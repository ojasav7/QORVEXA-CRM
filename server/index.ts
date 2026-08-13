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
import { resolveDealContext } from "./lib/pipelines";
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
import pipelineRoutes from "./routes/pipelines";
// Phase 2 · Communication Core
import emailTemplateRoutes from "./routes/email-templates";
import emailRoutes from "./routes/emails";
import trackingRoutes from "./routes/tracking";
import callRoutes from "./routes/calls";
import meetingRoutes from "./routes/meetings";
import bookingPageRoutes from "./routes/booking-pages";
import publicBookingRoutes from "./routes/public-booking";
import timelineRoutes from "./routes/timeline";
// Phase 3 · Automation & Workflow Engine
import automationRoutes from "./routes/automations";
import notificationRoutes from "./routes/notifications";
import { startAutomationEngine } from "./lib/automations";
// Phase 4 · Customer Service / Helpdesk
import ticketRoutes from "./routes/tickets";
import knowledgeRoutes from "./routes/knowledge";
import portalRoutes from "./routes/portals";
import publicPortalRoutes from "./routes/public-portal";
// Phase 5 · Marketing Automation & Journey Orchestration
import campaignRoutes from "./routes/campaigns";
import landingPageRoutes from "./routes/landing-pages";
import publicLandingRoutes from "./routes/public-landing";
import journeyRoutes from "./routes/journeys";
import deliverabilityRoutes from "./routes/deliverability";
import { startJourneyEngine } from "./lib/journeys";
// Phase 6 · Analytics, Forecasting & Business Intelligence
import analyticsRoutes from "./routes/analytics";
import reportRoutes from "./routes/reports";
// Phase 7 · CDP / Customer 360
import cdpRoutes from "./routes/cdp";
import portabilityRoutes from "./routes/portability";
import { startCdpEngine } from "./lib/cdp";
// Phase 8 · AI Assistant Layer (non-agentic copilot)
import aiRoutes from "./routes/ai";
import modelRoutes from "./routes/models";
import { startAiEngine } from "./lib/ai";
// Phase 9 · AI Agent Platform (autonomous, governed)
import agentRoutes from "./routes/agents";
import { startAgentEngine } from "./lib/agents";
// Phase 10 · Revenue Cloud (products, CPQ, contracts, billing)
import productRoutes from "./routes/products";
import priceBookRoutes from "./routes/price-books";
import quoteRoutes from "./routes/quotes";
import orderRoutes from "./routes/orders";
import contractRoutes from "./routes/contracts";
import subscriptionRoutes from "./routes/subscriptions";
import invoiceRoutes from "./routes/invoices";
import paymentRoutes from "./routes/payments";
import revenueRoutes from "./routes/revenue";
import { startRevenueEngine } from "./lib/revenue";
// Phase 11 · Customer Success (plans, usage, churn, surveys, loyalty)
import successRoutes from "./routes/success";
import { startSuccessEngine } from "./lib/success";
// Phase 12 · Field Operations (territories, visits, work orders, assets/inventory)
import fieldOpsRoutes from "./routes/field";
import { startFieldEngine } from "./lib/field";
// Phase 13 · Ecosystem (marketplace, partners, change sets, schema safety)
import ecosystemRoutes from "./routes/ecosystem";
// Phase 14 · Enterprise Security, Compliance & Governance (MFA, sessions, consent, retention, status, i18n)
import securityRoutes from "./routes/security";
import scimRoutes from "./routes/scim";
import { startSecurityEngine, enforceSecurityPolicy } from "./lib/security";
import { requireFeature } from "./lib/features";
import { objectRouter } from "./routes/object-routes";
import { createObjectService } from "./lib/object-service";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Register object types (Phase 1 core CRM objects) ─────────────────────────
registerObject({ type: "contact", uniqueFields: ["email"], eventPrefix: "contact", relations: [{ field: "accountId", type: "account" }] });
registerObject({ type: "account", uniqueFields: ["name"], eventPrefix: "account", relations: [{ field: "parentId", type: "account" }] });
// Phase 1 lead routing: round-robin over the admin-configured pool when no explicit owner.
registerObject({ type: "lead", uniqueFields: ["email"], eventPrefix: "lead", routedEvent: true, assignOwner: async (user) => nextRoundRobinOwner(user.orgId) });
// Phase 2-lite multi-pipeline: deals resolve their pipeline/stage/probability
// from the org's pipelines (default pipeline when none specified).
registerObject({
  type: "opportunity",
  eventPrefix: "deal",
  relations: [{ field: "accountId", type: "account" }, { field: "pipelineId", type: "pipeline" }],
  resolveDeal: async (user, input, before) =>
    resolveDealContext(user.orgId, user.environment ?? "production", input, before),
});
registerObject({ type: "task", eventPrefix: "task" });
registerObject({ type: "note", eventPrefix: "note", ownerField: "authorId" });
// Phase 4 · Customer Service — tickets are a first-class object (ADR-016):
// generic CRUD/audit/events/search/custom fields + a thin service-specific
// router (server/routes/tickets.ts). The generic service emits
// ticket.created/updated/deleted/status_changed.
registerObject({ type: "ticket", eventPrefix: "ticket", relations: [{ field: "contactId", type: "contact" }, { field: "accountId", type: "account" }] });

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(loadSession);
app.use(loadTokenAuth); // Bearer API tokens (Phase 0 OAuth for integrations)
app.use(enforceSecurityPolicy); // Phase 14 — org IP allowlist enforcement + threat alerts

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
app.use("/api/pipelines", pipelineRoutes); // Phase 2-lite multi-pipeline admin
app.use("/api/public", publicLeadRoutes); // unauthenticated lead-capture forms (Phase 1)

// ── Phase 2 · Communication Core (email, calendar, calling, booking) ─────────
app.use("/api/email-templates", emailTemplateRoutes);
app.use("/api/emails", requireFeature("comm.email"), emailRoutes);
app.use("/api/calls", requireFeature("comm.calling"), callRoutes);
app.use("/api/meetings", requireFeature("comm.calendar"), meetingRoutes);
app.use("/api/booking-pages", bookingPageRoutes);
app.use("/api/timeline", timelineRoutes);
// Phase 3 · Automation & Workflow Engine (feature-gated)
app.use("/api/automations", requireFeature("automation.workflows"), automationRoutes);
app.use("/api/notifications", requireFeature("automation.workflows"), notificationRoutes);
// Phase 4 · Customer Service / Helpdesk (feature-gated)
app.use("/api/tickets", requireFeature("service.tickets"), ticketRoutes);
app.use("/api/portals", requireFeature("service.tickets"), portalRoutes);
app.use("/api/knowledge", requireFeature("service.knowledge"), knowledgeRoutes);
app.use("/api/public/portal", publicPortalRoutes); // public intake (no auth)
// Phase 5 · Marketing Automation & Journey Orchestration (feature-gated)
app.use("/api/campaigns", requireFeature("marketing.campaigns"), campaignRoutes);
app.use("/api/landing-pages", requireFeature("marketing.landing"), landingPageRoutes);
app.use("/api/journeys", requireFeature("marketing.journeys"), journeyRoutes);
app.use("/api/deliverability", requireFeature("marketing.deliverability"), deliverabilityRoutes);
app.use("/api/public/pages", publicLandingRoutes); // public landing intake (no auth)
// Phase 6 · Analytics, Forecasting & BI (feature-gated)
app.use("/api/analytics", requireFeature("analytics.metrics"), analyticsRoutes);
app.use("/api/reports", requireFeature("analytics.reports"), reportRoutes);
// Phase 7 · CDP / Customer 360 (feature-gated)
app.use("/api/cdp", requireFeature("cdp.profiles"), cdpRoutes);
app.use("/api/portability", requireFeature("cdp.portability"), portabilityRoutes);
// Phase 8 · AI Assistant Layer (feature-gated)
app.use("/api/ai", requireFeature("ai.assistant"), aiRoutes);
app.use("/api/models", requireFeature("ai.modelRouter"), modelRoutes);
// Phase 9 · AI Agent Platform (feature-gated)
app.use("/api/agents", requireFeature("ai.agents"), agentRoutes);
// Phase 10 · Revenue Cloud (feature-gated)
app.use("/api/products", requireFeature("revenue.products"), productRoutes);
app.use("/api/price-books", requireFeature("revenue.products"), priceBookRoutes);
app.use("/api/quotes", requireFeature("revenue.cpq"), quoteRoutes);
app.use("/api/orders", requireFeature("revenue.cpq"), orderRoutes);
app.use("/api/contracts", requireFeature("revenue.billing"), contractRoutes);
app.use("/api/subscriptions", requireFeature("revenue.billing"), subscriptionRoutes);
app.use("/api/invoices", requireFeature("revenue.billing"), invoiceRoutes);
app.use("/api/payments", requireFeature("revenue.billing"), paymentRoutes);
app.use("/api/revenue", revenueRoutes); // per-route gates (metrics vs billing)
// Phase 11 · Customer Success (per-route gates: cs.plans/usage/churn/surveys/loyalty)
app.use("/api/success", successRoutes);
app.use("/api/field", fieldOpsRoutes); // per-route gates (territories/visits/workorders/inventory)
app.use("/api/ecosystem", ecosystemRoutes); // per-route gates (marketplace/partners/changesets/schema)
// Phase 14 · Enterprise Security (per-route gates: sec.mfa/sessions/scim/consent/retention/status + i18n)
app.use("/api/security", securityRoutes);
// SCIM 2.0 provisioning — bearer ApiToken with the `scim` scope (RFC 7644).
app.use("/api/scim/v2", scimRoutes);
// Public (no auth) — tracking pixels/click links + public booking pages.
app.use("/api/t", trackingRoutes);
app.use("/api/public/booking", publicBookingRoutes);
// Mock call recording placeholder (Phase 2 — telephony provider is mocked, ADR-014).
app.get("/api/mock/media/calls/:file", (_req, res) => {
  res.setHeader("content-type", "audio/wav");
  res.setHeader("content-disposition", "inline");
  res.send(Buffer.from("UkVGRiAAAAAAV0FWRSBmbXRkAAAAAAABAgEAAAAAAwAA/8zMAAAAAABEQVRBAAAAAAA=", "base64"));
});

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
// Phase 3: subscribe the workflow engine to the event bus before serving.
startAutomationEngine();
// Phase 5: subscribe the journey engine + start its ticker.
startJourneyEngine();
// Phase 7: subscribe the CDP behavior mirror (system events → customer behaviors).
startCdpEngine();
// Phase 8: the AI copilot engine (model router + firewall + memory TTL purger).
startAiEngine();
// Phase 9: the agent engine (risk-tiered autonomous actions + memory ticker).
startAgentEngine();
// Phase 10: the revenue engine (subscription renewals + dunning ticker).
startRevenueEngine();
// Phase 11: the customer success engine (usage mirror + adoption/churn/expansion ticker).
startSuccessEngine();
// Phase 12: the field operations engine (maintenance due + SLA breach + reorder ticker).
startFieldEngine();
// Phase 14: the security engine (retention scan + uptime ticks + session hygiene).
startSecurityEngine();

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
