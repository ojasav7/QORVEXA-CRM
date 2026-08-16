import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Megaphone, Send, Trophy, Users, MousePointerClick, MailOpen, CircleDollarSign } from "lucide-react";
import { api, del, patch, post, ApiError } from "../lib/api";
import { Badge, Field, Modal, Spinner, EmptyState, StatCard } from "../components/ui";
import { timeAgo } from "../lib/format";
import { useSession } from "../App";

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  subject: string;
  ab: { enabled: boolean; splitA: number; subjectB: string | null };
  winner: string | null;
  audienceSegmentId: string | null;
  audienceName: string | null;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  openRate: number;
  roi: number;
  createdAt: string;
  updatedAt: string;
};
type Segment = { id: string; name: string; objectType: string };
type Template = { id: string; name: string };
type Recipient = { id: string; contactName: string | null; contactEmail: string | null; variant: string; status: string; openedAt: string | null; clickedAt: string | null };

const statusTone: Record<string, "default" | "green" | "blue" | "amber"> = {
  draft: "default",
  active: "blue",
  paused: "amber",
  sent: "green",
};

export default function CampaignsPage() {
  const { user } = useSession();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [viewing, setViewing] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items: Campaign[] }>("/api/campaigns");
      setCampaigns(d.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const send = async (c: Campaign) => {
    if (!confirm(`Send "${c.name}" to its audience now?`)) return;
    setError(null);
    try {
      const d = await post<{ ok: boolean; sent: number }>(`/api/campaigns/${c.id}/send`, {});
      setError(null);
      await load();
      alert(`Sent to ${d.sent} recipient${d.sent === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Send failed");
    }
  };

  const remove = async (c: Campaign) => {
    if (!confirm(`Delete campaign "${c.name}"?`)) return;
    try {
      await del(`/api/campaigns/${c.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Campaigns</h1>
          <p className="text-sm text-slate-500">Send emails to dynamic segments, A/B test subjects, and watch attributed revenue roll in.</p>
        </div>
        {user?.role === "admin" && (
          <button className="btn-primary ml-auto" onClick={() => setCreating(true)}><Plus className="size-4" /> New campaign</button>
        )}
      </div>
      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-44" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="size-8" />}
          title="No campaigns yet"
          hint="Create one — pick an audience segment, write a subject + body, and send. A/B lets you test two subjects."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
            <div key={c.id} className={`card p-5 transition-colors ${c.status === "sent" ? "" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex size-9 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400"><Megaphone className="size-4" /></div>
                <Badge tone={statusTone[c.status] ?? "default"}>{c.status}</Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-white">{c.name}</h3>
              <p className="mt-1 line-clamp-2 min-h-8 text-xs text-slate-500">{c.description || "No description"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone="blue">{c.audienceName ?? "No segment"}</Badge>
                {c.ab?.enabled && <Badge tone="teal">A/B · {c.ab.splitA}% A</Badge>}
                {c.winner && <Badge tone="green">Winner: {c.winner}</Badge>}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-white/[0.03] p-2 text-center">
                <div><div className="text-sm font-semibold tabular-nums text-white">{c.sentCount}</div><div className="text-[10px] uppercase tracking-wider text-slate-600">sent</div></div>
                <div><div className="text-sm font-semibold tabular-nums text-mint-400">{c.openRate}%</div><div className="text-[10px] uppercase tracking-wider text-slate-600">open</div></div>
                <div><div className="text-sm font-semibold tabular-nums text-amber-400">${c.roi.toLocaleString()}</div><div className="text-[10px] uppercase tracking-wider text-slate-600">ROI</div></div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3">
                <span className="text-[11px] text-slate-600">{timeAgo(c.createdAt)}</span>
                <div className="flex gap-1">
                  {c.status !== "sent" && user?.role === "admin" && (
                    <button onClick={() => void send(c)} title="Send now" className="rounded-lg p-1.5 text-accent-400 hover:bg-accent-500/15"><Send className="size-3.5" /></button>
                  )}
                  <button onClick={() => setViewing(c)} title="Recipients & stats" className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><Users className="size-3.5" /></button>
                  {user?.role === "admin" && (
                    <>
                      <button onClick={() => setEditing(c)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><Pencil className="size-3.5" /></button>
                      <button onClick={() => void remove(c)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <CampaignModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
      {viewing && <RecipientsPanel campaign={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ── Builder modal ────────────────────────────────────────────────────────────
function CampaignModal({ initial, onClose, onDone }: { initial: Campaign | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    subject: initial?.subject ?? "",
    body: initial?.subject ?? "",
    audienceSegmentId: initial?.audienceSegmentId ?? "",
    abEnabled: initial?.ab?.enabled ?? false,
    splitA: initial?.ab?.splitA ?? 50,
    subjectB: initial?.ab?.subjectB ?? "",
  });
  const [segments, setSegments] = useState<Segment[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: Segment[] }>("/api/segments").then((d) => setSegments(d.items)).catch(() => {});
    void api<{ items: Template[] }>("/api/email-templates").then((d) => setTemplates(d.items)).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) { setError("Name, subject and body are required"); return; }
    setBusy(true); setError(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        subject: form.subject.trim(),
        body: form.body.trim(),
        audienceSegmentId: form.audienceSegmentId || undefined,
        ab: form.abEnabled ? { enabled: true, splitA: Number(form.splitA), subjectB: form.subjectB.trim() } : undefined,
      };
      if (initial) await patch(`/api/campaigns/${initial.id}`, body);
      else await post("/api/campaigns", body);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? "Edit campaign" : "New campaign"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Q3 Product Update" /></Field>
          <Field label="Audience segment" required>
            <select className="input" value={form.audienceSegmentId} onChange={(e) => setForm({ ...form, audienceSegmentId: e.target.value })}>
              <option value="">Choose a segment…</option>
              {segments.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.objectType})</option>)}
            </select>
          </Field>
        </div>
        <Field label="Description"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What's this campaign about?" /></Field>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
            <Trophy className="size-3.5 text-accent-400" /> Subject <span className="normal-case text-slate-600">(variant A)</span>
          </div>
          <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. What's new in Qorvexa" />
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="size-4 accent-accent-500" checked={form.abEnabled} onChange={(e) => setForm({ ...form, abEnabled: e.target.checked })} />
            A/B test — send a second subject to part of the audience
          </label>
          {form.abEnabled && (
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Field label="Variant B subject" required><input className="input" value={form.subjectB} onChange={(e) => setForm({ ...form, subjectB: e.target.value })} placeholder="A punchier version?" /></Field>
              <Field label={`Split — A gets ${form.splitA}%, B gets ${100 - Number(form.splitA)}%`}>
                <input type="range" min={0} max={100} className="w-full accent-accent-500" value={form.splitA} onChange={(e) => setForm({ ...form, splitA: Number(e.target.value) })} />
              </Field>
            </div>
          )}
        </div>

        <Field label="Body">
          <textarea className="input min-h-28 resize-y" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder='Plain text — use {{contact.firstName}} to merge recipient names.' />
        </Field>
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          <MailOpen className="size-3.5" /> Opens and clicks are tracked automatically. <code className="rounded bg-white/10 px-1">{"{{contact.*}}"}</code> merges recipient fields.
        </div>

        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? <Spinner className="size-4" /> : initial ? "Save changes" : "Create campaign"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Recipients + stats panel ─────────────────────────────────────────────────
function RecipientsPanel({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [stats, setStats] = useState<{ sent: number; opened: number; clicked: number; openRate: number; clickRate: number; roi: number; wonDealIds: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        api<{ items: Recipient[] }>(`/api/campaigns/${campaign.id}/recipients?pageSize=50`),
        api<{ stats: typeof stats }>(`/api/campaigns/${campaign.id}`),
      ]);
      setRecipients(r.items);
      setStats(s.stats);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [campaign.id]);
  useEffect(() => { void load(); }, [load]);

  const declareWinner = async (variant: "A" | "B") => {
    setBusy(true); setError(null);
    try {
      await post(`/api/campaigns/${campaign.id}/declare-winner`, { variant });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${campaign.name} — recipients & stats`} wide>
      {error && <div className="mb-3 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Sent" value={stats.sent} />
          <StatCard label="Opened" value={stats.opened} tone="green" sub={`${stats.openRate}% open rate`} />
          <StatCard label="Clicked" value={stats.clicked} tone="amber" sub={`${stats.clickRate}% click rate`} />
          <StatCard label="Attributed ROI" value={`$${stats.roi.toLocaleString()}`} tone="teal" sub={`${stats.wonDealIds.length} won deal${stats.wonDealIds.length === 1 ? "" : "s"}`} />
        </div>
      )}
      {campaign.ab?.enabled && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-teal-500/10 px-4 py-3 text-sm text-teal-300">
          <Trophy className="size-4" />
          <span className="flex-1">A/B active — compare open rates and declare the winning subject.</span>
          <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => void declareWinner("A")}>A wins</button>
          <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => void declareWinner("B")}>B wins</button>
          {campaign.winner && <Badge tone="green">Winner: {campaign.winner}</Badge>}
        </div>
      )}
      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-9" />)}</div>
      ) : recipients.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-600">No recipients yet — send the campaign first.</div>
      ) : (
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {recipients.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-ink-900/40 px-3 py-2 text-sm">
              <span className="w-5 text-center text-xs font-semibold text-teal-400">{r.variant}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-200">{r.contactName ?? "Unknown"}</div>
                <div className="truncate text-xs text-slate-600">{r.contactEmail}</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {r.openedAt && <Badge tone="green"><MailOpen className="size-3" /> opened</Badge>}
                {r.clickedAt && <Badge tone="blue"><MousePointerClick className="size-3" /> clicked</Badge>}
                {!r.openedAt && !r.clickedAt && <span className="text-slate-600">sent</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
