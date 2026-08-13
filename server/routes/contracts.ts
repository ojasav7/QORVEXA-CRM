// Contracts + contract intelligence (Phase 10 · Revenue Cloud) — flag
// revenue.billing. Contracts hold extracted clauses (parties, dates, renewal
// + payment terms) from the analyze endpoint; signing (mock e-signature) makes
// them active; the engine ticker flags renewal windows + expiry. Reads open,
// writes admin-only.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { nextReference } from "../lib/revenue";
import { analyzeContract, signContract, terminateContract } from "../lib/contracts";

const router = Router();

const contractSchema = z.object({
  name: z.string().min(1).max(200),
  accountId: z.string().optional(),
  quoteId: z.string().optional(),
  subscriptionId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  autoRenew: z.boolean().optional(),
  renewalNoticeDays: z.number().int().min(1).max(365).optional(),
});

function hydrate(c: any): any {
  return {
    id: c.id, contractNumber: c.contractNumber, name: c.name, status: c.status, accountId: c.accountId,
    quoteId: c.quoteId, subscriptionId: c.subscriptionId, startDate: c.startDate, endDate: c.endDate,
    autoRenew: c.autoRenew, renewalNoticeDays: c.renewalNoticeDays, clauses: c.clauses, analyzedAt: c.analyzedAt,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

// GET /api/contracts
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().contract.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, take: 200 });
    const accountIds = [...new Set(rows.map((r) => r.accountId).filter(Boolean))] as string[];
    const accounts = accountIds.length ? await db().account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }) : [];
    const byId = new Map(accounts.map((a) => [a.id, a.name]));
    ok(res, { items: rows.map((c) => ({ ...hydrate(c), accountName: c.accountId ? byId.get(c.accountId) ?? null : null })) });
  })
);

// POST /api/contracts (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = contractSchema.parse(req.body);
    const contractNumber = await nextReference(user.orgId, environment, "contract", "CTR");
    const contract = await db().contract.create({
      data: {
        orgId: user.orgId, environment, contractNumber, name: input.name, accountId: input.accountId ?? null,
        quoteId: input.quoteId ?? null, subscriptionId: input.subscriptionId ?? null, status: "draft",
        startDate: input.startDate ? new Date(input.startDate) : null, endDate: input.endDate ? new Date(input.endDate) : null,
        autoRenew: input.autoRenew ?? false, renewalNoticeDays: input.renewalNoticeDays ?? 30, createdBy: user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "contract.created", entity: "contract", entityId: contract.id, actorId: user.id, payload: { contractNumber, name: contract.name } });
    ok(res, { contract: hydrate(contract) }, 201);
  })
);

// GET /api/contracts/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const contract = await db().contract.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!contract) throw notFound("Contract not found");
    ok(res, { contract: hydrate(contract) });
  })
);

// PATCH /api/contracts/:id (admin) — drafts (or any status for metadata).
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const contract = await db().contract.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!contract) throw notFound("Contract not found");
    const input = contractSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) data.name = input.name;
    if (input.accountId !== undefined) data.accountId = input.accountId ?? null;
    if (input.quoteId !== undefined) data.quoteId = input.quoteId ?? null;
    if (input.subscriptionId !== undefined) data.subscriptionId = input.subscriptionId ?? null;
    if (input.startDate !== undefined) data.startDate = input.startDate ? new Date(input.startDate) : null;
    if (input.endDate !== undefined) data.endDate = input.endDate ? new Date(input.endDate) : null;
    if (input.autoRenew !== undefined) data.autoRenew = input.autoRenew;
    if (input.renewalNoticeDays !== undefined) data.renewalNoticeDays = input.renewalNoticeDays;
    const updated = await db().contract.update({ where: { id: contract.id }, data });
    await emitEvent({ orgId: user.orgId, environment, type: "contract.updated", entity: "contract", entityId: contract.id, actorId: user.id, payload: { contractNumber: contract.contractNumber } });
    ok(res, { contract: hydrate(updated) });
  })
);

// POST /api/contracts/:id/analyze — contract intelligence (clause extraction).
router.post(
  "/:id/analyze",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { text } = z.object({ text: z.string().min(10).max(20_000) }).parse(req.body ?? {});
    ok(res, await analyzeContract(user.orgId, environment, String(req.params.id), text, user), 201);
  })
);

// POST /api/contracts/:id/sign — mock e-signature → status active.
router.post(
  "/:id/sign",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { name, email } = z.object({ name: z.string().min(1), email: z.string().email().optional() }).parse(req.body ?? {});
    ok(res, { contract: hydrate(await signContract(user.orgId, environment, String(req.params.id), { name, email }, user)) });
  })
);

// POST /api/contracts/:id/terminate { reason? }
router.post(
  "/:id/terminate",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { reason } = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});
    ok(res, { contract: hydrate(await terminateContract(user.orgId, environment, String(req.params.id), reason, user)) });
  })
);

// DELETE /api/contracts/:id (admin) — drafts only.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const contract = await db().contract.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!contract) throw notFound("Contract not found");
    if (contract.status !== "draft") throw badRequest(`Only draft contracts can be deleted (status: ${contract.status})`);
    await db().contract.delete({ where: { id: contract.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "contract.deleted", entity: "contract", entityId: contract.id, actorId: user.id, payload: { contractNumber: contract.contractNumber } });
    ok(res, { ok: true });
  })
);

export default router;
