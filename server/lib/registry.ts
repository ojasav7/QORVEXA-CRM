// Object registry — the blueprint's "Object + Relationship + Event" model (docs/02-data-model.md).
// One source of truth describing every object type the platform knows:
// core typed fields, the pipeline (for opportunities), and option lists.
// Custom fields (FieldDef rows) are merged on top at runtime.

export type FieldSpec = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "select" | "email" | "url" | "currency";
  required?: boolean;
  options?: string[]; // for select
  searchable?: boolean; // included in global search
  list?: boolean; // shown in list tables by default
};

export type ObjectDef = {
  type: string; // prisma model name, lowercase
  label: string; // human label
  labelPlural: string;
  icon: string;
  fields: FieldSpec[];
  // UI-customisable pipeline (opportunities) — admin-editable in a later phase.
  pipeline?: { stage: string; probability: number }[];
};

export const PIPELINE = [
  { stage: "discovery", probability: 10 },
  { stage: "qualified", probability: 25 },
  { stage: "proposal", probability: 50 },
  { stage: "negotiation", probability: 75 },
  { stage: "won", probability: 100 },
  { stage: "lost", probability: 0 },
];

export const OBJECTS: ObjectDef[] = [
  {
    type: "contact",
    label: "Contact",
    labelPlural: "Contacts",
    icon: "users",
    fields: [
      { key: "firstName", label: "First name", type: "text", required: true, searchable: true, list: true },
      { key: "lastName", label: "Last name", type: "text", required: true, searchable: true, list: true },
      { key: "email", label: "Email", type: "email", searchable: true, list: true },
      { key: "phone", label: "Phone", type: "text", searchable: true, list: true },
      { key: "title", label: "Job title", type: "text", searchable: true, list: true },
      { key: "accountId", label: "Account", type: "text" },
      { key: "source", label: "Source", type: "select", options: ["Referral", "Website", "Cold outreach", "Event", "Import", "Other"] },
      { key: "status", label: "Status", type: "select", options: ["new", "contacted", "qualified", "customer", "lost"] },
    ],
  },
  {
    type: "account",
    label: "Account",
    labelPlural: "Accounts",
    icon: "building",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, searchable: true, list: true },
      { key: "parentId", label: "Parent account", type: "text" }, // account hierarchy (Phase 1)
      { key: "industry", label: "Industry", type: "select", options: ["Technology", "Finance", "Healthcare", "Retail", "Manufacturing", "Education", "Other"], searchable: true, list: true },
      { key: "website", label: "Website", type: "url", searchable: true, list: true },
      { key: "phone", label: "Phone", type: "text", searchable: true, list: true },
      { key: "employees", label: "Employees", type: "number", list: true },
      { key: "tier", label: "Tier", type: "select", options: ["SMB", "Mid-Market", "Enterprise"] },
    ],
  },
  {
    type: "lead",
    label: "Lead",
    labelPlural: "Leads",
    icon: "target",
    fields: [
      { key: "firstName", label: "First name", type: "text", required: true, searchable: true, list: true },
      { key: "lastName", label: "Last name", type: "text", required: true, searchable: true, list: true },
      { key: "email", label: "Email", type: "email", searchable: true, list: true },
      { key: "phone", label: "Phone", type: "text", searchable: true, list: true },
      { key: "company", label: "Company", type: "text", searchable: true, list: true },
      { key: "source", label: "Source", type: "select", options: ["Referral", "Website", "Cold outreach", "Event", "Import", "Other"] },
      { key: "status", label: "Status", type: "select", options: ["new", "contacted", "qualified", "converted", "lost"] },
      { key: "score", label: "Score", type: "number", list: true },
      { key: "campaignId", label: "Campaign", type: "text" }, // Phase 5 attribution
    ],
  },
  {
    type: "opportunity",
    label: "Deal",
    labelPlural: "Deals",
    icon: "dollar",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, searchable: true, list: true },
      { key: "amount", label: "Amount", type: "currency", list: true },
      { key: "stage", label: "Stage", type: "select", options: PIPELINE.map((p) => p.stage) },
      { key: "probability", label: "Probability", type: "number", list: true },
      { key: "pipelineId", label: "Pipeline", type: "text" }, // Phase 2-lite multi-pipeline (rendered as a select via relation options)
      { key: "closeDate", label: "Close date", type: "date" },
      { key: "accountId", label: "Account", type: "text" },
      { key: "contactId", label: "Contact", type: "text" },
      { key: "winReason", label: "Win reason", type: "text" },
      { key: "lostReason", label: "Lost reason", type: "text" },
      { key: "competitors", label: "Competitors", type: "text" },
    ],
  },
  {
    type: "task",
    label: "Task",
    labelPlural: "Tasks",
    icon: "check",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, searchable: true, list: true },
      { key: "description", label: "Description", type: "text", searchable: true },
      { key: "dueAt", label: "Due date", type: "date", list: true },
      { key: "status", label: "Status", type: "select", options: ["todo", "in_progress", "done"] },
      { key: "priority", label: "Priority", type: "select", options: ["low", "medium", "high"], list: true },
      { key: "contactId", label: "Contact", type: "text" },
      { key: "opportunityId", label: "Deal", type: "text" },
    ],
  },
  {
    type: "note",
    label: "Note",
    labelPlural: "Notes",
    icon: "file",
    fields: [
      { key: "body", label: "Body", type: "text", required: true, searchable: true },
      { key: "contactId", label: "Contact", type: "text" },
      { key: "accountId", label: "Account", type: "text" },
      { key: "opportunityId", label: "Deal", type: "text" },
    ],
  },
  // Phase 4 · Customer Service — tickets are a first-class object type (ADR-016).
  // The generic service powers CRUD/audit/events/search/custom fields; the
  // ticket router (server/routes/tickets.ts) adds reference numbers, SLA
  // deadlines, status transitions, replies, escalation, legal hold, and intake.
  {
    type: "ticket",
    label: "Ticket",
    labelPlural: "Tickets",
    icon: "lifebuoy",
    fields: [
      { key: "reference", label: "Reference", type: "text", searchable: true, list: true },
      { key: "subject", label: "Subject", type: "text", required: true, searchable: true, list: true },
      { key: "description", label: "Description", type: "text", searchable: true },
      { key: "status", label: "Status", type: "select", options: ["new", "open", "pending", "resolved", "closed"], list: true },
      { key: "priority", label: "Priority", type: "select", options: ["low", "medium", "high", "urgent"], list: true },
      { key: "channel", label: "Channel", type: "select", options: ["email", "web", "chat", "whatsapp", "sms", "phone", "social"], list: true },
      { key: "source", label: "Source", type: "select", options: ["portal", "email", "manual"] },
      { key: "contactId", label: "Contact", type: "text" },
      { key: "accountId", label: "Account", type: "text" },
      { key: "slaDueAt", label: "SLA due", type: "date", list: true },
      { key: "escalated", label: "Escalated", type: "boolean", list: true },
      { key: "legalHold", label: "Legal hold", type: "boolean" },
    ],
  },
];

export function getObjectDef(type: string): ObjectDef {
  const def = OBJECTS.find((o) => o.type === type);
  if (!def) throw new Error(`Unknown object type: ${type}`);
  return def;
}

export function stageProbability(stage: string): number {
  return PIPELINE.find((p) => p.stage === stage)?.probability ?? 10;
}

export function validateFieldValue(spec: FieldSpec, value: unknown): unknown {
  if (value === undefined || value === null || value === "") return spec.required ? null : undefined;
  switch (spec.type) {
    case "number":
    case "currency":
      return typeof value === "number" ? value : Number(value);
    case "boolean":
      return Boolean(value);
    case "date": {
      const d = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    default:
      return String(value);
  }
}
