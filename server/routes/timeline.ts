// Record timeline (Phase 2 — sales activity automation / auto-logging).
// One endpoint that aggregates every communication activity against a record:
// notes (Phase 1) + emails (Message) + calls + meetings, newest first. The
// record detail UI renders this as the activity timeline, so calls and emails
// are "auto-logged" the moment they are created against the record.
import { Router } from "express";
import { db } from "../db";
import { assertActiveUser } from "../lib/auth";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";

const router = Router();

type Entry = {
  kind: "note" | "email" | "call" | "meeting";
  id: string;
  title: string;
  subtitle: string;
  createdAt: string;
  meta?: Record<string, unknown>;
};

// GET /api/timeline?contactId=&accountId=&opportunityId=&limit=50
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { contactId, accountId, opportunityId } = req.query as Record<string, string | undefined>;
    const refs = { contactId, accountId, opportunityId };
    if (!contactId && !accountId && !opportunityId) throw badRequest("Provide contactId, accountId or opportunityId");
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    // Visibility: same scope rule as every object list (org-wide for
    // admin/manager; rep sees org-visible + owned).
    const scope: Record<string, unknown>[] = [{ orgId: user.orgId, environment }];

    const [notes, messages, calls, meetings] = await Promise.all([
      db().note.findMany({
        where: { AND: [...scope, ...Object.entries(refs).filter(([, v]) => v).map(([k, v]) => ({ [k]: v }))] },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      db().message.findMany({
        where: { AND: [...scope, ...Object.entries(refs).filter(([, v]) => v).map(([k, v]) => ({ [k]: v }))] },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      db().call.findMany({
        where: { AND: [...scope, ...Object.entries(refs).filter(([, v]) => v).map(([k, v]) => ({ [k]: v }))] },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      db().meeting.findMany({
        where: { AND: [...scope, ...Object.entries(refs).filter(([, v]) => v).map(([k, v]) => ({ [k]: v }))] },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    ]);

    const entries: Entry[] = [
      ...notes.map((n) => ({ kind: "note" as const, id: n.id, title: "Note", subtitle: n.body.slice(0, 120), createdAt: n.createdAt.toISOString() })),
      ...messages.map((m) => ({
        kind: "email" as const,
        id: m.id,
        title: m.subject,
        subtitle: `${m.direction === "out" ? "→" : "←"} ${m.direction === "out" ? m.toEmail : m.fromEmail} · ${m.status}`,
        createdAt: m.createdAt.toISOString(),
        meta: { direction: m.direction, status: m.status },
      })),
      ...calls.map((c) => ({
        kind: "call" as const,
        id: c.id,
        title: `Call ${c.direction === "out" ? "to" : "from"} ${c.phone}`,
        subtitle: `${c.status} · ${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s`,
        createdAt: c.createdAt.toISOString(),
        meta: { direction: c.direction, status: c.status, durationSec: c.durationSec },
      })),
      ...meetings.map((m) => ({
        kind: "meeting" as const,
        id: m.id,
        title: m.title,
        subtitle: `${m.status} · ${new Date(m.startsAt).toLocaleString()}`,
        createdAt: m.createdAt.toISOString(),
        meta: { status: m.status, startsAt: m.startsAt.toISOString() },
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);

    ok(res, { items: entries });
  })
);

export default router;
