import { Router } from "express";
import { db } from "../db";
import { assertActiveUser } from "../lib/auth";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { OBJECTS } from "../lib/registry";
import { listConditions } from "../lib/access";
import { resolveEnvironment } from "../lib/environment";

// Maps object type → owner column (notes use authorId).
const OWNER_FIELD: Record<string, string> = { note: "authorId" };

const router = Router();

// GET /api/search?q= — cross-object keyword search (semantic search arrives in Phase 8).
// Searches each object's searchable core fields with regex, capped per type.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const scoped = { ...user, environment: await resolveEnvironment(req, user.orgId) };
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) throw badRequest("Missing ?q=");

    const results: { type: string; id: string; title: string; subtitle: string }[] = [];

    await Promise.all(
      OBJECTS.map(async (def) => {
        const scope = listConditions(scoped, OWNER_FIELD[def.type]); // tenant + env + visibility, must AND with search
        const model = (db() as any)[def.type];
        const searchable = def.fields.filter((f) => f.searchable && f.type !== "number" && f.type !== "currency" && f.type !== "boolean");
        const ors = searchable.map((f) => ({ [f.key]: { contains: q, mode: "insensitive" } }));
        if (!ors.length) return;
        const items = await model.findMany({
          where: { AND: [...scope, { OR: ors }] },
          take: 10,
          orderBy: { createdAt: "desc" },
        });
        for (const item of items) {
          const titleField = def.fields.find((f) => f.list && f.type !== "number") ?? def.fields[0];
          const subField = def.fields.find((f) => f.key !== titleField.key && f.searchable && f.type !== "number" && f.type !== "boolean");
          results.push({
            type: def.type,
            id: item.id,
            title: String(item[titleField.key] ?? ""),
            subtitle: subField ? String(item[subField.key] ?? "") : "",
          });
        }
      })
    );

    results.sort((a, b) => a.title.localeCompare(b.title));
    ok(res, { items: results.slice(0, 25) });
  })
);

export default router;
