import { describe, it, expect } from "vitest";
import {
  filterSlashCommands,
  parseSlashCommand,
  SLASH_COMMANDS,
} from "@/lib/assistant/slash-commands";

describe("filterSlashCommands — fuzzy match", () => {
  it("empty query returns full catalog (in canonical order)", () => {
    expect(filterSlashCommands("")).toEqual(SLASH_COMMANDS);
  });

  it("exact prefix match returns the matching command", () => {
    const result = filterSlashCommands("clr"); // typo for clear
    // 'clr' is a subsequence of 'clear' (c..l..r): should match
    expect(result.find((c) => c.name === "clear")).toBeDefined();
  });

  it("startsWith ranks above subsequence: '/h' returns help first", () => {
    const result = filterSlashCommands("h");
    // help has prefix "h"; nothing else has prefix "h"
    expect(result[0]?.name).toBe("help");
  });

  it("typo: '/clr' matches 'clear' via subsequence", () => {
    const result = filterSlashCommands("clr");
    expect(result.map((c) => c.name)).toContain("clear");
  });

  it("typo: '/hp' matches 'help' via subsequence", () => {
    const result = filterSlashCommands("hp");
    expect(result.map((c) => c.name)).toContain("help");
  });

  it("non-match: '/xyz' returns []", () => {
    const result = filterSlashCommands("xyz");
    expect(result).toEqual([]);
  });

  it("case-insensitive: '/CLR' matches 'clear'", () => {
    const result = filterSlashCommands("CLR");
    expect(result.map((c) => c.name)).toContain("clear");
  });

  it("prefix outranks subsequence: 'l' returns 'list' before 'clear' (l in clear is subsequence)", () => {
    const result = filterSlashCommands("l");
    // 'list' starts with 'l' → score 100; 'clear' has 'l' at index 1 → subsequence score 50
    const listIdx = result.findIndex((c) => c.name === "list");
    const clearIdx = result.findIndex((c) => c.name === "clear");
    expect(listIdx).toBeLessThan(clearIdx);
  });
});

describe("parseSlashCommand", () => {
  it("'/' alone → send_literal (only slash, no command)", () => {
    expect(parseSlashCommand("/")).toEqual({ kind: "send_literal", text: "/" });
  });

  it("known command without args", () => {
    expect(parseSlashCommand("/clear")).toEqual({ kind: "clear" });
    expect(parseSlashCommand("/help")).toEqual({ kind: "help" });
    expect(parseSlashCommand("/list")).toEqual({ kind: "list" });
    expect(parseSlashCommand("/new")).toEqual({ kind: "new" });
  });

  it("/study with id", () => {
    expect(parseSlashCommand("/study s_abc")).toEqual({
      kind: "study",
      id: "s_abc",
    });
  });

  it("unknown verb → send_literal with raw text", () => {
    expect(parseSlashCommand("/foo bar")).toEqual({
      kind: "send_literal",
      text: "/foo bar",
    });
  });
});
