import { describe, it, expect } from "vitest";
import { usageMeter } from "../billing-data";

describe("workspace-billing usageMeter", () => {
  it("clamps pct to 100 and flags over at/above the allowance", () => {
    expect(usageMeter(50, 200)).toEqual({ used: 50, included: 200, pct: 25, over: false });
    expect(usageMeter(200, 200).over).toBe(true);
    expect(usageMeter(500, 200).pct).toBe(100);
  });
  it("handles a zero allowance without dividing by zero", () => {
    expect(usageMeter(3, 0)).toEqual({ used: 3, included: 0, pct: 0, over: false });
  });
});
