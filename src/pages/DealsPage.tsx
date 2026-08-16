import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, GripVertical, Download, Layers } from "lucide-react";
import { api, patch, post, downloadCsv, ApiError } from "../lib/api";
import { useToast } from "../App";
import { Alert, Field, Modal, PageHeader, Spinner } from "../components/ui";
import { money, date } from "../lib/format";
import { STAGE_COLORS, type Pipeline, type PipelineStage } from "../lib/objects";

type Deal = {
  id: string;
  name: string;
  amount: number;
  stage: string;
  probability: number;
  pipelineId: string | null;
  closeDate: string | null;
  accountId_label?: string | null;
  createdAt: string;
};

export default function DealsPage() {
  const toast = useToast();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [activePipelineId, setActivePipelineId] = useState<string | null>(null); // null = default pipeline
  const defaultPipelineId = useMemo(() => pipelines.find((p) => p.isDefault)?.id ?? pipelines[0]?.id ?? null, [pipelines]);
  const [params, setParams] = useSearchParams();
  // Quick-create support: /deals?new=1 opens the create modal (topbar + New, D
  // shortcut). Re-fires on param change so a repeat press works, and the param
  // is stripped after opening so refresh doesn't re-open the modal.
  useEffect(() => {
    if (params.get("new") === "1") {
      setCreating(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const loadPipelines = useCallback(async () => {
    try {
      const d = await api<{ items: Pipeline[] }>("/api/pipelines");
      setPipelines(d.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load pipelines");
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Always filter by a concrete pipeline id. null (the default chip) maps to
      // the org's default pipeline — the server returns legacy null-pipelineId
      // deals there too, so the board never mixes pipelines.
      const pid = activePipelineId ?? defaultPipelineId;
      if (!pid) return; // pipelines not loaded yet — avoid an unfiltered fetch
      const d = await api<{ items: Deal[] }>(`/api/opportunities?pageSize=200&pipelineId=${encodeURIComponent(pid)}`);
      setDeals(d.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load deals");
    } finally {
      setLoading(false);
    }
  }, [activePipelineId, defaultPipelineId]);

  useEffect(() => { void loadPipelines(); }, [loadPipelines]);
  useEffect(() => { void load(); }, [load]);

  // Columns for the active board. null (the default chip) resolves to the org's
  // default pipeline (legacy deals with pipelineId null land there too — see the API).
  const activePipeline = useMemo(() => {
    if (!activePipelineId) return pipelines.find((p) => p.isDefault) ?? pipelines[0] ?? null;
    return pipelines.find((p) => p.id === activePipelineId) ?? null;
  }, [pipelines, activePipelineId]);

  const columns: (PipelineStage & { color: string; textColor: string })[] = useMemo(() => {
    if (!activePipeline) return [];
    return activePipeline.stages.map((s, i) => ({
      ...s,
      color: STAGE_COLORS[i % STAGE_COLORS.length][0],
      textColor: STAGE_COLORS[i % STAGE_COLORS.length][1],
    }));
  }, [activePipeline]);

  const exportCsv = async () => {
    try {
      await downloadCsv("/api/export/opportunity", "deals.csv");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed");
    }
  };

  const move = async (id: string, toStage: string) => {
    const deal = deals.find((d) => d.id === id);
    if (!deal || deal.stage === toStage) return;
    const stageDef = columns.find((c) => c.key === toStage);
    // optimistic update
    setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, stage: toStage, probability: stageDef?.probability ?? d.probability } : d)));
    try {
      await patch(`/api/opportunities/${id}`, { stage: toStage });
      toast("success", `${deal.name} moved to ${stageDef?.label ?? toStage}`);
    } catch {
      toast("error", `Could not move ${deal.name} — try again`);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Deals"
        description={<>Drag deals between stages — changes fire <span className="font-mono text-accent-400">deal.stage_changed</span> events.</>}
        actions={
          <>
            <button className="btn-ghost" onClick={exportCsv} title="Export pipeline as CSV"><Download className="size-4" /> Export CSV</button>
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New deal</button>
          </>
        }
      />
      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

      {/* Pipeline switcher (Phase 2-lite) */}
      {pipelines.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Layers className="size-4 text-slate-600" />
          <button
            onClick={() => setActivePipelineId(null)}
            className={`chip transition-colors ${activePipelineId === null ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}
          >
            {defaultPipelineId ? pipelines.find((p) => p.id === defaultPipelineId)?.name ?? "Default" : "Default"}
            {activePipelineId === null && <span className="ml-1 text-[11px] opacity-70">default</span>}
          </button>
          {pipelines.filter((p) => p.id !== defaultPipelineId).map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePipelineId(p.id)}
              className={`chip transition-colors ${activePipelineId === p.id ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}
            >
              {p.name}
              {p.dealCount !== undefined && <span className="ml-1.5 rounded-full bg-white/[0.08] px-1.5 text-[11px] tabular-nums">{p.dealCount}</span>}
            </button>
          ))}
          <span className="ml-auto hidden text-xs text-slate-600 sm:block">{deals.length} deals on this pipeline</span>
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="size-6" /></div>
      ) : columns.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500">
          No pipeline configured yet — create one in <span className="text-slate-300">Settings → Pipelines</span>.
        </div>
      ) : (
        <div role="region" aria-label="Deal stages" tabIndex={0} className="flex gap-4 overflow-x-auto pb-4 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/60 rounded-xl">
          {columns.map((col) => {
            const colDeals = deals.filter((d) => d.stage === col.key);
            const total = colDeals.reduce((s, d) => s + d.amount, 0);
            return (
              <div
                key={col.key}
                className="w-72 shrink-0 rounded-2xl border border-white/[0.05] bg-ink-900/50 p-3"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragId) void move(dragId, col.key); setDragId(null); }}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <div className={`size-2 rounded-full bg-gradient-to-br ${col.color}`} />
                    <span className="text-sm font-semibold capitalize text-white">{col.label}</span>
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
          pipelines={pipelines}
          defaultPipelineId={defaultPipelineId ?? ""}
          initialPipelineId={activePipelineId ?? defaultPipelineId ?? undefined}
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); await load(); }}
        />
      )}
    </div>
  );
}

function NewDealModal({ pipelines, defaultPipelineId, initialPipelineId, onClose, onCreated }: {
  pipelines: Pipeline[];
  defaultPipelineId: string;
  initialPipelineId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [pipelineId, setPipelineId] = useState(initialPipelineId && pipelines.some((p) => p.id === initialPipelineId) ? initialPipelineId : defaultPipelineId);
  const pipeline = pipelines.find((p) => p.id === pipelineId);
  const stages = pipeline?.stages ?? [];
  const [form, setForm] = useState(() => ({
    name: "",
    amount: "",
    stage: stages.find((s) => s.key === "qualified")?.key ?? stages[0]?.key ?? "",
    closeDate: "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchPipeline = (id: string) => {
    setPipelineId(id);
    const p = pipelines.find((x) => x.id === id);
    setForm((f) => ({ ...f, stage: p?.stages.find((s) => s.key === "qualified")?.key ?? p?.stages[0]?.key ?? "" }));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/api/opportunities", {
        ...form,
        amount: Number(form.amount) || 0,
        closeDate: form.closeDate || null,
        pipelineId,
      });
      onCreated();
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
          <Field label="Pipeline">
            <select className="input" value={pipelineId} onChange={(e) => switchPipeline(e.target.value)}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " (default)" : ""}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Stage">
          <select className="input" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
            {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
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
