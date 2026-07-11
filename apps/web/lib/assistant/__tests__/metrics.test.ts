import { describe, it, expect, beforeEach } from "vitest";

import { morrisErrorCounter, getCounts, resetCounts } from "../metrics";

beforeEach(() => {
  resetCounts();
});

describe("morrisErrorCounter", () => {
  it("starts at zero", () => {
    expect(getCounts()).toEqual({
      client: 0,
      api: 0,
      transient: 0,
      transport: 0,
      unknown: 0,
    });
  });

  it("increments per kind independently", () => {
    morrisErrorCounter.inc("client");
    morrisErrorCounter.inc("client");
    morrisErrorCounter.inc("api");
    expect(getCounts()).toEqual({
      client: 2,
      api: 1,
      transient: 0,
      transport: 0,
      unknown: 0,
    });
  });

  it("getCounts returns a snapshot, not a live reference", () => {
    morrisErrorCounter.inc("transient");
    const snap = getCounts();
    morrisErrorCounter.inc("transient");
    expect(snap.transient).toBe(1);
    expect(getCounts().transient).toBe(2);
  });

  it("resetCounts wipes back to zero", () => {
    morrisErrorCounter.inc("transport");
    resetCounts();
    expect(getCounts()).toEqual({
      client: 0,
      api: 0,
      transient: 0,
      transport: 0,
      unknown: 0,
    });
  });
});
