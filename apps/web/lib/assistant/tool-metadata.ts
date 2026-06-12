/**
 * Morris 工具元数据 schema (R1 / morris-tool-metadata).
 *
 * 每个工具 builder (在 `lib/assistant/tools/<name>.ts`) 必须在返回值上声明
 * `metadata: ToolMetadata`, 由 `buildAssistantToolMetadata(ctx)` 聚合成 manifest
 * 视图供 approval / system-prompt / tool-results UI 消费。
 *
 * 设计取舍 (见 design.md §4):
 * - `ToolType` 用 as const 联合而非 enum, 避免 enum 编译产物的 tree-shaking 成本。
 * - `requiredScopes` 现在不强制, 只声明 — 留给将来 MCP / API key 化时审计。
 * - `enabled` 不带默认值, 强制每个 builder 显式表态 (借鉴 PostHog 60% 默认 false 哲学).
 * - 全 readonly, metadata 是值对象禁止就地修改; builder 每次调用返回新实例。
 *
 * 与本文件相关的契约:
 * - `validateToolMetadata` 是测试 (`metadata.test.ts`) 与 manifest 构造的共享校验入口。
 * - 任何新增字段必须同步: (a) ToolMetadata 接口 (b) validateToolMetadata 校验规则
 *   (c) tasks.md Wave G 文档段。
 */

/** 工具语义分类。 */
export type ToolType = "read" | "write" | "draft" | "meta";

/**
 * 工具语义三元组 — 决定 approval 流与 LLM 决策的核心元信息。
 * 借鉴自 PostHog `products/<name>/mcp/tools.yaml::annotations`。
 */
export interface ToolAnnotations {
  /** 工具不写 Appwrite / 不修改持久状态。 */
  readonly readOnly: boolean;
  /** 工具会破坏数据 (删除 / 不可逆覆盖); true 时自动走 approval guard。 */
  readonly destructive: boolean;
  /** 同样输入产出同样结果, 重试安全。 */
  readonly idempotent: boolean;
}

/** 单个工具的完整元数据。每个 builder 必须返回。 */
export interface ToolMetadata {
  /** UI 与 system prompt 中显示的短标题。 */
  readonly title: string;
  /** 给 LLM 的描述; 必含"做什么 / 何时用 / 关键参数". 长度 >= MIN_DESCRIPTION_CHARS. */
  readonly description: string;
  readonly annotations: ToolAnnotations;
  /**
   * 将来引入 MCP server / Personal API Key 时该工具需要的 scope. 现在仅声明不强制 —
   * approval guard 不读它, 但测试与未来审计读它。
   * `type === "meta"` 时必须为 [].
   */
  readonly requiredScopes: readonly string[];
  /**
   * Deep link 模板, `{key}` 占位符仅匹配 ASCII 标识符 [A-Za-z_][A-Za-z0-9_]*.
   * 形如 "/notebooks/{notebookShortId}"; 必含至少一个占位符 (纯静态 URL 应硬写卡片视觉)。
   */
  readonly enrichUrl?: string;
  readonly type: ToolType;
  /**
   * 工具是否暴露给 LLM. 默认建议 false, 显式开启需 PR reviewer 批准
   * (借鉴 PostHog 60% 默认禁用).
   */
  readonly enabled: boolean;
}

/** description 最低长度 (字符), `metadata.test.ts::K-METADATA-02` 强制. */
export const MIN_DESCRIPTION_CHARS = 120;

/** ASCII 标识符占位符正则; 与 page-context.ts / tool-template.ts 保持一致语义. */
export const ENRICH_URL_PLACEHOLDER_RE = /\{[A-Za-z_][A-Za-z0-9_]*\}/;

/** ToolType 全集, 测试与运行时校验共用. */
export const TOOL_TYPES: readonly ToolType[] = ["read", "write", "draft", "meta"] as const;

/**
 * 元数据自洽校验. 测试与 buildAssistantToolMetadata 共享.
 *
 * 返回 issue 字符串列表; 空列表表示 metadata 合规.
 * 每条 issue 含 toolName 前缀以便定位.
 *
 * 校验规则 (与 design.md §4 / requirements.md R1 对齐):
 * 1. title 非空。
 * 2. description.length >= MIN_DESCRIPTION_CHARS。
 * 3. type 在 TOOL_TYPES 内。
 * 4. type === "read" → annotations.readOnly === true && annotations.destructive === false。
 * 5. type === "draft" → annotations.readOnly === true。
 * 6. type === "meta" → annotations.readOnly === true && requiredScopes.length === 0。
 * 7. type === "write" → annotations 三项必须显式 boolean (不允许 undefined; TS 类型已强制, 这里防 cast 攻击)。
 * 8. enrichUrl 存在 → 必含至少一个 {key} 占位符。
 * 9. requiredScopes 元素必须是非空字符串。
 */
export function validateToolMetadata(toolName: string, m: ToolMetadata): string[] {
  const issues: string[] = [];

  if (!m.title.trim()) {
    issues.push(`${toolName}.title is empty`);
  }

  if (m.description.length < MIN_DESCRIPTION_CHARS) {
    issues.push(
      `${toolName}.description.length=${m.description.length}, expected >= ${MIN_DESCRIPTION_CHARS}`,
    );
  }

  if (!TOOL_TYPES.includes(m.type)) {
    issues.push(`${toolName}.type="${m.type}" not in [${TOOL_TYPES.join(", ")}]`);
  }

  // type ↔ annotations 互斥约束
  if (m.type === "read" || m.type === "draft" || m.type === "meta") {
    if (m.annotations.readOnly !== true) {
      issues.push(`${toolName}.type=${m.type} requires annotations.readOnly === true`);
    }
  }
  if (m.type === "read" && m.annotations.destructive !== false) {
    issues.push(`${toolName}.type=read requires annotations.destructive === false`);
  }
  if (m.type === "meta" && m.requiredScopes.length !== 0) {
    issues.push(`${toolName}.type=meta requires requiredScopes === []`);
  }

  // 防 cast 攻击: 即使 TS 通过, 运行时也要确保 annotations 三项是 boolean
  for (const k of ["readOnly", "destructive", "idempotent"] as const) {
    if (typeof m.annotations[k] !== "boolean") {
      issues.push(`${toolName}.annotations.${k} must be boolean, got ${typeof m.annotations[k]}`);
    }
  }

  if (m.enrichUrl !== undefined && !ENRICH_URL_PLACEHOLDER_RE.test(m.enrichUrl)) {
    issues.push(
      `${toolName}.enrichUrl="${m.enrichUrl}" lacks {key} placeholder; drop the field instead`,
    );
  }

  for (let i = 0; i < m.requiredScopes.length; i++) {
    const s = m.requiredScopes[i];
    if (typeof s !== "string" || s.length === 0) {
      issues.push(`${toolName}.requiredScopes[${i}] must be non-empty string`);
    }
  }

  return issues;
}

/**
 * 当 ToolResult UI 拿不到对应 metadata (理论上不应发生, 但作为防御性 fallback)
 * 时使用的占位元数据. 不应在生产代码中直接构造 — 用 buildAssistantToolMetadata.
 */
export const UNKNOWN_TOOL_METADATA: ToolMetadata = Object.freeze({
  title: "Unknown tool",
  description:
    "Placeholder metadata for tools that are not registered in buildAssistantToolMetadata. " +
    "If you see this in production it is a registration bug — check tools.ts to ensure the tool is in both " +
    "buildAssistantTools and buildAssistantToolMetadata.",
  annotations: Object.freeze({ readOnly: true, destructive: false, idempotent: true }) as ToolAnnotations,
  requiredScopes: Object.freeze([]) as readonly string[],
  type: "meta",
  enabled: false,
}) as ToolMetadata;
