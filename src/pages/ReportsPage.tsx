import { useEffect, useState } from "react";
import { api, del, get, post } from "../lib/api";
import { Badge, EmptyState, Field, Modal } from "../components/ui";
import { LayoutDashboard, Plus, Trash2, Eye, X } from "lucide-react";

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
          <p className="mt-1 text-sm text-slate-500">Saved dashboard configs — pick a kind and the metric cards you want to see, always rendered live.</p>
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
                <button onClick={() => void del(`/api/reports/${r.id}`).then(load)} className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="size-4" /></button>
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

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.report.name ?? ""} wide>
        {viewing && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">{viewing.kindLabel} report · {viewing.metrics.length} metrics, computed live</p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              {viewing.metrics.map((m) => (
                <div key={m.key} className="rounded-lg border border-white/[0.06] bg-black/20 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{m.label}</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums text-accent-300">{fmt(m)}</div>
                  <div className="mt-2 space-y-1">
                    {m.sources.map((s, i) => (
                      <div key={i} className="text-[10px] text-slate-600">{s.entity} · {s.query}</div>
                    ))}
                  </div>
                </div>
              ))}
              {viewing.metrics.length === 0 && <p className="text-xs text-slate-600">No metrics for this report's kind.</p>}
            </div>
            <button onClick={() => setViewing(null)} className="btn-ghost w-full text-xs"><X className="size-3.5" /> Close</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
