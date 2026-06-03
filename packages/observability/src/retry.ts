// Retry wrapper for external provider calls (LLM/STT/TTS). Mirrors
// apps/agent/agent/retry.py. Retries TransientProviderError with exponential
// backoff; PermanentProviderError is never retried.

export class TransientProviderError extends Error {}
export class PermanentProviderError extends Error {}

export interface RetryOptions {
  maxAttempts?: number;
  backoff?: "exponential";
  baseDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 200 } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PermanentProviderError) throw err;
      if (!(err instanceof TransientProviderError)) throw err;
      attempt += 1;
      if (attempt >= maxAttempts) throw err;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
