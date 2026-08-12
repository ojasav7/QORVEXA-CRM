// Knowledge base (Phase 4 · Customer Service) — articles, categories, search.
// Writes are admin-only (KB content is org config, like templates); reads are
// open to any authenticated user. Published articles also appear in the public
// portal (server/routes/public-portal.ts). Flag: service.knowledge.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";

const router = Router();

const articleSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50_000),
  category: z.string().max(60).optional(),
  tags: z.array(z.string().max(40)).optional(),
  published: z.boolean().optional(),
  slug: z.string().max(160).optional(),
});

/** URL-safe slug, unique per org × env (title-derived unless provided). */
function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 140) || "article"
  );
}

// GET /api/knowledge?q=&category=&published=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const where: Record<string, unknown> = { orgId: user.orgId, environment };
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }];
    if (typeof req.query.category === "string" && req.query.category) where.category = req.query.category;
    if (req.query.published === "true") where.published = true;
    if (req.query.published === "false") where.published = false;
    const items = await db().knowledgeArticle.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200 });
    const authorIds = [...new Set(items.map((a) => a.authorId))];
    const authors = authorIds.length ? await db().user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [];
    const byId = new Map(authors.map((u) => [u.id, u.name]));
    ok(res, { items: items.map((a) => ({ ...a, authorName: byId.get(a.authorId) ?? null })) });
  })
);

// GET /api/knowledge/categories — distinct categories with counts.
router.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().knowledgeArticle.findMany({ where: { orgId: user.orgId, environment }, select: { category: true } });
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    ok(res, { items: [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count) });
  })
);

// GET /api/knowledge/:id — single article; published reads bump viewCount.
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const article = await db().knowledgeArticle.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!article) throw notFound("Article not found");
    if (article.published) {
      // Count the view WITHOUT bumping updatedAt — a read must not reorder the
      // "newest updated first" list or look like an edit.
      await db().knowledgeArticle.update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } });
      article.viewCount += 1;
    }
    ok(res, { article });
  })
);

// POST /api/knowledge (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = articleSchema.parse(req.body);
    const slug = input.slug?.trim().toLowerCase() || slugify(input.title);
    const existing = await db().knowledgeArticle.findFirst({ where: { orgId: user.orgId, environment, slug } });
    if (existing) throw badRequest(`An article with slug "${slug}" already exists`);
    const article = await db().knowledgeArticle.create({
      data: {
        orgId: user.orgId,
        environment,
        title: input.title.trim(),
        slug,
        body: input.body,
        category: input.category?.trim() || "general",
        tags: input.tags ?? [],
        published: input.published ?? false,
        authorId: user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "knowledge.created", entity: "knowledgeArticle", entityId: article.id, actorId: user.id, payload: { title: article.title, published: article.published } });
    ok(res, { article }, 201);
  })
);

// PATCH /api/knowledge/:id (admin) — partial update, no .default()s.
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const article = await db().knowledgeArticle.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!article) throw notFound("Article not found");
    const input = articleSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.body !== undefined) data.body = input.body;
    if (input.category !== undefined) data.category = input.category.trim() || "general";
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.published !== undefined) data.published = input.published;
    if (input.slug !== undefined) {
      const slug = input.slug.trim().toLowerCase() || slugify(input.title ?? article.title);
      const clash = await db().knowledgeArticle.findFirst({ where: { orgId: user.orgId, environment, slug, id: { not: article.id } } });
      if (clash) throw badRequest(`An article with slug "${slug}" already exists`);
      data.slug = slug;
    }
    const updated = await db().knowledgeArticle.update({ where: { id: article.id }, data });
    await emitEvent({ orgId: user.orgId, environment, type: "knowledge.updated", entity: "knowledgeArticle", entityId: article.id, actorId: user.id, payload: { title: updated.title, published: updated.published } });
    ok(res, { article: updated });
  })
);

// DELETE /api/knowledge/:id (admin)
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const article = await db().knowledgeArticle.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!article) throw notFound("Article not found");
    await db().knowledgeArticle.delete({ where: { id: article.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "knowledge.deleted", entity: "knowledgeArticle", entityId: article.id, actorId: user.id, payload: { title: article.title } });
    ok(res, { ok: true });
  })
);

export default router;
