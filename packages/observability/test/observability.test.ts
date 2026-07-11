import { describe, it, expect } from "vitest";
import {
  createLogger,
  getRuntimeTraceId,
  runWithRuntimeContext,
  withRetry,
  TransientProviderError,
  PermanentProviderError,
  maskSecret,
} from "../src/index.js";

describe("observability", () => {
  it("masks secrets", () => {
    expect(maskSecret("supersecretvalue")).toBe("supe***");
    expect(maskSecret(undefined)).toBe("");
  });

  it("retries transient then succeeds", async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        n += 1;
        if (n < 3) throw new TransientProviderError("x");
        return "ok";
      },
      { baseDelayMs: 0 },
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });

  it("never retries permanent", async () => {
    let n = 0;
    await expect(
      withRetry(async () => {
        n += 1;
        throw new PermanentProviderError("bad");
      }),
    ).rejects.toBeInstanceOf(PermanentProviderError);
    expect(n).toBe(1);
  });

  it("inherits trace id from runtime scope", () => {
    const traceId = "123e4567-e89b-12d3-a456-426614174000";
    runWithRuntimeContext({ traceId }, () => {
      expect(getRuntimeTraceId()).toBe(traceId);
      expect(createLogger("test").traceId).toBe(traceId);
    });
  });
});
