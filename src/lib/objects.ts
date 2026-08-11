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
    formFields: ["name", "amount", "pipelineId", "stage", "closeDate"],
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
};

// Phase 2-lite multi-pipeline — client mirror of server/lib/pipelines.ts shapes.
export type PipelineStage = { key: string; label: string; probability: number; order: number };
export type Pipeline = { id: string; name: string; isDefault: boolean; stages: PipelineStage[]; dealCount?: number };

export const STAGE_TONES: Record<string, string> = {
  discovery: "violet",
  qualified: "blue",
  proposal: "amber",
  negotiation: "gold",
  won: "green",
  lost: "rose",
};

// Gradient classes per column for the deals board (cycled by stage index).
export const STAGE_COLORS: [string, string][] = [
  ["from-violet-500/80 to-violet-500/20", "text-violet-300"],
  ["from-accent-500/80 to-accent-500/20", "text-accent-300"],
  ["from-amber-500/80 to-amber-500/20", "text-amber-300"],
  ["from-yellow-500/80 to-yellow-500/20", "text-yellow-300"],
  ["from-emerald-500/80 to-emerald-500/20", "text-emerald-300"],
  ["from-rose-500/80 to-rose-500/20", "text-rose-300"],
];
