import { useEffect, useMemo, useState } from "react";
import { api, get, post } from "../lib/api";
import { Badge, EmptyState, Spinner, StatCard } from "../components/ui";
import { money } from "../lib/format";
import { BarChart3, TrendingUp, AlertTriangle, Info, RefreshCw, Sparkles, PieChart } from "lucide-react";
import { ChartCard, Donut, HBarRow, colorFor, type Segment } from "../components/charts";

type Metric = { key: string; label: string; value: number | string | null; format: string; sources: { entity: string; query: string; note: string }[] };
type MetricGroup = { kind: string; label: string; metrics: Metric[] };
type ForecastBuckets = { pipeline: number; weighted: number; commit: number; bestCase: number };
type Forecast = { live: { buckets: ForecastBuckets; stages: { stage: string; probability: number; count: number; amount: number; weighted: number }[]; byOwner: { ownerId: string; ownerName: string; pipeline: number; weighted: number; commit: number; bestCase: number }[]; dealCount: number }; snapshots: { id: string; buckets: ForecastBuckets; createdAt: string }[] };
type Prediction = { dealId?: string; contactId?: string; name: string; score: number; value?: number; inputs: Record<string, string>; stage?: string };

const KINDS = [
  { key: "sales", label: "Sales" },
  { key: "marketing", label: "Marketing" },
  { key: "service", label: "Service" },
  { key: "revenue", label: "Revenue" },
  { key: "executive", label: "Executive" },
];

function fmt(m: Metric): string {
  if (m.value === null || m.value === undefined) return "—";
  if (m.format === "currency") return money(Number(m.value));
  if (m.format === "percent") return `${m.value}%`;
  if (m.format === "hours") return `${m.value}h`;
  if (m.format === "days") return `${m.value}d`;
  if (m.format === "text") return String(m.value);
  return String(m.value);
}

// ── Spec §52 — filtered analytics: pick an attribute and the visualization ──
// updates. Data is aggregated client-side from the existing list endpoints
// (no invented APIs): leads (source/status/owner/month) and deals (stage /
// pipeline/owner/month, weighted by amount).
type AnalyzeRecord = Record<string, any>;
const LEAD_DIMS = [
  { key: "source", label: "Source" },
  { key: "status", label: "Status" },
  { key: "owner", label: "Owner" },
  { key: "month", label: "Month" },
];
const DEAL_DIMS = [
  { key: "stage", label: "Stage" },
  { key: "pipeline", label: "Pipeline" },
  { key: "owner", label: "Owner" },
  { key: "month", label: "Month" },
];
const DIM_LABELS: Record<string, string> = {
  source: "Source", status: "Status", owner: "Owner", month: "Month", stage: "Stage", pipeline: "Pipeline",
};

function monthLabel(iso: string | null | undefined): string {
  if (!iso) return "None";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "None";
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" }).replace(" ", " ’");
}

function dimValue(r: AnalyzeRecord, dim: string, ownerNames: Record<string, string>): string {
  if (dim === "month") return monthLabel(r.createdAt);
  if (dim === "owner") return ownerNames[r.ownerId] ?? "Unassigned";
  if (dim === "pipeline") return r.pipelineId_label ?? "None";
  const v = r[dim];
  if (v === null || v === undefined || v === "") return "None";
  return String(v);
}

function AnalyzePanel() {
  const [dataset, setDataset] = useState<"leads" | "deals">("leads");
  const [dim, setDim] = useState("source");
  const [rows, setRows] = useState<Record<"leads" | "deals", AnalyzeRecord[]> | null>(null);
  const [ownerNames, setOwnerNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void Promise.all([
      get<{ items: AnalyzeRecord[] }>("/api/leads?pageSize=500"),
      get<{ items: AnalyzeRecord[] }>("/api/opportunities?pageSize=500"),
      get<{ items: { id: string; name: string }[] }>("/api/users?pageSize=200"),
    ]).then(([l, d, u]) => {
      if (!alive) return;
      setOwnerNames(Object.fromEntries((u.items ?? []).map((x) => [x.id, x.name])));
      setRows({ leads: l.items ?? [], deals: d.items ?? [] });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const dims = dataset === "leads" ? LEAD_DIMS : DEAL_DIMS;
  // Keep the selected dimension valid when the dataset switches.
  const activeDim = dims.some((d) => d.key === dim) ? dim : dims[0].key;

  const byDim = useMemo(() => {
    const recs = rows?.[dataset] ?? [];
    const buckets = new Map<string, { label: string; count: number; amount: number }>();
    for (const r of recs) {
      const label = dimValue(r, activeDim, ownerNames);
      const b = buckets.get(label) ?? { label, count: 0, amount: 0 };
      b.count += 1;
      b.amount += Number(r.amount ?? 0) || 0;
      buckets.set(label, b);
    }
    const list = [...buckets.values()].sort((a, b) => (dataset === "deals" ? b.amount - a.amount : b.count - a.count));
    const total = dataset === "deals" ? list.reduce((s, x) => s + x.amount, 0) : recs.length;
    return { list, total };
  }, [rows, dataset, activeDim, ownerNames]);

  const top = byDim.list.slice(0, 8);
  const max = Math.max(...top.map((t) => (dataset === "deals" ? t.amount : t.count)), 1);
  const donutSegments: Segment[] = byDim.list.slice(0, 6).map((b) => ({ label: b.label, value: dataset === "deals" ? b.amount : b.count }));
  const rest = byDim.list.slice(6).reduce((s, x) => s + (dataset === "deals" ? x.amount : x.count), 0);
  if (rest > 0) donutSegments.push({ label: "Other", value: rest });

  const valueFmt = dataset === "deals" ? (v: number) => money(v) : (v: number) => `${v}`;
  const centerValue = dataset === "deals" ? byDim.total : byDim.list.reduce((s, x) => s + x.count, 0);

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2"><PieChart className="size-4 text-accent-400" /> Analyze by</span>
      }
      sub="Pick an attribute — the chart updates to that dataset (spec §52)."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-white/[0.04] p-0.5">
            {([["leads", "Leads"], ["deals", "Deals"]] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setDataset(k)}
                aria-pressed={dataset === k}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${dataset === k ? "bg-accent-500/20 text-accent-300" : "text-slate-400 hover:text-slate-200"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {dims.map((d) => (
            <button
              key={d.key}
              onClick={() => setDim(d.key)}
              aria-pressed={activeDim === d.key}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${activeDim === d.key ? "bg-accent-500/20 text-accent-300 ring-1 ring-accent-500/40" : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200"}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      }
    >
      {!rows ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-8" />)}</div>
      ) : byDim.list.length === 0 ? (
        <EmptyState icon={<PieChart className="size-5" />} title="No records to analyze" hint={`Create some ${dataset} to see the breakdown here.`} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              {dataset === "deals" ? "Deal" : "Lead"} {DIM_LABELS[activeDim]} performance
            </div>
            {top.map((b, i) => {
              const val = dataset === "deals" ? b.amount : b.count;
              const pct = byDim.total > 0 ? (val / (dataset === "deals" ? byDim.total : centerValue)) * 100 : 0;
              return <HBarRow key={b.label} label={b.label} value={val} pct={pct} max={max} fmt={valueFmt} color={colorFor(i)} />;
            })}
            {byDim.list.length > 8 && (
              <p className="text-[11px] text-slate-600">+{byDim.list.length - 8} more — showing the top {Math.min(byDim.list.length, 8)}.</p>
            )}
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-ink-800/40 p-4">
            <Donut
              segments={donutSegments}
              centerLabel="total"
              centerValue={centerValue}
              fmt={valueFmt}
            />
          </div>
        </div>
      )}
    </ChartCard>
  );
}

function MetricCard({ m }: { m: Metric }) {
  const [open, setOpen] = useState(false);
  const tone = (m.format === "percent" && Number(m.value) < 30) || (m.format === "currency" && Number(m.value) < 0) ? "amber" : "blue";
  return (
    <div className="card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/10">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{m.label}</div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md p-1 text-slate-600 transition-colors hover:bg-white/10 hover:text-slate-300"
          title="Data lineage"
        >
          <Info className="size-3.5" />
        </button>
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${tone === "amber" ? "text-amber-400" : "text-accent-300"}`}>{fmt(m)}</div>
      {open && (
        <div className="mt-3 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-ink-800/60 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Where this number comes from</div>
          {m.sources.map((s, i) => (
            <div key={i} className="text-xs">
              <span className="font-medium text-slate-300">{s.entity}</span>
              <span className="text-slate-500"> · {s.query}</span>
              <div className="text-[11px] text-slate-600">{s.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ForecastPanel({ data }: { data: Forecast }) {
  const [refreshing, setRefreshing] = useState(false);
  const [breaches, setBreaches] = useState<{ key: string; label: string; value: number; threshold: number }[]>([]);
  const { buckets, stages, byOwner } = data.live;
  const last = data.snapshots[0]?.buckets;
  const delta = last ? buckets.weighted - last.weighted : 0;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await post<{ saved: { id: string }; breaches: typeof breaches }>("/api/analytics/forecast/refresh", {});
      setBreaches(res.breaches ?? []);
      window.location.reload();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="card p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <TrendingUp className="size-4 text-accent-400" /> Weighted forecast
        </h2>
        <button onClick={() => void refresh()} disabled={refreshing} className="btn-ghost text-xs">
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> {refreshing ? "Refreshing…" : "Refresh snapshot"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ForecastTile label="Pipeline" value={money(buckets.pipeline)} sub={`${data.live.dealCount} open deals`} />
        <ForecastTile label="Weighted" value={money(buckets.weighted)} sub={last ? `${delta >= 0 ? "+" : ""}${money(delta)} vs last` : "live"} accent />
        <ForecastTile label="Commit (≥75%)" value={money(buckets.commit)} sub="negotiation + won" />
        <ForecastTile label="Best case (≥50%)" value={money(buckets.bestCase)} sub="proposal +" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">By stage</div>
          <div className="space-y-2">
            {stages.map((s) => (
              <div key={s.stage} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                <span className="capitalize text-slate-300">{s.stage} <span className="text-slate-600">({s.probability}%)</span></span>
                <span className="tabular-nums text-slate-400">{s.count} · {money(s.amount)} → <span className="text-accent-300">{money(s.weighted)}</span></span>
              </div>
            ))}
            {stages.length === 0 && <p className="text-xs text-slate-600">No open deals yet.</p>}
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">By owner</div>
          <div className="space-y-2">
            {byOwner.map((o) => (
              <div key={o.ownerId} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                <span className="text-slate-300">{o.ownerName}</span>
                <span className="tabular-nums text-slate-400">pipeline {money(o.pipeline)} · weighted <span className="text-accent-300">{money(o.weighted)}</span></span>
              </div>
            ))}
            {byOwner.length === 0 && <p className="text-xs text-slate-600">No owners with open deals.</p>}
          </div>
        </div>
      </div>

      {breaches.length > 0 && (
        <div className="mt-5 space-y-2">
          {breaches.map((b) => (
            <div key={b.key} className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span className="font-medium">{b.label}</span> is {b.value} (threshold {b.threshold}) — admins notified, event emitted.
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ForecastTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-ink-800/40 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${accent ? "text-accent-300" : "text-white"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-600">{sub}</div>}
    </div>
  );
}

function PredictionsPanel({ conversions, churn, ltvs }: { conversions: Prediction[]; churn: Prediction[]; ltvs: Prediction[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="card p-6">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles className="size-4 text-teal-400" /> Conversion likelihood
        </h3>
        <div className="space-y-3">
          {conversions.map((c) => (
            <div key={c.dealId} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="truncate text-slate-300">{c.name}</span>
                <span className="font-semibold tabular-nums text-teal-400">{c.score}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
                <div className="h-full rounded-full bg-teal-500" style={{ width: `${c.score}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-slate-600">{c.stage} · {Object.values(c.inputs).join(" · ")}</div>
            </div>
          ))}
          {conversions.length === 0 && <p className="text-xs text-slate-600">No open deals to score.</p>}
        </div>
      </div>

      <div className="card p-6">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <AlertTriangle className="size-4 text-amber-400" /> Churn risk
        </h3>
        <div className="space-y-3">
          {churn.map((c) => (
            <div key={c.contactId} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="truncate text-slate-300">{c.name}</span>
                <span className={`font-semibold tabular-nums ${c.score >= 60 ? "text-rose-400" : c.score >= 30 ? "text-amber-400" : "text-emerald-400"}`}>{c.score}/100</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
                <div className={`h-full rounded-full ${c.score >= 60 ? "bg-rose-500" : c.score >= 30 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${c.score}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-slate-600">{Object.values(c.inputs).slice(0, 2).join(" · ")}</div>
            </div>
          ))}
          {churn.length === 0 && <p className="text-xs text-slate-600">No contacts to score.</p>}
        </div>
      </div>

      <div className="card p-6">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <BarChart3 className="size-4 text-emerald-400" /> LTV estimates
        </h3>
        <div className="space-y-3">
          {ltvs.map((l) => (
            <div key={l.contactId} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
              <span className="truncate text-slate-300">{l.name}</span>
              <span className="font-semibold tabular-nums text-emerald-400">{money(l.value ?? 0)}</span>
            </div>
          ))}
          {ltvs.length === 0 && <p className="text-xs text-slate-600">No contacts to estimate.</p>}
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [kind, setKind] = useState("sales");
  const [group, setGroup] = useState<MetricGroup | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [predictions, setPredictions] = useState<{ conversions: Prediction[]; churn: Prediction[]; ltvs: Prediction[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      get<{ group: MetricGroup }>(`/api/analytics/dashboard?kind=${kind}`).then((d) => setGroup(d.group)),
      get<Forecast>("/api/analytics/forecast").then(setForecast),
      get<typeof predictions>("/api/analytics/predictions?limit=6").then(setPredictions),
    ]).finally(() => setLoading(false));
  }, [kind]);

  const stats = useMemo(() => group?.metrics.slice(0, 4) ?? [], [group]);

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">Metrics computed live from your pipeline, campaigns, and service desk — every number shows where it came from.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => setKind(k.key)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${kind === k.key ? "bg-accent-500/20 text-accent-300 ring-1 ring-accent-500/40" : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200"}`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <AnalyzePanel />

      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((m) => <MetricCard key={m.key} m={m} />)}
          </div>

          {group && (
            <div className="card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">{group.label} metrics</h2>
                <span className="text-[11px] text-slate-600">click ⓘ on a card to see its data lineage</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.metrics.map((m) => <MetricCard key={m.key} m={m} />)}
              </div>
            </div>
          )}

          {forecast && <ForecastPanel data={forecast} />}
          {predictions && <PredictionsPanel {...predictions} />}
        </>
      )}
    </div>
  );
}
