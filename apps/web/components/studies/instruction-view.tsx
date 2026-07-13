"use client";

/**
 * `InstructionView` — the 研究说明 tab (ADR-0015 Wave 2).
 *
 * Renders a single markdown editor for `Survey.instruction` plus two
 * action buttons: "生成 baseline" (LLM) and "从旧字段合成" (legacy
 * migration). The tab is intentionally minimal — it treats the
 * instruction as one free-form text field, matching the CLAUDE.md
 * mental model established in ADR-0015: one document, editor decides
 * structure, agent consumes markdown verbatim.
 *
 * Legacy migration:
 *   - "从旧字段合成" is only visible when `Survey.instruction` is empty
 *     AND at least one of the four legacy fields
 *     (moderatorInstruction / researchGoal / targetAudience /
 *     introScript) is populated. This lets researchers of pre-ADR-0015
 *     surveys bootstrap without spending an LLM call.
 *   - Once the researcher writes into the editor (making instruction
 *     non-empty), the legacy button hides — legacy fields become
 *     effectively orphaned and Wave 5's sunset will remove them.
 */

import { useCallback, useState, useTransition } from "react";
import { Loader2, Check, Sparkles, RefreshCw } from "lucide-react";

import { createLogger } from "@merism/observability";
import type { SurveyDraft } from "@merism/contracts";

import {
  generateInstructionBaselineAction,
  saveInstructionAction,
} from "@/lib/actions/instruction";
import { composeInstructionFromLegacy } from "@/lib/instruction/legacy-migration";

const log = createLogger("component.studies.instruction-view");

type SaveState = "idle" | "saving" | "saved" | "error";

export interface InstructionViewProps {
  surveyId: string;
  draft: SurveyDraft;
}

const ERROR_MESSAGE: Record<string, string> = {
  not_authenticated: "登录状态失效,请刷新页面后重试。",
  survey_not_found: "此调研已被删除或权限已变更。",
  no_questions: "先在「提纲」中添加至少一个问题,再生成研究说明。",
  generation_failed: "AI 生成失败,请稍后重试或直接编辑。",
  survey_not_owned: "你不是该调研的作者,无法保存修改。",
  internal_error: "保存失败,请稍后重试。",
};

export function InstructionView({ surveyId, draft }: InstructionViewProps) {
  const [markdown, setMarkdown] = useState<string>(draft.instruction ?? "");
  const [isGenerating, startGenerate] = useTransition();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const questionCount = draft.sections.reduce((n, s) => n + s.questions.length, 0);
  const legacyCompose = composeInstructionFromLegacy({
    researchGoal: draft.researchGoal,
    targetAudience: draft.targetAudience,
    introScript: draft.introScript,
    moderatorInstruction: draft.moderatorInstruction,
  });
  const legacyAvailable = markdown.trim() === "" && legacyCompose !== null;
  const dirty = markdown !== (draft.instruction ?? "");

  const handleGenerate = useCallback(() => {
    setGenerateError(null);
    startGenerate(async () => {
      const result = await generateInstructionBaselineAction(surveyId);
      if (!result.ok) {
        setGenerateError(ERROR_MESSAGE[result.error] ?? "生成失败,请重试。");
        log.warn("instruction.generate.failed", { surveyId, error: result.error });
        return;
      }
      setMarkdown(result.markdown);
      log.info("instruction.generate.ok", { surveyId, chars: result.markdown.length });
    });
  }, [surveyId]);

  const handleComposeFromLegacy = useCallback(() => {
    if (legacyCompose) setMarkdown(legacyCompose);
  }, [legacyCompose]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaveState("saving");
    const result = await saveInstructionAction(surveyId, markdown);
    if (!result.ok) {
      setSaveState("error");
      setSaveError(ERROR_MESSAGE[result.error] ?? "保存失败");
      log.warn("instruction.save.failed", { surveyId, error: result.error });
      return;
    }
    setSaveState("saved");
    log.info("instruction.save.ok", { surveyId, version: result.version });
    setTimeout(() => setSaveState("idle"), 1500);
  }, [surveyId, markdown]);

  return (
    <div className="flex h-full flex-col bg-mauve-50">
      {/* Header ------------------------------------------------------------- */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-ink-200 bg-ink-0 px-4">
        <div className="flex items-center gap-2">
          <p className="font-ui text-caption text-ink-400">研究说明 · AI 主持人运行指令</p>
          {dirty && <span className="text-caption text-mauve-400">· 未保存</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={questionCount === 0 || isGenerating}
            aria-disabled={questionCount === 0 || isGenerating}
            className="inline-flex h-9 items-center gap-2 rounded border border-ink-900 bg-ink-0 px-3 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-50 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              questionCount === 0
                ? "先在「提纲」中添加至少一个问题"
                : "使用 AI 基于当前问卷生成 baseline"
            }
          >
            {isGenerating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" strokeWidth={2} />
            )}
            {isGenerating ? "生成中…" : "生成 baseline"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saveState === "saving"}
            className="inline-flex h-9 items-center gap-2 rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveState === "saving" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : saveState === "saved" ? (
              <Check className="size-4" strokeWidth={2.5} />
            ) : null}
            {saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : "保存"}
          </button>
        </div>
      </div>

      {/* Body --------------------------------------------------------------- */}
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-6">
        {/* Description of what this field is for */}
        <div className="shrink-0 rounded-md border border-ink-100 bg-ink-0 p-4">
          <p className="font-ui text-body-sm text-ink-800">
            这里写的是 AI 访谈主持人的完整「运行说明」 —— 关于这次访谈的内容、注意事项、目标、访谈对象、开场与结束方式。
          </p>
          <p className="mt-2 font-ui text-caption text-ink-600 leading-5">
            访谈开始时,主持人会一次性加载这份文档并据此进行访谈。事后的分析(单次分析、研究聚合、报告)也会以此为背景。
            建议以 markdown 组织(建议 5 个 section:研究意图 / 访谈对象 / 主持行为要点 / 开场 / 结束),
            但格式完全自由 —— 你怎么写主持人就怎么读。
          </p>
          {legacyAvailable && (
            <div className="mt-3 flex items-center gap-3 rounded border border-dashed border-ink-200 bg-mauve-50 px-3 py-2">
              <p className="flex-1 font-ui text-caption text-ink-600">
                检测到旧版字段(研究目标 / 目标受众 / 开场 / 主持指令)。可从旧字段合成一份 markdown 骨架,
                或直接点「生成 baseline」由 AI 起草一份完整版。
              </p>
              <button
                type="button"
                onClick={handleComposeFromLegacy}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-ink-900 bg-ink-0 px-3 font-ui text-caption font-medium text-ink-900 transition-colors hover:bg-mauve-50"
              >
                <RefreshCw className="size-3.5" strokeWidth={2} />
                从旧字段合成
              </button>
            </div>
          )}
          {generateError && (
            <p className="mt-3 font-ui text-caption italic text-ink-900">⚠ {generateError}</p>
          )}
          {saveError && (
            <p className="mt-2 font-ui text-caption italic text-ink-900">⚠ {saveError}</p>
          )}
        </div>

        {/* Editor */}
        <label htmlFor="instruction-editor" className="sr-only">
          研究说明 markdown
        </label>
        <textarea
          id="instruction-editor"
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          placeholder={
            questionCount === 0
              ? "先在「提纲」tab 添加问题,再回来生成或撰写研究说明。"
              : "在这里写研究说明 —— 或点右上角「生成 baseline」让 AI 起草一份初稿。"
          }
          spellCheck={false}
          className="flex-1 resize-none rounded-md border border-ink-200 bg-ink-0 px-4 py-3 font-reading text-body leading-6 text-ink-900 shadow-inset-divider placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
        />
      </div>
    </div>
  );
}
