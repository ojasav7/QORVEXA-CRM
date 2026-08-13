// Contract intelligence (Phase 10 · ADR-022) — the blueprint's "AI clause/date
// extraction". Deterministic extraction (the ADR-020 discipline: transparent,
// explainable rules, no black box) that pulls parties, dates, renewal and
// payment terms out of a contract's text into `clauses: [{ key, label, value,
// source }]`, fills the contract's structured fields when they're empty, and
// emits contract.analyzed. A real LLM clause extractor slots in behind the
// same interface later.
import { db } from "../db";
import { badRequest, notFound } from "./http";
import { emitEvent } from "./events";

export type Clause = { key: string; label: string; value: string; source: string };

/** Deterministic clause extraction — each clause names the regex that found it. */
export function extractClauses(text: string): Clause[] {
  const clauses: Clause[] = [];
  const grab = (re: RegExp, label: string, key: string) => {
    const m = text.match(re);
    if (m) clauses.push({ key, label, value: m[1]?.trim() ?? m[0].trim(), source: re.toString() });
  };

  // Parties: "between X and Y" / "Party A: … / Party B: …"
  const parties = text.match(/between\s+([A-Z][^,.;]{2,60}?)\s+and\s+([A-Z][^,.;]{2,60}?)[,.;\n]/i);
  if (parties) {
    clauses.push({ key: "party_1", label: "Party 1", value: parties[1].trim(), source: "between <x> and <y> clause" });
    clauses.push({ key: "party_2", label: "Party 2", value: parties[2].trim(), source: "between <x> and <y> clause" });
  }
  const partyA = text.match(/party\s*a[:\s]+([^\n]{2,80})/i);
  const partyB = text.match(/party\s*b[:\s]+([^\n]{2,80})/i);
  if (partyA) clauses.push({ key: "party_1", label: "Party 1", value: partyA[1].trim(), source: "party A:" });
  if (partyB) clauses.push({ key: "party_2", label: "Party 2", value: partyB[1].trim(), source: "party B:" });

  grab(/(?:effective|commencement|start)\s+date[:\s]+([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}|[A-Z][a-z]+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})/i, "Effective date", "effective_date");
  grab(/(?:expiration|expiry|end|termination)\s+date[:\s]+([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}|[A-Z][a-z]+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})/i, "End date", "end_date");
  grab(/term\s+of\s+(\d+)\s*(?:calendar\s*)?(month|year|day)s?/i, "Initial term", "term_length");

  if (/auto[\s-]?renew/i.test(text)) {
    const notice = text.match(/(\d+)\s*(?:day|month)s?\s+(?:written\s+)?notice/i);
    clauses.push({
      key: "auto_renew", label: "Auto-renewal", value: notice ? `Yes (${notice[1]} ${notice[0].match(/month/i) ? "month" : "day"} notice)` : "Yes",
      source: notice ? `auto-renew + "${notice[0]}"` : "auto-renew clause present",
    });
  }
  grab(/(\d+)\s*(?:day|month)s?\s+(?:written\s+)?notice/i, "Renewal notice", "renewal_notice");
  grab(/net[- ]?(\d+)/i, "Payment terms", "payment_terms");
  grab(/governed by the laws of ([^.,;\n]{2,60})/i, "Governing law", "governing_law");
  grab(/\$\s?([\d,]+(?:\.\d{2})?)/i, "Contract value", "amount");
  grab(/annual (?:fee|price|charge)[:\s]+([^\n]{2,60})/i, "Annual fee", "annual_fee");

  return clauses;
}

function toDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Run contract intelligence: extract clauses from the contract's text (body is
 * a `text` field on the request or the contract's existing notes), fill the
 * structured fields when empty, persist clauses + analyzedAt, emit
 * contract.analyzed. Returns the clauses + a one-line summary.
 */
export async function analyzeContract(orgId: string, environment: string, contractId: string, text: string, actor: { id: string }): Promise<any> {
  const contract = await db().contract.findFirst({ where: { id: contractId, orgId, environment } });
  if (!contract) throw notFound("Contract not found");
  if (!text?.trim()) throw badRequest("Contract text is required for analysis");

  const clauses = extractClauses(text);
  if (!clauses.length) throw badRequest("No clauses could be extracted — check the contract text");

  const data: Record<string, unknown> = { clauses: clauses as unknown as object, analyzedAt: new Date(), updatedAt: new Date() };
  const endDate = clauses.find((c) => c.key === "end_date")?.value ? toDate(clauses.find((c) => c.key === "end_date")!.value) : null;
  if (!contract.startDate) {
    const start = clauses.find((c) => c.key === "effective_date")?.value ? toDate(clauses.find((c) => c.key === "effective_date")!.value) : null;
    if (start) data.startDate = start;
  }
  if (!contract.endDate && endDate) data.endDate = endDate;
  if (!contract.autoRenew) {
    const renew = clauses.find((c) => c.key === "auto_renew");
    if (renew) data.autoRenew = true;
  }
  const notice = clauses.find((c) => c.key === "renewal_notice");
  if (notice) {
    const n = parseInt(notice.value, 10);
    if (Number.isFinite(n)) data.renewalNoticeDays = n;
  }

  const updated = await db().contract.update({ where: { id: contract.id }, data });
  const summary = `${updated.name}: ${clauses.length} clause(s) extracted — parties ${clauses.filter((c) => c.key.startsWith("party_")).length ? "found" : "not found"}, ${endDate ? "term end " + endDate.toISOString().slice(0, 10) : "no end date"}, ${clauses.find((c) => c.key === "auto_renew") ? "auto-renew" : "no auto-renew"}.`;

  await emitEvent({ orgId, environment, type: "contract.analyzed", entity: "contract", entityId: contract.id, actorId: actor.id, payload: { contractNumber: contract.contractNumber, clauses: clauses.length, summary } });
  return { contract: updated, clauses, summary };
}

/** Mock e-signature — a signed contract becomes ACTIVE (contract.signed). */
export async function signContract(orgId: string, environment: string, contractId: string, signature: { name: string; email?: string }, actor: { id: string }): Promise<any> {
  const contract = await db().contract.findFirst({ where: { id: contractId, orgId, environment } });
  if (!contract) throw notFound("Contract not found");
  if (!["draft", "active"].includes(contract.status)) throw badRequest(`Contract ${contract.status} cannot be signed`);
  if (!signature?.name?.trim()) throw badRequest("Signature name is required");
  const updated = await db().contract.update({
    where: { id: contract.id },
    data: { status: "active", clauses: [...((contract.clauses ?? []) as Clause[]), { key: "signature", label: "Signed by", value: signature.name.trim(), source: "mock e-signature" }] as unknown as object, updatedAt: new Date() },
  });
  await emitEvent({ orgId, environment, type: "contract.signed", entity: "contract", entityId: contract.id, actorId: actor.id, payload: { contractNumber: contract.contractNumber, signer: signature.name.trim() } });
  return updated;
}

export async function terminateContract(orgId: string, environment: string, contractId: string, reason: string | undefined, actor: { id: string }): Promise<any> {
  const contract = await db().contract.findFirst({ where: { id: contractId, orgId, environment } });
  if (!contract) throw notFound("Contract not found");
  if (contract.status === "terminated") throw badRequest("Contract is already terminated");
  const updated = await db().contract.update({
    where: { id: contract.id },
    data: { status: "terminated", clauses: [...((contract.clauses ?? []) as Clause[]), { key: "termination", label: "Terminated", value: reason ?? "Terminated", source: "manual" }] as unknown as object, updatedAt: new Date() },
  });
  await emitEvent({ orgId, environment, type: "contract.terminated", entity: "contract", entityId: contract.id, actorId: actor.id, payload: { contractNumber: contract.contractNumber, reason: reason ?? null } });
  return updated;
}
