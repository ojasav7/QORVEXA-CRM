// Client-side mirror of server/lib/registry.ts — drives list columns and forms.
export type FieldSpec = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "select" | "email" | "url" | "currency";
  required?: boolean;
  options?: string[];
  searchable?: boolean;
  list?: boolean;
};

export type ObjectMeta = {
  type: string;
  label: string;
  plural: string;
  path: string;
  titleField: string; // used for the record title
  columns: string[]; // field keys shown in the table
  formFields: string[]; // field keys shown in the create/edit form
};

export const OBJECT_META: Record<string, ObjectMeta> = {
  contact: {
    type: "contact",
    label: "Contact",
    plural: "Contacts",
    path: "/contacts",
    titleField: "name",
    columns: ["firstName", "lastName", "title", "email", "phone", "status"],
    formFields: ["firstName", "lastName", "email", "phone", "title", "source", "status"],
  },
  account: {
    type: "account",
    label: "Account",
    plural: "Accounts",
    path: "/accounts",
    titleField: "name",
    columns: ["name", "industry", "tier", "employees", "website"],
    formFields: ["name", "parentId", "industry", "tier", "employees", "website", "phone"],
  },
  lead: {
    type: "lead",
    label: "Lead",
    plural: "Leads",
    path: "/leads",
    titleField: "name",
    columns: ["firstName", "lastName", "company", "email", "source", "score", "status"],
    formFields: ["firstName", "lastName", "email", "phone", "company", "source", "status", "score"],
  },
  opportunity: {
    type: "opportunity",
    label: "Deal",
    plural: "Deals",
    path: "/deals",
    titleField: "name",
    columns: ["name", "accountId_label", "pipelineId_label", "amount", "stage", "closeDate"],
    // Blueprint Phase 2 deal fields — value (amount), probability (derived from
    // the pipeline stage), close date, competitors, and win/lost reasons.
    formFields: ["name", "amount", "pipelineId", "stage", "closeDate", "competitors", "winReason", "lostReason"],
  },
  task: {
    type: "task",
    label: "Task",
    plural: "Tasks",
    path: "/activities",
    titleField: "title",
    columns: ["title", "priority", "status", "dueAt"],
    formFields: ["title", "description", "priority", "status", "dueAt"],
  },
  // Phase 4 · Customer Service — tickets are a first-class object type (ADR-016).
  ticket: {
    type: "ticket",
    label: "Ticket",
    plural: "Tickets",
    path: "/tickets",
    titleField: "subject",
    columns: ["reference", "subject", "priority", "status", "channel", "slaDueAt"],
    formFields: ["subject", "description", "priority", "channel", "contactId", "accountId"],
  },
};

export const TICKET_STATUSES = ["new", "open", "pending", "resolved", "closed"];
export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"];
export const TICKET_CHANNELS = ["email", "web", "chat", "whatsapp", "sms", "phone", "social"];

export const PRIORITY_TONES: Record<string, string> = {
  low: "default",
  medium: "blue",
  high: "amber",
  urgent: "rose",
};

export const STATUS_TONES: Record<string, string> = {
  new: "blue",
  open: "teal",
  pending: "amber",
  resolved: "green",
  closed: "default",
};

export const SLA_TONES: Record<string, string> = {
  on_track: "green",
  due_soon: "amber",
  breached: "rose",
  "n/a": "default",
};

// Phase 2-lite multi-pipeline — client mirror of server/lib/pipelines.ts shapes.
export type PipelineStage = { key: string; label: string; probability: number; order: number };
export type Pipeline = { id: string; name: string; isDefault: boolean; stages: PipelineStage[]; dealCount?: number };

export const STAGE_TONES: Record<string, string> = {
  discovery: "teal",
  qualified: "blue",
  proposal: "amber",
  negotiation: "gold",
  won: "green",
  lost: "rose",
};

// Gradient classes per column for the deals board (cycled by stage index).
export const STAGE_COLORS: [string, string][] = [
  ["from-teal-500/80 to-teal-500/20", "text-teal-300"],
  ["from-accent-500/80 to-accent-500/20", "text-accent-300"],
  ["from-amber-500/80 to-amber-500/20", "text-amber-300"],
  ["from-yellow-500/80 to-yellow-500/20", "text-yellow-300"],
  ["from-emerald-500/80 to-emerald-500/20", "text-emerald-300"],
  ["from-rose-500/80 to-rose-500/20", "text-rose-300"],
];
