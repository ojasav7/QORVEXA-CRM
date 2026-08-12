import { useCallback, useEffect, useMemo, useState } from "react";
import { api, get, post } from "../lib/api";
import { Badge, EmptyState, Spinner, StatCard } from "../components/ui";
import { dateTime, initials, money, timeAgo } from "../lib/format";
import { useSession } from "../App";
import {
  UserRound, Search, Fingerprint, Activity, HeartPulse, AlertTriangle, RefreshCw,
  Network, GitMerge, Mail, Phone, CalendarDays, LifeBuoy, X, Database, ArrowRight, Info,
} from "lucide-react";

type Health = {
  profileId: string;
  score: number;
  churnRisk: number;
  atRisk: boolean;
  lastActivityAt: string | null;
  components: { key: string; label: string; weight: number; value: number; inputs: Record<string, unknown> }[];
};

type Profile = {
  id: string;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  account: { id: string; name: string; industry: string | null; tier: string | null } | null;
  memberCount: number;
  contactCount: number;
  leadCount: number;
  memberIds: string[];
  mergedFromIds: string[];
  contacts: { id: string; firstName: string; lastName: string; email: string | null; title: string | null; status: string }[];
  leads: { id: string; firstName: string; lastName: string; email: string | null; company: string | null; score: number; status: string }[];
  health: Health;
  updatedAt: string;
};

type Behavior = {
  id: string;
  type: string;
  entity: string | null;
  value: number | null;
  meta: Record<string, unknown>;
  source: string;
  occurredAt: string;
};

type Overview = {
  profiles: number;
  contacts: number;
  leads: number;
  records: number;
  merged: number;
  behaviors: number;
  avgHealth: number;
  atRisk: number;
  behaviorByType: Record<string, number>;
  behaviorCatalog: string[];
};

type Msg = { id: string; direction: string; subject: string; status: string; createdAt: string };
type CallRow = { id: string; direction: string; status: string; durationSec: number; startedAt: string };
type MeetingRow = { id: string; title: string; status: string; startsAt: string };
type TicketRow = { id: string; reference: string; subject: string; status: string; priority: string; createdAt: string };

type GraphDeal = { dealId: string; name: string; stage: string; amount: number; probability: number; influence: number; primary: boolean; touches: { kind: string; count: number }[] };
type PersonGraph = { contact: { id: string; firstName: string; lastName: string; title: string | null }; deals: GraphDeal[] };

type Profile360 = {
  profile: Profile;
  behaviors: Behavior[];
  messages: Msg[];
  calls: CallRow[];
  meetings: MeetingRow[];
  tickets: TicketRow[];
  health: Health;
  history: { id: string; score: number; churnRisk: number; previousScore: number | null; createdAt: string }[];
  graphs: PersonGraph[];
};

const healthTone = (score: number) => (score < 40 ? "text-rose-400" : score < 70 ? "text-amber-400" : "text-emerald-400");
const healthBar = (score: number) => (score < 40 ? "bg-rose-500" : score < 70 ? "bg-amber-500" : "bg-emerald-500");

const BEHAVIOR_LABEL: Record<string, string> = {
  page_view: "Page view", product_use: "Product use", purchase: "Purchase", ad_click: "Ad click",
  form_submitted: "Form submitted", email_opened: "Email opened", email_clicked: "Email clicked",
  email_replied: "Email replied", call_completed: "Call completed", meeting_completed: "Meeting completed",
  support_ticket: "Support ticket",
};

function HealthGauge({ health }: { health: Health }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
          <HeartPulse className="size-4 text-rose-400" /> Customer health
        </div>
        <Badge tone={health.atRisk ? "rose" : health.score < 70 ? "amber" : "green"}>{health.atRisk ? "At risk" : health.score < 70 ? "Watch" : "Healthy"}</Badge>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <div className={`text-4xl font-bold tabular-nums ${healthTone(health.score)}`}>{health.score}</div>
        <div className="pb-1 text-xs text-slate-500">
          / 100 · churn risk <span className="font-semibold text-slate-300">{health.churnRisk}</span>/100
        </div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800">
        <div className={`h-full rounded-full ${healthBar(health.score)}`} style={{ width: `${health.score}%` }} />
      </div>
      <div className="mt-4 space-y-2.5">
        {health.components.map((c) => (
          <div key={c.key} className="text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">{c.label} <span className="text-slate-600">· {c.weight} pts</span></span>
              <span className={`font-semibold tabular-nums ${healthTone(c.value / c.weight * 100)}`}>{c.value}/{c.weight}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-800">
              <div className={`h-full rounded-full ${healthBar(c.value / c.weight * 100)}`} style={{ width: `${Math.min(100, (c.value / c.weight) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Drawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-white/[0.08] bg-ink-900 shadow-2xl shadow-black/60 animate-fade-in">
        {children}
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin" || user?.role === "manager";
  const [overview, setOverview] = useState<Overview | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Profile360 | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (query?: string) => {
    setLoading(true);
    try {
      const [ov, list] = await Promise.all([
        get<Overview>("/api/cdp/overview"),
        get<{ items: Profile[]; total: number }>(`/api/cdp/profiles?q=${encodeURIComponent(query ?? q)}&limit=100`),
      ]);
      setOverview(ov);
      setProfiles(list.items);
      setTotal(list.total);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  const openProfile = async (id: string) => {
    try {
      const view = await get<Profile360>(`/api/cdp/profiles/${id}`);
      setSelected(view);
    } catch { /* keep drawer closed on error */ }
  };

  const rebuild = async () => {
    setBusy(true);
    try {
      const res = await post<{ created: number; merged: number }>("/api/cdp/profiles/rebuild", {});
      setNotice(`Identity rebuild complete — ${res.created} new profiles, ${res.merged} unified.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const refreshHealth = async () => {
    setBusy(true);
    try {
      const res = await post<{ refreshed: number; atRisk: number; churnWarnings: number }>("/api/cdp/health/refresh", {});
      setNotice(`Health refreshed for ${res.refreshed} customers — ${res.atRisk} at risk, ${res.churnWarnings} churn alerts.`);
      await load();
      if (selected) await openProfile(selected.profile.id);
    } finally {
      setBusy(false);
    }
  };

  const stats = useMemo(() => {
    if (!overview) return [];
    return [
      { label: "Unified profiles", value: overview.profiles, tone: "blue" as const, sub: `${overview.merged} merged identities` },
      { label: "Records unified", value: overview.records, tone: "green" as const, sub: `${overview.contacts} contacts · ${overview.leads} leads` },
      { label: "Behaviors tracked", value: overview.behaviors, tone: "violet" as const, sub: Object.keys(overview.behaviorByType).length + " touchpoint types" },
      { label: "At-risk customers", value: overview.atRisk, tone: overview.atRisk > 0 ? "amber" as const : "green" as const, sub: `avg health ${overview.avgHealth}/100` },
    ];
  }, [overview]);

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Customers</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Every touchpoint unified into one identity — contacts, leads, behaviors, support, and deals, with an explained health score on each customer.
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={() => void rebuild()} disabled={busy} className="btn-ghost text-xs">
              <GitMerge className="size-3.5" /> Rebuild identities
            </button>
            <button onClick={() => void refreshHealth()} disabled={busy} className="btn text-xs">
              <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh health
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-400/70 hover:text-emerald-300"><X className="size-3.5" /></button>
        </div>
      )}

      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s) => <StatCard key={s.label} {...s} />)}
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, email, or company…"
          className="input pl-9"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-44" />)}
        </div>
      ) : profiles.length === 0 ? (
        <EmptyState icon={<UserRound className="size-10" />} title="No customer profiles yet" hint="Profiles are built automatically as contacts and leads are created — try creating a contact, or run Rebuild identities." />
      ) : (
        <>
          <div className="text-xs text-slate-600">{total} customers · click any card for the full 360 view</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => void openProfile(p.id)}
                className="card group p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-500/30"
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-500/30 to-violet-500/30 text-xs font-bold text-accent-200 ring-1 ring-white/10">
                    {initials(p.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-white">{p.name}</span>
                      {p.memberCount > 1 && <Badge tone="violet">unified ×{p.memberCount}</Badge>}
                    </div>
                    <div className="truncate text-xs text-slate-500">{p.email}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-600">
                      {p.account?.name ?? p.company ?? "—"}
                      {p.title ? ` · ${p.title}` : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex flex-wrap gap-1.5">
                    {p.contactCount > 0 && <Badge>{p.contactCount} contact{p.contactCount > 1 ? "s" : ""}</Badge>}
                    {p.leadCount > 0 && <Badge>{p.leadCount} lead{p.leadCount > 1 ? "s" : ""}</Badge>}
                    <Badge tone={p.health.atRisk ? "rose" : p.health.score < 70 ? "amber" : "green"}>
                      {p.health.score}/100
                    </Badge>
                  </div>
                  <div className="text-[11px] text-slate-600">{p.health.lastActivityAt ? timeAgo(p.health.lastActivityAt) : "no activity"}</div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
                  <div className={`h-full rounded-full ${healthBar(p.health.score)} transition-all`} style={{ width: `${p.health.score}%` }} />
                </div>
                {p.health.atRisk && (
                  <div className="mt-3 flex items-center gap-1.5 text-[11px] text-rose-400">
                    <AlertTriangle className="size-3" /> Churn risk {p.health.churnRisk}/100 — flagged by the health engine
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {selected && <ProfileDrawer view={selected} onClose={() => setSelected(null)} onReload={() => void openProfile(selected.profile.id)} />}
    </div>
  );
}

function ProfileDrawer({ view, onClose, onReload }: { view: Profile360; onClose: () => void; onReload: () => void }) {
  const { user } = useSession();
  const isAdmin = user?.role === "admin" || user?.role === "manager";
  const [tab, setTab] = useState<"overview" | "touchpoints" | "graph" | "health">("overview");
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeOptions, setMergeOptions] = useState<{ id: string; name: string; email: string }[]>([]);
  const [merging, setMerging] = useState(false);
  const p = view.profile;

  const loadMergeOptions = async () => {
    try {
      const list = await get<{ items: Profile[] }>(`/api/cdp/profiles?limit=30`);
      setMergeOptions(list.items.filter((x) => x.id !== p.id).map((x) => ({ id: x.id, name: x.name, email: x.email })));
    } catch { /* ignore */ }
  };

  const doMerge = async () => {
    if (!mergeTarget) return;
    setMerging(true);
    try {
      await post("/api/cdp/profiles/merge", { fromId: p.id, intoId: mergeTarget });
      onClose();
      window.location.reload();
    } finally {
      setMerging(false);
    }
  };

  const tabs = [
    { key: "overview" as const, label: "Overview" },
    { key: "touchpoints" as const, label: `Touchpoints (${view.behaviors.length})` },
    { key: "graph" as const, label: `Graph (${view.graphs.length})` },
    { key: "health" as const, label: "Health" },
  ];

  return (
    <Drawer onClose={onClose}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-accent-500/30 to-violet-500/30 text-xs font-bold text-accent-200 ring-1 ring-white/10">
            {initials(p.name)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-white">{p.name}</span>
              {p.memberCount > 1 && <Badge tone="violet"><Fingerprint className="size-3" /> unified</Badge>}
            </div>
            <div className="text-xs text-slate-500">{p.email}</div>
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white transition-colors"><X className="size-4" /></button>
      </div>

      <div className="flex gap-1 border-b border-white/[0.06] px-4 pt-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-t-lg px-3.5 py-2 text-xs font-medium transition-colors ${tab === t.key ? "border-b-2 border-accent-400 text-white" : "text-slate-500 hover:text-slate-300"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === "overview" && (
          <div className="space-y-5">
            <HealthGauge health={view.health} />
            <div className="grid grid-cols-2 gap-3">
              <InfoCell label="Phone" value={p.phone ?? "—"} />
              <InfoCell label="Company" value={p.account?.name ?? p.company ?? "—"} />
              <InfoCell label="Title" value={p.title ?? "—"} />
              <InfoCell label="Account" value={p.account?.name ?? "—"} />
            </div>
            {p.memberCount > 1 && (
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-3 text-xs text-violet-300">
                <div className="flex items-center gap-1.5 font-medium"><Fingerprint className="size-3.5" /> Identity resolution unified {p.memberCount} records</div>
                <div className="mt-1 text-violet-300/70">{p.memberIds.join(" · ")}</div>
                {p.mergedFromIds.length > 0 && <div className="mt-1 text-violet-300/50">Merged from: {p.mergedFromIds.join(", ")}</div>}
              </div>
            )}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Member records</div>
              {p.contacts.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                  <span className="text-slate-300">{c.firstName} {c.lastName} <span className="text-slate-600">({c.title ?? "contact"})</span></span>
                  <Badge>contact · {c.status}</Badge>
                </div>
              ))}
              {p.leads.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                  <span className="text-slate-300">{l.firstName} {l.lastName} <span className="text-slate-600">({l.company ?? "lead"})</span></span>
                  <Badge tone="amber">lead · score {l.score}</Badge>
                </div>
              ))}
              {p.memberCount === 0 && <p className="text-xs text-slate-600">No member records — this profile is behavior-only.</p>}
            </div>

            {isAdmin && (
              <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                  <GitMerge className="size-3.5" /> Merge identity into another profile
                </div>
                <p className="mb-3 text-[11px] text-slate-600">
                  Moves this profile's records, behaviors, and health history into the target (customer.identity_merged). The donor profile is deleted.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => void loadMergeOptions()} className="btn-ghost shrink-0 text-xs">Load profiles</button>
                  <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} className="input flex-1">
                    <option value="">Choose the target profile…</option>
                    {mergeOptions.map((m) => <option key={m.id} value={m.id} className="bg-ink-850 text-slate-200">{m.name} — {m.email}</option>)}
                  </select>
                  <button onClick={() => void doMerge()} disabled={!mergeTarget || merging} className="btn shrink-0 text-xs">
                    {merging ? <Spinner className="size-3" /> : "Merge"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "touchpoints" && (
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                <Activity className="size-3.5" /> Behaviors
              </div>
              <div className="space-y-1.5">
                {view.behaviors.map((b) => (
                  <div key={b.id} className="flex items-start justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <span className="font-medium text-accent-300">{BEHAVIOR_LABEL[b.type] ?? b.type}</span>
                      {b.value != null && <span className="ml-1.5 font-semibold text-emerald-400">${Number(b.value).toLocaleString()}</span>}
                      <div className="truncate text-[11px] text-slate-600">
                        {b.entity ?? ""} {Object.entries(b.meta).slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-600">{timeAgo(b.occurredAt)}</span>
                  </div>
                ))}
                {view.behaviors.length === 0 && <p className="text-xs text-slate-600">No behaviors yet — ingest via POST /api/cdp/behaviors.</p>}
              </div>
            </div>
            {view.messages.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500"><Mail className="size-3.5" /> Emails</div>
                {view.messages.slice(0, 8).map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="truncate text-slate-300">{m.direction === "out" ? "→" : "←"} {m.subject}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-slate-600">{m.status} · {timeAgo(m.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
            {view.calls.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500"><Phone className="size-3.5" /> Calls</div>
                {view.calls.slice(0, 5).map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="text-slate-300">{c.direction} call · {Math.round(c.durationSec / 60)}m</span>
                    <span className="text-[11px] text-slate-600">{timeAgo(c.startedAt)}</span>
                  </div>
                ))}
              </div>
            )}
            {view.meetings.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500"><CalendarDays className="size-3.5" /> Meetings</div>
                {view.meetings.slice(0, 5).map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="truncate text-slate-300">{m.title}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-slate-600">{m.status} · {timeAgo(m.startsAt)}</span>
                  </div>
                ))}
              </div>
            )}
            {view.tickets.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500"><LifeBuoy className="size-3.5" /> Tickets</div>
                {view.tickets.slice(0, 8).map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="truncate text-slate-300">{t.reference} · {t.subject}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-slate-600">{t.status} · {timeAgo(t.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "graph" && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Network className="size-4 text-accent-400" />
              Relationship graph v1 — involvement is scored from real touchpoints (emails / calls / meetings), capped at 100.
            </div>
            {view.graphs.length === 0 && <EmptyState icon={<Network className="size-8" />} title="No deal involvement yet" hint="Create deals and log emails/calls/meetings against them — the graph builds itself." />}
            {view.graphs.map((g) => (
              <div key={g.contact.id} className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <div className="mb-3 text-xs font-semibold text-white">
                  {g.contact.firstName} {g.contact.lastName} <span className="font-normal text-slate-500">· {g.contact.title ?? "contact"}</span>
                </div>
                <div className="space-y-2">
                  {g.deals.map((d) => (
                    <div key={d.dealId} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <span className="truncate text-slate-300">{d.name} <span className="text-slate-600">· {d.stage}</span></span>
                        <div className="text-[11px] text-slate-600">
                          {money(d.amount)} · {d.touches.map((t) => `${t.kind}×${t.count}`).join(", ") || "no logged touches"}
                        </div>
                      </div>
                      <div className="ml-3 flex shrink-0 items-center gap-2">
                        {d.primary && <Badge tone="gold">primary</Badge>}
                        <Badge tone={d.influence >= 50 ? "green" : d.influence >= 20 ? "blue" : "default"}>influence {d.influence}</Badge>
                      </div>
                    </div>
                  ))}
                  {g.deals.length === 0 && <p className="text-xs text-slate-600">No deals linked to this person's account.</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "health" && (
          <div className="space-y-5">
            <HealthGauge health={view.health} />
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                <Info className="size-3.5" /> Why this score
              </div>
              <div className="space-y-2">
                {view.health.components.map((c) => (
                  <div key={c.key} className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-300">{c.label}</span>
                      <span className={`font-semibold tabular-nums ${healthTone(c.value / c.weight * 100)}`}>{c.value}/{c.weight}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-600">
                      {Object.entries(c.inputs).filter(([k]) => k !== "formula").map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${v ?? "—"}`).join(" · ")}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-600">{String(c.inputs.formula)}</div>
                  </div>
                ))}
              </div>
            </div>
            {view.history.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                  <Database className="size-3.5" /> Health history
                </div>
                <div className="space-y-1.5">
                  {view.history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                      <span className="text-slate-400">{dateTime(h.createdAt)}</span>
                      <span className="flex items-center gap-2">
                        {h.previousScore != null && (
                          <span className={`text-[11px] ${h.score - h.previousScore < 0 ? "text-rose-400" : h.score - h.previousScore > 0 ? "text-emerald-400" : "text-slate-600"}`}>
                            {h.score - h.previousScore > 0 ? "▲" : h.score - h.previousScore < 0 ? "▼" : "·"} {Math.abs(h.score - h.previousScore)}
                          </span>
                        )}
                        <span className={`font-semibold tabular-nums ${healthTone(h.score)}`}>{h.score}</span>
                        <Badge tone={h.churnRisk >= 70 ? "rose" : "default"}>churn {h.churnRisk}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">{label}</div>
      <div className="mt-0.5 truncate text-xs text-slate-300">{value}</div>
    </div>
  );
}
