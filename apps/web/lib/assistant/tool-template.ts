/**
 * Morris 工具 contextPromptTemplate 渲染器 (R2 / morris-agent-hardening).
 *
 * 借鉴 hogai `MaxTool.format_context_prompt_injection` 的语义:
 * - 只替换 `{key}` 形式 (key ∈ /^[A-Za-z_][A-Za-z0-9_]*$/), 避免误吞代码里的 `{}`。
 * - 命中 ctx 的 string/number/boolean → String(value)。
 * - 命中 ctx 的对象/数组 → JSON.stringify(value)。
 * - 命中 ctx 但值为 null/undefined / 缺键 → 替换为字面量 "None" 并 console.warn。
 * - 不展开 `{a.b}` 嵌套, 不支持 mustache 三括号; 保持渲染规则简单可证。
 */

const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function renderContextPromptTemplate(
  template: string,
  ctx: Record<string, unknown>,
  toolName?: string,
): string {
  return template.replace(PLACEHOLDER_RE, (_, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(ctx, key)) {
      console.warn(`[assistant] context template (${toolName ?? "?"}) missing key: ${key}`);
      return "None";
    }
    const value = (ctx as Record<string, unknown>)[key];
    if (value === undefined || value === null) {
      console.warn(`[assistant] context template (${toolName ?? "?"}) key "${key}" is null/undefined`);
      return "None";
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return JSON.stringify(value);
  });
}
