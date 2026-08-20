import { describe, it, expect } from "vitest";
import {
  mergeTemplate,
  trackingToken,
  openPixelUrl,
  clickRedirectUrl,
  mockRecordingUrl,
  mockTranscript,
  slotsForDate,
  type BookingPageConfig,
} from "./comm.js";

describe("mergeTemplate", () => {
  it("replaces {{variable}} placeholders", () => {
    const result = mergeTemplate("Hello {{name}}, your deal is {{status}}.", {
      name: "Alice",
      status: "won",
    });
    expect(result).toBe("Hello Alice, your deal is won.");
  });

  it("replaces unmatched placeholders with empty string", () => {
    const result = mergeTemplate("Hello {{name}}", {});
    expect(result).toBe("Hello ");
  });

  it("handles multiple same variables", () => {
    const result = mergeTemplate("{{x}} and {{x}}", { x: "yes" });
    expect(result).toBe("yes and yes");
  });

  it("handles empty template", () => {
    expect(mergeTemplate("", { a: "1" })).toBe("");
  });

  it("supports dot-notation paths", () => {
    const result = mergeTemplate("{{contact.name}}", { contact: { name: "Bob" } });
    expect(result).toBe("Bob");
  });

  it("replaces null/undefined values with empty string", () => {
    const result = mergeTemplate("{{x}}", { x: null });
    expect(result).toBe("");
  });
});

describe("trackingToken", () => {
  it("generates a 32-char base64url token", () => {
    const token = trackingToken();
    // base64url: A-Z, a-z, 0-9, -, _
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => trackingToken()));
    expect(tokens.size).toBe(100);
  });
});

describe("openPixelUrl", () => {
  it("builds a URL with the token", () => {
    const url = openPixelUrl("abc123");
    expect(url).toContain("abc123");
    expect(url).toContain("/api/t/px/");
  });
});

describe("clickRedirectUrl", () => {
  it("builds a redirect URL with token and target", () => {
    const url = clickRedirectUrl("tok123", "https://example.com");
    expect(url).toContain("tok123");
    expect(url).toContain(encodeURIComponent("https://example.com"));
  });
});

describe("mockRecordingUrl", () => {
  it("builds a URL with the call id", () => {
    const url = mockRecordingUrl("call-42");
    expect(url).toContain("call-42");
    expect(url).toContain("/api/mock/media/calls/");
  });
});

describe("mockTranscript", () => {
  it("returns a non-empty string for inbound", () => {
    const t = mockTranscript("inbound");
    expect(typeof t).toBe("string");
    expect(t.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for outbound", () => {
    const t = mockTranscript("outbound");
    expect(t.length).toBeGreaterThan(0);
  });
});

describe("slotsForDate", () => {
  const baseConfig: BookingPageConfig = {
    id: "bp1",
    orgId: "org1",
    name: "Test",
    slug: "test",
    description: null,
    durationMins: 30,
    bufferMins: 15,
    hostPool: ["h1", "h2"],
    cursor: 0,
    availableDays: [1, 2, 3, 4, 5], // Mon-Fri
    startHour: 9,
    endHour: 17,
    timezone: "UTC",
    active: true,
  };

  it("returns time slots for a weekday", () => {
    // 2025-01-06 is a Monday (day 1)
    const slots = slotsForDate(baseConfig, "2025-01-06");
    expect(Array.isArray(slots)).toBe(true);
    expect(slots.length).toBeGreaterThan(0);
    // Each slot is an ISO date string
    expect(slots[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns empty for a day with no availability", () => {
    // 2025-01-04 is a Saturday (day 6) — not in availableDays
    const slots = slotsForDate(baseConfig, "2025-01-04");
    expect(slots).toEqual([]);
  });

  it("respects duration + buffer for slot spacing", () => {
    const slots = slotsForDate(baseConfig, "2025-01-06");
    // 9:00 to 17:00 = 480 mins; 30 min slots with 15 min buffer = 45 min total
    // 480 / 45 = 10.66 → 11 slots (9:00, 9:45, 10:30, …, 17:15 would exceed)
    // Actually: 0,45,90,135,180,225,270,315,360,405,450 → 450+30=480 ≤ 480 → 11 slots
    expect(slots.length).toBe(11);
  });
});
