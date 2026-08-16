// Organizational / customer memory (Phase 15) — persistent AI memory across
// every interaction.
//
// The memory engine subscribes to the event bus and LEARNS facts + observations
// from what actually happens (email.replied → the customer prefers email,
// contract signed → a renewal date is coming, meeting completed → we met). Each
// entry is keyed by (scope + sourceEvent + content) via a fingerprint so the
// same lesson is never learned twice; admins/users can also add manual entries,
// and expired rows are purged by the ticker (TTL memory, like Phase 8/9).
//
// Events: memory.recorded (one per learned/manual entry).
import { db } from "../db";
import { emitEvent, onEvent, type PersistedEvent } from "./events";
import { badRequest } from "./http";

const DAY = 86_400_000;

// A valid all-zero ObjectId used as the actor for machine-learned entries —
// the same system-actor sentinel the security engine uses for SCIM
// (SCIM_ACTOR_ID in lib/security.ts). createdBy / event actorId are ObjectId
// columns, so a bare "system" string would fail Prisma's ObjectId validation.
const SYSTEM_ACTOR_ID = "000000000000000000000000";
function actorFor(actorId: string): string {
  return /^[0-9a-fA-F]{24}$/.test(actorId) ? actorId : SYSTEM_ACTOR_ID;
}

type MemoryInput = {
  scope: string;
  scopeId?: string | null;
  kind: "fact" | "observation" | "insight";
  content: string;
  sourceEvent?: string | null;
  confidence?: number;
  expiresAt?: Date | null;
};

function fingerprintFor(scope: string, scopeId: string | null, sourceEvent: string | null, content: string) {
  return `${scope}:${scopeId ?? "org"}:${sourceEvent ?? "manual"}:${content.slice(0, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export async function recordMemory(orgId: string, environment: string, actorId: string, input: MemoryInput) {
  if (!["org", "account", "contact", "opportunity", "lead", "ticket"].includes(input.scope)) throw badRequest("scope must be org | account | contact | opportunity | lead | ticket");
  if (!["fact", "observation", "insight"].includes(input.kind)) throw badRequest("kind must be fact | observation | insight");
  if (!input.content || !input.content.trim()) throw badRequest("content is required");
  const fingerprint = fingerprintFor(input.scope, input.scopeId ?? null, input.sourceEvent ?? null, input.content);

  const existing = await db().orgMemoryEntry.findUnique({ where: { fingerprint } });
  if (existing) return { row: existing, created: false };

  const row = await db().orgMemoryEntry.create({
    data: {
      orgId,
      environment,
      scope: input.scope,
      scopeId: input.scopeId ?? null,
      kind: input.kind,
      content: input.content,
      sourceEvent: input.sourceEvent ?? null,
      fingerprint,
      confidence: input.confidence ?? 70,
      expiresAt: input.expiresAt ?? null,
      createdBy: actorFor(actorId),
    },
  });
  await emitEvent({ orgId, environment, type: "memory.recorded", entity: input.scope === "org" ? "brain" : input.scope, entityId: row.id, actorId: actorFor(actorId), payload: { scope: input.scope, scopeId: input.scopeId, kind: input.kind, fingerprint } });
  return { row, created: true };
}

export async function listMemory(orgId: string, environment: string, scope?: string, scopeId?: string) {
  return db().orgMemoryEntry.findMany({
    where: { orgId, environment, ...(scope ? { scope } : {}), ...(scopeId ? { scopeId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function forgetMemory(orgId: string, environment: string, id: string) {
  const row = await db().orgMemoryEntry.findUnique({ where: { id } });
  if (!row || row.orgId !== orgId || row.environment !== environment) return false;
  await db().orgMemoryEntry.delete({ where: { id } });
  return true;
}

// ── Learning rules (deterministic, evidence-backed) ─────────────────────────

async function learnFrom(event: PersistedEvent) {
  const { orgId, environment, type, payload, entity, entityId } = event;
  const p = (payload ?? {}) as Record<string, unknown>;
  try {
    switch (type) {
      case "email.replied": {
        const contactId = (p.contactId as string) || entity === "contact" ? entityId : null;
        if (contactId) {
          await recordMemory(orgId, environment, "system", {
            scope: "contact", scopeId: contactId, kind: "fact",
            content: "Replies by email — prefers email as a channel.",
            sourceEvent: type, confidence: 80, expiresAt: new Date(Date.now() + 180 * DAY),
          });
        }
        break;
      }
      case "email.bounced": {
        const contactId = (p.contactId as string) || entity === "contact" ? entityId : null;
        if (contactId) {
          await recordMemory(orgId, environment, "system", {
            scope: "contact", scopeId: contactId, kind: "observation",
            content: "Email bounced — the address may be stale.",
            sourceEvent: type, confidence: 85, expiresAt: new Date(Date.now() + 90 * DAY),
          });
        }
        break;
      }
      case "meeting.completed": {
        const accountId = (p.accountId as string) ?? null;
        const contactId = (p.contactId as string) ?? null;
        if (accountId) {
          await recordMemory(orgId, environment, "system", {
            scope: "account", scopeId: accountId, kind: "observation",
            content: `Met on ${new Date(event.createdAt).toISOString().slice(0, 10)}${(p.title as string) ? ` — \"${String(p.title).slice(0, 60)}\"` : ""}.`,
            sourceEvent: type, confidence: 75, expiresAt: new Date(Date.now() + 180 * DAY),
          });
        }
        if (contactId) {
          await recordMemory(orgId, environment, "system", {
            scope: "contact", scopeId: contactId, kind: "observation",
            content: `Attended a meeting on ${new Date(event.createdAt).toISOString().slice(0, 10)}.`,
            sourceEvent: type, confidence: 75, expiresAt: new Date(Date.now() + 180 * DAY),
          });
        }
        break;
      }
      case "ticket.created": {
        const accountId = (p.accountId as string) ?? null;
        const contactId = (p.contactId as string) ?? null;
        if (accountId) {
          await recordMemory(orgId, environment, "system", {
            scope: "account", scopeId: accountId, kind: "observation",
            content: "Opened a support ticket.",
            sourceEvent: type, confidence: 70, expiresAt: new Date(Date.now() + 90 * DAY),
          });
        }
        if (contactId) {
          await recordMemory(orgId, environment, "system", {
            scope: "contact", scopeId: contactId, kind: "observation",
            content: "Reached out for support.",
            sourceEvent: type, confidence: 70, expiresAt: new Date(Date.now() + 90 * DAY),
          });
        }
        break;
      }
      case "deal.stage_changed": {
        const to = p.to as string;
        const dealId = entity === "opportunity" ? entityId : null;
        if (dealId && to === "won") {
          await recordMemory(orgId, environment, "system", {
            scope: "opportunity", scopeId: dealId, kind: "fact",
            content: `Won on ${new Date(event.createdAt).toISOString().slice(0, 10)}.`,
            sourceEvent: type, confidence: 90, expiresAt: new Date(Date.now() + 365 * DAY),
          });
        }
        break;
      }
      case "invoice.paid": {
        const accountId = (p.accountId as string) ?? null;
        if (accountId) {
          await recordMemory(orgId, environment, "system", {
            scope: "account", scopeId: accountId, kind: "observation",
            content: "Pays invoices on time.",
            sourceEvent: type, confidence: 70, expiresAt: new Date(Date.now() + 180 * DAY),
          });
        }
        break;
      }
      case "subscription.renewed":
      case "contract.signed": {
        const accountId = (p.accountId as string) ?? null;
        const renewsAt = (p.renewsAt as string) ?? (p.endsAt as string) ?? null;
        if (accountId) {
          await recordMemory(orgId, environment, "system", {
            scope: "account", scopeId: accountId, kind: "fact",
            content: renewsAt ? `Renewal/commitment date: ${renewsAt.slice(0, 10)}.` : "Signed/renewed a commitment.",
            sourceEvent: type, confidence: 85, expiresAt: new Date(Date.now() + 365 * DAY),
          });
        }
        break;
      }
    }
  } catch (e) {
    console.error("[memory learn failed]", type, e);
  }
}

export function startMemoryEngine() {
  onEvent("*", (event) => void learnFrom(event));
  // TTL purge — drop expired entries.
  const purge = async () => {
    try {
      await db().orgMemoryEntry.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch (e) {
      console.error("[memory purge]", e);
    }
  };
  void purge();
  setInterval(purge, 60 * 60 * 1000);
}
