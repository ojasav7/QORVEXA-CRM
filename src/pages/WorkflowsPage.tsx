import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, GitMerge, Play, ListChecks, Bell, X, History, Loader2 } from "lucide-react";
import { api, del, patch, post, ApiError } from "../lib/api";
import { Badge, Field, Modal, Spinner, EmptyState } from "../components/ui";
import { timeAgo } from "../lib/format";
import { useSession } from "../App";

// Client mirror of server/lib/automations.ts trigger catalog.
const TRIGGER_EVENTS: { event: string; label: string; objectType: string }[] = [
  { event: "deal.stage_changed", label: "When a deal changes stage", objectType: "opportunity" },
  { event: "deal.created", label: "When a deal is created", objectType: "opportunity" },
  { event: "deal.updated", label: "When a deal is updated", objectType: "opportunity" },
  { event: "lead.created", label: "When a lead is created", objectType: "lead" },
  { event: "contact.created", label: "When a contact is created", objectType: "contact" },
  { event: "task.completed", label: "When a task is completed", objectType: "task" },
  // Phase 4 · Customer Service
  { event: "ticket.created", label: "When a ticket is created", objectType: "ticket" },
  { event: "ticket.status_changed", label: "When a ticket changes status", objectType: "ticket" },
  { event: "ticket.escalated", label: "When a ticket is escalated", objectType: "ticket" },
  // Phase 5 · Marketing — landing-page submissions
  { event: "form.submitted", label: "When a landing page form is submitted", objectType: "lead" },
];
const TRIGGER_LABELS: Record<string, string> = Object.fromEntries(TRIGGER_EVENTS.map((t) => [t.event, t.label]));
const OBJECT_TYPE_BY_EVENT: Record<string, string> = Object.fromEntries(TRIGGER_EVENTS.map((t) => [t.event, t.objectType]));
// API route per object type (opportunity → opportunities — not a naive +"s").
const API_PATH_BY_TYPE: Record<string, string> = { opportunity: "/api/opportunities", lead: "/api/leads", contact: "/api/contacts", task: "/api/tasks", ticket: "/api/tickets" };
// Trigger events that support a `to` filter (stage/status picker).
const TRIGGERS_WITH_TO = ["deal.stage_changed", "ticket.status_changed"];

const OPS: [string, string][] = [
  ["eq", "is"], ["neq", "is not"], ["contains", "contains"], ["not_contains", "doesn't contain"],
  ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["in", "is one of"], ["not_in", "is none of"],
];

type Automation = {
  id: string;
  name: string;
  description: string | null;
  trigger: { kind: string; event: string; to?: string };
  conditions: { field: string; op: string; value: unknown }[];
  actions: Record<string, any>[];
  active: boolean;
  runCount: number;
  lastRunAt: string | null;
  createdByName: string | null;
  createdAt: string;
};
type Run = {
  id: string;
  eventType: string;
  entity: string;
  entityId: string;
  matched: boolean;
  actions: { type: string; status: string; detail?: string }[];
  note: string | null;
  triggeredBy: string;
  createdAt: string;
};
type CoreField = { key: string; label: string; type: string; options?: string[] };

const ACTION_TYPES = [
  ["create_task", "Create a task"],
  ["notify", "Notify someone"],
  ["update_record", "Update the record"],
];

export default function WorkflowsPage() {
  const { user } = useSession();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [viewingRuns, setViewingRuns] = useState<Automation | null>(null);
  const [testing, setTesting] = useState<Automation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items: Automation[] }>("/api/automations");
      setAutomations(d.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (a: Automation) => {
    try {
      await patch(`/api/automations/${a.id}`, { active: !a.active });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  };

  const remove = async (a: Automation) => {
    if (!confirm(`Delete workflow "${a.name}"?`)) return;
    try {
      await del(`/api/automations/${a.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Workflows</h1>
          <p className="text-sm text-slate-500">Automate the event bus — when something happens, do something. Trigger → condition → action.</p>
        </div>
        {user?.role === "admin" && (
          <button className="btn-primary ml-auto" onClick={() => setCreating(true)}><Plus className="size-4" /> New workflow</button>
        )}
      </div>
      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-40" />)}
        </div>
      ) : automations.length === 0 ? (
        <EmptyState
          icon={<GitMerge className="size-8" />}
          title="No workflows yet"
          hint="Create one — e.g. when a deal moves to won, notify the owner and create a follow-up task."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {automations.map((a) => (
            <div key={a.id} className={`card p-5 transition-colors ${a.active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex size-9 items-center justify-center rounded-xl bg-teal-500/15 text-teal-400"><GitMerge className="size-4" /></div>
                <button
                  onClick={() => void toggle(a)}
                  title={a.active ? "Active — click to pause" : "Paused — click to activate"}
                  className={`relative h-5 w-9 rounded-full transition-colors ${a.active ? "bg-accent-500" : "bg-white/10"}`}
                >
                  <span className={`absolute top-0.5 size-4 rounded-full transition-all ${a.active ? "left-4 bg-on-brand" : "left-0.5 bg-white"}`} />
                </button>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-white">{a.name}</h3>
              <p className="mt-1 line-clamp-2 min-h-8 text-xs text-slate-500">{a.description || "No description"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone="blue">{TRIGGER_LABELS[a.trigger.event] ?? a.trigger.event}</Badge>
                {a.trigger.to && <Badge tone="green">→ {a.trigger.to}</Badge>}
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1"><ListChecks className="size-3" /> {a.conditions.length} condition{a.conditions.length === 1 ? "" : "s"}</span>
                <span className="flex items-center gap-1"><Bell className="size-3" /> {a.actions.length} action{a.actions.length === 1 ? "" : "s"}</span>
                <span className="flex items-center gap-1"><History className="size-3" /> {a.runCount} run{a.runCount === 1 ? "" : "s"}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3">
                <span className="text-[11px] text-slate-600">{a.lastRunAt ? `Last run ${timeAgo(a.lastRunAt)}` : "Never run"}</span>
                <div className="flex gap-1">
                  <button onClick={() => setTesting(a)} title="Test against a record" className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><Play className="size-3.5" /></button>
                  <button onClick={() => setViewingRuns(a)} title="Run history" className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><History className="size-3.5" /></button>
                  <button onClick={() => setEditing(a)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><Pencil className="size-3.5" /></button>
                  <button onClick={() => void remove(a)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <WorkflowModal
          initial={editing}
          isAdmin={user?.role === "admin"}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
      {viewingRuns && <RunsPanel automation={viewingRuns} onClose={() => setViewingRuns(null)} />}
      {testing && <TestModal automation={testing} onClose={() => setTesting(null)} />}
    </div>
  );
}

// ── Builder modal ────────────────────────────────────────────────────────────
function WorkflowModal({ initial, isAdmin, onClose, onDone }: { initial: Automation | null; isAdmin: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    event: initial?.trigger?.event ?? "deal.stage_changed",
    to: initial?.trigger?.to ?? "",
    conditions: initial?.conditions?.length ? initial.conditions.map((c) => ({ ...c })) : [],
    actions: initial?.actions?.length ? initial.actions.map((a) => ({ ...a })) : [{ type: "create_task", title: "", priority: "medium" }],
  });
  const [fields, setFields] = useState<CoreField[]>([]);
  const [stageOptions, setStageOptions] = useState<string[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ duplicateId: string; duplicateName: string } | null>(null);

  const objectType = OBJECT_TYPE_BY_EVENT[form.event] ?? "opportunity";

  useEffect(() => {
    void api<{ core: CoreField[] }>(`/api/fields/${objectType}`).then((d) => setFields(d.core)).catch(() => {});
  }, [objectType]);

  useEffect(() => {
    if (form.event !== "deal.stage_changed") return;
    void api<{ items: { name: string; isDefault: boolean; stages: { key: string; label: string }[] }[] }>("/api/pipelines")
      .then((d) => setStageOptions([...new Set(d.items.flatMap((p) => p.stages.map((s) => s.key)))])).catch(() => {});
  }, [form.event]);

  useEffect(() => {
    void api<{ items: { id: string; name: string }[] }>("/api/users").then((d) => setUsers(d.items)).catch(() => {});
  }, []);

  const setCondition = (i: number, patch: Partial<{ field: string; op: string; value: unknown }>) => {
    setForm((f) => ({ ...f, conditions: f.conditions.map((row, idx) => idx === i ? { ...row, ...patch } : row) }));
  };
  const setAction = (i: number, patch: Partial<Record<string, any>>) => {
    setForm((f) => ({ ...f, actions: f.actions.map((row, idx) => idx === i ? { ...row, ...patch } : row) }));
  };

  const submit = async (allowDuplicate = false) => {
    if (!form.name.trim()) { setError("Name is required"); return; }
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      trigger: { kind: "event", event: form.event, ...(form.event === "deal.stage_changed" && form.to ? { to: form.to } : {}) },
      conditions: form.conditions.filter((c) => c.field && c.op),
      actions: form.actions.filter((a) => a.type),
      ...(allowDuplicate ? { allowDuplicate: true } : {}),
    };
    setBusy(true); setError(null); setDuplicate(null);
    try {
      if (initial) await patch(`/api/automations/${initial.id}`, body);
      else await post("/api/automations", body);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data?.duplicateId) {
        setDuplicate({ duplicateId: String(e.data.duplicateId), duplicateName: String(e.data.duplicateName ?? "another workflow") });
        setError(null);
      } else {
        setError(e instanceof ApiError ? e.message : "Failed to save");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <Modal open onClose={onClose} title="Workflow builder">
        <div className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-400">Only admins can create or edit workflows. Ask an admin to set this up.</div>
        <div className="mt-4 flex justify-end"><button className="btn-ghost" onClick={onClose}>Close</button></div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={initial ? "Edit workflow" : "New workflow"} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Celebrate won deals" /></Field>
          <Field label="Description"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What should this do?" /></Field>
        </div>

        {/* Trigger */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500"><GitMerge className="size-3.5 text-accent-400" /> Trigger</div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input flex-1"
              value={form.event}
              onChange={(e) => {
                const next = e.target.value;
                // Conditions reference fields of the trigger's object type — drop
                // them when the trigger switches to a different object.
                const sameObject = OBJECT_TYPE_BY_EVENT[next] === OBJECT_TYPE_BY_EVENT[form.event];
                setForm({ ...form, event: next, to: "", ...(sameObject ? {} : { conditions: [] }) });
              }}
            >
              {TRIGGER_EVENTS.map((t) => <option key={t.event} value={t.event}>{t.label}</option>)}
            </select>
            {TRIGGERS_WITH_TO.includes(form.event) && form.event === "deal.stage_changed" && (
              <>
                <span className="text-xs text-slate-500">to stage</span>
                <select className="input w-40" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
                  <option value="">any stage</option>
                  {stageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </>
            )}
            {TRIGGERS_WITH_TO.includes(form.event) && form.event === "ticket.status_changed" && (
              <>
                <span className="text-xs text-slate-500">to status</span>
                <select className="input w-40" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
                  <option value="">any status</option>
                  {["new", "open", "pending", "resolved", "closed"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </>
            )}
          </div>
        </div>

        {/* Conditions */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Conditions <span className="normal-case text-slate-600">(all must match — optional)</span></span>
            <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setForm((f) => ({ ...f, conditions: [...f.conditions, { field: fields[0]?.key ?? "status", op: "eq", value: "" }] }))}>
              <Plus className="size-3" /> Add condition
            </button>
          </div>
          {form.conditions.length === 0 && <p className="text-xs text-slate-600">No conditions — runs on every matching event.</p>}
          <div className="space-y-2">
            {form.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className="input w-36" value={c.field} onChange={(e) => setCondition(i, { field: e.target.value })}>
                  {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  <option value="payload.to">payload.to (stage)</option>
                  <option value="payload.from">payload.from (stage)</option>
                </select>
                <select className="input w-32" value={c.op} onChange={(e) => setCondition(i, { op: e.target.value })}>
                  {OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input
                  className="input min-w-0 flex-1"
                  placeholder={fields.find((x) => x.key === c.field)?.type === "number" ? "number" : "value"}
                  value={String(c.value ?? "")}
                  onChange={(e) => setCondition(i, { value: e.target.value })}
                />
                <button onClick={() => setForm((s) => ({ ...s, conditions: s.conditions.filter((_, idx) => idx !== i) }))} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><X className="size-4" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Actions <span className="normal-case text-slate-600">(all run — use <code className="rounded bg-white/10 px-1">{"{{field}}"}</code> to merge record values)</span></span>
            <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setForm((f) => ({ ...f, actions: [...f.actions, { type: "create_task", title: "" }] }))}>
              <Plus className="size-3" /> Add action
            </button>
          </div>
          <div className="space-y-2">
            {form.actions.map((a, i) => (
              <div key={i} className="rounded-lg border border-white/[0.06] bg-ink-900/40 p-3">
                <div className="flex items-center gap-2">
                  <select className="input w-44" value={a.type} onChange={(e) => setAction(i, { type: e.target.value, title: "" })}>
                    {ACTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {a.type === "create_task" && (
                    <>
                      <input className="input min-w-0 flex-1" placeholder='Title — e.g. "Follow up with {{name}}"' value={a.title ?? ""} onChange={(e) => setAction(i, { title: e.target.value })} />
                      <input className="input w-24" type="number" min={0} max={365} placeholder="Due in days" value={a.dueInDays ?? ""} onChange={(e) => setAction(i, { dueInDays: e.target.value === "" ? undefined : Number(e.target.value) })} />
                      <select className="input w-28" value={a.priority ?? "medium"} onChange={(e) => setAction(i, { priority: e.target.value })}>
                        {["low", "medium", "high"].map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <button onClick={() => setForm((s) => ({ ...s, actions: s.actions.filter((_, idx) => idx !== i) }))} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><X className="size-4" /></button>
                    </>
                  )}
                  {a.type === "notify" && (
                    <>
                      <input className="input min-w-0 flex-1" placeholder="Title — e.g. Deal won 🎉" value={a.title ?? ""} onChange={(e) => setAction(i, { title: e.target.value })} />
                      <select className="input w-36" value={a.target ?? "owner"} onChange={(e) => setAction(i, { target: e.target.value })}>
                        <option value="owner">the record owner</option>
                        <option value="actor">the person who did it</option>
                        <option value="user">a specific person…</option>
                      </select>
                      {a.target === "user" && (
                        <select className="input w-40" value={a.userId ?? ""} onChange={(e) => setAction(i, { userId: e.target.value })}>
                          <option value="">Choose…</option>
                          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      )}
                      <button onClick={() => setForm((s) => ({ ...s, actions: s.actions.filter((_, idx) => idx !== i) }))} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><X className="size-4" /></button>
                    </>
                  )}
                  {a.type === "notify" && (a.title || a.body) && (
                    <input className="input mt-2 w-full" placeholder='Body (optional) — e.g. "{{name}} closed for {{amount}}"' value={a.body ?? ""} onChange={(e) => setAction(i, { body: e.target.value })} />
                  )}
                  {a.type === "update_record" && (
                    <>
                      <select className="input w-36" value={a.field ?? ""} onChange={(e) => setAction(i, { field: e.target.value })}>
                        <option value="">Field…</option>
                        {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                      <input className="input min-w-0 flex-1" placeholder="New value" value={String(a.value ?? "")} onChange={(e) => setAction(i, { value: e.target.value })} />
                      <button onClick={() => setForm((s) => ({ ...s, actions: s.actions.filter((_, idx) => idx !== i) }))} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><X className="size-4" /></button>
                    </>
                  )}
                </div>
                {a.type === "create_task" && a.title && (
                  <input className="input mt-2 w-full" placeholder="Description (optional)" value={a.description ?? ""} onChange={(e) => setAction(i, { description: e.target.value })} />
                )}
              </div>
            ))}
          </div>
        </div>

        {duplicate && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
            <span className="flex-1">This duplicates "<b>{duplicate.duplicateName}</b>" — running both would double the actions.</span>
            <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => void submit(true)} disabled={busy}>Save anyway</button>
          </div>
        )}
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void submit(false)} disabled={busy}>{busy ? <Spinner className="size-4" /> : initial ? "Save changes" : "Create workflow"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Run history panel ────────────────────────────────────────────────────────
function RunsPanel({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api<{ items: Run[] }>(`/api/automations/${automation.id}/runs?limit=50`).then((d) => setRuns(d.items)).catch(() => {}).finally(() => setLoading(false));
  }, [automation.id]);

  const tone = (status: string) => (status === "ok" ? "green" : status === "skipped" ? "default" : "rose");

  return (
    <Modal open onClose={onClose} title={`${automation.name} — run history`} wide>
      <p className="mb-4 text-xs text-slate-500">Every evaluation is logged — matched or not — so you can see exactly what each workflow did (and why it didn't).</p>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-10" />)}</div>
      ) : runs.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-600">No runs yet. Events will appear here as they happen — or use the test ▶ button.</div>
      ) : (
        <div className="space-y-3">
          {runs.map((r) => (
            <div key={r.id} className="rounded-lg border border-white/[0.05] bg-ink-900/40 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={r.matched ? "green" : "default"}>{r.matched ? "matched" : "skipped"}</Badge>
                <span className="font-medium text-slate-300">{r.eventType}</span>
                <span className="text-slate-600">{r.entity} · {r.entityId.slice(0, 8)}…</span>
                {r.triggeredBy === "test" && <Badge tone="blue">test</Badge>}
                <span className="ml-auto text-slate-600">{timeAgo(r.createdAt)}</span>
              </div>
              {r.note && <p className="mt-1.5 text-xs text-slate-500">{r.note}</p>}
              {r.actions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.actions.map((a, i) => (
                    <span key={i} title={a.detail ?? ""} className="chip">
                      <Badge tone={tone(a.status)}>{a.type}</Badge>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Test modal ───────────────────────────────────────────────────────────────
function TestModal({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const objectType = OBJECT_TYPE_BY_EVENT[automation.trigger.event] ?? "opportunity";
  const [records, setRecords] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{ matched: boolean; note: string | null; actions: { type: string; status: string; detail?: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const path = API_PATH_BY_TYPE[objectType] ?? `/api/${objectType}s`;
    void api<{ items: Record<string, any>[] }>(`${path}?pageSize=8`).then((d) => setRecords(d.items)).catch(() => {}).finally(() => setLoading(false));
  }, [objectType]);

  const title = (r: Record<string, any>) => r.name ?? ((`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim()) || r.title || r.id.slice(0, 8));

  const run = async (entityId: string) => {
    setBusy(true);
    try {
      const d = await post<{ matched: boolean; note: string | null; actions: { type: string; status: string; detail?: string }[] }>(`/api/automations/${automation.id}/test`, { entityId });
      setResult(d);
    } catch (e) {
      setResult({ matched: false, note: e instanceof ApiError ? e.message : "Test failed", actions: [] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Test "${automation.name}"`}>
      <p className="mb-3 text-xs text-slate-500">Runs the workflow against a real record now — same conditions and actions as a live event, marked as a test run.</p>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-9" />)}</div>
      ) : records.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-600">No {objectType} records to test against.</div>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {records.map((r) => (
            <button key={r.id} onClick={() => void run(r.id)} disabled={busy} className="flex w-full items-center gap-3 rounded-lg border border-white/[0.05] bg-ink-900/40 px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:border-accent-500/40 disabled:opacity-50">
              <Play className="size-3.5 text-accent-400" />
              <span className="min-w-0 flex-1 truncate">{title(r)}</span>
              <span className="text-xs text-slate-600">{r.status ?? r.stage ?? ""}</span>
            </button>
          ))}
        </div>
      )}
      {busy && <div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="size-3.5 animate-spin" /> Running…</div>}
      {result && (
        <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${result.matched ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
          {result.matched ? "Matched — actions executed:" : `Did not match${result.note ? ` (${result.note})` : ""}`}
          {result.actions.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.actions.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Badge tone={a.status === "ok" ? "green" : a.status === "failed" ? "rose" : "default"}>{a.status}</Badge>
                  <span className="text-slate-300">{a.type}</span>
                  {a.detail && <span className="truncate text-slate-500">{a.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
