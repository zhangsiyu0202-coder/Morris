import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  HealthCheckSchema,
  HealthResponseSchema,
  HealthRoleSchema,
} from "@merism/contracts";

describe("contracts: HealthRoleSchema (REQ-3)", () => {
  it("accepts the documented roles", () => {
    for (const role of ["web", "interview", "agent", "function"] as const) {
      expect(HealthRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it("rejects an unknown role", () => {
    expect(HealthRoleSchema.safeParse("worker").success).toBe(false);
    expect(HealthRoleSchema.safeParse("").success).toBe(false);
    expect(HealthRoleSchema.safeParse(null).success).toBe(false);
  });
});

describe("contracts: HealthCheckSchema (REQ-3)", () => {
  it("parses an empty object (no checks ran)", () => {
    expect(HealthCheckSchema.safeParse({}).success).toBe(true);
  });

  it("parses a typical web readyz response", () => {
    const ok = HealthCheckSchema.parse({ http: true, appwrite: true, cache: true });
    expect(ok).toEqual({ http: true, appwrite: true, cache: true });
  });

  it("parses a draining response with no other fields", () => {
    const ok = HealthCheckSchema.parse({ shutting_down: true });
    expect(ok.shutting_down).toBe(true);
  });

  it("rejects unknown fields would be ignored or kept — schema is non-strict by default", () => {
    // Documented: schema is non-strict so adding a new dependency on the agent
    // side without bumping the contract doesn't crash the web probe. The web
    // ignores fields it didn't ask about.
    const parsed = HealthCheckSchema.parse({ http: true, futureField: "x" } as unknown);
    expect(parsed).toEqual({ http: true });
  });

  it("rejects non-boolean values for known fields", () => {
    expect(
      HealthCheckSchema.safeParse({ http: "yes" } as unknown).success,
    ).toBe(false);
    expect(
      HealthCheckSchema.safeParse({ appwrite: 1 } as unknown).success,
    ).toBe(false);
  });

  it("forbids a traceId field at the schema level (binding info-leak prevention)", () => {
    // The schema does NOT define `traceId`. If someone tried to round-trip a
    // payload with traceId, the schema would strip it (non-strict). This is
    // the desired behavior — probe responses MUST NOT carry server identifiers.
    const parsed = HealthCheckSchema.parse({ http: true, traceId: "x" } as unknown);
    expect((parsed as Record<string, unknown>).traceId).toBeUndefined();
  });

  it("HealthResponseSchema is identical to HealthCheckSchema", () => {
    // Both names exist for documentation clarity; they must accept the same
    // payloads. A drift here would be a contract bug.
    const payload = { http: true, appwrite: true };
    expect(HealthResponseSchema.parse(payload)).toEqual(HealthCheckSchema.parse(payload));
  });

  it("property: any boolean combination round-trips", () => {
    fc.assert(
      fc.property(
        fc.record({
          http: fc.option(fc.boolean(), { nil: undefined }),
          appwrite: fc.option(fc.boolean(), { nil: undefined }),
          livekit: fc.option(fc.boolean(), { nil: undefined }),
          cache: fc.option(fc.boolean(), { nil: undefined }),
          providers: fc.option(fc.boolean(), { nil: undefined }),
          shutting_down: fc.option(fc.boolean(), { nil: undefined }),
        }),
        (input) => {
          // Drop undefined keys (schema only accepts presence/absence).
          const cleaned = Object.fromEntries(
            Object.entries(input).filter(([, v]) => v !== undefined),
          );
          const once = HealthCheckSchema.parse(cleaned);
          expect(HealthCheckSchema.parse(once)).toEqual(once);
        },
      ),
    );
  });
});
