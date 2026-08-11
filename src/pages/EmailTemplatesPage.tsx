import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, FileText, Check, Braces } from "lucide-react";
import { api, del, patch, post, ApiError } from "../lib/api";
import { Badge, Field, Modal, Spinner } from "../components/ui";
import { timeAgo } from "../lib/format";

export type EmailTemplate = {
  id: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const CATEGORIES = ["general", "sales", "follow-up", "marketing", "internal"];
const VARIABLES = ["{{contact.firstName}}", "{{contact.lastName}}", "{{contact.email}}", "{{contact.title}}", "{{account.name}}", "{{deal.name}}", "{{deal.amount}}"];

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: EmailTemplate[] }>("/api/email-templates");
      setTemplates(d.items);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to load templates" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleActive = async (t: EmailTemplate) => {
    try {
      await patch(`/api/email-templates/${t.id}`, { active: !t.active });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };

  const remove = async (t: EmailTemplate) => {
    if (!confirm(`Delete template "${t.name}"? Sent messages keep their merged copy.`)) return;
    try {
      await del(`/api/email-templates/${t.id}`);
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Email templates</h1>
          <p className="text-sm text-slate-500">
            Reusable subject/body pairs with <span className="font-mono text-accent-400">{"{{variable}}"}</span> merge fields — pick one when composing and variables fill from the linked record.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New template</button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((t) => (
          <div key={t.id} className="card flex flex-col p-5 transition-transform duration-200 hover:-translate-y-0.5">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-500/15 text-accent-300"><FileText className="size-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-white">{t.name}</span>
                  <Badge tone={t.active ? "green" : "rose"}>{t.active ? "active" : "paused"}</Badge>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <span className="capitalize">{t.category}</span>
                  <span>·</span>
                  <span>updated {timeAgo(t.updatedAt)}</span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex-1 space-y-2">
              <div className="rounded-xl bg-ink-800/60 border border-white/[0.05] px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-600">Subject</div>
                <div className="mt-0.5 truncate text-sm text-slate-200">{t.subject}</div>
              </div>
              <div className="rounded-xl bg-ink-800/60 border border-white/[0.05] px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-600">Body</div>
                <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs text-slate-400">{t.body}</div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
              <button className="btn-ghost !px-3 !py-1.5" onClick={() => void toggleActive(t)}>{t.active ? "Pause" : "Activate"}</button>
              <button className="btn-ghost !px-3 !py-1.5" onClick={() => setEditing(t)}><Pencil className="size-3.5" /> Edit</button>
              <button onClick={() => void remove(t)} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><Trash2 className="size-4" /></button>
            </div>
          </div>
        ))}
      </div>
      {templates.length === 0 && (
        <div className="card p-10 text-center">
          <FileText className="mx-auto mb-3 size-8 text-slate-600" />
          <div className="text-sm font-medium text-slate-400">No templates yet</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-600">Create reusable outreach emails with merge fields like <span className="font-mono">{"{{contact.firstName}}"}</span> — they'll fill from the linked record when you send.</p>
        </div>
      )}
      {msg && <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{msg.text}</div>}

      {(creating || editing) && (
        <TemplateModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function TemplateModal({ initial, onClose, onDone }: { initial: EmailTemplate | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: initial?.name ?? "", category: initial?.category ?? "sales", subject: initial?.subject ?? "", body: initial?.body ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const insertVar = (v: string) => {
    setForm((f) => ({ ...f, body: f.body + v }));
    setCopied(v);
    setTimeout(() => setCopied(null), 800);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) return setError("Name, subject and body are required.");
    setBusy(true); setError(null);
    try {
      if (initial) await patch(`/api/email-templates/${initial.id}`, form);
      else await post("/api/email-templates", form);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit template — ${initial.name}` : "New email template"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Template name" required><input className="input" placeholder="e.g. Proposal follow-up" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Category">
            <select className="input capitalize" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c} className="bg-ink-850 capitalize">{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Subject" required><input className="input" placeholder="Re: {{account.name}} proposal" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label !mb-0">Body</span>
            <span className="flex items-center gap-1 text-[11px] text-slate-600"><Braces className="size-3" /> click a variable to insert</span>
          </div>
          <textarea className="input min-h-40 font-mono text-xs leading-relaxed" placeholder={"Hi {{contact.firstName}},\n\n…"} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {VARIABLES.map((v) => (
              <button key={v} onClick={() => insertVar(v)} className="chip bg-white/[0.06] font-mono text-accent-300 transition-colors hover:bg-accent-500/20" title="Insert variable">
                {copied === v ? <Check className="size-3 text-mint-400" /> : v}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : initial ? "Save template" : "Create template"}</button>
        </div>
      </div>
    </Modal>
  );
}
