// Event bus — Phase 0 backbone.
// Every state change emits an event (deal.stage_changed, contact.created, ...).
// Events are:
//   1. persisted to the Event collection (activity feed, audit, Time Machine)
//   2. dispatched to registered webhooks (async, best-effort with retries)
//   3. passed to in-process subscribers (future analytics/AI layers)
import crypto from "node:crypto";
import { db } from "../db";
import { env } from "../env";

type Listener = (event: PersistedEvent) => void | Promise<void>;

const listeners = new Map<string, Listener[]>();

export type PersistedEvent = {
  id: string;
  orgId: string;
  environment: string;
  type: string;
  entity: string;
  entityId: string;
  actorId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type EmitInput = {
  orgId: string;
  environment?: string;
  type: string;
  entity: string;
  entityId: string;
  actorId: string;
  payload?: Record<string, unknown>;
};

/** Subscribe to all events of a type (e.g. "deal.stage_changed" or "*"). */
export function onEvent(type: string, listener: Listener) {
  const list = listeners.get(type) ?? [];
  list.push(listener);
  listeners.set(type, list);
  return () => {
    const l = listeners.get(type) ?? [];
    listeners.set(type, l.filter((x) => x !== listener));
  };
}

/** Persist + fan-out a domain event. Never throws to the caller. */
export async function emitEvent(input: EmitInput): Promise<PersistedEvent | null> {
  try {
    const environment = input.environment ?? "production";
    const created = await db().event.create({
      data: {
        orgId: input.orgId,
        environment,
        type: input.type,
        entity: input.entity,
        entityId: input.entityId,
        actorId: input.actorId,
        payload: (input.payload ?? {}) as object,
      },
    });
    const event: PersistedEvent = {
      id: created.id,
      orgId: created.orgId,
      environment: created.environment ?? environment,
      type: created.type,
      entity: created.entity,
      entityId: created.entityId,
      actorId: created.actorId,
      payload: (created.payload ?? {}) as Record<string, unknown>,
      createdAt: created.createdAt,
    };

    const local = [...(listeners.get(input.type) ?? []), ...(listeners.get("*") ?? [])];
    for (const l of local) {
      try {
        await l(event);
      } catch (e) {
        console.error("[event listener]", e);
      }
    }

    // Fire-and-forget webhook dispatch (no await — never blocks the request).
    void dispatchWebhooks(event);
    return event;
  } catch (e) {
    console.error("[event emit failed]", input.type, e);
    return null;
  }
}

const WEBHOOK_TIMEOUT_MS = 10_000;

async function dispatchWebhooks(event: PersistedEvent) {
  try {
    // ADR-008: sandbox events only reach webhooks registered in the same environment.
    const hooks = await db().webhook.findMany({
      where: { orgId: event.orgId, active: true, environment: event.environment },
    });
    const matching = hooks.filter((h) => {
      const events = (h.events as string[]) ?? [];
      return events.includes("*") || events.includes(event.type);
    });
    for (const hook of matching) {
      void deliver(hook.id, event).catch(() => {});
    }
  } catch (e) {
    console.error("[webhook lookup failed]", e);
  }
}

async function deliver(webhookId: string, event: PersistedEvent) {
  const hook = await db().webhook.findUnique({ where: { id: webhookId } });
  if (!hook) return;
  const signature = crypto
    .createHmac("sha256", hook.secret)
    .update(JSON.stringify(event))
    .digest("hex");

  let status = "success";
  let statusCode: number | null = null;
  let lastError: string | null = null;
  let attempts = 1;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    const res = await fetch(hook.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-qorvexa-signature": `sha256=${signature}` },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    clearTimeout(timer);
    statusCode = res.status;
    if (!res.ok) {
      status = "failed";
      lastError = `HTTP ${res.status}`;
    }
  } catch (e: any) {
    status = "failed";
    lastError = e?.message ?? "network error";
  }

  // One immediate retry for transient failures.
  if (status === "failed") {
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qorvexa-signature": `sha256=${signature}` },
        body: JSON.stringify(event),
      });
      statusCode = res.status;
      status = res.ok ? "success" : "failed";
      lastError = res.ok ? null : `HTTP ${res.status}`;
      attempts = 2;
    } catch (e: any) {
      lastError = e?.message ?? "network error";
      attempts = 2;
    }
  }

  await db().webhookDelivery.create({
    data: {
      orgId: event.orgId,
      webhookId,
      eventId: event.id,
      status,
      statusCode,
      attempts,
      lastError,
    },
  });
}
