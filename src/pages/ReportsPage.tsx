import { useEffect, useMemo, useState } from "react";
import { api, del, get, post } from "../lib/api";
import { Badge, EmptyState, Field, Modal } from "../components/ui";
import { LayoutDashboard, Plus, Trash2, Eye, X, TrendingUp } from "lucide-react";
import { ChartCard, Delta, HBarRow, MonthBars, colorFor } from "../components/charts";
import { money } from "../lib/format";

type Report = { id: string; name: string; description: string | null; kind: string; keys: string[]; active: boolean; createdAt: string };
type ReportMetric = { key: string; label: string; value: number | string | null; format: string; sources: { entity: string; query: string; note: string }[] };

const KINDS = ["sales", "marketing", "service", "revenue"];

const fmt = (m: ReportMetric) => {
  if (m.value === null || m.value === undefined) return "—";
  if (m.format === "currency") return `$${Math.round(Number(m.value)).toLocaleString()}`;
  if (m.format === "percent") return `${m.value}%`;
  if (m.format === "hours") return `${m.value}h`;
  if (m.format === "text") return String(m.value);
  return String(m.value);
};

/** Visual report dashboard (spec §51) — KPI hero + trend + comparison bars,
    computed live from the report's metrics and real deal data. */
function ReportDashboard({ report, metrics, kindLabel }: { report: Report; metrics: ReportMetric[]; kindLabel: string }) {
  const [deals, setDeals] = useState<{ amount: number; createdAt: string }[] | null>(null);
  const [period, setPeriod] = useState<"all" | "30" | "90">("all");

  useEffect(() => {
    let alive = true;
    get<{ items: { amount: number; createdAt: string }[] }>("/api/opportunities?pageSize=500")
      .then((d) => { if (alive) setDeals(d.items ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // KPI headline: the first currency metric (revenue), else the first metric.
  const headline = metrics.find((m) => m.format === "currency") ?? metrics[0];
  const headlineValue = headline && headline.value !== null && headline.value !== undefined ? Number(headline.value) : 0;

  // Real month-over-month revenue delta from live deals.
  const now = new Date();
  const monthKey = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}`;
  };
  const thisKey = monthKey(now.toISOString());
  const lastKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString());
  const revenueByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of deals ?? []) {
      const k = monthKey(d.createdAt);
      map.set(k, (map.get(k) ?? 0) + (Number(d.amount) || 0));
    }
    return map;
  }, [deals]);
  const thisRevenue = revenueByMonth.get(thisKey) ?? 0;
  const lastRevenue = revenueByMonth.get(lastKey) ?? 0;
  const delta = lastRevenue > 0 ? ((thisRevenue - lastRevenue) / lastRevenue) * 100 : (thisRevenue > 0 ? 100 : 0);

  // Trend: last N months of deal revenue (spec §51 trends).
  const trend = useMemo(() => {
    if (!deals) return [];
    const months = new Map<string, number>();
    for (const d of deals) {
      const k = monthKey(d.createdAt);
      months.set(k, (months.get(k) ?? 0) + (Number(d.amount) || 0));
    }
    const days = period === "all" ? 365 * 3 : Number(period);
    const cutoff = new Date(now.getFullYear(), now.getMonth() - Math.ceil(days / 31), 1);
    const out: { label: string; value: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const d = new Date(cutoff.getFullYear(), cutoff.getMonth() + i, 1);
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      out.push({ label: d.toLocaleString("en-US", { month: "short" }), value: months.get(k) ?? 0 });
    }
    return out;
  }, [deals, period]);

  // Comparison bars across the report's own metrics (% of the max).
  const comp = useMemo(() => {
    const vals = metrics
      .filter((m) => m.value !== null && m.value !== undefined)
      .map((m) => ({ m, v: Number(m.value) }));
    const max = Math.max(...vals.map((x) => Math.abs(x.v)), 1);
    return vals.map((x) => ({ m: x.m, v: x.v, pct: (x.v / max) * 100 }));
  }, [metrics]);

  return (
    <div className="space-y-5">
      {/* Hero KPI (spec §51 example) */}
      {headline && (
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-[var(--border-subtle)] bg-gradient-to-br from-accent-500/[0.08] to-teal-500/[0.04] p-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{headline.label} · {report.name}</div>
            <div className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-white">{fmt(headline)}</div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
              <Delta value={delta} />
              <span>vs last month — {kindLabel} report, computed live</span>
            </div>
          </div>
          <Badge tone="blue">{report.kind}</Badge>
        </div>
      )}

      {/* Filters: period (spec §51 filters) */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Period</span>
        <div className="flex rounded-lg bg-white/[0.04] p-0.5">
          {([["all", "All time"], ["30", "Last 30d"], ["90", "Last 90d"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setPeriod(k)}
              aria-pressed={period === k}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${period === k ? "bg-accent-500/20 text-accent-300" : "text-slate-400 hover:text-slate-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Monthly revenue trend */}
        <ChartCard
          title={<span className="flex items-center gap-2"><TrendingUp className="size-4 text-accent-400" /> Revenue by month</span>}
          sub={`Deal value created per month${period === "all" ? " (last 8 months)" : ""} — live from open deals`}
        >
          {deals === null ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-10" />)}</div>
          ) : deals.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-600">No deals yet — create some to see the trend.</p>
          ) : (
            <MonthBars data={trend} fmt={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
          )}
        </ChartCard>

        {/* Metric comparison */}
        <ChartCard
          title="Metric comparison"
          sub="Every metric in this report, sized against the largest"
        >
          {comp.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-600">No numeric metrics to compare.</p>
          ) : (
            <div className="space-y-3">
              {comp.map((c, i) => (
                <HBarRow
                  key={c.m.key}
                  label={c.m.label}
                  value={c.v}
                  pct={c.pct}
                  max={Math.max(...comp.map((x) => Math.abs(x.v)), 1)}
                  fmt={(v) => (c.m.format === "currency" ? money(v) : c.m.format === "percent" ? `${v}%` : String(v))}
                  color={colorFor(i)}
                />
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      {/* Detail grid (kept from before — lineage per metric) */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Metric detail & data lineage</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.key} className="rounded-lg border border-[var(--border-subtle)] bg-ink-800/40 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{m.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-accent-300">{fmt(m)}</div>
              <div className="mt-2 space-y-1">
                {m.sources.map((s, i) => (
                  <div key={i} className="text-[10px] text-slate-600">{s.entity} · {s.query}</div>
                ))}
              </div>
            </div>
          ))}
          {metrics.length === 0 && <p className="text-xs text-slate-600">No metrics for this report's kind.</p>}
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<{ report: Report; metrics: ReportMetric[]; kindLabel: string } | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("sales");
  const [keys, setKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => void get<{ items: Report[] }>("/api/reports").then((d) => setReports(d.items));
  useEffect(load, []);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/api/reports", { name, description: description || undefined, kind, keys });
      setOpen(false);
      setName(""); setDescription(""); setKeys([]); setKind("sales");
      load();
    } catch (e: any) {
      setError(e.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const view = async (r: Report) => {
    const d = await get<{ report: Report; metrics: ReportMetric[]; kindLabel: string }>(`/api/reports/${r.id}/data`);
    setViewing(d);
  };

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">Saved dashboard configs — every report renders live charts, trends, and comparisons, not a wall of numbers.</p>
        </div>
        <button onClick={() => setOpen(true)} className="btn-primary text-xs"><Plus className="size-3.5" /> New report</button>
      </div>

      {reports.length === 0 && !open ? (
        <EmptyState icon={<LayoutDashboard className="size-8" />} title="No reports yet" hint="Create a saved dashboard config with the button above." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => (
            <div key={r.id} className="card p-5 transition-transform duration-200 hover:-translate-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-white">{r.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{r.description ?? "—"}</div>
                </div>
                <Badge tone="blue">{r.kind}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.keys.length === 0 && <span className="text-[11px] text-slate-600">all metrics</span>}
                {r.keys.slice(0, 4).map((k) => <Badge key={k} tone="default">{k}</Badge>)}
                {r.keys.length > 4 && <Badge tone="default">+{r.keys.length - 4}</Badge>}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button onClick={() => void view(r)} className="btn-ghost flex-1 text-xs"><Eye className="size-3.5" /> View</button>
                <button onClick={() => void del(`/api/reports/${r.id}`).then(load)} aria-label={`Delete report ${r.name}`} className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="size-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New report">
        <div className="space-y-4">
          <Field label="Name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly sales overview" /></Field>
          <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this report shows" /></Field>
          <Field label="Dashboard kind">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button onClick={() => void save()} disabled={busy || !name.trim()} className="btn-primary w-full text-sm">
            {busy ? "Saving…" : "Create report"}
          </button>
        </div>
      </Modal>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.report.name ?? ""} size="xl">
        {viewing && (
          <div className="space-y-5">
            <ReportDashboard report={viewing.report} metrics={viewing.metrics} kindLabel={viewing.kindLabel} />
            <button onClick={() => setViewing(null)} className="btn-ghost w-full text-xs"><X className="size-3.5" /> Close</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
