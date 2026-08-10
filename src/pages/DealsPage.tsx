import { useCallback, useEffect, useState } from "react";
import { Plus, GripVertical, Download } from "lucide-react";
import { api, patch, post, downloadCsv, ApiError } from "../lib/api";
import { Field, Modal, Spinner } from "../components/ui";
import { money, date } from "../lib/format";

type Deal = {
  id: string;
  name: string;
  amount: number;
  stage: string;
  probability: number;
  closeDate: string | null;
  ownerId: string;
  accountId_label?: string | null;
  createdAt: string;
};

const PIPELINE = [
  { stage: "discovery", probability: 10, color: "from-violet-500/80 to-violet-500/20" },
  { stage: "qualified", probability: 25, color: "from-accent-500/80 to-accent-500/20" },
  { stage: "proposal", probability: 50, color: "from-amber-500/80 to-amber-500/20" },
  { stage: "negotiation", probability: 75, color: "from-yellow-500/80 to-yellow-500/20" },
  { stage: "won", probability: 100, color: "from-emerald-500/80 to-emerald-500/20" },
  { stage: "lost", probability: 0, color: "from-rose-500/80 to-rose-500/20" },
];

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportCsv = async () => {
    try {
      await downloadCsv("/api/export/opportunity", "deals.csv");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed");
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items: Deal[] }>("/api/opportunities?pageSize=200");
      setDeals(d.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const move = async (id: string, toStage: string) => {
    const deal = deals.find((d) => d.id === id);
    if (!deal || deal.stage === toStage) return;
    // optimistic update
    setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, stage: toStage, probability: PIPELINE.find((p) => p.stage === toStage)?.probability ?? d.probability } : d)));
    try {
      await patch(`/api/opportunities/${id}`, { stage: toStage });
      // eslint-disable-next-line no-empty
    } catch {}
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Deals</h1>
          <p className="text-sm text-slate-500">Drag deals between stages — changes fire <span className="font-mono text-accent-400">deal.stage_changed</span> events.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" onClick={exportCsv} title="Export pipeline as CSV"><Download className="size-4" /> Export CSV</button>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New deal</button>
        </div>
      </div>
      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {loading ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="size-6" /></div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {PIPELINE.map((col) => {
            const colDeals = deals.filter((d) => d.stage === col.stage);
            const total = colDeals.reduce((s, d) => s + d.amount, 0);
            return (
              <div
                key={col.stage}
                className="w-72 shrink-0 rounded-2xl border border-white/[0.05] bg-ink-900/50 p-3"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragId) void move(dragId, col.stage); setDragId(null); }}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <div className={`size-2 rounded-full bg-gradient-to-br ${col.color}`} />
                    <span className="text-sm font-semibold capitalize text-white">{col.stage}</span>
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] tabular-nums text-slate-400">{colDeals.length}</span>
                  </div>
                  <span className="text-xs font-medium tabular-nums text-slate-400">{money(total)}</span>
                </div>

                <div className="space-y-2">
                  {colDeals.map((deal) => (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={() => setDragId(deal.id)}
                      className="group cursor-grab rounded-xl border border-white/[0.06] bg-ink-850 p-3.5 transition-all hover:border-accent-500/40 hover:shadow-lg hover:shadow-black/30 active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{deal.name}</p>
                          {deal.accountId_label && <p className="mt-0.5 truncate text-xs text-slate-500">{deal.accountId_label}</p>}
                        </div>
                        <GripVertical className="size-4 shrink-0 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-sm font-semibold tabular-nums text-white">{money(deal.amount)}</span>
                        <span className="text-[11px] tabular-nums text-slate-500">{deal.probability}%</span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-700">
                        <div className="h-full rounded-full bg-accent-400/70" style={{ width: `${deal.probability}%` }} />
                      </div>
                      {deal.closeDate && <p className="mt-2 text-[11px] text-slate-600">Close {date(deal.closeDate)}</p>}
                    </div>
                  ))}
                  {colDeals.length === 0 && (
                    <div className="rounded-xl border border-dashed border-white/[0.06] py-6 text-center text-xs text-slate-600">Drop deals here</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <NewDealModal
          onClose={() => setCreating(false)}
          onCreated={async (deal) => { setCreating(false); await load(); }}
        />
      )}
    </div>
  );
}

function NewDealModal({ onClose, onCreated }: { onClose: () => void; onCreated: (d: Deal) => void }) {
  const [form, setForm] = useState({ name: "", amount: "", stage: "qualified", closeDate: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const deal = await post<Deal>("/api/opportunities", { ...form, amount: Number(form.amount) || 0, closeDate: form.closeDate || null });
      onCreated(deal);
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New deal">
      <div className="space-y-4">
        <Field label="Deal name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount"><input className="input" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Stage">
            <select className="input" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
              {PIPELINE.map((p) => <option key={p.stage} value={p.stage}>{p.stage}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Close date"><input className="input" type="date" value={form.closeDate} onChange={(e) => setForm({ ...form, closeDate: e.target.value })} /></Field>
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.name.trim()}>{busy ? <Spinner className="size-4" /> : "Create deal"}</button>
        </div>
      </div>
    </Modal>
  );
}
