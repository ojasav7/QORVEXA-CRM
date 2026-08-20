import { describe, it, expect } from "vitest";
import { canonicalEmail, memberRef, parseMemberRef, BEHAVIOR_TYPES } from "./cdp.js";

describe("canonicalEmail", () => {
  it("lowercases and trims", () => {
    expect(canonicalEmail("  Alice@Example.COM  ")).toBe("alice@example.com");
  });

  it("handles already canonical", () => {
    expect(canonicalEmail("bob@test.com")).toBe("bob@test.com");
  });

  it("trims whitespace", () => {
    expect(canonicalEmail("  x@y.com  ")).toBe("x@y.com");
  });
});

describe("memberRef", () => {
  it("creates type:id format", () => {
    expect(memberRef("contact", "abc")).toBe("contact:abc");
  });

  it("works with different types", () => {
    expect(memberRef("lead", "xyz")).toBe("lead:xyz");
  });
});

describe("parseMemberRef", () => {
  it("parses contact:id", () => {
    const result = parseMemberRef("contact:abc123");
    expect(result).toEqual({ type: "contact", id: "abc123" });
  });

  it("parses lead:id", () => {
    const result = parseMemberRef("lead:xyz789");
    expect(result).toEqual({ type: "lead", id: "xyz789" });
  });

  it("handles ids with colons (edge case)", () => {
    const result = parseMemberRef("contact:a:b:c");
    expect(result.type).toBe("contact");
    expect(result.id).toBe("a:b:c");
  });
});

describe("BEHAVIOR_TYPES", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(BEHAVIOR_TYPES)).toBe(true);
    expect(BEHAVIOR_TYPES.length).toBeGreaterThan(0);
  });

  it("includes common behavior types", () => {
    expect(BEHAVIOR_TYPES).toContain("page_view");
    expect(BEHAVIOR_TYPES).toContain("email_opened");
  });
});
