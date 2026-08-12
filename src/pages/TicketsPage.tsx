import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, Pencil, Trash2, Send, AlertTriangle, Lock, Unlock, ArrowUpRight, GitMerge, RefreshCw, MessageSquare } from "lucide-react";
import { api, del, patch, post, ApiError } from "../lib/api";
import { Badge, EmptyState, Field, Modal, Spinner } from "../components/ui";
import { timeAgo } from "../lib/format";
import { PRIORITY_TONES, STATUS_TONES, SLA_TONES, TICKET_PRIORITIES, TICKET_CHANNELS, TICKET_STATUSES } from "../lib/objects";
import { useSession } from "../App";

type Ticket = {
  id: string;
  reference: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  channel: string;
  source: string;
  assigneeId: string;
  assigneeName: string | null;
  contactId: string | null;
  contactId_label?: string | null;
  accountId: string | null;
  accountId_label?: string | null;
  slaDueAt: string | null;
  slaStatus: string;
  escalated: boolean;
  legalHold: boolean;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type Queue = { key: string; label: string; count: number };
type Reply = { id: string; body: string; internal: boolean; authorName: string | null; createdAt: string };
type CoreField = { key: string; label: string; type: string; options?: string[] };

const QUEUE_LABELS: Record<string, string> = {
  all: "All", my: "My tickets", new: "New", open: "Open", pending: "Pending",
  resolved: "Resolved", closed: "Closed", breached: "SLA breached", escalated: "Escalated",
};

export default function TicketsPage() {
  const { user } = useSession();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<{ checked: number; breached: number; escalated: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("pageSize", "200");
      if (queue === "my") params.set("ownerId", user?.id ?? "");
      if (queue === "breached") params.set("status", "breached");
      if (q) params.set("q", q);
      const where = queue === "breached" ? "" : ""; // breached filtered client-side (server has no sla query)
      const [d, qd] = await Promise.all([
        api<{ items: Ticket[] }>(`/api/tickets?${params}`),
        api<{ items: Queue[] }>("/api/tickets/queues"),
      ]);
      let items = d.items;
      if (queue === "breached") items = items.filter((t) => t.slaStatus === "breached");
      if (queue === "escalated") items = items.filter((t) => t.escalated);
      if (queue === "resolved") items = items.filter((t) => t.status === "resolved");
      if (queue === "closed") items = items.filter((t) => t.status === "closed");
      if (queue === "new") items = items.filter((t) => t.status === "new");
      if (queue === "open") items = items.filter((t) => t.status === "open");
      if (queue === "pending") items = items.filter((t) => t.status === "pending");
      if (queue === "all" && !q) items = items; // all
      void where;
      setTickets(items);
      setQueues(qd.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [queue, q, user?.id]);

  useEffect(() => { void load(); }, [load]);

  const sweep = async () => {
    setSweeping(true);
    setError(null);
    try {
      const d = await post<{ checked: number; breached: number; escalated: number }>("/api/tickets/sla/check");
      setSweepResult(d);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "SLA sweep failed");
    } finally {
      setSweeping(false);
    }
  };

  const queueCount = (key: string) => queues.find((x) => x.key === key)?.count ?? 0;
  const openTickets = tickets.filter((t) => !["resolved", "closed"].includes(t.status));

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Tickets</h1>
          <p className="text-sm text-slate-500">Customer service queues — SLAs, escalation, legal hold. Tickets are full CRM objects (audit + events + workflows).</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" onClick={() => void sweep()} disabled={sweeping} title="Check for SLA breaches + auto-escalate high/urgent">
            <RefreshCw className={`size-4 ${sweeping ? "animate-spin" : ""}`} /> {sweeping ? "Sweeping…" : "SLA sweep"}
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject…" className="input w-48 pl-9" />
          </div>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New ticket</button>
        </div>
      </div>
      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
      {sweepResult && (
        <div className="mb-4 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          SLA sweep: {sweepResult.checked} open tickets checked · {sweepResult.breached} breached · {sweepResult.escalated} escalated.
        </div>
      )}

      {/* Queue tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {queues.map((x) => (
          <button
            key={x.key}
            onClick={() => setQueue(x.key)}
            className={`chip transition-colors ${queue === x.key ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}
          >
            {QUEUE_LABELS[x.key] ?? x.label}
            <span className={`ml-1.5 rounded-full px-1.5 text-[11px] tabular-nums ${x.key === "breached" && x.count > 0 ? "bg-rose-500/25 text-rose-400" : "bg-white/[0.08]"}`}>{x.count}</span>
          </button>
        ))}
        <span className="ml-auto hidden text-xs text-slate-600 sm:block">{openTickets.length} open in view</span>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-14" />)}</div>
      ) : tickets.length === 0 ? (
        <EmptyState icon={<MessageSquare className="size-8" />} title="No tickets in this queue" hint="Create one, submit via the public portal, or ingest an inbound email." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 font-medium">Ticket</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Assignee</th>
                <th className="px-4 py-3 font-medium">SLA</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} onClick={() => setSelected(t)} className={`cursor-pointer border-b border-white/[0.03] transition-colors hover:bg-white/[0.03] ${selected?.id === t.id ? "bg-accent-500/[0.07]" : ""}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-600">{t.reference}</span>
                      {t.escalated && <AlertTriangle className="size-3.5 text-rose-400" />}
                      {t.legalHold && <Lock className="size-3.5 text-amber-400" />}
                    </div>
                    <div className="mt-0.5 max-w-72 truncate font-medium text-white">{t.subject}</div>
                  </td>
                  <td className="px-4 py-3"><Badge tone={(PRIORITY_TONES[t.priority] as any) ?? "default"}>{t.priority}</Badge></td>
                  <td className="px-4 py-3"><Badge tone={(STATUS_TONES[t.status] as any) ?? "default"}>{t.status}</Badge></td>
                  <td className="px-4 py-3 text-slate-400">{t.channel}</td>
                  <td className="px-4 py-3 text-slate-400">{t.assigneeName ?? "—"}</td>
                  <td className="px-4 py-3">
                    {t.slaStatus === "n/a" ? <span className="text-slate-600">—</span> : <Badge tone={(SLA_TONES[t.slaStatus] as any) ?? "default"}>{t.slaStatus}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{timeAgo(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <NewTicketModal onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); }} />}
      {selected && <TicketDrawer ticket={selected} isAdmin={user?.role === "admin"} onClose={() => setSelected(null)} onChanged={async (t) => { setSelected(t); await load(); }} />}
    </div>
  );
}

// ── New ticket modal ─────────────────────────────────────────────────────────
function NewTicketModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ subject: "", description: "", priority: "low", channel: "web", contactId: "" });
  const [contacts, setContacts] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: { id: string; firstName: string; lastName: string; email: string }[] }>("/api/contacts?pageSize=100")
      .then((d) => setContacts(d.items.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}`.trim() || c.email }))))
      .catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.subject.trim()) { setError("Subject is required"); return; }
    setBusy(true); setError(null);
    try {
      await post("/api/tickets", { ...form, contactId: form.contactId || undefined });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create ticket");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New ticket" wide>
      <div className="space-y-4">
        <Field label="Subject" required><input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="What's the issue?" /></Field>
        <Field label="Description"><textarea className="input min-h-24" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Priority">
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Channel">
            <select className="input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              {TICKET_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Contact (optional)">
          <select className="input" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
            <option value="">— none —</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : "Create ticket"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Ticket detail drawer ─────────────────────────────────────────────────────
function TicketDrawer({ ticket, isAdmin, onClose, onChanged }: { ticket: Ticket; isAdmin: boolean; onClose: () => void; onChanged: (t: Ticket) => void }) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReplies = useCallback(() => {
    void api<{ items: Reply[] }>(`/api/tickets/${ticket.id}/replies`).then((d) => setReplies(d.items)).catch(() => {});
  }, [ticket.id]);
  useEffect(() => { loadReplies(); }, [loadReplies]);
  useEffect(() => {
    void api<{ items: { id: string; name: string; role: string }[] }>("/api/users").then((d) => setUsers(d.items)).catch(() => {});
  }, []);

  const act = async (fn: () => Promise<any>, refresh = true) => {
    setBusy(true); setError(null);
    try {
      const row = await fn();
      if (refresh) onChanged(row as Ticket);
      return row;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const reply = async () => {
    if (!body.trim()) return;
    await act(async () => {
      const d = await post<{ ticket: Ticket }>(`/api/tickets/${ticket.id}/reply`, { body, internal });
      setBody("");
      setInternal(false);
      return d.ticket;
    });
    loadReplies();
  };

  const setStatus = (status: string) => act(() => patch(`/api/tickets/${ticket.id}`, { status }));
  const setPriority = (priority: string) => act(() => patch(`/api/tickets/${ticket.id}`, { priority }));
  const assign = (assigneeId: string) => act(() => post(`/api/tickets/${ticket.id}/assign`, { assigneeId }));
  const escalate = () => act(() => post(`/api/tickets/${ticket.id}/escalate`, {}));
  const toggleHold = () => act(() => post(`/api/tickets/${ticket.id}/legal-hold`, { legalHold: !ticket.legalHold }));
  const convert = () => act(async () => {
    await post(`/api/tickets/${ticket.id}/convert-to-lead`);
    return ticket;
  }, false);
  const remove = () => act(async () => {
    await del(`/api/tickets/${ticket.id}`);
    onClose();
    return ticket;
  }, false);

  return (
    <Modal open onClose={onClose} title={`${ticket.reference} — ${ticket.subject}`} wide>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Badge tone={(STATUS_TONES[ticket.status] as any) ?? "default"}>{ticket.status}</Badge>
        <Badge tone={(PRIORITY_TONES[ticket.priority] as any) ?? "default"}>{ticket.priority}</Badge>
        <Badge tone="blue">{ticket.channel}</Badge>
        <Badge tone={ticket.slaStatus === "n/a" ? "default" : (SLA_TONES[ticket.slaStatus] as any) ?? "default"}>SLA: {ticket.slaStatus}</Badge>
        {ticket.escalated && <Badge tone="rose"><AlertTriangle className="mr-1 size-3" />escalated</Badge>}
        {ticket.legalHold && <Badge tone="amber"><Lock className="mr-1 size-3" />legal hold</Badge>}
        {ticket.slaDueAt && <span className="text-xs text-slate-500">due {new Date(ticket.slaDueAt).toLocaleString()}</span>}
      </div>

      {ticket.legalHold && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          <Lock className="size-4 shrink-0" /> This ticket is on legal hold — edits, replies and deletion are locked until an admin lifts the hold.
        </div>
      )}
      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {ticket.description && <p className="mb-4 whitespace-pre-wrap rounded-xl border border-white/[0.05] bg-ink-900/40 p-4 text-sm text-slate-300">{ticket.description}</p>}

      {/* Actions */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <select className="input w-36" value={ticket.status} onChange={(e) => void setStatus(e.target.value)} disabled={busy || ticket.legalHold}>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input w-32" value={ticket.priority} onChange={(e) => void setPriority(e.target.value)} disabled={busy || ticket.legalHold}>
          {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="input w-44" value={ticket.assigneeId} onChange={(e) => e.target.value && void assign(e.target.value)} disabled={busy || ticket.legalHold} title="Assign">
          <option value={ticket.assigneeId}>{ticket.assigneeName ?? "Assignee"}</option>
          {users.filter((u) => u.id !== ticket.assigneeId).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
        </select>
        <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => void escalate()} disabled={busy || ticket.legalHold || ticket.escalated}>
          <AlertTriangle className="size-3.5" /> {ticket.escalated ? "Escalated" : "Escalate"}
        </button>
        {isAdmin && (
          <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => void toggleHold()} disabled={busy}>
            {ticket.legalHold ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />} {ticket.legalHold ? "Lift hold" : "Legal hold"}
          </button>
        )}
        <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => void convert()} disabled={busy} title="Create a lead from this ticket">
          <ArrowUpRight className="size-3.5" /> Convert to lead
        </button>
        <button className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400 disabled:opacity-40" onClick={() => void remove()} disabled={busy || ticket.legalHold} title="Delete ticket">
          <Trash2 className="size-4" />
        </button>
      </div>

      {/* Replies */}
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">Replies <span className="normal-case text-slate-600">({replies.length})</span></div>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {replies.map((r) => (
          <div key={r.id} className={`rounded-xl border px-4 py-3 ${r.internal ? "border-amber-500/20 bg-amber-500/[0.06]" : "border-white/[0.05] bg-ink-900/40"}`}>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-slate-300">{r.authorName ?? "Staff"}</span>
              {r.internal && <Badge tone="amber">internal</Badge>}
              <span className="ml-auto text-slate-600">{timeAgo(r.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{r.body}</p>
          </div>
        ))}
        {replies.length === 0 && <p className="rounded-xl border border-dashed border-white/[0.06] p-6 text-center text-xs text-slate-600">No replies yet. First reply marks the first-response time.</p>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input className="input min-w-0 flex-1" placeholder={ticket.legalHold ? "Replies locked (legal hold)" : "Write a reply…"} value={body} onChange={(e) => setBody(e.target.value)} disabled={busy || ticket.legalHold} onKeyDown={(e) => e.key === "Enter" && void reply()} />
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} disabled={busy || ticket.legalHold} className="size-3.5 accent-amber-500" />
          internal
        </label>
        <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => void reply()} disabled={busy || ticket.legalHold || !body.trim()}>
          <Send className="size-3.5" /> Reply
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-white/[0.05] pt-3 text-[11px] text-slate-600">
        <span>Created {timeAgo(ticket.createdAt)}</span>
        <span>Source {ticket.source}</span>
        {ticket.contactId_label && <span>Contact {ticket.contactId_label}</span>}
        {ticket.accountId_label && <span>Account {ticket.accountId_label}</span>}
        {ticket.firstResponseAt && <span>First response {timeAgo(ticket.firstResponseAt)}</span>}
        {ticket.resolvedAt && <span>Resolved {timeAgo(ticket.resolvedAt)}</span>}
        <span className="flex items-center gap-1"><GitMerge className="size-3" />Audited + event-sourced</span>
      </div>
    </Modal>
  );
}
