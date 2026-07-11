/**
 * Morris LLM 错误分类 (R4 / morris-agent-hardening).
 *
 * 把 `@ai-sdk/deepseek` + 底层 fetch 抛出的各种错误归到 5 类:
 * - client    : 4xx / 422 / "context length" 等 "重试无意义" 错。
 * - api       : 401 / 403 / model not found 等 "鉴权或配置失败" 错。
 * - transient : 429 / 5xx / timeout / overloaded, 重试有用。
 * - transport : 网络层(fetch failed / ECONNRESET / ETIMEDOUT 等)。
 * - unknown   : 兜底, 保证函数总能返回一个 MorrisError。
 *
 * 判定规则:取 `err.status` / `err.code` / `err.name` / `String(err.message)`
 * 拼一个统一字符串小写后做 includes 匹配。优先级从上到下,命中即返回 (P-AI-04
 * 互斥)。绝不读 stack。
 */

export type MorrisErrorKind = "client" | "api" | "transient" | "transport" | "unknown";

export interface MorrisError {
  readonly kind: MorrisErrorKind;
  /** 给前端展示的中文文案。已脱敏。 */
  readonly userMessage: string;
  /** 给服务端日志的简短说明。不含 stack/api key。 */
  readonly detail: string;
  /** 透传原错误,仅给 server log,绝不送客户端。 */
  readonly cause?: unknown;
}

const USER_MESSAGES: Record<MorrisErrorKind, string> = {
  client: "对话过长或参数无效,请新建对话试试。",
  api: "AI 服务鉴权或配置失败,请联系管理员。",
  transient: "AI 服务暂时不可用,请稍后再试。",
  transport: "网络连接不稳定,请稍后再试。",
  unknown: "AI 助手处理时出现问题,请重试。",
};

/** 从错误对象抽取一段可匹配的小写字符串 (status/code/name/message 拼起来)。 */
function fingerprint(err: unknown): string {
  if (err == null) return "";
  if (typeof err !== "object") return String(err).toLowerCase();
  const e = err as { status?: unknown; code?: unknown; name?: unknown; message?: unknown };
  const parts: string[] = [];
  if (e.status !== undefined && e.status !== null) parts.push(`status=${String(e.status)}`);
  if (e.code !== undefined && e.code !== null) parts.push(`code=${String(e.code)}`);
  if (e.name !== undefined && e.name !== null) parts.push(`name=${String(e.name)}`);
  if (e.message !== undefined && e.message !== null) parts.push(`msg=${String(e.message)}`);
  return parts.join(" ").toLowerCase();
}

function statusOf(err: unknown): number | null {
  if (err && typeof err === "object") {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
    if (typeof s === "string" && /^\d+$/.test(s)) return Number(s);
  }
  return null;
}

const CLIENT_PATTERNS = [
  "context length",
  "maximum context",
  "context_length_exceeded",
  "invalid_request",
  "invalid request",
  "ai_invalidargumenterror",
  "tool_use_failed",
  "validation",
];

const API_PATTERNS = [
  "api key",
  "api_key",
  "unauthorized",
  "forbidden",
  "model not found",
  "model_not_found",
  "does not exist",
  "permission_denied",
];

const TRANSIENT_PATTERNS = [
  "rate limit",
  "rate_limit",
  "too many requests",
  "overloaded",
  "server_error",
  "internal_server_error",
  "service unavailable",
  "service_unavailable",
  "bad gateway",
  "gateway timeout",
  "timeout",
  "timed out",
  "aborterror",
];

const TRANSPORT_PATTERNS = [
  "fetch failed",
  "econnreset",
  "econnrefused",
  "etimedout",
  "enotfound",
  "und_err_",
  "socket hang up",
  "network error",
];

/** 把任意错误归入 5 类之一,返回 MorrisError (用户文案 + 服务端简述)。
 *
 * 优先级 (P-AI-04 互斥):
 *   1. 具名 api patterns       (api_key / model_not_found / permission_denied)
 *   2. 具名 client patterns    (context_length / invalid_request / tool_use_failed)
 *   3. status === 401 / 403    → api
 *   4. status 4xx (非 429)     → client
 *   5. status === 429 / 5xx    → transient
 *   6. 具名 transient patterns (rate_limit / overloaded / timeout / aborterror)
 *   7. 具名 transport patterns (fetch failed / ECONNRESET / ENOTFOUND ...)
 *   8. unknown
 *
 * 把"具名 api patterns"放在最前面是为了让 `code=model_not_found` 这种
 * 实际配置错(provider 一般用 status=400 + code 上报)被准确归到 api,
 * 而不是被 4xx 抢先归到 client。
 */
export function classifyMorrisError(err: unknown): MorrisError {
  const fp = fingerprint(err);
  const status = statusOf(err);

  if (API_PATTERNS.some((p) => fp.includes(p))) return makeError("api", err, fp);
  if (CLIENT_PATTERNS.some((p) => fp.includes(p))) return makeError("client", err, fp);
  if (status === 401 || status === 403) return makeError("api", err, fp);
  if (status !== null && status >= 400 && status < 500 && status !== 429) {
    return makeError("client", err, fp);
  }
  if (status === 429 || (status !== null && status >= 500 && status < 600)) {
    return makeError("transient", err, fp);
  }
  if (TRANSIENT_PATTERNS.some((p) => fp.includes(p))) return makeError("transient", err, fp);
  if (TRANSPORT_PATTERNS.some((p) => fp.includes(p))) return makeError("transport", err, fp);
  return makeError("unknown", err, fp);
}

function makeError(kind: MorrisErrorKind, cause: unknown, fp: string): MorrisError {
  return {
    kind,
    userMessage: USER_MESSAGES[kind],
    // detail 是给服务端日志的;限长,且不含 stack。fp 已是小写拼接。
    detail: fp.slice(0, 240),
    cause,
  };
}

/** 给指定 kind 的标准用户文案 (前端单测用)。 */
export function userMessageFor(kind: MorrisErrorKind): string {
  return USER_MESSAGES[kind];
}
