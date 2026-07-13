import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Next.js web health route", () => {
  it("escapes the leading underscore in the physical app-router segment", () => {
    const appDirectory = resolve(process.cwd(), "apps/web/app");

    expect(existsSync(resolve(appDirectory, "%5Fhealth/livez/route.ts"))).toBe(true);
    expect(existsSync(resolve(appDirectory, "%5Fhealth/readyz/route.ts"))).toBe(true);
    expect(existsSync(resolve(appDirectory, "_health/readyz/route.ts"))).toBe(false);
  });
});
