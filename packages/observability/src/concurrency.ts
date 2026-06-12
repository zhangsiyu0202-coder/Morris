/**
 * LLM provider 并发上限 gate (R6).
 *
 * 单进程内一个全局 gate 防止撞 DeepSeek RPM. 跨进程限流 (web + functions
 * 同时压测) 不在范围 — 当前 single-instance 足够.
 *
 * env `MERISM_LLM_MAX_CONCURRENT` 可调, 默认 8.
 */

import pLimit from "p-limit";

const DEFAULT_MAX = 8;

function readMaxFromEnv(): number {
  const raw = process.env.MERISM_LLM_MAX_CONCURRENT;
  if (!raw) return DEFAULT_MAX;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX;
  return n;
}

/**
 * Create a fresh concurrency gate. 测试用 (隔离 state) 或希望多个独立 gate.
 * production 一律用导出的 `llmGate`.
 */
export function createLLMConcurrencyGate(max: number) {
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error(`createLLMConcurrencyGate: max must be positive, got ${max}`);
  }
  return pLimit(max);
}

/** Process-wide gate. 共享 — withLLMCall + middleware 都走它. */
export const llmGate = pLimit(readMaxFromEnv());
