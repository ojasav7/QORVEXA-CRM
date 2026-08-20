import { describe, it, expect } from "vitest";
import {
  EVENT_OBJECT_TYPES,
  TRIGGER_EVENTS,
  TRIGGERS_WITH_TO,
  CONDITION_OPS,
  parseWorkflowParts,
  workflowFingerprint,
} from "./automations.js";

describe("EVENT_OBJECT_TYPES", () => {
  it("maps common events to object types", () => {
    expect(EVENT_OBJECT_TYPES["deal.created"]).toBe("opportunity");
    expect(EVENT_OBJECT_TYPES["lead.created"]).toBe("lead");
    expect(EVENT_OBJECT_TYPES["contact.created"]).toBe("contact");
    expect(EVENT_OBJECT_TYPES["ticket.created"]).toBe("ticket");
  });

  it("has more than 5 events", () => {
    expect(Object.keys(EVENT_OBJECT_TYPES).length).toBeGreaterThanOrEqual(5);
  });
});

describe("TRIGGER_EVENTS", () => {
  it("includes deal.created", () => {
    expect(TRIGGER_EVENTS).toContain("deal.created");
  });

  it("includes lead.created", () => {
    expect(TRIGGER_EVENTS).toContain("lead.created");
  });
});

describe("TRIGGERS_WITH_TO", () => {
  it("includes deal.stage_changed", () => {
    expect(TRIGGERS_WITH_TO).toContain("deal.stage_changed");
  });

  it("includes ticket.status_changed", () => {
    expect(TRIGGERS_WITH_TO).toContain("ticket.status_changed");
  });
});

describe("CONDITION_OPS", () => {
  it("includes standard comparison operators", () => {
    expect(CONDITION_OPS).toContain("eq");
    expect(CONDITION_OPS).toContain("neq");
    expect(CONDITION_OPS).toContain("contains");
    expect(CONDITION_OPS).toContain("gt");
    expect(CONDITION_OPS).toContain("in");
  });
});

describe("parseWorkflowParts", () => {
  it("parses valid trigger", () => {
    const result = parseWorkflowParts({
      trigger: { kind: "event", event: "lead.created" },
      conditions: [],
      actions: [],
    });
    expect(result.trigger.event).toBe("lead.created");
  });

  it("throws on invalid/empty trigger event", () => {
    expect(() =>
      parseWorkflowParts({ trigger: { kind: "event", event: "" }, conditions: [], actions: [] })
    ).toThrow();
  });

  it("throws on unknown trigger event", () => {
    expect(() =>
      parseWorkflowParts({ trigger: { kind: "event", event: "nonexistent.event" }, conditions: [], actions: [] })
    ).toThrow();
  });
});

describe("workflowFingerprint", () => {
  it("returns a deterministic hash", () => {
    const parts = {
      trigger: { event: "lead.created" },
      conditions: [{ field: "source", op: "eq", value: "Website" }],
      actions: [{ type: "create_task", title: "Follow up" }],
    };
    const fp1 = workflowFingerprint(parts);
    const fp2 = workflowFingerprint(parts);
    expect(fp1).toBe(fp2);
    expect(fp1.length).toBeGreaterThan(0);
  });

  it("different inputs produce different fingerprints", () => {
    const fp1 = workflowFingerprint({ trigger: { event: "a" }, conditions: [], actions: [] });
    const fp2 = workflowFingerprint({ trigger: { event: "b" }, conditions: [], actions: [] });
    expect(fp1).not.toBe(fp2);
  });
});
