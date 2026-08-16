import { useEffect, useState } from "react";
import {
  HeartHandshake, ListChecks, Activity, TrendingDown, ClipboardList, Crown, Users,
  Plus, Trash2, X, Check, RefreshCw, Zap, Megaphone, Target, Gift, BadgePercent,
} from "lucide-react";
import { api, post, del } from "../lib/api";
import { useSession } from "../App";
import { Badge, EmptyState, Spinner, Field, StatCard, Modal } from "../components/ui";
import { date, timeAgo } from "../lib/format";

// ── Types ───────────────────────────────────────────────────────────────────
type Plan = {
  id: string; name: string; kind: string; status: string; accountId: string | null; accountName: string | null;
  accountTier: string | null; ownerName: string | null; startDate: string | null; targetDate: string | null;
  healthScore: number | null; churnRisk: number | null; atRisk: boolean; notes: string | null;
  milestones: { id: string; title: string; dueDate: string | null; status: string; completedAt: string | null }[];
  qbrs: { id: string; title: string; date: string; attendees: string[]; notes: string | null }[];
  createdAt: string;
};
type UsageRow = { accountId: string | null; accountName: string | null; tier: string | null; features30: number; features60: number; featureDrop: number | null; adoptionPct: number; activeUsers30: number; seats: number; seatUtilization: number | null; daysInactive: number | null; inactive: boolean };
type ChurnItem = { accountId: string; accountName: string | null; accountTier: string | null; score: number; riskTier: string; factors: { key: string; label: string; impact: number; detail: string }[]; recommendation: string; lastScoredAt: string | null; lastScore: number | null; delta: number | null };
type Opportunity = { type: string; accountId: string; accountName: string | null; title: string; reason: string; estimatedValue: number; confidence: number };
type Survey = { id: string; name: string; kind: string; question: string; active: boolean; createdAt: string };
type SurveyResponse = { id: string; surveyId: string; score: number; comment: string | null; sentiment: string | null; contactName: string | null; accountId: string | null; respondedAt: string };
type SurveyResult = { survey: Survey; total: number; score: number | null; avg: number | null; sentiment: Record<string, number>; formula: string[]; distribution: Record<string, number> };
type RoadmapItem = { id: string; title: string; description: string | null; source: string; status: string; category: string; votes: number; createdAt: string };
type Program = { id: string; name: string; active: boolean; tiers: { key: string; name: string; minPoints: number; benefits: string[] }[]; rewards: { key: string; name: string; pointsCost: number; description: string }[]; pointsRules: Record<string, number>; members: { id: string; contactId: string | null; points: number; tier: { key: string; name: string } }[]; referrals: any[] };
type Member = { id: string; programId: string; programName: string | null; contactName: string | null; accountId: string | null; points: number; tier: { key: string; name: string } };
type Referral = { id: string; referredEmail: string; referredName: string | null; referrerName: string | null; status: string; pointsAwarded: number; createdAt: string };

const STATUS_TONE: Record<string, "default" | "green" | "amber" | "rose" | "blue" | "teal"> = {
  draft: "default", active: "blue", at_risk: "rose", completed: "green", archived: "default",
  onboarding: "blue", success: "teal", custom: "default",
  low: "green", medium: "amber", high: "amber", critical: "rose",
  pending: "default", contacted: "blue", converted: "green", expired: "default",
  new: "default", triaged: "blue", planned: "teal", in_progress: "amber", shipped: "green", declined: "rose",
  positive: "green", neutral: "default", negative: "rose",
  upsell: "teal", cross_sell: "blue", expansion: "green",
};
const tierBadge = (s: string) => <Badge tone={STATUS_TONE[s] ?? "default"}>{s.replace("_", " ")}</Badge>;

export default function SuccessPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<"plans" | "usage" | "churn" | "surveys" | "loyalty">("plans");
  const isAdmin = user?.role === "admin";
  const isManager = isAdmin || user?.role === "manager";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <HeartHandshake className="size-4 text-teal-400" /> Customer Success
            <span className="chip bg-teal-500/15 text-teal-300">plans · usage · churn · surveys · loyalty</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Success plans with milestones + QBRs, product usage intelligence, explained churn prediction + expansion radar, NPS/CSAT/CES surveys with a feedback → roadmap pipeline, and loyalty/advocacy programs.
          </p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06]">
        {([
          ["plans", "Plans", ListChecks],
          ["usage", "Usage", Activity],
          ["churn", "Churn & expansion", TrendingDown],
          ["surveys", "Surveys", ClipboardList],
          ["loyalty", "Loyalty", Crown],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === key ? "border-accent-400 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "plans" && <PlansTab isAdmin={isAdmin} isManager={isManager} />}
      {tab === "usage" && <UsageTab />}
      {tab === "churn" && <ChurnTab isAdmin={isAdmin} />}
      {tab === "surveys" && <SurveysTab isAdmin={isAdmin} isManager={isManager} />}
      {tab === "loyalty" && <LoyaltyTab isAdmin={isAdmin} isManager={isManager} />}
    </div>
  );
}

// ── Plans ───────────────────────────────────────────────────────────────────
function PlansTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [items, setItems] = useState<Plan[]>([]);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Plan | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const load = () => {
    void api<{ items: Plan[] }>("/api/success/plans").then((d) => setItems(d.items)).catch(() => {});
    void api<{ items: { id: string; name: string }[] }>("/api/accounts?pageSize=100").then((d) => setAccounts(d.items)).catch(() => {});
    void api<{ items: { id: string; name: string }[] }>("/api/users?pageSize=100").then((d) => setUsers(d.items)).catch(() => {});
  };
  useEffect(load, []);
  const remove = async (p: Plan) => {
    if (!confirm(`Delete plan "${p.name}"?`)) return;
    try { await del(`/api/success/plans/${p.id}`); load(); } catch (e: any) { alert(e?.message ?? "Delete failed"); }
  };

  return (
    <div className="space-y-4">
      {(isAdmin || isManager) && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Onboarding & success plans per account — milestones + QBR log. Low health auto-flags a plan at risk.</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New plan</button>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<ListChecks className="size-8" />} title="No success plans yet" hint="Create an onboarding or success plan for an account." />}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {items.map((p) => {
          const done = p.milestones.filter((m) => m.status === "done").length;
          return (
            <div key={p.id} className="card p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <button onClick={() => setDetail(p)} className="text-left">
                    <span className="text-sm font-semibold text-white hover:text-accent-300">{p.name}</span>
                  </button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    {tierBadge(p.kind)} {tierBadge(p.status)}
                    {p.accountName && <span>{p.accountName}</span>}
                    {p.ownerName && <span>· CSM {p.ownerName}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {p.healthScore != null && (
                    <span className={`chip ${p.atRisk ? "bg-rose-500/15 text-rose-300" : p.healthScore >= 60 ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                      health {p.healthScore}
                    </span>
                  )}
                  {(isAdmin || isManager) && <button className="text-slate-600 hover:text-rose-400" onClick={() => void remove(p)}><Trash2 className="size-3.5" /></button>}
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Milestones {done}/{p.milestones.length}</span>
                  {p.targetDate && <span>target {date(p.targetDate)}</span>}
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-accent-400/70" style={{ width: `${p.milestones.length ? (done / p.milestones.length) * 100 : 0}%` }} />
                </div>
              </div>
              {p.qbrs.length > 0 && <p className="mt-2 text-[11px] text-slate-500">{p.qbrs.length} QBR(s) · last {date(p.qbrs[p.qbrs.length - 1].date)}</p>}
              {p.atRisk && <p className="mt-2 rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">At risk — health below 55. Run the playbook.</p>}
            </div>
          );
        })}
      </div>
      {creating && <PlanModal accounts={accounts} users={users} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {detail && <PlanDetail plan={detail} users={users} isManager={isManager} onClose={() => setDetail(null)} onChanged={(updated) => { setDetail(updated); load(); }} />}
    </div>
  );
}

function PlanModal({ accounts, users, onClose, onSaved }: { accounts: { id: string; name: string }[]; users: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("onboarding");
  const [accountId, setAccountId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post("/api/success/plans", {
        name: name.trim(), kind, accountId: accountId || undefined, ownerId: ownerId || undefined,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        targetDate: targetDate ? new Date(targetDate).toISOString() : undefined,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="New success plan">
      <div className="space-y-3">
        <Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="input">
              <option value="onboarding">Onboarding</option><option value="success">Success</option><option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="Account">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input"><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </Field>
        </div>
        <Field label="CSM owner">
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="input"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" /></Field>
          <Field label="Target date"><input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="input" /></Field>
        </div>
        <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim() || busy} onClick={() => void save()}>
            {busy ? <Spinner className="size-4" /> : <Check className="size-4" />} Create
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PlanDetail({ plan, users, isManager, onClose, onChanged }: {
  plan: Plan; users: { id: string; name: string }[]; isManager: boolean; onClose: () => void; onChanged: (p: Plan) => void;
}) {
  const [milestone, setMilestone] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [qbrTitle, setQbrTitle] = useState("");
  const [qbrNotes, setQbrNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (path: string, body?: unknown) => {
    try {
      const d = await post<{ plan: Plan }>(path, body ?? {});
      onChanged(d.plan);
    } catch (e: any) { alert(e?.message ?? "Action failed"); }
  };
  const setStatus = async (status: string) => {
    try {
      const d = await api<{ plan: Plan }>(`/api/success/plans/${plan.id}`, { method: "PUT", body: JSON.stringify({ status }) });
      onChanged(d.plan);
    } catch (e: any) { alert(e?.message ?? "Failed"); }
  };
  return (
    <Modal open onClose={onClose} title={plan.name} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {tierBadge(plan.kind)} {tierBadge(plan.status)}
          <span className="text-slate-500">{plan.accountName ?? "—"} · CSM {plan.ownerName ?? "—"}</span>
          {plan.healthScore != null && <span className={`chip ${plan.atRisk ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}>health {plan.healthScore}/100</span>}
          {isManager && (
            <span className="ml-auto flex gap-1.5">
              {["draft", "active", "at_risk", "completed", "archived"].filter((s) => s !== plan.status).map((s) => (
                <button key={s} className="btn-ghost !py-1 text-[11px]" onClick={() => void setStatus(s)}>{s}</button>
              ))}
            </span>
          )}
        </div>
        {plan.notes && <p className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-slate-400">{plan.notes}</p>}
        {plan.atRisk && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            Health-score-to-playbook: score &lt; 55 → schedule a QBR, review usage, and prepare the save conversation (docs/34).
          </div>
        )}
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"><ListChecks className="size-3.5" /> Milestones</h4>
          <div className="mt-2 space-y-1.5">
            {plan.milestones.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs">
                <button
                  disabled={!isManager}
                  onClick={() => void act(`/api/success/plans/${plan.id}/milestones/${m.id}`, { done: m.status !== "done" })}
                  className={`flex size-4 items-center justify-center rounded-full border ${m.status === "done" ? "border-emerald-400 bg-emerald-400/20 text-emerald-300" : "border-slate-600 text-transparent"} ${isManager ? "cursor-pointer hover:border-accent-400" : "cursor-default"}`}
                >
                  <Check className="size-3" />
                </button>
                <span className={m.status === "done" ? "text-slate-500 line-through" : "text-slate-200"}>{m.title}</span>
                {m.dueDate && <span className="ml-auto text-[10px] text-slate-600">{date(m.dueDate)}</span>}
              </div>
            ))}
            {plan.milestones.length === 0 && <p className="text-xs text-slate-600">No milestones yet.</p>}
          </div>
          {isManager && (
            <div className="mt-2 flex gap-2">
              <input value={milestone} onChange={(e) => setMilestone(e.target.value)} placeholder="New milestone…" className="input !py-1.5 text-xs" />
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input !py-1.5 text-xs" />
              <button
                className="btn-primary !py-1.5 text-xs"
                disabled={!milestone.trim() || busy}
                onClick={() => void (async () => { setBusy(true); try { await act(`/api/success/plans/${plan.id}/milestones`, { title: milestone.trim(), dueDate: dueDate ? new Date(dueDate).toISOString() : undefined }); setMilestone(""); setDueDate(""); } finally { setBusy(false); } })()}
              >
                <Plus className="size-3.5" /> Add
              </button>
            </div>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">QBRs</h4>
          <div className="mt-2 space-y-1.5">
            {plan.qbrs.map((q) => (
              <div key={q.id} className="rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs">
                <span className="font-medium text-slate-200">{q.title}</span>
                <span className="ml-2 text-[10px] text-slate-600">{date(q.date)}</span>
                {q.attendees.length > 0 && <span className="ml-2 text-[10px] text-slate-500">with {q.attendees.join(", ")}</span>}
                {q.notes && <p className="mt-0.5 text-[11px] text-slate-500">{q.notes}</p>}
              </div>
            ))}
            {plan.qbrs.length === 0 && <p className="text-xs text-slate-600">No QBRs logged yet.</p>}
          </div>
          {isManager && (
            <div className="mt-2 flex gap-2">
              <input value={qbrTitle} onChange={(e) => setQbrTitle(e.target.value)} placeholder="QBR title…" className="input min-w-0 flex-1 !py-1.5 text-xs" />
              <input value={qbrNotes} onChange={(e) => setQbrNotes(e.target.value)} placeholder="Notes…" className="input min-w-0 flex-1 !py-1.5 text-xs" />
              <button
                className="btn-primary !py-1.5 text-xs"
                disabled={!qbrTitle.trim()}
                onClick={() => void (async () => { try { await act(`/api/success/plans/${plan.id}/qbrs`, { title: qbrTitle.trim(), notes: qbrNotes.trim() || undefined }); setQbrTitle(""); setQbrNotes(""); } catch { /* alert handled */ } })()}
              >
                <Plus className="size-3.5" /> Log QBR
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Usage ───────────────────────────────────────────────────────────────────
function UsageTab() {
  const [data, setData] = useState<{ catalog: string[]; totals: Record<string, number>; accounts: UsageRow[] } | null>(null);
  useEffect(() => { void api<typeof data>("/api/success/usage").then(setData).catch(() => {}); }, []);
  const maxFeatures = Math.max(1, ...(data?.accounts.map((a) => a.features30) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Feature adoption" value={data ? `${data.totals.adoptionPct}%` : "—"} sub={`${data?.totals.featuresUsed30 ?? 0} of ${data?.catalog.length ?? 0} features used`} tone="blue" />
        <StatCard label="Accounts tracked" value={data?.totals.accountsTracked ?? "—"} sub={`${data?.totals.activeUsers30 ?? 0} active users`} tone="teal" />
        <StatCard label="Inactive accounts" value={data?.totals.inactiveAccounts ?? "—"} sub="no usage in 30+ days" tone="amber" />
        <StatCard label="Feature catalog" value={data?.catalog.length ?? "—"} sub={data?.catalog.join(", ") ?? ""} tone="green" />
      </div>
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-white">Per-account usage</h3>
        <p className="mt-0.5 text-xs text-slate-500">Features used in the last 30d vs the prior 30d — a drop below 50% fires usage.adoption_dropped.</p>
        <div className="mt-3 space-y-2">
          {!data && <Spinner />}
          {data?.accounts.map((a) => (
            <div key={a.accountId ?? "none"} className="rounded-lg bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-white">{a.accountName ?? "Unassigned"}</span>
                {a.tier && <span className="chip bg-white/[0.05] text-[10px] text-slate-400">{a.tier}</span>}
                {a.inactive && <Badge tone="default">inactive</Badge>}
                {a.featureDrop != null && a.featureDrop < 0 && <Badge tone="amber">↓ {Math.abs(a.featureDrop)}% vs prior</Badge>}
                <span className="ml-auto text-[11px] text-slate-500">
                  {a.features30} feature(s) · {a.activeUsers30} user(s) · {a.seats ? `${a.seatUtilization ?? 0}% of ${a.seats} seat(s)` : "no seats"}
                  {a.daysInactive != null ? ` · ${a.daysInactive}d inactive` : ""}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full ${a.inactive ? "bg-rose-400/70" : a.featureDrop != null && a.featureDrop < 0 ? "bg-amber-400/70" : "bg-emerald-400/70"}`} style={{ width: `${(a.features30 / maxFeatures) * 100}%` }} />
              </div>
            </div>
          ))}
          {data && data.accounts.length === 0 && <p className="text-xs text-slate-600">No usage telemetry yet — post to POST /api/success/usage or use the product.</p>}
        </div>
      </div>
    </div>
  );
}

// ── Churn & expansion ───────────────────────────────────────────────────────
function ChurnTab({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<ChurnItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<{ id: string; accountId: string; score: number; riskTier: string; createdAt: string }[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 3000); };
  const load = () => {
    void api<{ overview: { counts: Record<string, number>; items: ChurnItem[] }; history: typeof history }>("/api/success/churn").then((d) => { setItems(d.overview.items); setCounts(d.overview.counts); setHistory(d.history); }).catch(() => {});
    void api<{ items: Opportunity[] }>("/api/success/churn/expansion").then((d) => setOpportunities(d.items)).catch(() => {});
  };
  useEffect(load, []);
  const refresh = async () => {
    setRefreshing(true);
    try {
      const d = await post<{ refresh: { refreshed: number; escalated: string[]; counts: Record<string, number> } }>("/api/success/churn/refresh");
      flash(`Refreshed ${d.refresh.refreshed} account(s) — ${d.refresh.escalated.length} escalated to a higher risk tier`);
      load();
    } catch (e: any) { alert(e?.message ?? "Refresh failed"); }
    finally { setRefreshing(false); }
  };

  return (
    <div className="space-y-4">
      {notice && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Low risk" value={counts.low ?? 0} tone="green" />
          <StatCard label="Medium" value={counts.medium ?? 0} tone="amber" />
          <StatCard label="High" value={counts.high ?? 0} tone="amber" />
          <StatCard label="Critical" value={counts.critical ?? 0} tone="amber" />
        </div>
        {isAdmin && <button className="btn-primary" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh scores</button>}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Target className="size-4 text-accent-400" /> Churn prediction v2</h3>
          <p className="mt-0.5 text-xs text-slate-500">Explained score: health 35% + usage 25% + support 20% + billing 25% + surveys 15% (docs/34).</p>
          <div className="mt-3 space-y-2">
            {!items.length && <Spinner />}
            {items.map((i) => (
              <details key={i.accountId} className="rounded-lg bg-white/[0.03] px-3 py-2">
                <summary className="flex cursor-pointer items-center gap-2 text-sm">
                  <span className="font-medium text-white">{i.accountName ?? i.accountId}</span>
                  {tierBadge(i.riskTier)}
                  <span className="ml-auto tabular-nums font-semibold text-rose-300">{i.score}/100</span>
                </summary>
                {i.delta != null && <div className="mt-1 text-[11px] text-slate-500">last scored {i.lastScore}{i.delta > 0 ? ` (+${i.delta})` : i.delta < 0 ? ` (${i.delta})` : ""} · {i.lastScoredAt ? timeAgo(i.lastScoredAt) : "never"}</div>}
                <div className="mt-1 space-y-1">
                  {i.factors.map((f) => (
                    <div key={f.key} className="flex items-start gap-2 rounded-lg bg-ink-950/50 p-2 text-[11px] text-slate-400">
                      <span className="w-14 shrink-0 font-medium text-slate-300">{f.label}</span>
                      <span className="tabular-nums text-rose-300/80">{f.impact > 0 ? `+${f.impact}` : f.impact}</span>
                      <span>{f.detail}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 rounded-lg bg-accent-500/10 px-2 py-1 text-[11px] text-accent-200">Playbook → {i.recommendation}</p>
              </details>
            ))}
          </div>
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Snapshot history</h4>
          <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
            {history.slice(0, 20).map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="w-10">{tierBadge(s.riskTier)}</span>
                <span className="tabular-nums">{s.score}/100</span>
                <span className="ml-auto">{date(s.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Megaphone className="size-4 text-teal-400" /> Expansion radar</h3>
          <p className="mt-0.5 text-xs text-slate-500">Derived upsell / cross-sell / expansion opportunities — expansion.opportunity_detected fires on tick.</p>
          <div className="mt-3 space-y-2">
            {opportunities.length === 0 && <p className="text-xs text-slate-600">No opportunities right now.</p>}
            {opportunities.map((o, i) => (
              <div key={i} className="rounded-lg bg-white/[0.03] p-3">
                <div className="flex items-center gap-2 text-xs">
                  {tierBadge(o.type)}
                  <span className="font-medium text-white">{o.title}</span>
                  <span className="ml-auto tabular-nums text-emerald-300">${o.estimatedValue.toLocaleString()}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{o.accountName ?? "—"} · {o.reason} · {Math.round(o.confidence * 100)}% confidence</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Surveys & roadmap ───────────────────────────────────────────────────────
function SurveysTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [selected, setSelected] = useState<Survey | null>(null);
  const [creating, setCreating] = useState(false);
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const load = () => {
    void api<{ items: Survey[] }>("/api/success/surveys").then((d) => setSurveys(d.items)).catch(() => {});
    void api<{ items: RoadmapItem[] }>("/api/success/roadmap").then((d) => setRoadmap(d.items)).catch(() => {});
  };
  useEffect(load, []);

  return (
    <div className="space-y-4">
      {(isAdmin || isManager) && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">NPS / CSAT / CES surveys — negative comments auto-promote to the roadmap pipeline.</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New survey</button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-white">Surveys</h3>
          <div className="mt-3 space-y-2">
            {surveys.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
                <span className="font-medium text-white">{s.name}</span>
                {tierBadge(s.kind)}
                {!s.active && <Badge tone="rose">inactive</Badge>}
                <button className="ml-auto text-xs text-accent-400 hover:text-accent-300" onClick={() => setSelected(s)}>Results</button>
              </div>
            ))}
            {surveys.length === 0 && <p className="text-xs text-slate-600">No surveys yet.</p>}
          </div>
          <h3 className="mt-5 text-sm font-semibold text-white">Roadmap pipeline</h3>
          <div className="mt-2 space-y-1.5">
            {roadmap.map((r) => (
              <div key={r.id} className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-200">{r.title}</span>
                  {tierBadge(r.status)}
                  <button className="ml-auto flex items-center gap-1 text-[11px] text-slate-500 hover:text-accent-300" onClick={() => void (async () => { try { await post(`/api/success/roadmap/${r.id}/vote`); load(); } catch { /* ignore */ } })()}>
                    <Zap className="size-3" /> {r.votes}
                  </button>
                </div>
                <div className="mt-0.5 text-[10px] text-slate-600">source: {r.source} · {r.category}</div>
              </div>
            ))}
            {roadmap.length === 0 && <p className="text-xs text-slate-600">No roadmap items — negative survey feedback lands here.</p>}
          </div>
        </div>
        <div className="card p-5">
          {selected ? <SurveyResults surveyId={selected.id} /> : (
            <div className="flex h-full min-h-40 items-center justify-center text-xs text-slate-600">Pick a survey to see its computed score + responses.</div>
          )}
        </div>
      </div>
      {creating && <SurveyModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </div>
  );
}

function SurveyResults({ surveyId }: { surveyId: string }) {
  const [result, setResult] = useState<SurveyResult | null>(null);
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const load = () => {
    void api<SurveyResult>(`/api/success/surveys/${surveyId}/results`).then(setResult).catch(() => {});
    void api<{ items: SurveyResponse[] }>(`/api/success/surveys/${surveyId}/responses`).then((d) => setResponses(d.items)).catch(() => {});
  };
  useEffect(load, [surveyId]);
  return (
    <div>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white">{result?.survey.name ?? "Survey"}</h3>
        {result && tierBadge(result.survey.kind)}
        {result && <span className="ml-auto text-2xl font-bold tabular-nums text-white">{result.score ?? "—"}</span>}
      </div>
      {result && (
        <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
          <span>{result.total} response(s)</span>
          {result.survey.kind === "ces" && result.avg != null && <span>· avg {result.avg}/7</span>}
          <span className="ml-auto flex gap-1">
            <Badge tone="green">{result.sentiment.positive ?? 0} pos</Badge>
            <Badge tone="default">{result.sentiment.neutral ?? 0} neu</Badge>
            <Badge tone="rose">{result.sentiment.negative ?? 0} neg</Badge>
          </span>
        </div>
      )}
      {result && (
        <div className="mt-2 rounded-lg bg-ink-950/50 p-2.5 text-[11px] text-slate-500">
          {result.formula.map((f) => <div key={f}>{f}</div>)}
        </div>
      )}
      <div className="mt-3 space-y-1.5">
        {responses.map((r) => (
          <div key={r.id} className="rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold tabular-nums text-white">{r.score}</span>
              <span className="text-slate-400">{r.contactName ?? "Anonymous"}</span>
              {r.sentiment && tierBadge(r.sentiment)}
              <span className="ml-auto text-[10px] text-slate-600">{date(r.respondedAt)}</span>
            </div>
            {r.comment && <p className="mt-0.5 text-[11px] text-slate-500">"{r.comment}"</p>}
          </div>
        ))}
        {responses.length === 0 && <p className="text-xs text-slate-600">No responses yet.</p>}
      </div>
    </div>
  );
}

function SurveyModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("nps");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await post("/api/success/surveys", { name: name.trim(), kind, question: question.trim() || undefined }); onSaved(); }
    catch (e: any) { alert(e?.message ?? "Create failed"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="New survey">
      <div className="space-y-3">
        <Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="input">
            <option value="nps">NPS (0–10)</option><option value="csat">CSAT (1–5)</option><option value="ces">CES (1–7)</option>
          </select>
        </Field>
        <Field label="Question"><input value={question} onChange={(e) => setQuestion(e.target.value)} className="input" /></Field>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim() || busy} onClick={() => void save()}>
            {busy ? <Spinner className="size-4" /> : <Check className="size-4" />} Create
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Loyalty ─────────────────────────────────────────────────────────────────
function LoyaltyTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [creating, setCreating] = useState(false);
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);
  const load = () => {
    void api<{ programs: Program[]; members: Member[] }>("/api/success/loyalty").then((d) => { setPrograms(d.programs); setMembers(d.members); }).catch(() => {});
    void api<{ items: Referral[] }>("/api/success/loyalty/referrals").then((d) => setReferrals(d.items)).catch(() => {});
    void api<{ items: { id: string; name: string }[] }>("/api/contacts?pageSize=100").then((d) => setContacts(d.items)).catch(() => {});
  };
  useEffect(load, []);

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Programs with tiers + rewards + points rules; referrals auto-award points on conversion (docs/34 loyalty rules).</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New program</button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Crown className="size-4 text-amber-400" /> Programs & members</h3>
          <div className="mt-3 space-y-3">
            {programs.map((p) => (
              <div key={p.id} className="rounded-lg bg-white/[0.03] p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold text-white">{p.name}</span>
                  {!p.active && <Badge tone="rose">inactive</Badge>}
                  <span className="ml-auto text-[11px] text-slate-500">{p.members.length} member(s) · referral = {p.pointsRules.referral ?? 500} pts</span>
                </div>
                <div className="mt-2 flex gap-1.5">
                  {p.tiers.map((t) => <span key={t.key} className="chip bg-white/[0.05] text-[10px] text-slate-400">{t.name} {t.minPoints}+</span>)}
                  {p.rewards.map((r) => <span key={r.key} className="chip bg-amber-500/10 text-[10px] text-amber-300" title={r.description}>{r.name} · {r.pointsCost} pts</span>)}
                </div>
                <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                  {p.members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span className="font-medium text-slate-200">{m.contactId ? "Member" : "Member"}</span>
                      <span className="ml-auto tabular-nums">{m.points} pts</span>
                      <Badge tone="amber">{m.tier.name}</Badge>
                    </div>
                  ))}
                </div>
                {isManager && (
                  <button
                    className="btn-ghost mt-2 !py-1 text-xs"
                    onClick={() => void (async () => {
                      const contactId = prompt("Contact id to enroll?");
                      if (!contactId) return;
                      try { await post(`/api/success/loyalty/programs/${p.id}/members`, { contactId }); load(); } catch (e: any) { alert(e?.message ?? "Enroll failed"); }
                    })()}
                  >
                    <Users className="size-3.5" /> Enroll member
                  </button>
                )}
              </div>
            ))}
            {programs.length === 0 && <p className="text-xs text-slate-600">No programs yet.</p>}
          </div>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Members</h3>
          <div className="mt-1.5 space-y-1">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="font-medium text-slate-200">{m.contactName ?? "Member"}</span>
                <span className="text-slate-600">{m.programName}</span>
                <span className="ml-auto tabular-nums">{m.points} pts</span>
                <Badge tone="amber">{m.tier.name}</Badge>
                {isManager && (
                  <button
                    className="text-[10px] text-accent-400 hover:text-accent-300"
                    onClick={() => void (async () => {
                      const pts = prompt("Points to award (integer)");
                      const reason = prompt("Reason");
                      if (!pts || !reason) return;
                      try { await post(`/api/success/loyalty/members/${m.id}/award`, { points: Number(pts), reason }); load(); } catch (e: any) { alert(e?.message ?? "Award failed"); }
                    })()}
                  >
                    + award
                  </button>
                )}
              </div>
            ))}
            {members.length === 0 && <p className="text-xs text-slate-600">No members yet.</p>}
          </div>
        </div>
        <div className="card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Gift className="size-4 text-teal-400" /> Referrals</h3>
          <p className="mt-0.5 text-xs text-slate-500">pending → contacted → converted (referrer earns points) | expired.</p>
          <div className="mt-3 space-y-1.5">
            {referrals.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                <span className="font-medium text-slate-200">{r.referredName ?? r.referredEmail}</span>
                <span className="text-[10px] text-slate-600">{r.referredEmail}</span>
                {tierBadge(r.status)}
                {r.referrerName && <span className="text-[10px] text-slate-500">by {r.referrerName}</span>}
                {r.pointsAwarded > 0 && <Badge tone="amber">+{r.pointsAwarded} pts</Badge>}
                {isManager && r.status === "pending" && (
                  <span className="ml-auto flex gap-1">
                    <button className="btn-ghost !py-0.5 text-[10px]" onClick={() => void setRefStatus(r.id, "contacted")}>Contacted</button>
                    <button className="btn-ghost !py-0.5 text-[10px] text-rose-400" onClick={() => void setRefStatus(r.id, "expired")}>Expire</button>
                  </span>
                )}
                {isManager && r.status === "contacted" && (
                  <button className="btn-primary ml-auto !py-0.5 text-[10px]" onClick={() => void setRefStatus(r.id, "converted")}>Convert</button>
                )}
              </div>
            ))}
            {referrals.length === 0 && <p className="text-xs text-slate-600">No referrals yet.</p>}
          </div>
          {isManager && (
            <button className="btn-primary mt-3 w-full !py-1.5 text-xs" onClick={() => void (async () => {
              const email = prompt("Referred email");
              const name = prompt("Referred name (optional)");
              const referrerId = prompt("Referrer contact id (optional)");
              const programId = programs[0]?.id;
              if (!email || !programId) return alert("Email + program required");
              try { await post("/api/success/loyalty/referrals", { programId, referredEmail: email, referredName: name || undefined, referrerContactId: referrerId || undefined }); load(); } catch (e: any) { alert(e?.message ?? "Create failed"); }
            })()}>
              <Plus className="size-3.5" /> Log referral
            </button>
          )}
        </div>
      </div>
      {creating && (
        <Modal open onClose={() => setCreating(false)} title="New loyalty program">
          <CreateProgramForm onDone={() => { setCreating(false); load(); }} />
        </Modal>
      )}
    </div>
  );
}

async function setRefStatus(id: string, status: string) {
  try { await post(`/api/success/loyalty/referrals/${id}/status`, { status }); } catch (e: any) { alert(e?.message ?? "Failed"); }
}

function CreateProgramForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const save = async () => {
    try { await post("/api/success/loyalty/programs", { name: name.trim() }); onDone(); } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };
  return (
    <div className="space-y-3">
      <Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
      <p className="text-xs text-slate-500">Default tiers (bronze/silver/gold), rewards, and points rules are seeded — tune them later.</p>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onDone}>Cancel</button>
        <button className="btn-primary" disabled={!name.trim()} onClick={() => void save()}><Check className="size-4" /> Create</button>
      </div>
    </div>
  );
}
