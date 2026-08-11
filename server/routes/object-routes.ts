// REST layer for any registered object type — /api/contacts, /api/accounts, ...
// One factory; new objects get routes for free (docs/05-api-reference.md).
import { Router } from "express";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { assertActiveUser } from "../lib/auth";
import { resolveEnvironment } from "../lib/environment";
import { createObjectService, type ObjectService } from "../lib/object-service";

export function objectRouter(service: ObjectService): Router {
  const router = Router();
  const { type } = service;

  // GET /api/:type?page=&pageSize=&q=&stage=&status=&ownerId=&sort=
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const user = await assertActiveUser(req);
      const scoped = { ...user, environment: await resolveEnvironment(req, user.orgId) };
      const result = await service.list(scoped, {
        page: num(req.query.page),
        pageSize: num(req.query.pageSize),
        q: str(req.query.q),
        stage: str(req.query.stage),
        status: str(req.query.status),
        ownerId: str(req.query.ownerId),
        pipelineId: str(req.query.pipelineId),
        sort: str(req.query.sort),
      });
      ok(res, result);
    })
  );

  // GET /api/:type/:id
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const user = await assertActiveUser(req);
      const scoped = { ...user, environment: await resolveEnvironment(req, user.orgId) };
      ok(res, await service.get(scoped, String(req.params.id)));
    })
  );

  // POST /api/:type
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const user = await assertActiveUser(req);
      if (!req.body || typeof req.body !== "object") throw badRequest("JSON body required");
      const scoped = { ...user, environment: await resolveEnvironment(req, user.orgId) };
      ok(res, await service.create(scoped, req.body, req.ip), 201);
    })
  );

  // PATCH /api/:type/:id
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const user = await assertActiveUser(req);
      if (!req.body || typeof req.body !== "object") throw badRequest("JSON body required");
      const scoped = { ...user, environment: await resolveEnvironment(req, user.orgId) };
      ok(res, await service.update(scoped, String(req.params.id), req.body, req.ip));
    })
  );

  // DELETE /api/:type/:id
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const user = await assertActiveUser(req);
      const scoped = { ...user, environment: await resolveEnvironment(req, user.orgId) };
      await service.remove(scoped, String(req.params.id), req.ip);
      ok(res, { ok: true });
    })
  );

  return router;
}

function num(v: unknown): number | undefined {
  if (typeof v !== "string" || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}
