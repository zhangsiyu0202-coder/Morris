/**
 * analyzeSurvey 二段式 rollup (analysis-report-v2 R4 / design §7).
 *
 * 三阶段 LLM + 一个纯函数 enrichSurveyThemes:
 *   Stage 1 — extractThemesWithLLM       (LLM, 不带归属)
 *   Stage 2 — assignThemesWithLLM        (LLM, 决定每个 session 归哪个 theme)
 *   Pure   — enrichSurveyThemes          (代码, 算 mentions/pct, 拆 themes vs themeContexts)
 *   Stage 3 — composeInsightsAndCitations (LLM, 写 insights/citations/topics/sentimentBreakdown
 *                                          + themeSentiments + questionSummaries)
 *
 * 中间态 schema 与类型按 D14 决策**只在本文件内**定义,不上 contracts。
 */

import { z } from "zod";

import type {
  GenerationMeta,
  SurveyAnalysisReportOutput,
} from "@merism/contracts";

import type { SessionLevelReport } from "./handler.js";

// ============================================================================
// 中间态 zod schemas (D14: 本地, 不上 contracts)
// ============================================================================

const SegmentRefSchema = z.object({
  transcriptId: z.string(),
  segmentIndex: z.number().int().nonnegative(),
});

export const ExtractedThemeSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  description: z.string(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  indicators: z.array(z.string()).optional(),
});
export const ExtractedThemesListSchema = z.object({
  themes: z.array(ExtractedThemeSchema),
});

export const ThemeAssignmentSchema = z.object({
  themeId: z.string(),
  sessionIds: z.array(z.string()),
  evidenceRefs: z.array(SegmentRefSchema),
});
export const ThemeAssignmentListSchema = z.object({
  assignments: z.array(ThemeAssignmentSchema),
});

const SentimentEnum = z.enum(["positive", "neutral", "negative"]);

export const ComposeInsightsOutputSchema = z.object({
  insights: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      text: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  citations: z.array(
    z.object({
      segmentRef: SegmentRefSchema,
      quote: z.string(),
      themeIds: z.array(z.string()),
    }),
  ),
  topics: z.array(z.string()),
  sentimentBreakdown: z.array(
    z.object({
      sentiment: SentimentEnum,
      count: z.number().int().nonnegative(),
    }),
  ),
  themeSentiments: z.record(z.string(), SentimentEnum),
  questionSummaries: z.record(z.string(), z.string()),
});

export type ExtractedTheme = z.infer<typeof ExtractedThemeSchema>;
export type ExtractedThemes = z.infer<typeof ExtractedThemesListSchema>;
export type ThemeAssignment = z.infer<typeof ThemeAssignmentSchema>;
export type ThemeAssignments = z.infer<typeof ThemeAssignmentListSchema>;
export type ComposeInsightsOutput = z.infer<typeof ComposeInsightsOutputSchema>;

// ============================================================================
// 中间态运行时类型 (Function 内存, 不出 Function)
// ============================================================================

export type SurveyTheme = SurveyAnalysisReportOutput["themes"][number];
/** SurveyTheme 缺 sentiment 形态 — sentiment 由 stage-3 compose LLM 推导后回填。 */
export type SurveyThemePreSentiment = Omit<SurveyTheme, "sentiment">;

export interface ThemeContext {
  id: string;
  label: string;
  description: string;
  evidenceRefs: Array<{ transcriptId: string; segmentIndex: number }>;
}

export interface EnrichedRollupThemes {
  themes: SurveyThemePreSentiment[];
  themeContexts: ThemeContext[];
}

// ============================================================================
// 纯函数 (P-ANL-07 在这一层锁死)
// ============================================================================

/**
 * 把 stage-1 themes + stage-2 assignments 折成最终落库的 themes (缺 sentiment)
 * 与 themeContexts (Function 内存)。无随机性,无 LLM 调用 — P-ANL-07 在这里锁死。
 *
 * - mentions = sessionIds.length
 * - pct      = round(mentions / totalSessions × 100, 2)
 * - mentions === 0 的 theme 直接丢弃
 * - 总 share > 1.0 + ε 时按 mentions 降序 normalize 到 1.0 之内 (P-ANL-04)
 */
export function enrichSurveyThemes(
  themes: ExtractedTheme[],
  assignments: ThemeAssignment[],
  totalSessions: number,
): EnrichedRollupThemes {
  const byThemeId = new Map(assignments.map((a) => [a.themeId, a]));

  const blocks = themes
    .map((t) => {
      const a = byThemeId.get(t.id);
      const sessionIds = a?.sessionIds ?? [];
      const evidenceRefs = a?.evidenceRefs ?? [];
      const mentions = sessionIds.length;
      const pct = totalSessions > 0
        ? Math.min(100, Math.round((mentions / totalSessions) * 10_000) / 100)
        : 0;
      return {
        id: t.id,
        label: t.label,
        description: t.description,
        mentions,
        pct,
        evidenceRefs,
      };
    })
    .filter((b) => b.mentions > 0);

  const totalShare = blocks.reduce((s, b) => s + b.pct / 100, 0);
  if (totalShare > 1.0 + 1e-6) {
    const factor = 1.0 / totalShare;
    blocks.sort((a, b) => b.mentions - a.mentions);
    for (const b of blocks) {
      b.pct = Math.round(b.pct * factor * 100) / 100;
    }
  }

  return {
    themes: blocks.map((b) => ({
      id: b.id,
      label: b.label,
      mentions: b.mentions,
      pct: b.pct,
    })),
    themeContexts: blocks.map((b) => ({
      id: b.id,
      label: b.label,
      description: b.description,
      evidenceRefs: b.evidenceRefs,
    })),
  };
}

/**
 * 把 stage-3 输出的 themeSentiments 回填到 themes,得到最终 SurveyTheme[] 落库形态。
 * sentiment 缺失 → 默认 "neutral"。
 */
export function applyThemeSentiments(
  themesPreSentiment: SurveyThemePreSentiment[],
  themeSentiments: Record<string, "positive" | "neutral" | "negative">,
): SurveyTheme[] {
  return themesPreSentiment.map((t) => ({
    ...t,
    sentiment: themeSentiments[t.id] ?? "neutral",
  }));
}

// ============================================================================
// 编排辅助: 聚合 createdWith 元数据
// ============================================================================

export function buildGenerationMeta(args: {
  promptVersion: string;
  attemptCount: number;
  hallucinationRatio: number;
  models: {
    extract: string;
    assign: string;
    compose: string;
    combine?: string;
  };
  /** Number of extract LLM calls (>=1). Default 1 (single-chunk path). */
  extractChunkCount?: number;
  /** Number of assign LLM calls (>=1). Default 1. */
  assignChunkCount?: number;
}): GenerationMeta {
  const extractCount = args.extractChunkCount ?? 1;
  const assignCount = args.assignChunkCount ?? 1;
  const createdWith: Array<{ stage: string; model: string }> = [];
  for (let i = 0; i < extractCount; i++) {
    createdWith.push({ stage: "extract", model: args.models.extract });
  }
  // combine stage only present when extract was chunked (extractChunkCount > 1)
  if (extractCount > 1) {
    createdWith.push({
      stage: "combine",
      model: args.models.combine ?? args.models.extract,
    });
  }
  for (let i = 0; i < assignCount; i++) {
    createdWith.push({ stage: "assign", model: args.models.assign });
  }
  createdWith.push({ stage: "compose", model: args.models.compose });
  return {
    promptVersion: args.promptVersion,
    attemptCount: args.attemptCount,
    hallucinationRatio: args.hallucinationRatio,
    createdWith,
  };
}

// =====================================================================
// Wave F (D15): chunk + combination 三段式纯函数
// =====================================================================

/**
 * 把 items 按 size 切成 chunks; 最后一 chunk 可不满。
 * 性质 (P-ANL-08): concat ∘ chunkSessionReports(_, size) === id (无丢失/重复/乱序)。
 */
export function chunkSessionReports<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error("chunkSessionReports: size must be a positive integer");
  }
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * 合并多份 ThemeAssignments:
 *   - 按 themeId 合并 sessionIds (dedupe within a theme)
 *   - 合并 evidenceRefs (dedupe by `transcriptId#segmentIndex`)
 *   - 输出 themeId 顺序 = 首次出现顺序 (确定性)
 *
 * 性质 (P-ANL-08):
 *   - 结合律: merge(merge(a, b), c) === merge(a, merge(b, c))
 *   - 交换律: merge(a, b) ≡ merge(b, a) (字段集层面相等; 顺序由 first-seen 规则确定)
 *   - 同一 (themeId, sessionId) 不重计 -> 保护 P-ANL-07 mentions 精确性
 */
export function mergeThemeAssignments(
  list: readonly ThemeAssignments[],
): ThemeAssignments {
  const order: string[] = [];
  const sessionSets = new Map<string, Set<string>>();
  const evidenceSets = new Map<string, Set<string>>();
  const evidenceLists = new Map<
    string,
    Array<{ transcriptId: string; segmentIndex: number }>
  >();
  for (const piece of list) {
    for (const a of piece.assignments) {
      if (!sessionSets.has(a.themeId)) {
        order.push(a.themeId);
        sessionSets.set(a.themeId, new Set());
        evidenceSets.set(a.themeId, new Set());
        evidenceLists.set(a.themeId, []);
      }
      const sessSet = sessionSets.get(a.themeId)!;
      for (const sid of a.sessionIds) sessSet.add(sid);
      const evSet = evidenceSets.get(a.themeId)!;
      const evList = evidenceLists.get(a.themeId)!;
      for (const ref of a.evidenceRefs) {
        const key = `${ref.transcriptId}#${ref.segmentIndex}`;
        if (!evSet.has(key)) {
          evSet.add(key);
          evList.push(ref);
        }
      }
    }
  }
  return {
    assignments: order.map((themeId) => ({
      themeId,
      sessionIds: Array.from(sessionSets.get(themeId)!),
      evidenceRefs: evidenceLists.get(themeId)!,
    })),
  };
}
