import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Waypoints, Play, History, ArrowRight, X, Loader2, Users } from "lucide-react";
import { api, del, patch, post, ApiError } from "../lib/api";
import { Badge, Field, Modal, Spinner, EmptyState } from "../components/ui";
import { timeAgo } from "../lib/format";
import { useSession } from "../App";

type Journey = {
  id: string;
  name: string;
  description: string | null;
  trigger: { kind: string; event?: string; segmentId?: string };
  steps: Record<string, any>[];
  active: boolean;
  enrolledCount: number;
  triggerLabel: string;
  createdAt: string;
};
type Segment = { id: string; name: string; objectType: string };
type Template = { id: string; name: string };
type Enrollment = { id: string; entity: string; entityName: string | null; entityEmail: string | null; currentStep: number; status: string; nextRunAt: string | null; enteredAt: string };
type StepRun = { id: string; stepIndex: number; stepType: string; status: string; detail: string | null; createdAt: string };

const TRIGGER_EVENTS: { event: string; label: string }[] = [
  { event: "lead.created", label: "When a lead is created" },
  { event: "contact.created", label: "When a contact is created" },
  { event: "deal.created", label: "When a deal is created" },
  { event: "deal.stage_changed", label: "When a deal changes stage" },
  { event: "task.completed", label: "When a task is completed" },
  { event: "ticket.created", label: "When a ticket is created" },
  { event: "form.submitted", label: "When a landing page form is submitted" },
];

const STEP_TYPES: [string, string][] = [
  ["wait", "Wait"],
  ["send_email", "Send email"],
  ["notify", "Notify"],
  ["create_task", "Create task"],
  ["update_record", "Update record"],
  ["condition", "Branch on condition"],
  ["end", "End"],
];

const OPS: [string, string][] = [
  ["eq", "is"], ["neq", "is not"], ["contains", "contains"], ["not_contains", "doesn't contain"],
  ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["in", "is one of"], ["not_in", "is none of"],
];

const FIELD_OPTIONS: [string, string][] = [
  ["status", "Status"], ["score", "Score (lead)"], ["company", "Company"], ["email", "Email"], ["source", "Source"], ["title", "Title"],
];

const statusTone: Record<string, "default" | "green" | "amber" | "blue"> = {
  active: "blue", waiting: "amber", completed: "green", exited: "default",
};

export default function JourneysPage() {
  const { user } = useSession();
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Journey | null>(null);
  const [viewing, setViewing] = useState<Journey | null>(null);
  const [testing, setTesting] = useState<Journey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items: Journey[] }>("/api/journeys");
      setJourneys(d.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load journeys");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (j: Journey) => {
    try {
      await patch(`/api/journeys/${j.id}`, { active: !j.active });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  };

  const remove = async (j: Journey) => {
    if (!confirm(`Delete journey "${j.name}"?`)) return;
    try {
      await del(`/api/journeys/${j.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  };

  const advance = async () => {
    setAdvancing(true); setError(null);
    try {
      const d = await post<{ advanced: number }>("/api/journeys/advance", {});
      await load();
      alert(`Advanced ${d.advanced} waiting enrollment${d.advanced === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to advance");
    } finally {
      setAdvancing(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Journeys</h1>
          <p className="text-sm text-slate-500">Orchestrate the customer experience — a trigger event starts a timed sequence of emails, tasks, and notifications.</p>
        </div>
        {user?.role === "admin" && (
          <button className="btn-primary ml-auto" onClick={() => setCreating(true)}><Plus className="size-4" /> New journey</button>
        )}
      </div>
      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-44" />)}
        </div>
      ) : journeys.length === 0 ? (
        <EmptyState
          icon={<Waypoints className="size-8" />}
          title="No journeys yet"
          hint="Build one — e.g. when a lead is created, wait 1 day, send a welcome email, then notify the owner."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {journeys.map((j) => (
            <div key={j.id} className={`card p-5 transition-colors ${j.active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400"><Waypoints className="size-4" /></div>
                <button
                  onClick={() => void toggle(j)}
                  title={j.active ? "Active — click to pause" : "Paused — click to activate"}
                  className={`relative h-5 w-9 rounded-full transition-colors ${j.active ? "bg-accent-500" : "bg-white/10"}`}
                >
                  <span className={`absolute top-0.5 size-4 rounded-full transition-all ${j.active ? "left-4 bg-on-brand" : "left-0.5 bg-white"}`} />
                </button>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-white">{j.name}</h3>
              <p className="mt-1 line-clamp-2 min-h-8 text-xs text-slate-500">{j.description || "No description"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone="blue">{j.triggerLabel}</Badge>
                <Badge tone="amber">{j.steps.length} step{j.steps.length === 1 ? "" : "s"}</Badge>
                <Badge tone="violet"><Users className="size-3" /> {j.enrolledCount}</Badge>
              </div>
              <div className="mt-3 flex min-h-9 flex-wrap gap-1">
                {j.steps.slice(0, 4).map((s, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ArrowRight className="size-3 text-slate-700" />}
                    <span className="chip">{s.type}</span>
                  </span>
                ))}
                {j.steps.length > 4 && <span className="chip">+{j.steps.length - 4}</span>}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3">
                <span className="text-[11px] text-slate-600">{timeAgo(j.createdAt)}</span>
                <div className="flex gap-1">
                  <button onClick={() => setTesting(j)} title="Test against a contact" className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><Play className="size-3.5" /></button>
                  <button onClick={() => setViewing(j)} title="Enrollments & run log" className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><History className="size-3.5" /></button>
                  {user?.role === "admin" && (
                    <>
                      <button onClick={() => setEditing(j)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><Pencil className="size-3.5" /></button>
                      <button onClick={() => void remove(j)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {user?.role === "admin" && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-slate-500">
          <Loader2 className={`size-3.5 ${advancing ? "animate-spin" : ""}`} />
          <span className="flex-1">Waits are advanced by a background ticker (every 60s).</span>
          <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => void advance()} disabled={advancing}>Advance now</button>
        </div>
      )}

      {(creating || editing) && (
        <JourneyModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
      {viewing && <EnrollmentsPanel journey={viewing} onClose={() => setViewing(null)} />}
      {testing && <TestModal journey={testing} onClose={() => setTesting(null)} />}
    </div>
  );
}

// ── Builder modal ────────────────────────────────────────────────────────────
function JourneyModal({ initial, onClose, onDone }: { initial: Journey | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    triggerKind: initial?.trigger?.kind ?? "event",
    triggerEvent: initial?.trigger?.event ?? "lead.created",
    triggerSegmentId: initial?.trigger?.segmentId ?? "",
    steps: initial?.steps?.length ? initial.steps.map((s) => ({ ...s })) : [{ type: "wait", days: 1 }],
  });
  const [segments, setSegments] = useState<Segment[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: Segment[] }>("/api/segments").then((d) => setSegments(d.items)).catch(() => {});
    void api<{ items: Template[] }>("/api/email-templates").then((d) => setTemplates(d.items)).catch(() => {});
  }, []);

  const setStep = (i: number, patch: Partial<Record<string, any>>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));

  const addStep = () => setForm((f) => ({ ...f, steps: [...f.steps, { type: "wait", days: 1 }] }));
  const removeStep = (i: number) => setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }));
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= form.steps.length) return;
    setForm((f) => {
      const steps = [...f.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...f, steps };
    });
  };

  const submit = async () => {
    if (!form.name.trim()) { setError("Name is required"); return; }
    setBusy(true); setError(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        trigger:
          form.triggerKind === "event"
            ? { kind: "event", event: form.triggerEvent }
            : { kind: "segment", segmentId: form.triggerSegmentId },
        steps: form.steps,
      };
      if (initial) await patch(`/api/journeys/${initial.id}`, body);
      else await post("/api/journeys", body);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? "Edit journey" : "New journey"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. New lead welcome" /></Field>
          <Field label="Description"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What does this journey do?" /></Field>
        </div>

        {/* Trigger */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500"><Waypoints className="size-3.5 text-amber-400" /> Trigger</div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-32" value={form.triggerKind} onChange={(e) => setForm({ ...form, triggerKind: e.target.value })}>
              <option value="event">Event</option>
              <option value="segment">Segment</option>
            </select>
            {form.triggerKind === "event" ? (
              <select className="input flex-1" value={form.triggerEvent} onChange={(e) => setForm({ ...form, triggerEvent: e.target.value })}>
                {TRIGGER_EVENTS.map((t) => <option key={t.event} value={t.event}>{t.label}</option>)}
              </select>
            ) : (
              <select className="input flex-1" value={form.triggerSegmentId} onChange={(e) => setForm({ ...form, triggerSegmentId: e.target.value })}>
                <option value="">Choose a segment…</option>
                {segments.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.objectType})</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Steps */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Steps</span>
            <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={addStep}><Plus className="size-3" /> Add step</button>
          </div>
          {form.steps.length === 0 && <p className="text-xs text-slate-600">No steps — add a wait, email, task, or branch.</p>}
          <div className="space-y-2">
            {form.steps.map((s, i) => (
              <div key={i} className="rounded-lg border border-white/[0.06] bg-ink-900/40 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-semibold text-amber-400">{i + 1}</span>
                  <select className="input w-40" value={s.type} onChange={(e) => setStep(i, { type: e.target.value })}>
                    {STEP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {s.type === "wait" && (
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <input className="input w-16" type="number" min={0} placeholder="days" value={s.days ?? ""} onChange={(e) => setStep(i, { days: e.target.value === "" ? undefined : Number(e.target.value) })} />
                      <span>days</span>
                      <input className="input w-16" type="number" min={0} placeholder="hours" value={s.hours ?? ""} onChange={(e) => setStep(i, { hours: e.target.value === "" ? undefined : Number(e.target.value) })} />
                      <span>hours</span>
                    </div>
                  )}
                  {s.type === "send_email" && (
                    <select className="input min-w-0 flex-1" value={s.templateId ?? ""} onChange={(e) => setStep(i, { templateId: e.target.value })}>
                      <option value="">Choose a template…</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                  {s.type === "notify" && (
                    <input className="input min-w-0 flex-1" placeholder="Title — e.g. New lead needs a callback" value={s.title ?? ""} onChange={(e) => setStep(i, { title: e.target.value })} />
                  )}
                  {s.type === "create_task" && (
                    <>
                      <input className="input min-w-0 flex-1" placeholder='Title — e.g. "Follow up with {{contact.firstName}}"' value={s.title ?? ""} onChange={(e) => setStep(i, { title: e.target.value })} />
                      <input className="input w-20" type="number" min={0} placeholder="Due in days" value={s.dueInDays ?? ""} onChange={(e) => setStep(i, { dueInDays: e.target.value === "" ? undefined : Number(e.target.value) })} />
                    </>
                  )}
                  {s.type === "update_record" && (
                    <>
                      <select className="input w-36" value={s.field ?? "status"} onChange={(e) => setStep(i, { field: e.target.value })}>
                        {FIELD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <input className="input min-w-0 flex-1" placeholder="New value" value={String(s.value ?? "")} onChange={(e) => setStep(i, { value: e.target.value })} />
                    </>
                  )}
                  {s.type === "condition" && (
                    <>
                      <select className="input w-32" value={s.field ?? "score"} onChange={(e) => setStep(i, { field: e.target.value })}>
                        {FIELD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <select className="input w-28" value={s.op ?? "gte"} onChange={(e) => setStep(i, { op: e.target.value })}>
                        {OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <input className="input w-20" placeholder="value" value={String(s.value ?? "")} onChange={(e) => setStep(i, { value: e.target.value })} />
                      <span className="text-xs text-slate-500">then step</span>
                      <input className="input w-14" type="number" min={i + 1} max={form.steps.length - 1} placeholder="→" value={s.thenIndex ?? ""} onChange={(e) => setStep(i, { thenIndex: e.target.value === "" ? undefined : Number(e.target.value) })} />
                    </>
                  )}
                  <button onClick={() => removeStep(i)} className="rounded-lg p-1.5 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><X className="size-4" /></button>
                </div>
                {s.type === "end" && <p className="mt-1.5 text-[11px] text-slate-600">Completes the journey for this contact.</p>}
              </div>
            ))}
          </div>
        </div>

        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? <Spinner className="size-4" /> : initial ? "Save changes" : "Create journey"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Enrollments + run log panel ──────────────────────────────────────────────
function EnrollmentsPanel({ journey, onClose }: { journey: Journey; onClose: () => void }) {
  const [tab, setTab] = useState<"enrollments" | "runs">("enrollments");
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [runs, setRuns] = useState<StepRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      api<{ items: Enrollment[] }>(`/api/journeys/${journey.id}/enrollments?pageSize=50`).then((d) => setEnrollments(d.items)).catch(() => {}),
      api<{ items: StepRun[] }>(`/api/journeys/${journey.id}/runs?limit=50`).then((d) => setRuns(d.items)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [journey.id]);

  return (
    <Modal open onClose={onClose} title={`${journey.name} — activity`} wide>
      <div className="mb-4 flex gap-1 rounded-xl bg-white/[0.04] p-1">
        {(["enrollments", "runs"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${tab === t ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>{t}</button>
        ))}
      </div>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-9" />)}</div>
      ) : tab === "enrollments" ? (
        enrollments.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-600">No enrollments yet. Trigger the journey by creating a matching record — or use the test ▶ button.</div>
        ) : (
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {enrollments.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-ink-900/40 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-200">{e.entityName ?? e.entity}</div>
                  <div className="truncate text-xs text-slate-600">{e.entityEmail}</div>
                </div>
                <Badge tone={statusTone[e.status] ?? "default"}>{e.status}</Badge>
                <span className="w-16 text-right text-xs text-slate-500">step {e.currentStep}</span>
                {e.nextRunAt && <span className="hidden text-xs text-slate-600 sm:block">{timeAgo(e.nextRunAt)}</span>}
              </div>
            ))}
          </div>
        )
      ) : runs.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-600">No step runs yet.</div>
      ) : (
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {runs.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-ink-900/40 px-3 py-2 text-sm">
              <span className="w-8 text-center text-xs font-semibold text-amber-400">{r.stepIndex}</span>
              <span className="w-28 text-xs font-medium text-slate-300">{r.stepType}</span>
              <Badge tone={r.status === "ok" ? "green" : r.status === "failed" ? "rose" : "default"}>{r.status}</Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{r.detail}</span>
              <span className="text-xs text-slate-600">{timeAgo(r.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Test modal ───────────────────────────────────────────────────────────────
function TestModal({ journey, onClose }: { journey: Journey; onClose: () => void }) {
  const [contacts, setContacts] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{ outcomes: { stepIndex: number; stepType: string; status: string; detail?: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ items: Record<string, any>[] }>("/api/contacts?pageSize=8").then((d) => setContacts(d.items)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const run = async (entityId: string) => {
    setBusy(true);
    try {
      const d = await post<{ outcomes: { stepIndex: number; stepType: string; status: string; detail?: string }[] }>(`/api/journeys/${journey.id}/test`, { entityId });
      setResult(d);
    } catch (e) {
      setResult({ outcomes: [{ stepIndex: 0, stepType: "error", status: "failed", detail: e instanceof ApiError ? e.message : "Test failed" }] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Test "${journey.name}"`}>
      <p className="mb-3 text-xs text-slate-500">Runs the journey synchronously against a real contact — waits are skipped, everything else executes exactly as live.</p>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-9" />)}</div>
      ) : contacts.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-600">No contacts to test against.</div>
      ) : (
        <div className="max-h-60 space-y-1.5 overflow-y-auto">
          {contacts.map((c) => (
            <button key={c.id} onClick={() => void run(c.id)} disabled={busy} className="flex w-full items-center gap-3 rounded-lg border border-white/[0.05] bg-ink-900/40 px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:border-amber-500/40 disabled:opacity-50">
              <Play className="size-3.5 text-amber-400" />
              <span className="min-w-0 flex-1 truncate">{`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.id}</span>
              <span className="text-xs text-slate-600">{c.email}</span>
            </button>
          ))}
        </div>
      )}
      {busy && <div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="size-3.5 animate-spin" /> Running…</div>}
      {result && (
        <div className="mt-3 space-y-1.5 rounded-xl border border-white/[0.06] bg-ink-900/40 p-3">
          {result.outcomes.map((o, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-6 text-center text-amber-400">{o.stepIndex}</span>
              <span className="w-24 font-medium text-slate-300">{o.stepType}</span>
              <Badge tone={o.status === "ok" ? "green" : "rose"}>{o.status}</Badge>
              <span className="min-w-0 flex-1 truncate text-slate-500">{o.detail}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
