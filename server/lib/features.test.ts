import { describe, it, expect } from "vitest";
import { KNOWN_FEATURES } from "./features.js";

describe("KNOWN_FEATURES", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(KNOWN_FEATURES)).toBe(true);
    expect(KNOWN_FEATURES.length).toBeGreaterThan(10);
  });

  it("every feature has required fields", () => {
    for (const f of KNOWN_FEATURES) {
      expect(typeof f.key).toBe("string");
      expect(f.key.length).toBeGreaterThan(0);
      expect(typeof f.label).toBe("string");
      expect(typeof f.description).toBe("string");
      expect(typeof f.enabledDefault).toBe("boolean");
      expect(Array.isArray(f.plans)).toBe(true);
      expect(f.plans.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate keys", () => {
    const keys = KNOWN_FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes core CRM features", () => {
    const keys = KNOWN_FEATURES.map((f) => f.key);
    expect(keys).toContain("comm.email");
    expect(keys).toContain("comm.calling");
    expect(keys).toContain("comm.calendar");
    expect(keys).toContain("automation.workflows");
    expect(keys).toContain("service.tickets");
    expect(keys).toContain("ai.assistant");
    expect(keys).toContain("ai.agents");
  });

  it("includes Phase 16 relevant features", () => {
    const keys = KNOWN_FEATURES.map((f) => f.key);
    expect(keys).toContain("marketing.campaigns");
    expect(keys).toContain("marketing.landing");
    expect(keys).toContain("cdp.profiles");
    expect(keys).toContain("revenue.products");
  });
});
