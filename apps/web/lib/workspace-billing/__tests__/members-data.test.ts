import { describe, it, expect } from "vitest";
import { seatUsage } from "../members-data";
import { getMockMembers } from "@/lib/mock/workspace-billing";

describe("workspace-billing seatUsage", () => {
  it("counts active + invited (owner included) against seats", () => {
    const v = getMockMembers(); // 5 seats, 4 members (1 invited)
    const u = seatUsage(v.members, v.seats);
    expect(u.used).toBe(4);
    expect(u.remaining).toBe(1);
    expect(u.full).toBe(false);
  });

  it("reports full and never-negative remaining at/over capacity", () => {
    const v = getMockMembers();
    const u = seatUsage(v.members, 4);
    expect(u.used).toBe(4);
    expect(u.full).toBe(true);
    expect(u.remaining).toBe(0);
    expect(seatUsage(v.members, 2).remaining).toBe(0); // over capacity -> clamped, not negative
  });
});
