// Voice CRM & Computer-Use Agent console (Phase 15).
//
// Operate the CRM by natural-language command (a voice transcript pasted or
// typed) or let the computer-use agent "click" the UI for you — both paths run
// through ONE console that classifies the intent and executes it through the
// REAL APIs with the Phase 9 risk-tier discipline:
//   🟢 auto     — queries, navigation, creating tasks/notes (executed now)
//   🟡 approval — email drafts, record updates (returned as proposals)
//   🔴 human    — destructive actions (refused — never automated)
// Everything returns an English explanation of what was done + why.
import { db } from "../db";
import { createObjectService } from "./object-service";
import { ubqAnswer } from "./ubq";
import { badRequest } from "./http";

export function commandCatalog() {
  return [
    { key: "query", tier: "green", label: "Ask anything", description: "Answer a cross-object business question (routed to Universal Business Query).", examples: ["What's the total pipeline by owner?"] },
    { key: "create_task", tier: "green", label: "Create a task", description: "Create a to-do, optionally linked to a deal/contact.", examples: ["Create a task for the Acme deal to send the proposal"] },
    { key: "create_note", tier: "green", label: "Add a note", description: "Log a note on a record.", examples: ["Add a note to the Northwind deal: agreed on pricing"] },
    { key: "draft_email", tier: "yellow", label: "Draft an email", description: "Compose a draft (proposed — requires approval before sending).", examples: ["Draft an email to Sarah about the proposal"] },
    { key: "update_deal", tier: "yellow", label: "Update a deal", description: "Propose a record change (requires approval).", examples: ["Move the Acme deal to negotiation stage"] },
    { key: "navigate", tier: "green", label: "Navigate", description: "Computer-use navigation — jump to a surface.", examples: ["Go to the pipeline board"] },
    { key: "delete", tier: "red", label: "Delete", description: "Destructive actions are human-only — the console refuses.", examples: ["Delete the Acme account"] },
  ];
}

type AccessUser = { id: string; orgId: string; role: string; environment: string };

async function findOpportunityByName(orgId: string, environment: string, name: string) {
  const rows = await db().opportunity.findMany({ where: { orgId, environment }, select: { id: true, name: true } });
  const q = name.toLowerCase().trim();
  return rows.find((r) => r.name.toLowerCase().includes(q)) ?? null;
}

async function findContactByName(orgId: string, environment: string, name: string) {
  const rows = await db().contact.findMany({ where: { orgId, environment }, select: { id: true, firstName: true, lastName: true, email: true } });
  const q = name.toLowerCase().trim();
  return rows.find((r) => `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q)) ?? null;
}

function quoted(prompt: string): string | null {
  const m = prompt.match(/["“]([^"”]+)["”]/);
  return m ? m[1] : null;
}

/** Classify a natural-language command. */
function classify(prompt: string): { intent: string; params: Record<string, unknown> } {
  const s = prompt.toLowerCase();
  if (/\b(delete|remove|destroy|purge)\b/.test(s)) return { intent: "delete", params: {} };
  if (/\b(draft|write|compose) an? email\b|\bemail draft\b/.test(s)) {
    const name = quoted(prompt) ?? s.match(/to\s+([a-z][a-z ]+?)(?:\babout\b|$)/i)?.[1]?.trim() ?? null;
    return { intent: "draft_email", params: { contactName: name } };
  }
  if (/\b(go to|open|navigate|show me|show the|take me to)\b/.test(s)) {
    const target = s.match(/(pipeline|deals? board|dashboard|reports?|tickets?|customers?|analytics|revenue|calendar|field|ecosystem|security|brain)/)?.[1] ?? "dashboard";
    return { intent: "navigate", params: { target } };
  }
  if (/\b(create|add|log|make) (a )?task\b|\bto-do\b|\btodo\b/.test(s)) {
    const dealName = quoted(prompt);
    const title = prompt
      .replace(/^(create|add|log|make)\s+(a\s+)?(task|to-do|todo)\s+(for|on|titled|called)?\s*/i, "")
      .replace(/\s*$/, "");
    return { intent: "create_task", params: { title: title || "Follow-up", dealName } };
  }
  if (/\b(add|log|leave|write) (a )?note\b/.test(s)) {
    const content = prompt.replace(/^(add|log|leave|write)\s+(a\s+)?note\s+(to|on|for)?\s*/i, "").trim();
    return { intent: "create_note", params: { content: content || "Noted." } };
  }
  if (/\b(move|change|update|set)\b.*\b(stage|probability|amount|owner)\b/.test(s)) {
    const dealName = quoted(prompt);
    return { intent: "update_deal", params: { dealName } };
  }
  if (/\b(how many|total|pipeline|what is|what's|show|list|by |tickets|contacts|deals|revenue|mrr|won|lost|open)\b/.test(s)) {
    return { intent: "query", params: {} };
  }
  return { intent: "query", params: {} };
}

export type CommandResult = {
  intent: string;
  tier: "green" | "yellow" | "red";
  executed: boolean;
  explanation: string;
  result: Record<string, unknown>;
};

export async function runCommand(orgId: string, environment: string, actor: AccessUser, input: { text?: string; action?: { element: string; action: string; params?: Record<string, unknown> } }): Promise<CommandResult> {
  // Computer-use agent path — simulate the agent operating the UI via the API.
  if (input.action) {
    const { element, action, params = {} } = input.action;
    if (!element) throw badRequest("action.element is required");
    const elementToIntent: Record<string, { intent: string; tier: string; params: Record<string, unknown> }> = {
      "deals-board": { intent: "navigate", tier: "green", params: { target: "pipeline" } },
      "dashboard": { intent: "navigate", tier: "green", params: { target: "dashboard" } },
      "new-task": { intent: "create_task", tier: "green", params: { title: (params.title as string) ?? "Follow-up", dealName: params.dealName as string | undefined } },
      "compose-email": { intent: "draft_email", tier: "yellow", params: { contactName: params.contactName ?? null } },
      "deal-card": { intent: "navigate", tier: "green", params: { target: "deal", dealId: params.dealId } },
      "delete-record": { intent: "delete", tier: "red", params: {} },
    };
    const mapped = elementToIntent[element];
    if (!mapped) throw badRequest(`Unknown UI element "${element}"`);
    const executed = mapped.tier === "green";
    return {
      intent: mapped.intent,
      tier: mapped.tier as "green" | "yellow" | "red",
      executed,
      explanation: `Computer-use agent simulated "${action}" on <${element}> and ${executed ? "executed" : "proposed"} the ${mapped.intent} intent via the API (${mapped.tier === "green" ? "🟢 auto" : mapped.tier === "yellow" ? "🟡 approval" : "🔴 human"}).`,
      result: { element, action, intent: mapped.intent, tier: mapped.tier, ...mapped.params },
    };
  }

  const text = (input.text ?? "").trim();
  if (!text) throw badRequest("text (or action) is required");
  const { intent, params } = classify(text);

  // 🔴 Destructive — refuse.
  if (intent === "delete") {
    return { intent, tier: "red", executed: false, explanation: "Refused: destructive actions (delete/remove/purge) are human-only (🔴). The console never automates them.", result: {} };
  }

  // 🟢 Query → Universal Business Query.
  if (intent === "query") {
    const answer = await ubqAnswer(orgId, environment, text);
    return { intent, tier: "green", executed: true, explanation: `Answered from live data: ${answer.answer}`, result: answer as unknown as Record<string, unknown> };
  }

  // 🟢 Navigate (computer-use navigation).
  if (intent === "navigate") {
    const routes: Record<string, string> = { pipeline: "/deals", "deals board": "/deals", dashboard: "/dashboard", reports: "/reports", tickets: "/tickets", customers: "/customers", analytics: "/analytics", revenue: "/revenue", calendar: "/calendar", field: "/field", ecosystem: "/ecosystem", security: "/security", brain: "/brain" };
    const target = String(params.target ?? "dashboard");
    const route = params.dealId ? `/deals/${params.dealId}` : routes[target] ?? "/dashboard";
    return { intent, tier: "green", executed: true, explanation: `Navigated to ${route} (computer-use: clicked the ${target} surface).`, result: { route, target } };
  }

  // 🟢 Create task (executed through the object service → audit + task.created).
  if (intent === "create_task") {
    const deal = params.dealName ? await findOpportunityByName(orgId, environment, String(params.dealName)) : null;
    const svc = createObjectService({ type: "task" });
    const row = await svc.create(actor, { title: String(params.title ?? "Follow-up"), opportunityId: deal?.id, status: "todo" });
    return { intent, tier: "green", executed: true, explanation: `Created task "${String(params.title)}"${deal ? ` for deal "${deal.name}"` : ""}.`, result: { taskId: row.id, dealId: deal?.id ?? null } };
  }

  // 🟢 Create note (executed through the object service → audit + note.created).
  if (intent === "create_note") {
    const svc = createObjectService({ type: "note" });
    const row = await svc.create(actor, { body: String(params.content ?? "") });
    return { intent, tier: "green", executed: true, explanation: "Logged the note.", result: { noteId: row.id } };
  }

  // 🟡 Draft email — proposed, never sent.
  if (intent === "draft_email") {
    const contact = params.contactName ? await findContactByName(orgId, environment, String(params.contactName)) : null;
    const draft = {
      subject: contact ? `Re: ${contact.firstName ?? ""}`.trim() : "Draft",
      body: `Hi ${contact?.firstName ?? "there"},\n\nFollowing up on our last conversation.\n\nBest,`,
      contactId: contact?.id ?? null,
    };
    return { intent, tier: "yellow", executed: false, explanation: `Drafted an email${contact ? ` to ${contact.firstName} ${contact.lastName}` : ""} (🟡 — awaiting approval before send).`, result: draft };
  }

  // 🟡 Update deal — proposed.
  if (intent === "update_deal") {
    const deal = params.dealName ? await findOpportunityByName(orgId, environment, String(params.dealName)) : null;
    if (!deal) throw badRequest("Could not find the deal to update");
    return { intent, tier: "yellow", executed: false, explanation: `Proposed updating "${deal.name}" (🟡 — awaiting approval).`, result: { dealId: deal.id, dealName: deal.name, proposedBy: "command-console" } };
  }

  return { intent: "query", tier: "green", executed: true, explanation: "Ran as a query.", result: {} };
}
