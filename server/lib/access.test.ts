import { describe, it, expect } from "vitest";
import { assertCanAccess, listConditions, listWhere, VISIBILITY_OWNER, VISIBILITY_ORG } from "./access.js";

const adminUser = { id: "u1", role: "admin", orgId: "org1", environment: "production" } as any;
const repUser = { id: "u2", role: "rep", orgId: "org1", environment: "production" } as any;
const managerUser = { id: "u3", role: "manager", orgId: "org1", environment: "production" } as any;

describe("assertCanAccess", () => {
  it("admin can access org records matching their environment", () => {
    expect(() => assertCanAccess(adminUser, { orgId: "org1", ownerId: "other", environment: "production" })).not.toThrow();
  });

  it("admin cannot access records with mismatched environment", () => {
    expect(() => assertCanAccess(adminUser, { orgId: "org1", ownerId: "other", environment: "sandbox" })).toThrow();
  });

  it("admin cannot access records in a different org", () => {
    expect(() => assertCanAccess(adminUser, { orgId: "org2", ownerId: "u1", environment: "production" })).toThrow();
  });

  it("rep can access their own records", () => {
    expect(() => assertCanAccess(repUser, { orgId: "org1", ownerId: "u2", visibility: "owner", environment: "production" })).not.toThrow();
  });

  it("rep can access org-visible records", () => {
    expect(() => assertCanAccess(repUser, { orgId: "org1", ownerId: "other", visibility: "org", environment: "production" })).not.toThrow();
  });

  it("rep cannot access owner-visibility records they don't own", () => {
    expect(() => assertCanAccess(repUser, { orgId: "org1", ownerId: "other", visibility: "owner", environment: "production" })).toThrow();
  });

  it("rep cannot access records from a different org", () => {
    expect(() => assertCanAccess(repUser, { orgId: "org2", ownerId: "u2", environment: "production" })).toThrow();
  });

  it("manager can access org-scoped records", () => {
    expect(() => assertCanAccess(managerUser, { orgId: "org1", ownerId: "x", visibility: VISIBILITY_ORG, environment: "production" })).not.toThrow();
  });

  it("defaults visibility to org when missing", () => {
    // rep accessing a record with no visibility → defaults to org → allowed
    expect(() => assertCanAccess(repUser, { orgId: "org1", ownerId: "other", environment: "production" })).not.toThrow();
  });
});

describe("listConditions", () => {
  it("admin gets org+environment scope", () => {
    const conditions = listConditions(adminUser);
    expect(conditions).toEqual([{ orgId: "org1", environment: "production" }]);
  });

  it("rep gets OR condition (org-visible OR owned)", () => {
    const conditions = listConditions(repUser);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].orgId).toBe("org1");
    expect(conditions[0].environment).toBe("production");
    expect(conditions[0].OR).toEqual([
      { visibility: VISIBILITY_ORG },
      { ownerId: "u2" },
    ]);
  });

  it("rep with custom owner field", () => {
    const conditions = listConditions(repUser, "authorId");
    expect(conditions[0].OR).toEqual([
      { visibility: VISIBILITY_ORG },
      { authorId: "u2" },
    ]);
  });
});

describe("listWhere", () => {
  it("admin wraps in AND", () => {
    const where = listWhere(adminUser) as any;
    expect(where.AND).toBeDefined();
    expect(where.AND).toEqual([{ orgId: "org1", environment: "production" }]);
  });

  it("rep wraps in AND with OR sub-condition", () => {
    const where = listWhere(repUser) as any;
    expect(where.AND).toHaveLength(1);
    expect(where.AND[0].OR).toBeDefined();
  });
});

describe("visibility constants", () => {
  it("owner and org are distinct", () => {
    expect(VISIBILITY_OWNER).not.toBe(VISIBILITY_ORG);
  });

  it("owner is 'owner' and org is 'org'", () => {
    expect(VISIBILITY_OWNER).toBe("owner");
    expect(VISIBILITY_ORG).toBe("org");
  });
});
