import { useEffect, useState, type FormEvent } from "react";
import {
  Brain, Waypoints, ScanSearch, Radar, Database, Network, Timer, FlaskConical,
  Wand2, Search, Mic, RefreshCw, Plus, Trash2, Play, ToggleLeft, ToggleRight,
  AlertTriangle, TrendingUp, TrendingDown, Sparkles, GitFork, Clock, Check,
  X, Zap, Eye, ArrowLeftRight, Hammer, ListChecks, MessageSquareText,
} from "lucide-react";
import { api, post, patch, del } from "../lib/api";
import { useSession } from "../App";
import { Badge, EmptyState, Spinner, Field, StatCard } from "../components/ui";
import { dateTime, timeAgo } from "../lib/format";

// ── Types ───────────────────────────────────────────────────────────────────
type Overview = {
  insights: { total: number; open: number; byCategory: Record<string, number>; bySeverity: Record<string, number> };
  radar: { signals: number; byKind: Record<string, number> };
  memory: number; orchestrators: number; snapshots: number; simulations: number; retentionDays: number;
};
type Insight = {
  id: string; category: string; severity: string; title: string; summary: string | null;
  source: string; entity: string | null; entityId: string | null; recommendation: string | null;
  status: string; createdAt: string;
};
type XrayResult = {
  deal: { id: string; name: string; stage: string; amount: number; probability: number };
  score: number; confidence: number; flags: string[]; recommendation: string;
  factors: { key: string; label: string; weight: number; value: number; inputs: Record<string, unknown> }[];
  coverage: { pct: number; roles: { name: string; role: string; influence: number }[]; gaps: string[] };
};
type Detective = { deal: { name: string; stage: string }; verdict: string; totalDays: number; summary: string; factors: { kind: string; label: string; detail: string }[]; timeline: { type: string; note: string; at: string }[]; stages: { stage: string; days: number }[] };
type RadarSignal = { kind: "opportunity" | "risk"; signalType: string; targetType: string; targetId: string; title: string; detail: string; severity: string; estimatedValue: number | null };
type MemoryEntry = { id: string; scope: string; scopeId: string | null; kind: string; content: string; sourceEvent: string | null; confidence: number; createdAt: string };
type Orchestrator = { id: string; name: string; description: string | null; trigger: { kind: string; event: string | null }; childAgentIds: string[]; mode: string; active: boolean; runCount: number; createdAt: string };
type Snapshot = { id: string; scope: string; entity: string | null; entityId: string | null; snapshotAt: string; retentionUntil: string | null; createdAt: string };
type Simulation = { id: string; name: string; scenario: string; params: Record<string, number>; results: Record<string, unknown>; summary: string | null; status: string; createdAt: string };
type BuildResult = { entityType: string; entity: string; entityId: string; explanation: string; riskTier: string };
type UbqResult = { question: string; intent: Record<string, unknown>; answer: string; data: { key: string; value: number; count: number }[]; total: number };
type CommandResult = { intent: string; tier: string; executed: boolean; explanation: string; result: Record<string, unknown> };

const CATEGORY_TONE: Record<string, "green" | "rose" | "amber" | "blue" | "default"> = {
  opportunity: "green", risk: "rose", anomaly: "amber", recommendation: "blue",
};
const SEVERITY_TONE: Record<string, "rose" | "amber" | "blue" | "default"> = {
  critical: "rose", high: "rose", medium: "amber", low: "blue", info: "default",
};
const TIER_LABEL: Record<string, string> = { green: "🟢 auto", yellow: "🟡 approval", red: "🔴 human" };

const TABS = [
  ["overview", "Brain", Brain],
  ["graph", "Graph v2", Waypoints],
  ["xray", "X-Ray", ScanSearch],
  ["radar", "Radar", Radar],
  ["memory", "Memory", Database],
  ["orchestrators", "Orchestration", GitFork],
  ["timemachine", "Time machine", Timer],
  ["simulator", "Simulator", FlaskConical],
  ["builder", "Builder", Wand2],
  ["ubq", "Query", Search],
  ["command", "Console", Mic],
] as const;

export default function BrainPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("overview");
  const isAdmin = user?.role === "admin";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Brain className="size-4 text-teal-400" /> Brain &amp; differentiators
            <span className="chip bg-teal-500/15 text-teal-300">Business Brain · X-Ray · Radar · Time Machine · Simulator</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            The Phase 15 “1-of-1” layer: the org-wide Business Brain (opportunities / risks / anomalies / recommendations with evidence), the buying-committee graph v2, Deal X-Ray + the AI Deal Detective, the Opportunity Radar early-warning feed, organizational memory, multi-agent orchestration, the CRM Time Machine, the What-If simulator, AI-built generators, Universal Business Query, and the voice / computer-use console.
          </p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06]">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === key ? "border-accent-400 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab isAdmin={isAdmin} />}
      {tab === "graph" && <GraphTab />}
      {tab === "xray" && <XrayTab />}
      {tab === "radar" && <RadarTab isAdmin={isAdmin} />}
      {tab === "memory" && <MemoryTab />}
      {tab === "orchestrators" && <OrchestratorsTab isAdmin={isAdmin} />}
      {tab === "timemachine" && <TimeMachineTab isAdmin={isAdmin} />}
      {tab === "simulator" && <SimulatorTab isAdmin={isAdmin} />}
      {tab === "builder" && <BuilderTab isAdmin={isAdmin} />}
      {tab === "ubq" && <UbqTab />}
      {tab === "command" && <CommandTab />}
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={`flex items-center gap-1.5 font-medium ${ok === undefined ? "text-slate-300" : ok ? "text-mint-400" : "text-slate-300"}`}>
        {ok !== undefined && <span className={`size-1.5 rounded-full ${ok ? "bg-mint-400" : "bg-slate-600"}`} />}
        {value}
      </span>
    </div>
  );
}

function Err({ e }: { e: string }) {
  return <p className="mt-2 text-xs text-rose-400">{e}</p>;
}

async function loadList<T>(path: string, setter: (v: T[]) => void) {
  try {
    const d: any = await api(`/api${path}`);
    setter((d.items ?? d.data?.items ?? []) as T[]);
  } catch {
    /* ignore */
  }
}

// ── Overview ────────────────────────────────────────────────────────────────
function OverviewTab({ isAdmin }: { isAdmin: boolean }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState("");
  const load = () => {
    void api<any>("/api/brain/overview").then((d) => setOv(d.data ?? d)).catch(() => {});
    void loadList<Insight>("/brain/insights", setInsights);
  };
  useEffect(load, []);
  const scan = async () => {
    setScanning(true); setErr("");
    try {
      const r: any = await post("/api/brain/refresh");
      setErr(`Scan complete: ${r.created} new insight(s), ${r.updated} refreshed, ${r.pruned} pruned (${r.total} total).`);
    } catch (e: any) {
      setErr(e?.message ?? "Scan failed");
    } finally {
      setScanning(false);
      load();
    }
  };
  const act = async (id: string, action: "acknowledge" | "dismiss" | "action") => {
    await post(`/api/brain/insights/${id}/${action}`);
    load();
  };
  if (!ov) return <Spinner className="py-16" />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open insights" value={ov.insights.open} sub={`${ov.insights.total} total across ${Object.keys(ov.insights.byCategory).length} categories`} tone={ov.insights.open ? "amber" : "green"} />
        <StatCard label="Radar signals" value={ov.radar.signals} sub={`${ov.radar.byKind.risk ?? 0} risk · ${ov.radar.byKind.opportunity ?? 0} opportunity`} tone={ov.radar.byKind.risk ? "amber" : "green"} />
        <StatCard label="Memory entries" value={ov.memory} sub={`${ov.orchestrators} orchestrator(s)`} tone="teal" />
        <StatCard label="Snapshots" value={ov.snapshots} sub={`${ov.simulations} simulation(s) · ${ov.retentionDays}d retention`} tone="blue" />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Insight ledger</p>
        {isAdmin && (
          <button className="btn-primary px-3 py-1.5 text-xs" onClick={scan} disabled={scanning}>
            <RefreshCw className={`size-3.5 ${scanning ? "animate-spin" : ""}`} /> {scanning ? "Scanning…" : "Run brain scan"}
          </button>
        )}
      </div>
      {err && <p className="text-xs text-slate-400">{err}</p>}
      {insights.length === 0 ? (
        <EmptyState icon={<Brain className="size-8" />} title="No insights yet" hint="Run a brain scan to synthesize opportunities, risks, anomalies and recommendations across every module." />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          {insights.slice(0, 14).map((i) => (
            <div key={i.id} className="rounded-lg border border-white/[0.06] bg-ink-900/50 p-3.5">
              <div className="flex items-start gap-2.5">
                {i.category === "risk" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-400" /> : i.category === "opportunity" ? <TrendingUp className="mt-0.5 size-4 shrink-0 text-mint-400" /> : i.category === "anomaly" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" /> : <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-300" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-white">{i.title}</span>
                    <Badge tone={CATEGORY_TONE[i.category] ?? "default"}>{i.category}</Badge>
                    <Badge tone={SEVERITY_TONE[i.severity] ?? "default"}>{i.severity}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{i.summary}</p>
                  {i.recommendation && <p className="mt-1 text-xs text-slate-400"><span className="text-slate-500">→ </span>{i.recommendation}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                    <span>source: {i.source}</span>
                    <span>· {timeAgo(i.createdAt)}</span>
                    <span className="flex-1" />
                    <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => act(i.id, "acknowledge")}>Ack</button>
                    <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => act(i.id, "action")}>Actioned</button>
                    <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => act(i.id, "dismiss")}>Dismiss</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Relationship Graph v2 ───────────────────────────────────────────────────
function GraphTab() {
  const [deals, setDeals] = useState<any[]>([]);
  const [dealId, setDealId] = useState("");
  const [g, setG] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    void loadList<any>("/opportunities?limit=100", (v) => { setDeals(v); if (v.length) setDealId(v[0].id); });
  }, []);
  const load = async () => {
    if (!dealId) return;
    try { setG(await api<any>(`/api/brain/graph?dealId=${encodeURIComponent(dealId)}`)); setErr(""); }
    catch (e: any) { setErr(e?.message ?? "Failed to load graph"); }
  };
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Buying committee · deal</p>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-72" value={dealId} onChange={(e) => setDealId(e.target.value)} aria-label="Deal">
            {deals.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.stage}</option>)}
          </select>
          <button className="btn-primary px-3 py-1.5 text-xs" onClick={load}><Eye className="size-3.5" /> Map committee</button>
        </div>
        {err && <Err e={err} />}
      </div>
      {g && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={g.coverage >= 75 ? "green" : g.coverage >= 50 ? "amber" : "rose"}>Committee coverage {g.coverage}%</Badge>
            {g.gaps.map((gap: string) => <Badge key={gap} tone="amber">missing: {gap}</Badge>)}
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {g.committee.map((m: any) => (
              <div key={m.contact.id} className="rounded-lg border border-white/[0.06] bg-ink-900/50 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{m.name}</p>
                    <p className="truncate text-xs text-slate-500">{m.contact.title ?? "—"}</p>
                  </div>
                  <Badge tone={m.role === "champion" ? "green" : m.role === "blocker" ? "rose" : m.role === "economic_buyer" ? "blue" : "default"}>{m.role}</Badge>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-ink-700">
                    <div className="h-1.5 rounded-full bg-accent-400" style={{ width: `${m.influence}%` }} />
                  </div>
                  <span className="text-xs font-medium text-slate-400">{m.influence}</span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-600">influence · {m.touches.length} touch class(es){m.primary ? " · primary" : ""}{m.openTickets ? ` · ${m.openTickets} open ticket(s)` : ""}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Deal X-Ray + Detective ──────────────────────────────────────────────────
function XrayTab() {
  const [deals, setDeals] = useState<any[]>([]);
  const [dealId, setDealId] = useState("");
  const [x, setX] = useState<XrayResult | null>(null);
  const [det, setDet] = useState<Detective | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    void loadList<any>("/opportunities?limit=100", (v) => { setDeals(v); if (v.length) setDealId(v[0].id); });
  }, []);
  const load = async () => {
    if (!dealId) return;
    setErr(""); setX(null); setDet(null);
    try { setX(await api<XrayResult>(`/api/brain/xray/${dealId}`)); } catch (e: any) { setErr(e?.message ?? "X-Ray failed"); }
  };
  const detective = async () => {
    if (!dealId) return;
    try { setDet(await api<Detective>(`/api/brain/detective/${dealId}`)); setErr(""); } catch (e: any) { setErr(e?.message ?? "Detective failed"); }
  };
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-72" value={dealId} onChange={(e) => setDealId(e.target.value)} aria-label="Deal">
            {deals.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.stage}</option>)}
          </select>
          <button className="btn-primary px-3 py-1.5 text-xs" onClick={load}><ScanSearch className="size-3.5" /> Deal X-Ray</button>
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={detective}><Hammer className="size-3.5" /> AI Deal Detective</button>
        </div>
        {err && <Err e={err} />}
      </div>
      {x && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Deal X-Ray</p>
              <Badge tone={x.score >= 75 ? "green" : x.score >= 55 ? "amber" : "rose"}>{x.score}/100 health</Badge>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-2 flex-1 rounded-full bg-ink-700">
                <div className={`h-2 rounded-full ${x.score >= 75 ? "bg-mint-400" : x.score >= 55 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${x.score}%` }} />
              </div>
              <span className="text-sm font-semibold text-white">{x.confidence}% conf</span>
            </div>
            <div className="mt-3 space-y-2">
              {x.factors.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-500">{f.label}</span>
                  <span className="font-medium text-slate-300">{f.value}/100 × {Math.round(f.weight * 100)}%</span>
                </div>
              ))}
            </div>
            {x.flags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {x.flags.map((f) => <Badge key={f} tone="rose">{f}</Badge>)}
              </div>
            )}
            <p className="mt-3 text-xs text-slate-400">→ {x.recommendation}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Committee coverage</p>
            <p className="mt-1 text-sm text-slate-400">{x.coverage.pct}% of expected buying-committee roles filled</p>
            <div className="mt-2 space-y-1.5">
              {x.coverage.roles.map((r) => (
                <div key={r.name} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{r.name}</span>
                  <Badge tone={r.role === "champion" ? "green" : r.role === "blocker" ? "rose" : "default"}>{r.role} · {r.influence}</Badge>
                </div>
              ))}
              {x.coverage.roles.length === 0 && <p className="text-xs text-slate-600">No contacts mapped to this deal's account yet.</p>}
            </div>
            {x.coverage.gaps.length > 0 && <p className="mt-2 text-xs text-amber-400">Gaps: {x.coverage.gaps.join(", ")}</p>}
          </div>
        </div>
      )}
      {det && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">AI Deal Detective · {det.verdict} · {det.totalDays}d</p>
            <Badge tone={det.verdict === "won" ? "green" : det.verdict === "lost" ? "rose" : "amber"}>{det.verdict}</Badge>
          </div>
          <p className="mt-2 text-sm text-slate-300">{det.summary}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {det.factors.map((f, i) => (
              <div key={i} className="rounded-lg border border-white/[0.06] bg-ink-900/50 p-2.5 text-xs">
                <span className="font-medium text-slate-300">{f.label}: </span>
                <span className="text-slate-500">{f.detail}</span>
              </div>
            ))}
          </div>
          {det.stages.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {det.stages.map((s) => <Badge key={s.stage} tone="default">{s.stage}: {s.days}d</Badge>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Opportunity Radar ───────────────────────────────────────────────────────
function RadarTab({ isAdmin }: { isAdmin: boolean }) {
  const [signals, setSignals] = useState<RadarSignal[]>([]);
  const [emitted, setEmitted] = useState(0);
  const [err, setErr] = useState("");
  const load = () => {
    void api<any>("/api/brain/radar").then((d) => { setSignals((d.data ?? d).signals ?? []); setEmitted((d.data ?? d).emitted ?? 0); }).catch(() => {});
  };
  useEffect(load, []);
  const scan = async () => {
    setErr("");
    try {
      const r: any = await post("/api/brain/radar/scan");
      setErr(`Scan complete — ${r.emitted} new signal event(s) emitted.`);
    } catch (e: any) { setErr(e?.message ?? "Scan failed"); }
    load();
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Early-warning feed · {signals.length} signal(s)</p>
        {isAdmin && <button className="btn-primary px-3 py-1.5 text-xs" onClick={scan}><Radar className="size-3.5" /> Run scan</button>}
      </div>
      {err && <p className="text-xs text-slate-400">{err}</p>}
      {signals.length === 0 ? (
        <EmptyState icon={<Radar className="size-8" />} title="No signals" hint="Upsell / cross-sell / expansion opportunities, churn risks, weak deals and SLA breaches will appear here." />
      ) : (
        <div className="space-y-2">
          {signals.map((s, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-ink-900/50 px-3 py-2.5">
              {s.kind === "risk" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-400" /> : <TrendingUp className="mt-0.5 size-4 shrink-0 text-mint-400" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-white">{s.title}</span>
                  <Badge tone={s.kind === "risk" ? "rose" : "green"}>{s.kind}</Badge>
                  <Badge tone={SEVERITY_TONE[s.severity] ?? "default"}>{s.severity}</Badge>
                  <Badge tone="default">{s.signalType}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{s.detail}</p>
              </div>
              {s.estimatedValue != null && <span className="shrink-0 text-sm font-semibold text-mint-400">${Math.round(s.estimatedValue).toLocaleString()}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Organizational memory ───────────────────────────────────────────────────
function MemoryTab() {
  const [items, setItems] = useState<MemoryEntry[]>([]);
  const [scope, setScope] = useState("org"); const [kind, setKind] = useState("fact"); const [content, setContent] = useState("");
  const [err, setErr] = useState("");
  const load = () => void loadList<MemoryEntry>("/brain/memory", setItems);
  useEffect(load, []);
  const add = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    if (!content.trim()) return;
    try { await post("/api/brain/memory", { scope, kind, content }); setContent(""); load(); }
    catch (err2: any) { setErr(err2?.message ?? "Failed to record memory"); }
  };
  const forget = async (id: string) => { await del(`/api/brain/memory/${id}`); load(); };
  return (
    <div className="space-y-4">
      <form className="card flex flex-wrap items-end gap-2 p-4" onSubmit={add}>
        <Field label="Scope">
          <select className="input w-36" value={scope} onChange={(e) => setScope(e.target.value)}>
            {["org", "account", "contact", "opportunity", "lead", "ticket"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Kind">
          <select className="input w-36" value={kind} onChange={(e) => setKind(e.target.value)}>
            {["fact", "observation", "insight"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Memory">
          <input className="input w-96" value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. Prefers email — replies quickly" />
        </Field>
        <button className="btn-primary px-3 py-1.5 text-xs"><Plus className="size-3.5" /> Record</button>
        {err && <Err e={err} />}
      </form>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">What the org remembers · {items.length} entr{items.length === 1 ? "y" : "ies"}</p>
      {items.length === 0 ? (
        <EmptyState icon={<Database className="size-8" />} title="No memory yet" hint="The memory engine learns facts from the event bus (email replies, meetings, contracts) — or add one above." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => (
            <div key={m.id} className="rounded-lg border border-white/[0.06] bg-ink-900/50 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <Badge tone={m.kind === "fact" ? "green" : m.kind === "observation" ? "blue" : "teal"}>{m.kind} · {m.scope}</Badge>
                <button className="btn-ghost px-1.5 py-0.5 text-[11px] text-slate-500" onClick={() => forget(m.id)} aria-label="Forget"><Trash2 className="size-3" /></button>
              </div>
              <p className="mt-2 text-sm text-slate-300">{m.content}</p>
              <p className="mt-2 text-[11px] text-slate-600">{m.sourceEvent ? `learned from ${m.sourceEvent}` : "manual"} · conf {m.confidence}% · {timeAgo(m.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Multi-agent orchestration ───────────────────────────────────────────────
function OrchestratorsTab({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<Orchestrator[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [name, setName] = useState(""); const [event, setEvent] = useState("lead.created"); const [mode, setMode] = useState("sequential");
  const [childIds, setChildIds] = useState<string[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [delegations, setDelegations] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const load = () => { void loadList<Orchestrator>("/brain/orchestrators", setItems); void loadList<any>("/agents?limit=50", setAgents); };
  useEffect(load, []);
  const create = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    try { await post("/api/brain/orchestrators", { name, trigger: { kind: "event", event }, childAgentIds: childIds, mode }); setName(""); load(); }
    catch (err2: any) { setErr(err2?.message ?? "Failed to create orchestrator"); }
  };
  const run = async (id: string, entity: string, entityId: string) => {
    setErr("");
    try {
      const r: any = await post(`/api/brain/orchestrators/${id}/run`, { entity, entityId });
      setRuns((prev) => [{ orchestratorId: id, ...r }, ...prev].slice(0, 10));
      const d: any = await api(`/api/brain/orchestrators/${id}/delegations`);
      setDelegations(d.items ?? []);
    } catch (e: any) { setErr(e?.message ?? "Run failed"); }
  };
  return (
    <div className="space-y-4">
      {isAdmin && (
        <form className="card flex flex-wrap items-end gap-2 p-4" onSubmit={create}>
          <Field label="Name">
            <input className="input w-56" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lead intake → qualification" required />
          </Field>
          <Field label="Event trigger">
            <select className="input w-52" value={event} onChange={(e) => setEvent(e.target.value)}>
              {["lead.created", "deal.stage_changed", "ticket.created", "contact.created", "form.submitted"].map((ev) => <option key={ev} value={ev}>{ev}</option>)}
            </select>
          </Field>
          <Field label="Mode">
            <select className="input w-36" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="sequential">sequential</option>
              <option value="parallel">parallel</option>
            </select>
          </Field>
          <Field label="Child agents">
            <select className="input w-56" value={childIds.length ? childIds[childIds.length - 1] : ""} onChange={(e) => { const v = e.target.value; if (v && !childIds.includes(v)) setChildIds([...childIds, v]); }}>
              <option value="">+ add agent…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          {childIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pb-1">
              {childIds.map((id) => {
                const a = agents.find((x) => x.id === id);
                return <Badge key={id} tone="teal">{a?.name ?? id} <button className="ml-1 text-slate-400 hover:text-white" onClick={() => setChildIds(childIds.filter((x) => x !== id))} aria-label="Remove">×</button></Badge>;
              })}
            </div>
          )}
          <button className="btn-primary px-3 py-1.5 text-xs"><Plus className="size-3.5" /> Create</button>
          {err && <Err e={err} />}
        </form>
      )}
      {items.length === 0 ? (
        <EmptyState icon={<GitFork className="size-8" />} title="No orchestrators" hint="Orchestrators fan an event out to child Phase 9 agents (parallel or sequential), with a parent → child run chain." />
      ) : (
        <div className="space-y-2">
          {items.map((o) => (
            <div key={o.id} className="rounded-lg border border-white/[0.06] bg-ink-900/50 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">{o.name}</span>
                <Badge tone="teal">{o.mode}</Badge>
                <Badge tone="default">{o.trigger.kind === "event" ? o.trigger.event : "manual"}</Badge>
                <Badge tone={o.active ? "green" : "default"}>{o.active ? "active" : "paused"}</Badge>
                <span className="text-xs text-slate-600">· {o.runCount} run(s) · {o.childAgentIds.length} child agent(s)</span>
                <span className="flex-1" />
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => run(o.id, "lead", "")}>Manual run</button>
              </div>
              {o.description && <p className="mt-1 text-xs text-slate-500">{o.description}</p>}
              {runs.filter((r) => r.orchestratorId === o.id).map((r, i) => (
                <p key={i} className="mt-1.5 text-xs text-slate-400">Last run: {r.total} child agent(s), {r.failed} failed, {r.delegations.length} delegation(s)</p>
              ))}
            </div>
          ))}
          {delegations.length > 0 && (
            <div className="card p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Recent delegations</p>
              <div className="space-y-1.5 text-xs">
                {delegations.slice(0, 10).map((d) => (
                  <div key={d.id} className="flex items-center gap-2">
                    <GitFork className="size-3 text-slate-500" />
                    <span className="text-slate-300">agent → child run {d.childRunId ? "delegated" : d.status}</span>
                    <Badge tone={d.status === "delegated" ? "green" : d.status === "skipped" ? "amber" : "rose"}>{d.status}</Badge>
                    <span className="flex-1" />
                    <span className="text-slate-600">{timeAgo(d.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── CRM Time Machine ────────────────────────────────────────────────────────
function TimeMachineTab({ isAdmin }: { isAdmin: boolean }) {
  const [entity, setEntity] = useState("opportunity"); const [id, setId] = useState("");
  const [asOf, setAsOf] = useState(""); const [recon, setRecon] = useState<any>(null);
  const [compare, setCompare] = useState<any>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [err, setErr] = useState("");
  const load = () => void loadList<Snapshot>("/brain/timemachine/snapshots", setSnaps);
  useEffect(load, []);
  const reconstruct = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setRecon(null);
    const asOfIso = asOf ? new Date(asOf).toISOString() : new Date().toISOString();
    try { setRecon(await api<any>(`/api/brain/timemachine/reconstruct?entity=${entity}&id=${encodeURIComponent(id)}&asOf=${encodeURIComponent(asOfIso)}`)); }
    catch (err2: any) { setErr(err2?.message ?? "Reconstruction failed"); }
  };
  const doCompare = async () => {
    setErr("");
    const from = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const to = new Date().toISOString();
    try { setCompare(await api<any>(`/api/brain/timemachine/compare?entity=${entity}&id=${encodeURIComponent(id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)); }
    catch (err2: any) { setErr(err2?.message ?? "Compare failed"); }
  };
  const snapshot = async (scope: "full" | "record") => {
    setErr("");
    try { await post("/api/brain/timemachine/snapshot", { scope, entity: scope === "record" ? entity : null, entityId: scope === "record" ? id : null }); load(); }
    catch (err2: any) { setErr(err2?.message ?? "Snapshot failed"); }
  };
  return (
    <div className="space-y-4">
      <form className="card flex flex-wrap items-end gap-2 p-4" onSubmit={reconstruct}>
        <Field label="Entity">
          <select className="input w-36" value={entity} onChange={(e) => setEntity(e.target.value)}>
            {["opportunity", "contact", "account", "lead", "ticket", "task"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Record id">
          <input className="input w-56" value={id} onChange={(e) => setId(e.target.value)} placeholder="paste a record id" required />
        </Field>
        <Field label="As of (optional)">
          <input type="datetime-local" className="input w-52" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
        <button className="btn-primary px-3 py-1.5 text-xs"><Clock className="size-3.5" /> Reconstruct</button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={doCompare}><ArrowLeftRight className="size-3.5" /> Diff (2h ago → now)</button>
        {isAdmin && (
          <>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => snapshot("record")}><CameraIcon /> Snapshot record</button>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => snapshot("full")}><CameraIcon /> Snapshot org</button>
          </>
        )}
        {err && <Err e={err} />}
      </form>
      {recon && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Reconstructed state · {recon.entity} · {dateTime(recon.at)}</p>
            {recon.deleted && <Badge tone="rose">deleted as of {dateTime(recon.deletedAt)}</Badge>}
          </div>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-ink-950/60 p-3 text-xs text-slate-300">{JSON.stringify(recon.state ?? {}, null, 2)}</pre>
        </div>
      )}
      {compare && (
        <div className="card p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">What changed in the last 2 hours</p>
          {Object.keys(compare.diff.changed).length === 0 && <p className="text-xs text-slate-500">No fields changed.</p>}
          <div className="space-y-1.5 text-xs">
            {Object.entries(compare.diff.changed as Record<string, { from: unknown; to: unknown }>).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <Badge tone="blue">{k}</Badge>
                <span className="text-slate-600 line-through">{String(v.from)}</span>
                <span className="text-slate-400">→</span>
                <span className="text-mint-400">{String(v.to)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Snapshots · {snaps.length}</p>
        {snaps.length === 0 ? <EmptyState icon={<Timer className="size-8" />} title="No snapshots" hint="Capture a point-in-time snapshot of a record or the whole org (retention-pruned)." /> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {snaps.map((s) => (
              <div key={s.id} className="rounded-lg border border-white/[0.06] bg-ink-900/50 p-3">
                <div className="flex items-center gap-2">
                  <Badge tone={s.scope === "full" ? "teal" : "blue"}>{s.scope}</Badge>
                  {s.entity && <span className="text-xs text-slate-400">{s.entity}</span>}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">Captured {timeAgo(s.snapshotAt)} · retention until {s.retentionUntil ? dateTime(s.retentionUntil) : "—"}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CameraIcon() {
  return <span className="text-xs">📸</span>;
}

// ── What-If simulator ───────────────────────────────────────────────────────
function SimulatorTab({ isAdmin }: { isAdmin: boolean }) {
  const [models, setModels] = useState<any[]>([]);
  const [scenario, setScenario] = useState("pricing");
  const [params, setParams] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<Simulation[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    void api<any>("/api/brain/simulate/models").then((d) => { const m = (d.data ?? d).models ?? []; setModels(m); if (m.length) { setScenario(m[0].key); const p: Record<string, number> = {}; m[0].params.forEach((x: any) => { p[x.key] = x.default; }); setParams(p); } }).catch(() => {});
    void loadList<Simulation>("/brain/simulations", setHistory);
  }, []);
  const pickModel = (key: string) => {
    setScenario(key);
    const m = models.find((x) => x.key === key);
    const p: Record<string, number> = {};
    (m?.params ?? []).forEach((x: any) => { p[x.key] = x.default; });
    setParams(p);
    setResult(null);
  };
  const run = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    try { setResult(await post("/api/brain/simulate", { name: name || `${scenario} simulation`, scenario, params })); void loadList<Simulation>("/brain/simulations", setHistory); }
    catch (err2: any) { setErr(err2?.message ?? "Simulation failed"); }
  };
  const model = models.find((m) => m.key === scenario);
  const metrics: Record<string, unknown> = (result?.results ?? result?.metrics) ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Scenario</p>
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <button key={m.key} onClick={() => pickModel(m.key)} className={`chip ${scenario === m.key ? "bg-teal-500/20 text-teal-300" : "bg-white/[0.04] text-slate-400 hover:text-slate-200"}`}>{m.label}</button>
            ))}
          </div>
          {model && <p className="mt-2 text-xs text-slate-500">{model.description}</p>}
          <form className="mt-3 space-y-3" onSubmit={run}>
            {model?.params?.map((p: any) => (
              <Field key={p.key} label={`${p.label} (${p.unit})`}>
                <input type="number" min={p.min} max={p.max} step="any" className="input w-40" value={params[p.key] ?? p.default} onChange={(e) => setParams({ ...params, [p.key]: Number(e.target.value) })} />
              </Field>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && <button className="btn-primary px-3 py-1.5 text-xs" type="submit"><Play className="size-3.5" /> Run simulation</button>}
              <input className="input w-64" value={name} onChange={(e) => setName(e.target.value)} placeholder="Run name (optional)" aria-label="Simulation name" />
            </div>
            {err && <Err e={err} />}
          </form>
          {model && (
            <div className="mt-3 rounded-lg bg-ink-950/50 p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">Assumptions</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-slate-500">
                {model.assumptions.map((a: string, i: number) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </div>
        <div className="card p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Result</p>
          {!result ? <EmptyState icon={<FlaskConical className="size-8" />} title="Nothing simulated yet" hint="Pick a scenario, set parameters, and run it against real org data." /> : (
            <div>
              <p className="text-sm text-slate-300">{result.summary}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {Object.entries(metrics).filter(([k]) => typeof metrics[k] !== "object").map(([k, v]) => (
                  <Row key={k} label={k} value={String(v)} />
                ))}
              </div>
              {Array.isArray(metrics.projected) && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">Projected MRR</p>
                  <div className="mt-1.5 flex h-16 items-end gap-0.5">
                    {(metrics.projected as number[]).slice(0, 24).map((v, i) => (
                      <div key={i} className="flex-1 rounded-t bg-teal-500/50" style={{ height: `${Math.max(4, (v / Math.max(1, Math.max(...(metrics.projected as number[])))) * 100)}%` }} title={`${v}`} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Run history · {history.length}</p>
        {history.length === 0 ? <p className="text-xs text-slate-600">No runs yet.</p> : (
          <div className="space-y-1.5 text-xs">
            {history.slice(0, 12).map((h) => (
              <div key={h.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-ink-900/50 px-3 py-2">
                <Badge tone={h.status === "completed" ? "green" : "rose"}>{h.scenario}</Badge>
                <span className="text-slate-300">{h.name}</span>
                <span className="flex-1" />
                {h.summary && <span className="max-w-md truncate text-slate-500">{h.summary}</span>}
                <span className="text-slate-600">{timeAgo(h.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── AI-built generators ─────────────────────────────────────────────────────
function BuilderTab({ isAdmin }: { isAdmin: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<BuildResult | null>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { void loadList<any>("/brain/builder/catalog", setCatalog); }, []);
  const build = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setResult(null);
    try { setResult(await post("/api/brain/builder", { prompt })); }
    catch (err2: any) { setErr(err2?.message ?? "Build failed"); }
  };
  return (
    <div className="space-y-4">
      <form className="card p-4" onSubmit={build}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Natural language → working configuration</p>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-72 flex-1" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder='e.g. "When a deal is won, notify the owner and create a task to send the contract"' />
          {isAdmin && <button className="btn-primary px-3 py-1.5 text-xs" type="submit"><Wand2 className="size-3.5" /> Build</button>}
        </div>
        {err && <Err e={err} />}
        {result && (
          <div className="mt-3 rounded-lg border border-mint-400/20 bg-mint-400/[0.06] p-3">
            <div className="flex items-center gap-2">
              <Badge tone="green">{result.entityType}</Badge>
              <Badge tone="default">{TIER_LABEL[result.riskTier]}</Badge>
              <span className="text-xs text-slate-400">{result.entity} · {result.entityId.slice(0, 8)}…</span>
            </div>
            <p className="mt-2 text-sm text-slate-300">{result.explanation}</p>
          </div>
        )}
      </form>
      <div className="grid gap-2 sm:grid-cols-2">
        {catalog.map((c) => (
          <div key={c.entityType} className="rounded-lg border border-white/[0.06] bg-ink-900/50 p-3.5">
            <p className="text-sm font-medium text-white">{c.entityType}</p>
            <p className="mt-1 text-xs text-slate-500">{c.description}</p>
            <p className="mt-2 text-[11px] text-slate-600">e.g. “{c.examples?.[0]}”</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Universal Business Query ────────────────────────────────────────────────
function UbqTab() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<UbqResult | null>(null);
  const [examples, setExamples] = useState<string[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { void api<any>("/api/brain/ubq").then((d) => setExamples((d.data ?? d).examples ?? [])).catch(() => {}); }, []);
  const ask = async (query?: string) => {
    const text = query ?? q;
    if (!text.trim()) return;
    setErr("");
    try { setResult(await api<UbqResult>(`/api/brain/ubq?q=${encodeURIComponent(text)}`)); }
    catch (err2: any) { setErr(err2?.message ?? "Query failed"); }
  };
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Ask anything across the CRM</p>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-72 flex-1" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void ask(); }} placeholder='e.g. "total pipeline by owner"' aria-label="Business question" />
          <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => ask()}><Search className="size-3.5" /> Ask</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {examples.map((ex) => (
            <button key={ex} className="chip bg-white/[0.04] text-slate-400 hover:text-slate-200" onClick={() => { setQ(ex); void ask(ex); }}>{ex}</button>
          ))}
        </div>
        {err && <Err e={err} />}
      </div>
      {result && (
        <div className="card p-4">
          <p className="text-sm font-medium text-white">{result.answer}</p>
          {result.data.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-xs uppercase tracking-widest text-slate-500">
                    <th className="py-2 pr-4">Key</th>
                    <th className="py-2 pr-4">Value</th>
                    <th className="py-2">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((r) => (
                    <tr key={r.key} className="border-b border-white/[0.04]">
                      <td className="py-2 pr-4 text-slate-300">{r.key}</td>
                      <td className="py-2 pr-4 font-medium text-mint-400">{typeof r.value === "number" && r.value > 0 && result.intent.metric === "sum" ? `$${r.value.toLocaleString()}` : r.value}</td>
                      <td className="py-2 text-slate-500">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-600">intent: {JSON.stringify(result.intent)}</p>
        </div>
      )}
    </div>
  );
}

// ── Voice & computer-use console ────────────────────────────────────────────
function CommandTab() {
  const [text, setText] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { void loadList<any>("/brain/command/catalog", setCatalog); }, []);
  const send = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setResult(null);
    try { setResult(await post("/api/brain/command", { text })); }
    catch (err2: any) { setErr(err2?.message ?? "Command failed"); }
  };
  const act = async (element: string) => {
    setErr(""); setResult(null);
    try { setResult(await post("/api/brain/command", { action: { element, action: "click", params: {} } })); }
    catch (err2: any) { setErr(err2?.message ?? "Action failed"); }
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <form className="card p-4" onSubmit={send}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Voice / typed command</p>
          <div className="flex flex-wrap gap-2">
            <input className="input min-w-64 flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder='e.g. "Create a task for the Northwind deal to send the proposal"' aria-label="Command text" />
            <button className="btn-primary px-3 py-1.5 text-xs" type="submit"><Mic className="size-3.5" /> Run</button>
          </div>
          {err && <Err e={err} />}
        </form>
        <div className="card p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Computer-use agent (simulated)</p>
          <div className="flex flex-wrap gap-1.5">
            {["deals-board", "new-task", "compose-email", "deal-card", "delete-record"].map((el) => (
              <button key={el} className="chip bg-white/[0.04] text-slate-400 hover:text-slate-200" onClick={() => { setAction(el); void act(el); }}>{el}</button>
            ))}
          </div>
          {action && <p className="mt-2 text-[11px] text-slate-600">clicked &lt;{action}&gt;</p>}
        </div>
      </div>
      {result && (
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={result.tier === "green" ? "green" : result.tier === "yellow" ? "amber" : "rose"}>{TIER_LABEL[result.tier]}</Badge>
            <Badge tone="default">{result.intent}</Badge>
            <Badge tone={result.executed ? "green" : "default"}>{result.executed ? "executed" : "proposed"}</Badge>
          </div>
          <p className="mt-2 text-sm text-slate-300">{result.explanation}</p>
          {result.result && Object.keys(result.result).length > 0 && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-ink-950/60 p-3 text-xs text-slate-400">{JSON.stringify(result.result, null, 2)}</pre>
          )}
        </div>
      )}
      <div className="card p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">What the console can do</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.map((c) => (
            <div key={c.key} className="rounded-lg border border-white/[0.06] bg-ink-900/50 p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{c.label}</span>
                <Badge tone={c.tier === "green" ? "green" : c.tier === "yellow" ? "amber" : "rose"}>{TIER_LABEL[c.tier]}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">{c.description}</p>
              <p className="mt-1.5 text-[11px] text-slate-600">“{c.examples?.[0]}”</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
