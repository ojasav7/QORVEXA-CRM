// Shared in-app notification writer (Phase 3/4) — the automation `notify`
// action and the ticket escalation/assignment flows both write Notification
// rows. Centralising it keeps the emission of `notification.created` (the
// event-catalog contract) in one place.
import { db } from "../db";
import { emitEvent } from "./events";

export async function createNotification(input: {
  orgId: string;
  environment: string;
  userId: string;
  title: string;
  body?: string | null;
  kind?: string;
  link?: string | null;
}) {
  const notif = await db().notification.create({
    data: {
      orgId: input.orgId,
      environment: input.environment,
      userId: input.userId,
      title: input.title,
      body: input.body ?? null,
      kind: input.kind ?? "system",
      link: input.link ?? null,
    },
  });
  await emitEvent({
    orgId: input.orgId,
    environment: input.environment,
    type: "notification.created",
    entity: "notification",
    entityId: notif.id,
    actorId: input.userId,
    payload: { userId: input.userId, kind: notif.kind, title: notif.title },
  });
  return notif;
}
