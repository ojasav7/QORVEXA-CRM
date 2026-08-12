import { useEffect, useMemo, useState } from "react";
import { api, get, post } from "../lib/api";
import { Badge, EmptyState, Spinner, StatCard } from "../components/ui";
import { money } from "../lib/format";
import { BarChart3, TrendingUp, AlertTriangle, Info, RefreshCw, Sparkles } from "lucide-react";

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
        <div className="mt-3 space-y-2 rounded-lg border border-white/[0.06] bg-black/30 p-3">
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
    <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
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
          <Sparkles className="size-4 text-violet-400" /> Conversion likelihood
        </h3>
        <div className="space-y-3">
          {conversions.map((c) => (
            <div key={c.dealId} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="truncate text-slate-300">{c.name}</span>
                <span className="font-semibold tabular-nums text-violet-400">{c.score}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
                <div className="h-full rounded-full bg-violet-500" style={{ width: `${c.score}%` }} />
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
