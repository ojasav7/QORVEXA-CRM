import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Copy, Check, Pencil, KeyRound, GitBranch, RefreshCcw, ArrowRight, Database, Flag, HardDriveDownload, Shield, Globe, KeySquare, Route as RouteIcon, ClipboardList, Share2, Layers, ArrowUp, ArrowDown, Star } from "lucide-react";
import { api, del, patch, post, ApiError, type User, type Org } from "../lib/api";
import { Badge, Field, Modal, Spinner } from "../components/ui";
import { useSession } from "../App";
import { timeAgo, initials } from "../lib/format";

const OBJECT_TYPES = ["contact", "account", "lead", "opportunity", "task"];
const FIELD_TYPES = ["text", "number", "date", "boolean", "select", "multiselect", "url", "email"];

type FieldDef = { id: string; key: string; label: string; type: string; required: boolean; options: string[]; order: number };
type Webhook = { id: string; url: string; events: string[]; secret: string; active: boolean; createdAt: string };

export default function SettingsPage() {
  const { user, org, refresh } = useSession();
  const [tab, setTab] = useState<"team" | "fields" | "webhooks" | "environments" | "flags" | "backups" | "tokens" | "routing" | "forms" | "pipelines">("team");
  const isAdmin = user?.role === "admin";

  const tabs: [string, string][] = [
    ["team", "Team"],
    ["fields", "Custom fields"],
    ["webhooks", "Webhooks"],
    ["environments", "Environments"],
    ["flags", "Feature flags"],
    ["backups", "Backups"],
    ["tokens", "API tokens"],
    ["routing", "Lead routing"],
    ["forms", "Lead capture"],
    ["pipelines", "Pipelines"],
  ];

  return (
    <div className="animate-fade-up">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-white">Settings</h1>
        <p className="text-sm text-slate-500">{org?.name} · {org?.plan} plan</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-1 rounded-xl bg-ink-900/60 p-1 border border-white/[0.05] w-fit">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as typeof tab)} className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === key ? "bg-ink-700 text-white" : "text-slate-500 hover:text-slate-300"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "team" && <TeamTab />}
      {tab === "fields" && (isAdmin ? <FieldsTab /> : <NotAdmin />)}
      {tab === "webhooks" && (isAdmin ? <WebhooksTab /> : <NotAdmin />)}
      {tab === "environments" && (isAdmin ? <EnvironmentsTab /> : <NotAdmin />)}
      {tab === "flags" && (isAdmin ? <FlagsTab /> : <NotAdmin />)}
      {tab === "backups" && (isAdmin ? <BackupsTab /> : <NotAdmin />)}
      {tab === "tokens" && (isAdmin ? <TokensTab /> : <NotAdmin />)}
      {tab === "routing" && (isAdmin ? <LeadRoutingTab /> : <NotAdmin />)}
      {tab === "forms" && (isAdmin ? <LeadCaptureTab /> : <NotAdmin />)}
      {tab === "pipelines" && (isAdmin ? <PipelinesTab /> : <NotAdmin />)}
    </div>
  );
}

// ── Lead routing (Phase 1) ────────────────────────────────────────────────────
function LeadRoutingTab() {
  const [mode, setMode] = useState<"manual" | "round-robin">("manual");
  const [pool, setPool] = useState<string[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    void api<{ items: User[] }>("/api/users").then((d) => setUsers(d.items.filter((u) => u.role !== "admin"))).catch(() => {});
    void api<{ org: { settings: Record<string, any> } }>("/api/org").then((d) => {
      const rr = d.org.settings?.leadRouting;
      setMode(rr?.mode === "round-robin" ? "round-robin" : "manual");
      setPool(Array.isArray(rr?.pool) ? rr.pool.map(String) : []);
    }).catch(() => {});
  }, []);

  const toggleUser = (id: string) => setPool((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const d = await api<{ org: { settings: Record<string, any> } }>("/api/org");
      const settings = d.org.settings ?? {};
      const prev = (settings.leadRouting ?? {}) as Record<string, any>;
      await patch("/api/org", { settings: { ...settings, leadRouting: { mode, pool: mode === "round-robin" ? pool : [], cursor: prev.cursor ?? 0 } } });
      setMsg({ kind: "ok", text: "Routing config saved." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to save" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-6 py-4">
          <RouteIcon className="size-4 text-accent-400" />
          <h2 className="text-sm font-semibold text-white">Inbound lead assignment</h2>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">Mode</p>
            <div className="flex gap-2">
              {([[ "manual", "Manual"], ["round-robin", "Round-robin"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setMode(v)}
                  className={`chip transition-colors ${mode === v ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}>
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Round-robin hands each new lead (no explicit owner) to the next person in the pool, skipping inactive users. An explicit <span className="font-mono">ownerId</span> on create always wins, and admins can reassign any lead manually.
            </p>
          </div>

          {mode === "round-robin" && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">Pool (managers + reps)</p>
              <div className="flex flex-wrap gap-2">
                {users.map((u) => (
                  <button key={u.id} onClick={() => toggleUser(u.id)}
                    className={`chip transition-colors ${pool.includes(u.id) ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}>
                    {u.name} · <span className="capitalize">{u.role}</span>
                  </button>
                ))}
                {users.length === 0 && <span className="text-xs text-slate-600">Invite managers/reps first (Settings → Team).</span>}
              </div>
            </div>
          )}

          {msg && <div className={`rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{msg.text}</div>}
          <div className="flex justify-end">
            <button className="btn-primary" onClick={save} disabled={busy || (mode === "round-robin" && pool.length === 0)}>
              {busy ? <Spinner className="size-4" /> : "Save routing"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Public lead-capture forms (Phase 1) ───────────────────────────────────────
type LeadFormRow = { id: string; name: string; slug: string; fields: { key: string; label: string; required: boolean; type: string }[]; submitLabel: string; active: boolean; createdAt: string };
const LEAD_FORM_FIELDS = [
  { key: "firstName", label: "First name", type: "text" },
  { key: "lastName", label: "Last name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "phone" },
  { key: "company", label: "Company", type: "text" },
];

function LeadCaptureTab() {
  const [forms, setForms] = useState<LeadFormRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: LeadFormRow[] }>("/api/lead-forms");
      setForms(d.items);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to load forms" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const copy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };
  const url = (f: LeadFormRow) => `${window.location.origin}/forms/${f.slug}`;
  const embed = (f: LeadFormRow) => `<iframe src="${url(f)}" width="100%" height="560" frameBorder="0" title="${f.name}"></iframe>`;

  const toggleActive = async (f: LeadFormRow) => {
    try {
      await patch(`/api/lead-forms/${f.id}`, { active: !f.active });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };
  const remove = async (f: LeadFormRow) => {
    if (!confirm(`Delete form "${f.name}"? Its public URL stops working immediately.`)) return;
    try {
      await del(`/api/lead-forms/${f.id}`);
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Publish a public form — no login needed. Submissions become leads (source <span className="text-slate-300">Website</span>), routed by your <span className="font-mono text-accent-400">Lead routing</span> config, with a honeypot + rate limit.</p>
        <button className="btn-primary" onClick={() => setCreating(true)}><ClipboardList className="size-4" /> New form</button>
      </div>

      <div className="card divide-y divide-white/[0.04]">
        {forms.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
            <ClipboardList className={`size-4 ${f.active ? "text-mint-400" : "text-slate-600"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{f.name}</span>
                <span className="font-mono text-xs text-slate-600">/forms/{f.slug}</span>
                <Badge tone={f.active ? "green" : "rose"}>{f.active ? "live" : "paused"}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {f.fields.map((x) => x.label).join(" · ")} · button “{f.submitLabel}”
              </div>
            </div>
            <button className="btn-ghost !px-3 !py-1.5" onClick={() => copy(url(f), `url-${f.id}`)} title="Copy form URL">
              {copied === `url-${f.id}` ? <Check className="size-4 text-mint-400" /> : <Share2 className="size-4" />} URL
            </button>
            <button className="btn-ghost !px-3 !py-1.5" onClick={() => copy(embed(f), `emb-${f.id}`)} title="Copy iframe embed code">
              {copied === `emb-${f.id}` ? <Check className="size-4 text-mint-400" /> : <Copy className="size-4" />} Embed
            </button>
            <button className="btn-ghost !px-3 !py-1.5" onClick={() => void toggleActive(f)}>{f.active ? "Pause" : "Publish"}</button>
            <button onClick={() => void remove(f)} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><Trash2 className="size-4" /></button>
          </div>
        ))}
        {forms.length === 0 && <div className="p-8 text-center text-sm text-slate-600">No forms yet — create one to get a public lead-capture URL.</div>}
      </div>
      {msg && <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{msg.text}</div>}
      {creating && <FormModal onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); }} />}
    </div>
  );
}

function FormModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", slug: "", submitLabel: "Send" });
  const [included, setIncluded] = useState<Record<string, { on: boolean; required: boolean }>>({
    firstName: { on: true, required: true },
    lastName: { on: true, required: true },
    email: { on: true, required: true },
    phone: { on: false, required: false },
    company: { on: true, required: false },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

  const submit = async () => {
    setBusy(true); setError(null);
    const fields = LEAD_FORM_FIELDS.filter((f) => included[f.key]?.on).map((f) => ({ key: f.key, label: f.label, type: f.type, required: !!included[f.key]?.required }));
    try {
      await post("/api/lead-forms", { ...form, slug: form.slug || slugify(form.name), fields });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New lead-capture form">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Form name" required><input className="input" placeholder="e.g. Request a demo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Slug"><input className="input font-mono" placeholder="request-a-demo" value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} /><span className="text-[11px] text-slate-600">auto-generated from the name</span></Field>
        </div>
        <Field label="Submit button"><input className="input" value={form.submitLabel} onChange={(e) => setForm({ ...form, submitLabel: e.target.value })} /></Field>
        <Field label="Fields">
          <div className="space-y-1.5">
            {LEAD_FORM_FIELDS.map((f) => {
              const inc = included[f.key];
              return (
                <div key={f.key} className="flex items-center gap-3 rounded-xl bg-ink-800/50 border border-white/[0.05] px-3 py-2">
                  <input type="checkbox" checked={inc?.on} onChange={(e) => setIncluded((s) => ({ ...s, [f.key]: { ...s[f.key], on: e.target.checked } }))} className="size-4 accent-accent-500" />
                  <span className="flex-1 text-sm text-slate-300">{f.label}</span>
                  <label className={`flex items-center gap-1.5 text-xs ${inc?.on ? "text-slate-400" : "text-slate-700"}`}>
                    <input type="checkbox" disabled={!inc?.on} checked={inc?.required} onChange={(e) => setIncluded((s) => ({ ...s, [f.key]: { ...s[f.key], required: e.target.checked } }))} className="size-3.5 accent-accent-500" />
                    required
                  </label>
                </div>
              );
            })}
          </div>
        </Field>
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.name.trim()}>{busy ? <Spinner className="size-4" /> : "Create form"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Pipelines (Phase 2-lite multi-pipeline) ──────────────────────────────────
type PipelineRow = { id: string; name: string; isDefault: boolean; stages: { key: string; label: string; probability: number }[]; dealCount?: number };

type StageDraft = { key: string; label: string; probability: number };

function PipelinesTab() {
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [editing, setEditing] = useState<PipelineRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: PipelineRow[] }>("/api/pipelines");
      setPipelines(d.items);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to load pipelines" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setDefault = async (p: PipelineRow) => {
    setBusy(`def-${p.id}`); setMsg(null);
    try {
      await patch(`/api/pipelines/${p.id}`, { isDefault: true });
      setMsg({ kind: "ok", text: `"${p.name}" is now the default pipeline.` });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (p: PipelineRow) => {
    if (!confirm(`Delete pipeline "${p.name}"? Deals must be moved off it first.`)) return;
    setBusy(`del-${p.id}`); setMsg(null);
    try {
      await del(`/api/pipelines/${p.id}`);
      setMsg({ kind: "ok", text: `Pipeline "${p.name}" deleted.` });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Deal pipelines are per-org config — each has its own stages and probabilities. The default pipeline drives the deals board and dashboard snapshot.</p>
        <button className="btn-primary" onClick={() => setCreating(true)}><Layers className="size-4" /> New pipeline</button>
      </div>

      <div className="card divide-y divide-white/[0.04]">
        {pipelines.map((p) => (
          <div key={p.id} className="px-6 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Layers className={`size-4 ${p.isDefault ? "text-accent-400" : "text-slate-600"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{p.name}</span>
                  {p.isDefault && <Badge tone="blue">default</Badge>}
                  {p.dealCount !== undefined && <span className="text-xs text-slate-600">{p.dealCount} deal{p.dealCount === 1 ? "" : "s"}</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.stages.map((s, i) => (
                    <span key={s.key} className="chip bg-white/[0.06] text-slate-400">
                      {i + 1}. {s.label} <span className="ml-1 tabular-nums text-accent-300">{s.probability}%</span>
                    </span>
                  ))}
                </div>
              </div>
              {!p.isDefault && (
                <button className="btn-ghost !px-3 !py-1.5" disabled={busy === `def-${p.id}`} onClick={() => void setDefault(p)}>
                  {busy === `def-${p.id}` ? <Spinner className="size-3.5" /> : <Star className="size-3.5" />} Set default
                </button>
              )}
              <button className="btn-ghost !px-3 !py-1.5" onClick={() => setEditing(p)}><Pencil className="size-3.5" /> Edit</button>
              <button onClick={() => void remove(p)} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><Trash2 className="size-4" /></button>
            </div>
          </div>
        ))}
        {pipelines.length === 0 && <div className="p-8 text-center text-sm text-slate-600">No pipelines yet — create one to get a deals board.</div>}
      </div>
      {msg && <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{msg.text}</div>}

      {(creating || editing) && (
        <PipelineModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function PipelineModal({ initial, onClose, onDone }: { initial: PipelineRow | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [stages, setStages] = useState<StageDraft[]>(() =>
    initial?.stages?.length
      ? initial.stages.map((s) => ({ key: s.key, label: s.label, probability: s.probability }))
      : [
          { key: "discovery", label: "Discovery", probability: 10 },
          { key: "qualified", label: "Qualified", probability: 25 },
          { key: "proposal", label: "Proposal", probability: 50 },
          { key: "negotiation", label: "Negotiation", probability: 75 },
          { key: "won", label: "Won", probability: 100 },
          { key: "lost", label: "Lost", probability: 0 },
        ]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

  const updateStage = (i: number, patch2: Partial<StageDraft>) =>
    setStages((ss) => ss.map((s, idx) => {
      if (idx !== i) return s;
      const next = { ...s, ...patch2 };
      // Derive a key from the label ONLY for placeholder keys (newly added
      // stages). Editing an existing stage's label must not change its key —
      // deals reference stage keys, so renaming would orphan them (ADR-013).
      if (patch2.label !== undefined && /^stage_\d+$/.test(s.key)) {
        next.key = slugify(patch2.label) || s.key;
      }
      return next;
    }));
  const removeStage = (i: number) => setStages((ss) => ss.filter((_, idx) => idx !== i));
  const moveStage = (i: number, dir: -1 | 1) => {
    setStages((ss) => {
      const j = i + dir;
      if (j < 0 || j >= ss.length) return ss;
      const next = [...ss];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const addStage = () => setStages((ss) => [...ss, { key: `stage_${ss.length + 1}`, label: "", probability: 10 }]);

  const submit = async () => {
    if (!name.trim()) return setError("Pipeline needs a name");
    if (stages.some((s) => !s.label.trim())) return setError("Every stage needs a label");
    setBusy(true); setError(null);
    try {
      const body = { name: name.trim(), stages: stages.map((s) => ({ key: s.key, label: s.label.trim(), probability: Number(s.probability) || 0 })) };
      if (initial) await patch(`/api/pipelines/${initial.id}`, body);
      else await post("/api/pipelines", body);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit pipeline — ${initial.name}` : "New pipeline"} wide>
      <div className="space-y-4">
        <Field label="Pipeline name" required>
          <input className="input" placeholder="e.g. Renewals" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Stages</span>
            <button className="btn-ghost !px-3 !py-1" onClick={addStage}><Plus className="size-3.5" /> Add stage</button>
          </div>
          <div className="space-y-2">
            {stages.map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl bg-ink-800/50 border border-white/[0.05] px-3 py-2">
                <span className="w-6 text-center text-xs tabular-nums text-slate-600">{i + 1}</span>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <input className="input !py-1.5" placeholder="Stage label" value={s.label} onChange={(e) => updateStage(i, { label: e.target.value })} />
                  <div className="flex w-28 shrink-0 items-center gap-1">
                    <input className="input !py-1.5 tabular-nums" type="number" min={0} max={100} value={s.probability} onChange={(e) => updateStage(i, { probability: Number(e.target.value) || 0 })} />
                    <span className="text-xs text-slate-500">%</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button onClick={() => moveStage(i, -1)} disabled={i === 0} className="rounded p-1 text-slate-500 hover:text-white disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                  <button onClick={() => moveStage(i, 1)} disabled={i === stages.length - 1} className="rounded p-1 text-slate-500 hover:text-white disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                  <button onClick={() => removeStage(i)} className="rounded p-1 text-slate-600 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
            ))}
            {stages.length === 0 && <div className="rounded-xl border border-dashed border-white/[0.06] py-6 text-center text-xs text-slate-600">Add at least one stage.</div>}
          </div>
        </div>

        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : initial ? "Save pipeline" : "Create pipeline"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── API tokens (Phase 0 OAuth for integrations) ─────────────────────────────
type ApiToken = { id: string; name: string; prefix: string; role: string; scopes: string[]; active: boolean; expiresAt: string | null; lastUsedAt: string | null; createdAt: string };

function TokensTab() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: ApiToken[] }>("/api/tokens");
      setTokens(d.items);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to load tokens" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const revoke = async (t: ApiToken) => {
    if (!confirm(`Revoke token "${t.name}"? Scripts using it will immediately lose access.`)) return;
    try {
      await del(`/api/tokens/${t.id}`);
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Bearer tokens for integrations and scripts — authenticate with <span className="font-mono text-accent-400">Authorization: Bearer &lt;token&gt;</span>. The raw token is shown <span className="text-slate-300">only once</span> at creation.</p>
        <button className="btn-primary" onClick={() => setCreating(true)}><KeySquare className="size-4" /> Issue token</button>
      </div>
      <div className="card divide-y divide-white/[0.04]">
        {tokens.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
            <KeyRound className={`size-4 ${t.active ? "text-mint-400" : "text-slate-600"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{t.name}</span>
                <span className="font-mono text-xs text-slate-600">{t.prefix}…</span>
                {!t.active && <Badge tone="rose">revoked</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                acts as <span className="capitalize">{t.role}</span> · scopes {t.scopes.join(", ")}
                {t.expiresAt && <> · expires {new Date(t.expiresAt).toLocaleDateString()}</>}
                {t.lastUsedAt && <> · last used {timeAgo(t.lastUsedAt)}</>}
              </div>
            </div>
            {t.active && (
              <button className="btn-danger !px-3 !py-1.5" onClick={() => void revoke(t)}>Revoke</button>
            )}
          </div>
        ))}
        {tokens.length === 0 && <div className="p-8 text-center text-sm text-slate-600">No API tokens yet — issue one for your integration.</div>}
      </div>
      {msg && (
        <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{msg.text}</div>
      )}
      {creating && <TokenModal onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); }} />}
    </div>
  );
}

function TokenModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", role: "admin", scopes: ["all"], expiresInDays: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ raw: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const d = await post<{ token: string; name: string }>("/api/tokens", { ...form, expiresInDays: form.expiresInDays ? Number(form.expiresInDays) : undefined });
      setIssued({ raw: d.token, name: d.name });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <Modal open onClose={onClose} title="Token issued — copy it now">
        <p className="text-sm text-slate-500">This is the only time the raw token is shown. Store it securely.</p>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-ink-800/80 border border-white/[0.07] p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-xs text-mint-400">{issued.raw}</code>
          <button onClick={async () => { await navigator.clipboard.writeText(issued.raw); setCopied(true); }} className="btn-ghost !px-3 !py-1.5">
            {copied ? <Check className="size-4 text-mint-400" /> : <Copy className="size-4" />}
          </button>
        </div>
        <div className="mt-6 flex justify-end">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Issue API token">
      <div className="space-y-4">
        <Field label="Name" required><input className="input" placeholder="e.g. sales-sync-script" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Acts as role">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">Admin</option><option value="manager">Manager</option><option value="rep">Rep</option>
            </select>
          </Field>
          <Field label="Expires in (days)"><input className="input" type="number" min={1} placeholder="never" value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} /></Field>
        </div>
        <Field label="Scopes">
          <div className="flex flex-wrap gap-1.5">
            {[["all", "All (read + write)"], ["read", "Read only"], ["write", "Write only"]].map(([v, l]) => (
              <button key={v} onClick={() => setForm((f) => ({ ...f, scopes: f.scopes.includes(v) ? f.scopes.filter((x) => x !== v) : [...f.scopes, v] }))}
                className={`chip transition-colors ${form.scopes.includes(v) ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}>
                {l}
              </button>
            ))}
          </div>
        </Field>
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.name || !form.scopes.length}>
            {busy ? <Spinner className="size-4" /> : "Issue token"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Environments (ADR-008) ───────────────────────────────────────────────────
function EnvironmentsTab() {
  const { environment, environments, setEnvironment } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [promoting, setPromoting] = useState(false);

  const createSandbox = async () => {
    setBusy("create"); setMsg(null);
    try {
      await post("/api/env/create", { name: "sandbox" });
      setMsg({ kind: "ok", text: "Sandbox environment created." });
      await setEnvironment("sandbox");
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  };

  const resetEnv = async (env: string) => {
    if (env === "production") {
      const confirmText = prompt('Type RESET-PRODUCTION to confirm wiping production records:');
      if (confirmText !== "RESET-PRODUCTION") return;
      setBusy(`reset-${env}`); setMsg(null);
      try {
        await post("/api/env/reset", { environment: env, confirm: "RESET-PRODUCTION" });
        setMsg({ kind: "ok", text: "Production reset complete." });
      } catch (e) {
        setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
      } finally {
        setBusy(null);
      }
      return;
    }
    if (!confirm(`Reset ${env}? All records in this environment will be permanently deleted.`)) return;
    setBusy(`reset-${env}`); setMsg(null);
    try {
      await post("/api/env/reset", { environment: env });
      setMsg({ kind: "ok", text: `${env} reset — all records wiped.` });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Environments</h2>
            <p className="text-xs text-slate-500">Sandbox data is fully isolated from production — a separate scoping field on every record (ADR-008).</p>
          </div>
          <button className="btn-primary" onClick={createSandbox} disabled={busy === "create"}>
            {busy === "create" ? <Spinner className="size-4" /> : <Plus className="size-4" />} Create sandbox
          </button>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {environments.map((env) => {
            const active = env === environment;
            return (
              <div key={env} className="flex items-center gap-3 px-6 py-4">
                <GitBranch className={`size-4 ${active ? "text-accent-400" : "text-slate-600"}`} />
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-sm text-white">{env}</span>
                  {active && <Badge tone="blue" >current</Badge>}
                  {env.startsWith("sandbox-restored") && <Badge tone="amber">restored</Badge>}
                </div>
                <button className="btn-ghost !px-3 !py-1.5" disabled={active} onClick={() => void setEnvironment(env)}>
                  Switch
                </button>
                <button
                  className="btn-danger !px-3 !py-1.5"
                  disabled={busy === `reset-${env}`}
                  onClick={() => void resetEnv(env)}
                >
                  {busy === `reset-${env}` ? <Spinner className="size-3.5" /> : <RefreshCcw className="size-3.5" />} Reset
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
          {msg.text}
        </div>
      )}

      <ResidencyCard />
      <PromoteCard onResult={setMsg} busy={promoting} setBusy={setPromoting} />
    </div>
  );
}

// ── Data residency (config slot — enforcement lands with multi-region hosting) ─
function ResidencyCard() {
  const { user } = useSession();
  const [region, setRegion] = useState("");
  const [policy, setPolicy] = useState("flexible");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void api<{ org: { settings: Record<string, any> } }>("/api/org").then((d) => {
      const r = d.org.settings?.dataResidency;
      setRegion(r?.region ?? "");
      setPolicy(r?.policy ?? "flexible");
    }).catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const d = await api<{ org: { settings: Record<string, any> } }>("/api/org");
      const settings = d.org.settings ?? {};
      await patch("/api/org", { settings: { ...settings, dataResidency: { region: region.trim() || null, policy } } });
      setMsg("Residency preference saved.");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/[0.06] px-6 py-4">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-white">Data residency</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">Config only for now — enforcement (region-locked hosting, AI routing) arrives with multi-region infrastructure in a later phase.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3 px-6 py-4">
        <Field label="Primary region">
          <input className="input w-48" placeholder="e.g. eu-central-1" value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>
        <Field label="Policy">
          <select className="input w-48" value={policy} onChange={(e) => setPolicy(e.target.value)}>
            <option value="flexible">Flexible</option>
            <option value="region-lock">Region lock</option>
          </select>
        </Field>
        <button className="btn-ghost" onClick={save} disabled={busy}>{busy ? <Spinner className="size-4" /> : "Save"}</button>
        {msg && <span className={`text-xs ${msg === "Residency preference saved." ? "text-mint-400" : "text-rose-400"}`}>{msg}</span>}
      </div>
    </div>
  );
}

function PromoteCard({ onResult, busy, setBusy }: { onResult: (m: { kind: "ok" | "err"; text: string }) => void; busy: boolean; setBusy: (b: boolean) => void }) {
  const { environments } = useSession();
  const [from, setFrom] = useState("sandbox");
  const [to, setTo] = useState("production");
  const [objectType, setObjectType] = useState("all");

  const run = async () => {
    setBusy(true);
    try {
      const d = await post<{ copied: number; updated: number; counts: Record<string, number> }>("/api/env/promote", {
        from,
        to,
        ...(objectType !== "all" ? { objectType } : {}),
      });
      const parts = Object.entries(d.counts).map(([t, n]) => `${t}: ${n}`).join(", ");
      onResult({ kind: "ok", text: `Promoted ${d.copied} copied / ${d.updated} updated → ${parts}` });
    } catch (e) {
      onResult({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  };

  const envs = environments.length ? environments : ["production", "sandbox"];
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/[0.06] px-6 py-4">
        <h2 className="text-sm font-semibold text-white">Promote changes</h2>
        <p className="text-xs text-slate-500">Copy records from one environment into another (lineage tracked via <span className="font-mono">promotedFrom</span>).</p>
      </div>
      <div className="flex flex-wrap items-end gap-3 px-6 py-4">
        <Field label="From">
          <select className="input w-44" value={from} onChange={(e) => setFrom(e.target.value)}>
            {envs.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </Field>
        <ArrowRight className="mb-3 size-4 text-slate-600" />
        <Field label="To">
          <select className="input w-44" value={to} onChange={(e) => setTo(e.target.value)}>
            {envs.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </Field>
        <Field label="Object type">
          <select className="input w-44" value={objectType} onChange={(e) => setObjectType(e.target.value)}>
            <option value="all">All objects</option>
            {OBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <button className="btn-primary" onClick={run} disabled={busy || from === to}>
          {busy ? <Spinner className="size-4" /> : <ArrowRight className="size-4" />} Promote
        </button>
      </div>
    </div>
  );
}

// ── Feature flags ────────────────────────────────────────────────────────────
function FlagsTab() {
  const { features, environment, refresh } = useSession();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const toggle = async (key: string, enabled: boolean) => {
    setBusyKey(key); setMsg(null);
    try {
      await api(`/api/features/${key}`, { method: "PUT", body: JSON.stringify({ enabled }) });
      setMsg({ kind: "ok", text: `Flag "${key}" ${enabled ? "enabled" : "disabled"} for ${environment}.` });
      await refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    } finally {
      setBusyKey(null);
    }
  };

  const rows = Object.entries(features);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">Server-owned registry — toggles below are <span className="text-slate-300">advisory</span>; the API enforces the real gate per request (<span className="font-mono text-accent-400">requireFeature</span>).</p>
        <Badge tone="blue">env: {environment}</Badge>
      </div>
      <div className="card divide-y divide-white/[0.04]">
        {rows.map(([key, f]) => (
          <div key={key} className="flex items-center gap-4 px-6 py-4">
            <Flag className={`size-4 ${f.enabled ? "text-mint-400" : "text-slate-600"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{f.label}</span>
                <span className="font-mono text-xs text-slate-600">{key}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{f.description}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {f.plans.map((p) => <Badge key={p} tone="default">{p}</Badge>)}
                {f.source !== "default" && <Badge tone="amber">{f.source === "featureFlag" ? "org override" : "settings override"}</Badge>}
              </div>
            </div>
            <button
              role="switch"
              aria-checked={f.enabled}
              onClick={() => void toggle(key, !f.enabled)}
              disabled={busyKey === key}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${f.enabled ? "bg-accent-500" : "bg-ink-700"}`}
            >
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${f.enabled ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        ))}
      </div>
      {msg && (
        <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ── Backups (ADR-009) ────────────────────────────────────────────────────────
type BackupJob = { id: string; status: string; archivePath: string; sizeBytes: number; environment: string; restoredToEnv: string | null; note: string | null; error: string | null; createdAt: string };

function BackupsTab() {
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const { environment } = useSession();

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: BackupJob[] }>("/api/backups");
      setJobs(d.items);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to load backups" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const snapshot = async () => {
    setBusy("create"); setMsg(null);
    try {
      await post("/api/backup/create", { environment });
      setMsg({ kind: "ok", text: `Snapshot of ${environment} created.` });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (job: BackupJob) => {
    if (!confirm(`Restore snapshot ${job.archivePath} into a fresh sandbox? Production is never touched (ADR-009).`)) return;
    setBusy(`restore-${job.id}`); setMsg(null);
    try {
      const d = await post<{ targetEnvironment: string; restored: number }>("/api/backup/restore", { backupId: job.id, targetEnvironment: "sandbox" });
      setMsg({ kind: "ok", text: `Restored ${d.restored} records into ${d.targetEnvironment} — switch to it from the header.` });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  };

  const fmt = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Snapshots capture the current environment's records as JSON archives. Restores always land in a <span className="text-slate-300">fresh sandbox</span> — production can never be overwritten.</p>
        <button className="btn-primary" onClick={snapshot} disabled={busy === "create"}>
          {busy === "create" ? <Spinner className="size-4" /> : <Database className="size-4" />} Create snapshot now
        </button>
      </div>

      <div className="card divide-y divide-white/[0.04]">
        {jobs.map((j) => (
          <div key={j.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
            <HardDriveDownload className={`size-4 ${j.status === "success" ? "text-mint-400" : j.status === "failed" ? "text-rose-400" : "text-amber-400"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-white">{j.archivePath || "—"}</span>
                <Badge tone={j.status === "success" ? "green" : j.status === "failed" ? "rose" : "amber"}>{j.status}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                env <span className="font-mono">{j.environment}</span> · {fmt(j.sizeBytes)} · {timeAgo(j.createdAt)}
                {j.restoredToEnv && <> · restored to <span className="font-mono text-amber-400">{j.restoredToEnv}</span></>}
              </div>
              {j.error && <div className="mt-1 text-xs text-rose-400">{j.error}</div>}
            </div>
            {j.status === "success" && !j.restoredToEnv && (
              <button className="btn-ghost !px-3 !py-1.5" disabled={busy === `restore-${j.id}`} onClick={() => void restore(j)}>
                {busy === `restore-${j.id}` ? <Spinner className="size-3.5" /> : <RefreshCcw className="size-3.5" />} Restore into sandbox
              </button>
            )}
            {j.restoredToEnv && <Badge tone="amber">restored</Badge>}
          </div>
        ))}
        {jobs.length === 0 && <div className="p-8 text-center text-sm text-slate-600">No snapshots yet — create one to get started.</div>}
      </div>
      {msg && (
        <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function NotAdmin() {
  return <div className="card p-8 text-center text-sm text-slate-500">Only admins can manage this section.</div>;
}

// ── Team ──────────────────────────────────────────────────────────────────────
function TeamTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [creating, setCreating] = useState(false);
  const { user: me } = useSession();

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: User[] }>("/api/users");
      setUsers(d.items);
    } catch { /* rep view */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const roleTone: Record<string, string> = { admin: "violet", manager: "blue", rep: "default" };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
        <h2 className="text-sm font-semibold text-white">Team members</h2>
        {me?.role === "admin" && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Invite member</button>}
      </div>
      <div className="divide-y divide-white/[0.04]">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-4 px-6 py-4">
            <div className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-ink-600 to-ink-700 text-xs font-semibold text-white ring-1 ring-white/10">{initials(u.name)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-white">{u.name}</span>
                {u.id === me?.id && <Badge>you</Badge>}
              </div>
              <div className="truncate text-xs text-slate-500">{u.email}{u.title ? ` · ${u.title}` : ""}</div>
            </div>
            <Badge tone={(roleTone[u.role] as any) ?? "default"}>{u.role}</Badge>
            <span className="hidden text-xs text-slate-600 sm:block">{u.lastLoginAt ? `last seen ${timeAgo(u.lastLoginAt)}` : "never signed in"}</span>
            {me?.role === "admin" && u.id !== me.id && (
              <button
                onClick={() => { if (confirm(`Remove ${u.name} from the workspace?`)) { void del(`/api/users/${u.id}`).then(load); } }}
                className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"
              ><Trash2 className="size-4" /></button>
            )}
          </div>
        ))}
      </div>

      {creating && <InviteModal onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); }} />}
    </div>
  );
}

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", role: "rep", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await post("/api/users", form); onDone(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Failed"); setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Invite member">
      <div className="space-y-4">
        <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email" required><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Role">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="rep">Rep</option><option value="manager">Manager</option><option value="admin">Admin</option>
            </select>
          </Field>
          <Field label="Password" required><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        </div>
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : "Add member"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Custom fields (no-code builder v1) + field-level permissions (principle #3) ─
type FieldPermRow = { fieldKey: string; readRoles: string[]; writeRoles: string[] };
const ROLES = ["admin", "manager", "rep"];

function FieldsTab() {
  const [objectType, setObjectType] = useState("contact");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [core, setCore] = useState<{ key: string; label: string; required?: boolean; type?: string; options?: string[] }[]>([]);
  const [perms, setPerms] = useState<Record<string, FieldPermRow>>({});
  const [creating, setCreating] = useState(false);
  const [editingPerm, setEditingPerm] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api<{ core: any[]; custom: FieldDef[]; permissions?: FieldPermRow[] }>(`/api/fields/${objectType}`);
    setCore(d.core.map((f: any) => ({ key: f.key, label: f.label, required: f.required, type: f.type, options: f.options })));
    setFields(d.custom);
    setPerms(Object.fromEntries((d.permissions ?? []).map((p) => [p.fieldKey, p])));
  }, [objectType]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <select value={objectType} onChange={(e) => setObjectType(e.target.value)} className="input w-48">
          {OBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)}><Plus className="size-4" /> Add custom field</button>
      </div>

      <div className="card divide-y divide-white/[0.04]">
        {[...core.map((f) => ({ ...f, isCustom: false, id: f.key })), ...fields.map((f) => ({ ...f, isCustom: true, id: f.id }))].map((f) => {
          const perm = perms[f.key];
          const restricted = perm && (perm.readRoles.length > 0 || perm.writeRoles.length > 0);
          return (
            <div key={f.id} className="flex items-center justify-between gap-3 px-6 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm text-white">
                  {f.label} {f.required && <span className="text-rose-400">*</span>} {!f.isCustom && <Badge>core</Badge>}
                </div>
                <div className="truncate text-xs text-slate-600">
                  <span className="font-mono">{f.key}</span>{f.isCustom ? ` · ${f.type}` : ""}{f.isCustom && f.options?.length ? ` · ${f.options.join(", ")}` : ""}
                  {restricted && <span className="ml-2 text-amber-400">· restricted</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => setEditingPerm(f.key)} className="rounded-lg p-2 text-slate-500 hover:bg-white/10 hover:text-white" title="Field permissions">
                  <Shield className={`size-4 ${restricted ? "text-amber-400" : ""}`} />
                </button>
                {f.isCustom && (
                  <button onClick={() => { if (confirm("Delete this custom field?")) { void del(`/api/fields/${objectType}/${f.id}`).then(load); } }} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {creating && <FieldModal objectType={objectType} onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); }} />}
      {editingPerm && (
        <PermModal
          objectType={objectType}
          fieldKey={editingPerm}
          initial={perms[editingPerm]}
          onClose={() => setEditingPerm(null)}
          onDone={async () => { setEditingPerm(null); await load(); }}
        />
      )}
    </div>
  );
}

function PermModal({ objectType, fieldKey, initial, onClose, onDone }: {
  objectType: string; fieldKey: string; initial?: FieldPermRow; onClose: () => void; onDone: () => void;
}) {
  const [readRoles, setReadRoles] = useState<string[]>(initial?.readRoles ?? []);
  const [writeRoles, setWriteRoles] = useState<string[]>(initial?.writeRoles ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], setList: (v: string[]) => void, role: string) =>
    setList(list.includes(role) ? list.filter((r) => r !== role) : [...list, role]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api(`/api/fields/${objectType}/permissions/${fieldKey}`, { method: "PUT", body: JSON.stringify({ readRoles, writeRoles }) });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
      setBusy(false);
    }
  };
  const clear = async () => {
    try {
      await api(`/api/fields/${objectType}/permissions/${fieldKey}`, { method: "DELETE" });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  };

  const RoleRow = ({ label, list, setList }: { label: string; list: string[]; setList: (v: string[]) => void }) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-xs uppercase tracking-wider text-slate-500">{label}</span>
      {ROLES.map((r) => (
        <button key={r} onClick={() => toggle(list, setList, r)}
          className={`chip transition-colors ${list.includes(r) ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}>
          {r}
        </button>
      ))}
      <span className="text-xs text-slate-600">{list.length === 0 ? "= everyone" : ""}</span>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`Permissions · ${fieldKey}`}>
      <p className="mb-4 text-sm text-slate-500">Empty role lists mean <span className="text-slate-300">everyone</span>. Admins always pass. Read gating hides the field in lists/forms; write gating blocks setting it.</p>
      <div className="space-y-4">
        <RoleRow label="Can read" list={readRoles} setList={setReadRoles} />
        <RoleRow label="Can write" list={writeRoles} setList={setWriteRoles} />
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-between gap-2">
          <button className="btn-ghost" onClick={clear}>Reset to open</button>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner className="size-4" /> : "Save"}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function FieldModal({ objectType, onClose, onDone }: { objectType: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ key: "", label: "", type: "text", required: false, options: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await post(`/api/fields/${objectType}`, { ...form, options: form.options.split(",").map((o) => o.trim()).filter(Boolean) });
      onDone();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed"); setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Add custom field · ${objectType}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Label" required><input className="input" placeholder="e.g. Employee size" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <Field label="Key" required><input className="input font-mono" placeholder="e.g. employeeSize" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <label className="flex items-end gap-2 pb-2.5">
            <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} className="size-4 accent-accent-500" />
            <span className="text-sm text-slate-400">Required</span>
          </label>
        </div>
        {(form.type === "select" || form.type === "multiselect") && (
          <Field label="Options (comma-separated)"><input className="input" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} placeholder="Option A, Option B, Option C" /></Field>
        )}
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.key || !form.label}>{busy ? <Spinner className="size-4" /> : "Create field"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Webhooks ──────────────────────────────────────────────────────────────────
function WebhooksTab() {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api<{ items: Webhook[] }>("/api/webhooks");
    setHooks(d.items);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const copy = async (secret: string) => {
    await navigator.clipboard.writeText(secret);
    setCopied(secret.slice(0, 8));
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">Outbound webhooks — POSTed when subscribed events fire, signed with <span className="font-mono text-accent-400">x-qorvexa-signature</span>.</p>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Add webhook</button>
      </div>
      <div className="card divide-y divide-white/[0.04]">
        {hooks.map((h) => (
          <div key={h.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
            <span className={`size-2 rounded-full ${h.active ? "bg-mint-400" : "bg-slate-600"}`} />
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-white">{h.url}</span>
            <div className="flex flex-wrap gap-1">
              {h.events.slice(0, 3).map((e) => <Badge key={e} tone="blue">{e}</Badge>)}
              {h.events.length > 3 && <Badge>+{h.events.length - 3}</Badge>}
            </div>
            <button onClick={() => copy(h.secret)} className="rounded-lg p-2 text-slate-500 hover:bg-white/10 hover:text-white" title="Copy signing secret">
              {copied === h.secret.slice(0, 8) ? <Check className="size-4 text-mint-400" /> : <KeyRound className="size-4" />}
            </button>
            <button onClick={() => { if (confirm("Delete this webhook?")) { void del(`/api/webhooks/${h.id}`).then(load); } }} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        {hooks.length === 0 && <div className="p-8 text-center text-sm text-slate-600">No webhooks yet — add one to stream events to your own systems.</div>}
      </div>
      {creating && <HookModal onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); }} />}
    </div>
  );
}

function HookModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ url: "", events: ["deal.stage_changed", "contact.created"] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ALL = ["deal.stage_changed", "deal.created", "contact.created", "contact.updated", "lead.created", "account.created", "task.completed", "user.logged_in", "webhook.test"];
  const submit = async () => {
    setBusy(true); setError(null);
    try { await post("/api/webhooks", form); onDone(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Failed"); setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add webhook">
      <div className="space-y-4">
        <Field label="Endpoint URL" required><input className="input font-mono" placeholder="https://your-app.example/hooks/qorvexa" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
        <Field label="Events to subscribe">
          <div className="flex flex-wrap gap-1.5">
            {ALL.map((e) => (
              <button key={e} onClick={() => setForm((f) => ({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] }))}
                className={`chip transition-colors ${form.events.includes(e) ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}>
                {e}
              </button>
            ))}
          </div>
        </Field>
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.url || !form.events.length}>{busy ? <Spinner className="size-4" /> : "Create webhook"}</button>
        </div>
      </div>
    </Modal>
  );
}
