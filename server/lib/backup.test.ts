import { describe, it, expect } from "vitest";
import { validArchiveName, BUSINESS_MODELS, SNAPSHOT_MODELS } from "./backup.js";

describe("validArchiveName", () => {
  it("accepts alphanumeric, underscore, and hyphen names", () => {
    expect(validArchiveName("backup-2025-01-15T10-30-00")).toBe(true);
    expect(validArchiveName("snapshot_20250115")).toBe(true);
    expect(validArchiveName("my-backup_v2")).toBe(true);
  });

  it("rejects names with dots (no extension in the name)", () => {
    expect(validArchiveName("backup.zip")).toBe(false);
  });

  it("rejects names with path traversal", () => {
    expect(validArchiveName("../etc/passwd")).toBe(false);
    expect(validArchiveName("foo/../../bar")).toBe(false);
  });

  it("rejects names with special characters", () => {
    expect(validArchiveName("backup; rm -rf /")).toBe(false);
    expect(validArchiveName("backup`whoami`")).toBe(false);
    expect(validArchiveName("backup space")).toBe(false);
  });

  it("rejects empty names", () => {
    expect(validArchiveName("")).toBe(false);
  });
});

describe("model constants", () => {
  it("BUSINESS_MODELS includes core types", () => {
    expect(BUSINESS_MODELS).toContain("contact");
    expect(BUSINESS_MODELS).toContain("account");
    expect(BUSINESS_MODELS).toContain("lead");
    expect(BUSINESS_MODELS).toContain("opportunity");
  });

  it("SNAPSHOT_MODELS extends BUSINESS_MODELS with fieldDef", () => {
    expect(SNAPSHOT_MODELS).toContain("fieldDef");
    for (const m of BUSINESS_MODELS) {
      expect(SNAPSHOT_MODELS).toContain(m);
    }
  });
});
