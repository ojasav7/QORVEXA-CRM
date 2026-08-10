// QORVEXA CRM — server entry point.
// Express 5 API + serves the built React client from dist/ in production.
import path from "node:path";
import fs from "node:fs";
import express from "express";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "node:url";
import { env } from "./env";
import { dbHealthy } from "./db";
import { loadSession, loadTokenAuth } from "./lib/auth";
import { errorHandler } from "./lib/http";
import { registerObject } from "./lib/object-service";
import { runScheduledSnapshots } from "./lib/backup";
import { nextRoundRobinOwner } from "./lib/lead-routing";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import orgRoutes from "./routes/org";
import eventRoutes from "./routes/events";
import fieldRoutes from "./routes/fields";
import webhookRoutes from "./routes/webhooks";
import importRoutes from "./routes/import";
import searchRoutes from "./routes/search";
import dashboardRoutes from "./routes/dashboard";
import healthRoutes from "./routes/health";
import envRoutes from "./routes/env";
import featureRoutes from "./routes/features";
import backupRoutes from "./routes/backup";
import exportRoutes from "./routes/export";
import tokenRoutes from "./routes/tokens";
import oauthRoutes from "./routes/oauth";
import segmentRoutes from "./routes/segments";
import leadFormRoutes from "./routes/lead-forms";
import publicLeadRoutes from "./routes/public-leads";
import mergeRoutes from "./routes/merge";
import { objectRouter } from "./routes/object-routes";
import { createObjectService } from "./lib/object-service";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Register object types (Phase 1 core CRM objects) ─────────────────────────
registerObject({ type: "contact", uniqueFields: ["email"], eventPrefix: "contact", relations: [{ field: "accountId", type: "account" }] });
registerObject({ type: "account", uniqueFields: ["name"], eventPrefix: "account", relations: [{ field: "parentId", type: "account" }] });
// Phase 1 lead routing: round-robin over the admin-configured pool when no explicit owner.
registerObject({ type: "lead", uniqueFields: ["email"], eventPrefix: "lead", routedEvent: true, assignOwner: async (user) => nextRoundRobinOwner(user.orgId) });
registerObject({ type: "opportunity", eventPrefix: "deal" });
registerObject({ type: "task", eventPrefix: "task" });
registerObject({ type: "note", eventPrefix: "note", ownerField: "authorId" });

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(loadSession);
app.use(loadTokenAuth); // Bearer API tokens (Phase 0 OAuth for integrations)

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/org", orgRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/fields", fieldRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/import", importRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/env", envRoutes);
app.use("/api/features", featureRoutes);
// ADR-009 API surface: create/restore under /api/backup/*, listing under /api/backups.
app.use(["/api/backup", "/api/backups"], backupRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/tokens", tokenRoutes);
app.use("/api/auth/oauth", oauthRoutes);
app.use("/api/segments", segmentRoutes);
app.use("/api/lead-forms", leadFormRoutes);
app.use("/api/merge", mergeRoutes);
app.use("/api/public", publicLeadRoutes); // unauthenticated lead-capture forms (Phase 1)

// One REST router per object type — all powered by the generic service.
app.use("/api/contacts", objectRouter(createObjectService({ type: "contact" })));
app.use("/api/accounts", objectRouter(createObjectService({ type: "account" })));
app.use("/api/leads", objectRouter(createObjectService({ type: "lead" })));
app.use("/api/opportunities", objectRouter(createObjectService({ type: "opportunity" })));
app.use("/api/tasks", objectRouter(createObjectService({ type: "task" })));
app.use("/api/notes", objectRouter(createObjectService({ type: "note" })));

// ── Static client (production) ────────────────────────────────────────────────
const clientDist = path.resolve(__dirname, "../dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use(errorHandler);

// ── Boot ──────────────────────────────────────────────────────────────────────
const server = app.listen(env.port, () => {
  console.log(`\n  QORVEXA CRM  ·  http://localhost:${env.port}`);
  console.log(`  API          ·  http://localhost:${env.port}/api`);
  void dbHealthy().then((ok) =>
    console.log(`  Database     ·  ${ok ? "connected" : "NOT CONNECTED — start Mongo (npm run mongo:up) or set DATABASE_URL"}\n`)
  );
});

// Scheduled snapshots (ADR-009) — first run 60s after boot, then every interval.
if (env.snapshotsEnabled) {
  setTimeout(() => {
    void runScheduledSnapshots();
  }, 60_000);
  setInterval(() => {
    void runScheduledSnapshots();
  }, env.snapshotIntervalHours * 3_600_000);
  console.log(`  Backups       · scheduled snapshots every ${env.snapshotIntervalHours}h (SNAPSHOTS_ENABLED=false to disable)`);
} else {
  console.log(`  Backups       · scheduled snapshots DISABLED (SNAPSHOTS_ENABLED=false)`);
}

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
