import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Send, RefreshCcw, Inbox, ArrowUpRight, Search, Trash2, MessageSquareReply, Eye, MousePointerClick, FileText } from "lucide-react";
import { api, del, post, ApiError } from "../lib/api";
import { Badge, EmptyState, Field, Modal, Spinner } from "../components/ui";
import { timeAgo, dateTime } from "../lib/format";
import type { EmailTemplate } from "./EmailTemplatesPage";

export type Message = {
  id: string;
  direction: "in" | "out";
  threadId: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  status: "sent" | "opened" | "clicked" | "replied";
  openedAt: string | null;
  clickedAt: string | null;
  repliedAt: string | null;
  openedCount: number;
  templateId: string | null;
  contactId: string | null;
  accountId: string | null;
  opportunityId: string | null;
  createdAt: string;
};

const statusTone: Record<Message["status"], "default" | "blue" | "green" | "amber" | "teal"> = {
  sent: "default",
  opened: "blue",
  clicked: "teal",
  replied: "green",
};

export default function EmailPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState(""); // debounced — the inbox only refetches 250ms after the user stops typing
  const [open, setOpen] = useState<Message | null>(null);
  const [composing, setComposing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setAppliedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ pageSize: "50" });
      if (filter !== "all") params.set("direction", filter);
      if (appliedQ) params.set("q", appliedQ);
      const d = await api<{ items: Message[]; total: number }>(`/api/emails?${params}`);
      setMessages(d.items);
      setTotal(d.total);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to load mail" });
    }
  }, [filter, appliedQ]);
  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setSyncing(true); setMsg(null);
    try {
      const d = await post<{ synced: number }>("/api/emails/sync");
      setMsg({ kind: "ok", text: d.synced ? `Synced ${d.synced} new message${d.synced === 1 ? "" : "s"} from the mock inbox.` : "Inbox up to date." });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Sync failed" });
    } finally {
      setSyncing(false);
    }
  };

  const remove = async (m: Message) => {
    if (!confirm(`Delete this email thread message?`)) return;
    try {
      await del(`/api/emails/${m.id}`);
      if (open?.id === m.id) setOpen(null);
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };

  const reply = async (m: Message) => {
    if (!confirm("Simulate the recipient replying to this thread? (mock provider)")) return;
    try {
      await post(`/api/emails/${m.id}/reply`);
      setMsg({ kind: "ok", text: "Mock reply received — thread updated." });
      await load();
      if (open?.id === m.id) setOpen(null);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };

  const counts = useMemo(() => {
    const c = { all: total, in: 0, out: 0 };
    for (const m of messages) c[m.direction]++;
    return c;
  }, [messages, total]);

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Email</h1>
          <p className="text-sm text-slate-500">Inbox + compose with templates, mock provider sync, and open/click tracking.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={() => void sync()} disabled={syncing}>
            {syncing ? <Spinner className="size-4" /> : <RefreshCcw className="size-4" />} Sync inbox
          </button>
          <button className="btn-primary" onClick={() => setComposing(true)}><Send className="size-4" /> Compose</button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl bg-ink-900/60 p-1 border border-white/[0.05]">
          {([["all", "All"], ["in", "Inbox"], ["out", "Sent"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === k ? "bg-ink-700 text-white" : "text-slate-500 hover:text-slate-300"}`}>
              {l} <span className="tabular-nums text-slate-600">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
          <input className="input pl-9" placeholder="Search subject, body, addresses…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {msg && <div className={`mb-3 rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{msg.text}</div>}

      <div className="card overflow-hidden">
        <div className="divide-y divide-white/[0.04]">
          {messages.map((m) => (
            <button key={m.id} onClick={() => setOpen(m)} className={`flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.03] ${open?.id === m.id ? "bg-white/[0.04]" : ""}`}>
              <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${m.direction === "in" ? "bg-mint-500/15 text-mint-400" : "bg-accent-500/15 text-accent-300"}`}>
                {m.direction === "in" ? <Inbox className="size-4" /> : <Send className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-white">{m.subject || "(no subject)"}</span>
                  <Badge tone={statusTone[m.status]}>{m.status}</Badge>
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {m.direction === "out" ? `→ ${m.toEmail}` : `← ${m.fromEmail}`} · {timeAgo(m.createdAt)}
                </div>
              </div>
              {m.openedCount > 0 && <span className="hidden shrink-0 items-center gap-1 text-[11px] text-slate-600 sm:flex"><Eye className="size-3" /> {m.openedCount}</span>}
              <button
                onClick={(e) => { e.stopPropagation(); void remove(m); }}
                className="shrink-0 rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"
              ><Trash2 className="size-4" /></button>
            </button>
          ))}
        </div>
        {messages.length === 0 && (
          <EmptyState icon={<Mail className="size-8" />} title="No messages" hint={filter === "all" ? "Compose your first email or hit “Sync inbox” to pull the mock inbound queue." : "Nothing here yet — switch tabs or sync the inbox."} />
        )}
      </div>

      {composing && <ComposeModal onClose={() => setComposing(false)} onDone={async () => { setComposing(false); await load(); }} />}
      {open && <MessageModal message={open} onClose={() => setOpen(null)} onReply={() => void reply(open)} onDelete={() => void remove(open)} />}
    </div>
  );
}

// ── Compose ───────────────────────────────────────────────────────────────────
type ContactOption = { id: string; label: string };
type DealOption = { id: string; label: string };

function ComposeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [form, setForm] = useState({ toEmail: "", subject: "", body: "", templateId: "", contactId: "", opportunityId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: EmailTemplate[] }>("/api/email-templates").then((d) => setTemplates(d.items)).catch(() => {});
    void api<{ items: { id: string; firstName: string; lastName: string; email: string | null }[] }>("/api/contacts?pageSize=200").then((d) =>
      setContacts(d.items.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}${c.email ? ` <${c.email}>` : ""}` })))
    ).catch(() => {});
    void api<{ items: { id: string; name: string }[] }>("/api/opportunities?pageSize=200").then((d) =>
      setDeals(d.items.map((o) => ({ id: o.id, label: o.name })))
    ).catch(() => {});
  }, []);

  const pickTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    setForm((f) => ({ ...f, templateId: id, subject: t ? t.subject : f.subject, body: t ? t.body : f.body }));
  };

  const submit = async () => {
    if (!form.toEmail.trim() || !form.subject.trim() || !form.body.trim()) return setError("To, subject and body are required.");
    setBusy(true); setError(null);
    try {
      const d = await post<{ message: Message; tracking: { openUrl: string } }>("/api/emails", {
        toEmail: form.toEmail.trim(),
        subject: form.subject.trim(),
        body: form.body,
        templateId: form.templateId || undefined,
        contactId: form.contactId || undefined,
        opportunityId: form.opportunityId || undefined,
      });
      setError(null);
      onDone();
      if (window.confirm(`Email sent — message ${d.message.subject}. Open the tracking pixel now to demo email.opened?`)) {
        window.open(d.tracking.openUrl, "_blank");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Compose email" wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="To" required><input className="input" type="email" placeholder="elena@northwind.example" value={form.toEmail} onChange={(e) => setForm({ ...form, toEmail: e.target.value })} /></Field>
          <Field label="Template">
            <select className="input" value={form.templateId} onChange={(e) => pickTemplate(e.target.value)}>
              <option value="" className="bg-ink-850">No template</option>
              {templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id} className="bg-ink-850">{t.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Linked contact (merges {{variables}})">
            <select className="input" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
              <option value="" className="bg-ink-850">None</option>
              {contacts.map((c) => <option key={c.id} value={c.id} className="bg-ink-850">{c.label}</option>)}
            </select>
          </Field>
          <Field label="Linked deal">
            <select className="input" value={form.opportunityId} onChange={(e) => setForm({ ...form, opportunityId: e.target.value })}>
              <option value="" className="bg-ink-850">None</option>
              {deals.map((o) => <option key={o.id} value={o.id} className="bg-ink-850">{o.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Subject" required><input className="input" placeholder="Re: Northwind proposal" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
        <Field label="Body" required>
          <textarea className="input min-h-40 font-mono text-xs leading-relaxed" placeholder={"Hi {{contact.firstName}},\n\n…"} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </Field>
        <p className="text-[11px] text-slate-600">Sending uses the mock provider ({'{'}EMAIL_MOCK=1{'}'}) — no real email leaves the server. Every send gets a tracking token (open pixel + click redirect).</p>
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : <Send className="size-4" />} Send</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Message detail ────────────────────────────────────────────────────────────
function MessageModal({ message, onClose, onReply, onDelete }: { message: Message; onClose: () => void; onReply: () => void; onDelete: () => void }) {
  return (
    <Modal open onClose={onClose} title="Email" wide>
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">{message.subject || "(no subject)"}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{message.direction === "out" ? `To ${message.toEmail}` : `From ${message.fromEmail}`}</span>
            <Badge tone={statusTone[message.status]}>{message.status}</Badge>
            <span>{dateTime(message.createdAt)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.openedAt && <Badge tone="blue"><Eye className="size-3" /> opened {timeAgo(message.openedAt)}{message.openedCount > 1 ? ` ×${message.openedCount}` : ""}</Badge>}
            {message.clickedAt && <Badge tone="teal"><MousePointerClick className="size-3" /> clicked {timeAgo(message.clickedAt)}</Badge>}
            {message.repliedAt && <Badge tone="green"><MessageSquareReply className="size-3" /> replied {timeAgo(message.repliedAt)}</Badge>}
            {message.templateId && <Badge tone="default"><FileText className="size-3" /> from template</Badge>}
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl bg-ink-800/60 border border-white/[0.05] p-4 font-mono text-xs leading-relaxed text-slate-300">
          {message.body}
        </div>
        <div className="flex justify-end gap-2">
          {message.direction === "out" && message.status !== "replied" && (
            <button className="btn-ghost" onClick={onReply}><MessageSquareReply className="size-4" /> Simulate reply</button>
          )}
          <button className="btn-danger" onClick={onDelete}><Trash2 className="size-4" /> Delete</button>
          <button className="btn-primary" onClick={onClose}><ArrowUpRight className="size-4" /> Done</button>
        </div>
      </div>
    </Modal>
  );
}
