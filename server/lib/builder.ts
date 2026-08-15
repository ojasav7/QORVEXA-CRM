// AI-built generators (Phase 15) — natural language → WORKING configuration.
//
// Deterministic (mock-provider discipline, ADR-014): a transparent keyword
// parser classifies the prompt into one of the four builder targets and
// creates the real entity through the existing engines — a workflow (Phase 3
// Automation row), an agent (Phase 9 Agent row), a report (Phase 6 Report row)
// or a custom field (Phase 0 FieldDef row) — so the generated thing works
// immediately and is audited like any other row. Every build returns the
// created entity + an English explanation + the risk tier (admin-initiated
// config work is 🟢 auto; no record data is touched).
import { db } from "../db";
import { emitEvent } from "./events";
import { badRequest } from "./http";

const OBJECT_TYPES = ["contact", "account", "lead", "opportunity", "ticket"];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "field";
}

function pickEntity(prompt: string): string {
  const m = prompt.toLowerCase().match(/\b(contact|account|lead|opportunity|ticket|deal)s?\b/);
  if (!m) return "opportunity";
  return m[1].replace(/s$/, "").replace(/^deal$/, "opportunity");
}

function pickName(prompt: string, fallback: string): string {
  const m = prompt.match(/(?:called|named|about|for|of)\s+["']?([A-Za-z][A-Za-z0-9 _-]{2,40})["']?/i);
  return m ? m[1].trim().replace(/\s+/g, " ") : fallback;
}

export type BuildResult = {
  entityType: "workflow" | "agent" | "report" | "field";
  entity: string;
  entityId: string;
  explanation: string;
  riskTier: "green";
  prompt: string;
};

export function builderCatalog() {
  return [
    { entityType: "workflow", description: "Natural language → a working Phase 3 workflow (trigger → condition → action).", examples: ["When a deal is won, notify the owner and create a task to send the contract"] },
    { entityType: "agent", description: "Natural language → a working Phase 9 agent with trigger + tools + rules.", examples: ["Create an agent that follows up on cold leads by creating a task and notifying the owner"] },
    { entityType: "report", description: "Natural language → a live Phase 6 report config (kind + metric keys).", examples: ["Build a sales report for won deals this quarter"] },
    { entityType: "field", description: "Natural language → a custom field on an object type.", examples: ["Add a number field called priority score to deals"] },
  ];
}

/** Classify + build. Creates real rows; emits builder.generated (+ native creation events). */
export async function buildFromPrompt(orgId: string, environment: string, actorId: string, prompt: string): Promise<BuildResult> {
  if (!prompt || !prompt.trim()) throw badRequest("prompt is required");
  const p = prompt.trim();
  const lower = p.toLowerCase();

  // 1. Field
  if (/\b(field|custom field|column)\b/.test(lower)) {
    const objectType = pickEntity(p);
    const label = pickName(p, "AI-built field");
    let type = "text";
    if (/\b(number|amount|numeric|score|count|percent)\b/.test(lower)) type = "number";
    else if (/\b(date|deadline|due)\b/.test(lower)) type = "date";
    else if (/\b(select|choice|dropdown|category|status|stage)\b/.test(lower)) type = "select";
    else if (/\b(boolean|bool|checkbox|flag|yes\/no)\b/.test(lower)) type = "boolean";
    else if (/\b(url|link|website)\b/.test(lower)) type = "url";
    else if (/\b(email)\b/.test(lower)) type = "email";
    const key = slugify(label);
    const existing = await db().fieldDef.findFirst({ where: { orgId, environment, objectType, key } });
    if (existing) throw badRequest(`Field "${key}" already exists on ${objectType}`);
    const row = await db().fieldDef.create({ data: { orgId, environment, objectType, key, label, type, options: type === "select" ? ["Option A", "Option B", "Option C"] : [], order: 0 } });
    await emitEvent({ orgId, environment, type: "builder.generated", entity: "fieldDef", entityId: row.id, actorId, payload: { entityType: "field", objectType, key, label, type, via: "ai-builder" } });
    return { entityType: "field", entity: "fieldDef", entityId: row.id, explanation: `Created a ${type} field "${label}" (${key}) on ${objectType}.`, riskTier: "green", prompt: p };
  }

  // 2. Report
  if (/\b(report|dashboard)\b/.test(lower)) {
    const kind = /\b(revenue|mrr|billing)\b/.test(lower) ? "revenue" : /\b(service|ticket|support)\b/.test(lower) ? "service" : /\b(marketing|campaign|landing)\b/.test(lower) ? "marketing" : "sales";
    const name = pickName(p, "AI-built report");
    const row = await db().report.create({ data: { orgId, environment, name, description: `AI-built from: "${p.slice(0, 120)}"`, kind, keys: [], active: true, createdBy: actorId } });
    await emitEvent({ orgId, environment, type: "builder.generated", entity: "report", entityId: row.id, actorId, payload: { entityType: "report", kind, name, via: "ai-builder" } });
    return { entityType: "report", entity: "report", entityId: row.id, explanation: `Built a ${kind} report "${name}" (renders live metrics from the Phase 6 library).`, riskTier: "green", prompt: p };
  }

  // 3. Agent
  if (/\bagent\b/.test(lower)) {
    const name = pickName(p, "AI-built agent");
    let trigger: { kind: string; event?: string } = { kind: "manual" };
    if (/\b(lead|prospect)\b/.test(lower)) trigger = { kind: "event", event: "lead.created" };
    else if (/\b(deal|opportunity|win|won)\b/.test(lower)) trigger = { kind: "event", event: "deal.stage_changed" };
    else if (/\b(ticket|support)\b/.test(lower)) trigger = { kind: "event", event: "ticket.created" };
    const tools: string[] = [];
    if (/\b(task|follow|qualif|nurture|remind)\b/.test(lower)) tools.push("create_task");
    if (/\b(notify|alert|ping|message|owner)\b/.test(lower)) tools.push("notify");
    if (/\b(email|draft)\b/.test(lower)) tools.push("send_email");
    if (/\b(update|change|set)\b/.test(lower)) tools.push("update_record");
    if (!tools.length) tools.push("create_task", "notify");
    const row = await db().agent.create({
      data: { orgId, environment, name, kind: "custom", description: `AI-built from: "${p.slice(0, 120)}"`, trigger: trigger as object, rules: [], tools: tools as unknown as object, tierPolicy: {}, memoryEnabled: true, active: true, createdBy: actorId },
    });
    await emitEvent({ orgId, environment, type: "agent.created", entity: "agent", entityId: row.id, actorId, payload: { via: "ai-builder", source: "ai-builder", trigger, tools } });
    await emitEvent({ orgId, environment, type: "builder.generated", entity: "agent", entityId: row.id, actorId, payload: { entityType: "agent", name, trigger, tools, via: "ai-builder" } });
    return { entityType: "agent", entity: "agent", entityId: row.id, explanation: `Created agent "${name}" triggered by ${trigger.kind === "event" ? trigger.event : "manual run"} with tools [${tools.join(", ")}].`, riskTier: "green", prompt: p };
  }

  // 4. Workflow (default — "when X, do Y")
  const trigger: { kind: string; event: string; to?: string } = { kind: "event", event: "deal.stage_changed" };
  if (/\b(lead|prospect)\b/.test(lower)) trigger.event = "lead.created";
  else if (/\b(ticket|support)\b/.test(lower)) trigger.event = "ticket.created";
  if (/\bwon\b/.test(lower)) trigger.to = "won";
  if (/\blost\b/.test(lower)) trigger.to = "lost";
  const actions: { type: string; title?: string; notifyRole?: string }[] = [];
  if (/\b(task|todo|contract|send the contract)\b/.test(lower)) actions.push({ type: "create_task", title: "Follow up from automation" });
  if (/\b(notify|alert|ping|message)\b/.test(lower) || !actions.length) actions.push({ type: "notify", notifyRole: "owner" });
  if (/\b(update|change|set|stage)\b/.test(lower)) actions.push({ type: "update_record" });
  const name = pickName(p, "AI-built workflow");
  const row = await db().automation.create({
    data: { orgId, environment, name, description: `AI-built from: "${p.slice(0, 120)}"`, trigger: trigger as object, conditions: [], actions: actions as unknown as object, active: true, createdBy: actorId },
  });
  await emitEvent({ orgId, environment, type: "automation.created", entity: "automation", entityId: row.id, actorId, payload: { via: "ai-builder", trigger, actions } });
  await emitEvent({ orgId, environment, type: "builder.generated", entity: "automation", entityId: row.id, actorId, payload: { entityType: "workflow", name, trigger, actions, via: "ai-builder" } });
  return { entityType: "workflow", entity: "automation", entityId: row.id, explanation: `Built workflow "${name}" (${trigger.event}${trigger.to ? ` → ${trigger.to}` : ""}) with actions [${actions.map((a) => a.type).join(", ")}].`, riskTier: "green", prompt: p };
}

/** Resolve a built entity back to a friendly display name. */
export async function resolveBuilt(orgId: string, environment: string, entity: string, entityId: string): Promise<string | null> {
  const delegate = (db() as any)[entity];
  if (!delegate) return null;
  const row = await delegate.findUnique({ where: { id: entityId } }).catch(() => null);
  if (!row || row.orgId !== orgId) return null;
  return row.name ?? row.label ?? row.key ?? null;
}

/** Slugs used by the catalog (exported for tests). */
export { OBJECT_TYPES, slugify, pickEntity, pickName };
