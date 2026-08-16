import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Plus, Search, Pencil, Trash2, Download, Network, GitMerge, StickyNote, Mail, Phone, CalendarDays, Columns3, MoreHorizontal, Eye } from "lucide-react";
import { api, del, patch, post, downloadCsv, ApiError } from "../lib/api";
import { useToast } from "../App";
import { OBJECT_META, type FieldSpec, type ObjectMeta, type Pipeline } from "../lib/objects";
import { Alert, Badge, Drawer, EmptyState, Field, Modal, PageHeader, Spinner } from "../components/ui";
import { money, date } from "../lib/format";

type FieldPermInfo = { fieldKey: string; read: boolean; write: boolean; readRoles: string[]; writeRoles: string[] };
const ROLE_READ = (p?: FieldPermInfo) => p === undefined || p.read;
const ROLE_WRITE = (p?: FieldPermInfo) => p === undefined || p.write;

type Row = Record<string, any>;

export default function ObjectPage({ type }: { type: string }) {
  const meta = OBJECT_META[type];
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [relationOptions, setRelationOptions] = useState<Record<string, { id: string; label: string }[]>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [fields, setFields] = useState<{ core: FieldSpec[]; custom: any[]; permissions: FieldPermInfo[] }>({ core: [], custom: [], permissions: [] });
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedId = params.get("id");
  // Quick-create support: /contacts?new=1 (and friends) opens the create modal
  // immediately — wired from the topbar + New menu, the command palette, and
  // the N/D/T shortcuts. The param is stripped after opening so a repeat press
  // works (the effect re-fires on the fresh param change) and refresh doesn't
  // unexpectedly re-open the modal.
  useEffect(() => {
    if (params.get("new") === "1") {
      setCreating(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: Row[]; total: number }>(
        `/api/${type}s?pageSize=100${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${status}` : ""}`
      );
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [type, q, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void api(`/api/fields/${type}`).then((d: any) => setFields({ core: d.core, custom: d.custom, permissions: d.permissions ?? [] })).catch(() => {});
  }, [type]);

  // Account hierarchy: parent-account options for the form (Phase 1).
  useEffect(() => {
    if (type !== "account") return;
    void api<{ items: { id: string; name: string }[] }>("/api/accounts?pageSize=500")
      .then((d) => setRelationOptions({ parentId: d.items.map((a) => ({ id: a.id, label: a.name })) }))
      .catch(() => {});
  }, [type]);

  // Phase 2-lite multi-pipeline: pipeline options for the deal form.
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  useEffect(() => {
    if (type !== "opportunity") return;
    void api<{ items: Pipeline[] }>("/api/pipelines")
      .then((d) => {
        setPipelines(d.items);
        setRelationOptions((prev) => ({ ...prev, pipelineId: d.items.map((p) => ({ id: p.id, label: p.name })) }));
      })
      .catch(() => {});
  }, [type]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const closeDetail = () => {
    const next = new URLSearchParams(params);
    next.delete("id");
    setParams(next);
  };

  const statusOptions = fields.core.find((f) => f.key === "status")?.options ?? [];

  const permMap = useMemo(() => Object.fromEntries(fields.permissions.map((p) => [p.fieldKey, p])), [fields.permissions]);
  // Column customization (spec §24) — read-permissioned columns, with the
  // user's checkbox choices persisted to localStorage per object type.
  const allReadable = useMemo(() => meta.columns.filter((c) => ROLE_READ(permMap[c])), [meta.columns, permMap]);
  const [customCols, setCustomCols] = useState<string[] | null>(null);
  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);
  const colsKey = `qorvexa.columns.${type}`;
  useEffect(() => {
    if (!colsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setColsOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onEsc);
    };
  }, [colsOpen]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(colsKey);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        setCustomCols(parsed.filter((c) => allReadable.includes(c)));
      }
    } catch { /* corrupt storage — fall back to defaults */ }
  }, [colsKey, allReadable]);
  const visibleColumns = useMemo(() => (customCols ? customCols.filter((c) => allReadable.includes(c)) : allReadable), [customCols, allReadable]);
  const toggleColumn = (c: string) => {
    setCustomCols((prev) => {
      const cur = prev ?? allReadable;
      const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
      try { localStorage.setItem(colsKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };
  const resetColumns = () => {
    setCustomCols(null);
    try { localStorage.removeItem(colsKey); } catch { /* storage unavailable */ }
  };

  const exportCsv = async () => {
    try {
      const params2 = new URLSearchParams();
      if (q) params2.set("q", q);
      if (status) params2.set("status", status);
      await downloadCsv(`/api/export/${type}${params2.toString() ? `?${params2}` : ""}`, `${type}.csv`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed");
    }
  };

  const doDelete = async (id: string) => {
    try {
      await del(`/api/${type}s/${id}`);
      closeDetail();
      await load();
      toast("success", `${meta.label} deleted`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete");
      toast("error", e instanceof ApiError ? e.message : "Failed to delete");
    }
  };

  // Bulk delete (spec §25) — real DELETE per record; confirm once upfront.
  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected ${meta.plural.toLowerCase()}? This cannot be undone.`)) return;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await del(`/api/${type}s/${id}`);
      } catch {
        failed++;
      }
    }
    setSelectedIds(new Set());
    await load();
    if (failed) {
      setError(`${failed} ${failed === 1 ? "record" : "records"} could not be deleted.`);
      toast("error", `${failed} ${failed === 1 ? "record" : "records"} could not be deleted.`);
    } else {
      toast("success", `${selectedIds.size} ${meta.plural.toLowerCase()} deleted`);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={meta.plural}
        description={`${total} ${total === 1 ? "record" : "records"}`}
        actions={
          <>
            <button className="btn-ghost" onClick={exportCsv} title="Export visible records as CSV"><Download className="size-4" /> Export</button>
            {type === "account" && (
              <button className="btn-ghost" onClick={() => navigate("/accounts/hierarchy")} title="Account hierarchy tree"><Network className="size-4" /> Hierarchy</button>
            )}
            {["contact", "account", "lead"].includes(type) && (
              <button className="btn-ghost" onClick={() => setMergeOpen(true)} title="Merge duplicate records"><GitMerge className="size-4" /> Merge</button>
            )}
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New {meta.label}</button>
          </>
        }
      />

      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

      {/* Search + filter + result count (spec §26/§27) */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search records" className="input w-56 pl-9" />
        </div>
        {statusOptions.length > 0 && (
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="input w-40">
            <option value="">All statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs tabular-nums text-slate-500">Showing {rows.length} of {total}</span>
          {(q || status) && (
            <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => { setQ(""); setStatus(""); }}>Clear filters</button>
          )}
          <div className="relative" ref={colsRef}>
            <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setColsOpen((v) => !v)} aria-haspopup="menu" aria-expanded={colsOpen} aria-label="Customize columns">
              <Columns3 className="size-3.5" /> Columns
            </button>
            {colsOpen && (
              <div className="glass absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl p-1.5 shadow-2xl shadow-black/40 animate-fade-up" role="group" aria-label="Choose columns">
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Visible columns</div>
                <div className="max-h-64 overflow-y-auto">
                  {allReadable.map((c) => (
                    <label key={c} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-[var(--surface-hover)]">
                      <input
                        type="checkbox"
                        checked={(customCols ?? allReadable).includes(c)}
                        onChange={() => toggleColumn(c)}
                        className="size-4 accent-accent-500"
                      />
                      {fieldLabel(fields.core, c)}
                    </label>
                  ))}
                </div>
                <div className="border-t border-[var(--border-subtle)] px-2 py-1.5">
                  <button className="w-full rounded-lg px-2 py-1 text-left text-xs text-slate-500 transition-colors hover:bg-[var(--surface-hover)] hover:text-slate-300" onClick={resetColumns}>Reset to default</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bulk selection bar (spec §25) */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent-500/30 bg-accent-500/10 px-4 py-2.5 animate-fade-in">
          <span className="text-sm font-medium text-accent-300">{selectedIds.size} selected</span>
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setSelectedIds(new Set())}>Clear</button>
            <button className="btn-danger px-3 py-1.5 text-xs" onClick={() => void bulkDelete()}><Trash2 className="size-3.5" /> Delete</button>
          </div>
        </div>
      )}

      {/* Desktop table (md+) — hidden on mobile where cards take over (spec §41/§76) */}
      <div className="hidden md:block">
      <div className="card overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-6">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Search className="size-5" />}
            title={q || status ? "No records match your filters" : `No ${meta.plural.toLowerCase()} yet`}
            hint={q || status ? "Try changing or clearing the search / status filter." : `Create your first ${meta.label.toLowerCase()} to get started.`}
            action={<button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New {meta.label}</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={rows.length > 0 && rows.every((r) => selectedIds.has(r.id))}
                      onChange={(e) => setSelectedIds(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                      className="size-4 accent-accent-500"
                    />
                  </th>
                  {visibleColumns.map((c) => <th key={c} className="px-4 py-3 font-semibold">{fieldLabel(fields.core, c)}</th>)}
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setParams({ id: row.id })}
                    onKeyDown={(e) => {
                      // Only open from the row itself — don't hijack Enter/Space
                      // pressed on the row's own controls (checkbox, actions).
                      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                        e.preventDefault();
                        setParams({ id: row.id });
                      }
                    }}
                    tabIndex={0}
                    aria-label={`Open ${meta.label} ${row[meta.titleField] ?? row.id}`}
                    className={`cursor-pointer border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/60 ${selectedId === row.id ? "bg-accent-500/[0.08]" : ""}`}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${meta.label}`}
                        checked={selectedIds.has(row.id)}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(row.id);
                          else next.delete(row.id);
                          setSelectedIds(next);
                        }}
                        className="size-4 accent-accent-500"
                      />
                    </td>
                    {visibleColumns.map((c) => (
                      <td key={c} className="px-4 py-3 whitespace-nowrap">
                        <Cell field={c} value={row[c]} />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        row={row}
                        meta={meta}
                        statusOptions={statusOptions}
                        onView={() => setParams({ id: row.id })}
                        onEdit={() => { setEditing(row); closeDetail(); }}
                        onDelete={() => { if (confirm(`Delete this ${meta.label.toLowerCase()}?`)) void doDelete(row.id); }}
                        onStatusChange={async (next) => {
                          try {
                            await patch(`/api/${type}s/${row.id}`, { status: next });
                            await load();
                            toast("success", `${meta.label} status → ${next}`);
                          } catch (e) {
                            toast("error", e instanceof ApiError ? e.message : "Status update failed");
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>

      {/* Mobile card list (<md) — priority fields, no shrink (spec §76) */}
      <div className="md:hidden">
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-24" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="card"><EmptyState
            icon={<Search className="size-5" />}
            title={q || status ? "No records match your filters" : `No ${meta.plural.toLowerCase()} yet`}
            hint={q || status ? "Try changing or clearing the search / status filter." : `Create your first ${meta.label.toLowerCase()} to get started.`}
            action={<button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New {meta.label}</button>}
          /></div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <RecordCard
                key={row.id}
                row={row}
                meta={meta}
                fields={fields}
                visibleColumns={visibleColumns}
                selected={selectedId === row.id}
                checked={selectedIds.has(row.id)}
                onCheck={(v) => {
                  const next = new Set(selectedIds);
                  if (v) next.add(row.id);
                  else next.delete(row.id);
                  setSelectedIds(next);
                }}
                onOpen={() => setParams({ id: row.id })}
                actions={
                  <RowActions
                    row={row}
                    meta={meta}
                    statusOptions={statusOptions}
                    onView={() => setParams({ id: row.id })}
                    onEdit={() => { setEditing(row); closeDetail(); }}
                    onDelete={() => { if (confirm(`Delete this ${meta.label.toLowerCase()}?`)) void doDelete(row.id); }}
                    onStatusChange={async (next) => {
                      try {
                        await patch(`/api/${type}s/${row.id}`, { status: next });
                        await load();
                        toast("success", `${meta.label} status → ${next}`);
                      } catch (e) {
                        toast("error", e instanceof ApiError ? e.message : "Status update failed");
                      }
                    }}
                  />
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Create / edit modal */}
      {(creating || editing) && (
        <ObjectForm
          meta={meta}
          fields={fields}
          permMap={permMap}
          relationOptions={relationOptions}
          pipelines={type === "opportunity" ? pipelines : undefined}
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async (row) => {
            setCreating(false);
            setEditing(null);
            await load();
            setParams({ id: row.id });
            toast("success", editing ? `${meta.label} updated` : `${meta.label} created`);
          }}
        />
      )}

      {/* Detail drawer */}
      {selected && !creating && !editing && (
        <DetailPanel row={selected} meta={meta} fields={fields} visibleColumns={visibleColumns} onClose={closeDetail} onEdit={() => setEditing(selected)} onDeleted={async () => { closeDetail(); await load(); }} />
      )}

      {/* Duplicate merge (Phase 1) */}
      {mergeOpen && (
        <MergeModal
          type={type}
          rows={rows}
          onClose={() => setMergeOpen(false)}
          onDone={async () => { setMergeOpen(false); await load(); }}
        />
      )}
    </div>
  );
}

// ── Duplicate merge (Phase 1) ────────────────────────────────────────────────
function MergeModal({ type, rows, onClose, onDone }: { type: string; rows: Row[]; onClose: () => void; onDone: () => void }) {
  const [masterId, setMasterId] = useState(rows[0]?.id ?? "");
  const [mergeId, setMergeId] = useState(rows[1]?.id ?? "");
  const [choices, setChoices] = useState<Record<string, "master" | "merge">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const master = rows.find((r) => r.id === masterId);
  const merge = rows.find((r) => r.id === mergeId);
  const meta = OBJECT_META[type];
  const fields = meta.formFields;

  const submit = async () => {
    if (!masterId || !mergeId || masterId === mergeId) {
      setError("Pick two different records to merge.");
      return;
    }
    setBusy(true); setError(null);
    try {
      await post(`/api/merge`, { objectType: type, masterId, mergeId, fieldChoices: choices });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  };

  const winner = (k: string) => choices[k] === "merge" ? merge?.[k] : master?.[k] ?? merge?.[k];

  return (
    <Modal open onClose={onClose} title={`Merge duplicate ${meta.plural.toLowerCase()}`} wide>
      <p className="mb-4 text-sm text-slate-500">
        Choose the <span className="text-slate-300">master</span> (kept) and the record to merge into it (deleted). Per-field you can pick which value wins — master by default.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Field label="Master (kept)">
          <select className="input" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
            {rows.map((r) => <option key={r.id} value={r.id}>{r.name ?? `${r.firstName} ${r.lastName}`.trim()}</option>)}
          </select>
        </Field>
        <Field label="Merge into master (deleted)">
          <select className="input" value={mergeId} onChange={(e) => setMergeId(e.target.value)}>
            {rows.map((r) => <option key={r.id} value={r.id}>{r.name ?? `${r.firstName} ${r.lastName}`.trim()}</option>)}
          </select>
        </Field>
      </div>

      <div className="max-h-80 divide-y divide-white/[0.04] overflow-y-auto rounded-xl border border-white/[0.06]">
        {fields.map((k) => {
          const m = master?.[k];
          const g = merge?.[k];
          if (m === undefined && g === undefined) return null;
          return (
            <div key={k} className="flex items-center gap-3 px-4 py-3">
              <span className="w-28 shrink-0 text-xs uppercase tracking-wider text-slate-500">{fieldLabel([], k)}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{String(m ?? "—")}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{String(g ?? "—")}</span>
              <div className="flex shrink-0 gap-1">
                {([["master", "Master"], ["merge", "Merge"]] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setChoices((c) => ({ ...c, [k]: v }))}
                    className={`chip transition-colors ${(choices[k] ?? "master") === v ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : "Merge records"}</button>
      </div>
    </Modal>
  );
}

function Cell({ field, value }: { field: string; value: any }) {
  if (field === "status") return <Badge tone={statusTone(String(value))}>{String(value ?? "—")}</Badge>;
  if (field === "score") return <Badge tone={Number(value) >= 70 ? "green" : Number(value) >= 40 ? "amber" : "default"}>{value ?? "—"}</Badge>;
  if (field === "amount") return <span className="font-medium tabular-nums text-white">{money(value)}</span>;
  if (field === "employees") return <span className="tabular-nums">{value ?? "—"}</span>;
  if (field === "closeDate" || field === "dueAt") return <span className="tabular-nums text-slate-400">{date(value)}</span>;
  if (field === "website" || field === "email") return value ? <a href={field === "email" ? `mailto:${value}` : value} onClick={(e) => e.stopPropagation()} className="text-accent-400 hover:underline">{value}</a> : <span className="text-slate-600">—</span>;
  if (field.endsWith("_label")) return <span className="text-slate-400">{value ?? "—"}</span>;
  return <span className="text-slate-300">{value ?? <span className="text-slate-600">—</span>}</span>;
}

function fieldLabel(core: FieldSpec[], key: string) {
  return core.find((f) => f.key === key)?.label ?? key;
}

function statusTone(s: string): string {
  const map: Record<string, string> = { new: "blue", contacted: "teal", qualified: "amber", converted: "green", customer: "green", lost: "rose", done: "green", won: "green" };
  return map[s] ?? "default";
}

/** Per-row quick actions (spec §23): view, edit, status quick-change, delete. */
function RowActions({ row, meta, statusOptions, onView, onEdit, onDelete, onStatusChange }: {
  row: Row;
  meta: ObjectMeta;
  statusOptions: string[];
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const focusItem = (i: number) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (items.length) items[Math.max(0, Math.min(i, items.length - 1))].focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (!open) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusItem(idx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(idx < 0 ? items.length - 1 : idx - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(items.length - 1); }
  };

  return (
    <div className="relative inline-flex justify-end" ref={ref}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${meta.label}`}
        className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-[var(--surface-hover)] hover:text-white"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div ref={menuRef} role="menu" className="glass absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-xl p-1.5 shadow-2xl shadow-black/40 animate-fade-up">
          <button role="menuitem" onClick={() => { setOpen(false); onView(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-[var(--surface-hover)] hover:text-white">
            <Eye className="size-4 text-teal-400" /> View
          </button>
          <button role="menuitem" onClick={() => { setOpen(false); onEdit(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-[var(--surface-hover)] hover:text-white">
            <Pencil className="size-4 text-accent-400" /> Edit
          </button>
          {statusOptions.length > 0 && row.status !== undefined && (
            <div className="border-t border-[var(--border-subtle)] px-1 py-1">
              <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Set status</div>
              {statusOptions.filter((s) => s !== row.status).map((s) => (
                <button key={s} role="menuitem" onClick={() => { setOpen(false); onStatusChange(s); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm capitalize text-slate-300 transition-colors hover:bg-[var(--surface-hover)] hover:text-white">
                  <span className={`size-1.5 rounded-full ${statusTone(s) === "green" ? "bg-emerald-400" : statusTone(s) === "amber" ? "bg-amber-400" : statusTone(s) === "rose" ? "bg-rose-400" : statusTone(s) === "teal" ? "bg-teal-400" : "bg-slate-500"}`} />
                  {s}
                </button>
              ))}
            </div>
          )}
          <button role="menuitem" onClick={() => { setOpen(false); onDelete(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-400 transition-colors hover:bg-rose-500/15">
            <Trash2 className="size-4" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

/** Mobile record card (spec §76) — title + priority fields, taps to open. */
function RecordCard({ row, meta, fields, visibleColumns, selected, checked, onCheck, onOpen, actions }: {
  row: Row;
  meta: ObjectMeta;
  fields: { core: FieldSpec[] };
  visibleColumns: string[];
  selected: boolean;
  checked: boolean;
  onCheck: (v: boolean) => void;
  onOpen: () => void;
  actions: ReactNode;
}) {
  // The record title is the object's name or first+last; other columns are the
  // card's detail rows (kept to the most important ones for readability).
  const title = meta.titleField === "name" ? row.name ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() : `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || "Untitled";
  const detailCols = visibleColumns.filter((c) => c !== "firstName" && c !== "lastName" && c !== meta.titleField && c !== "status").slice(0, 3);

  return (
    <div className={`card p-4 transition-colors hover:border-[var(--border-strong)] ${selected ? "border-accent-500/50 bg-accent-500/[0.06]" : ""}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Select ${meta.label}`}
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-accent-500"
        />
        {/* Real button for the card body — keyboard-native, no nested interactives */}
        <button
          onClick={onOpen}
          aria-label={`Open ${meta.label} ${title}`}
          className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/60"
        >
          <span className="block truncate text-sm font-semibold text-white">{title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {row.status !== undefined && <Badge tone={statusTone(String(row.status))}>{String(row.status)}</Badge>}
            {detailCols.map((c) => (
              <span key={c} className="text-xs text-slate-500"><Cell field={c} value={row[c]} /></span>
            ))}
          </span>
        </button>
        <div className="shrink-0">{actions}</div>
      </div>
    </div>
  );
}

function ObjectForm({ meta, fields, permMap, relationOptions, pipelines, initial, onClose, onSaved }: {
  meta: ObjectMeta;
  fields: { core: FieldSpec[]; custom: any[] };
  permMap: Record<string, FieldPermInfo>;
  relationOptions?: Record<string, { id: string; label: string }[]>;
  pipelines?: Pipeline[];
  initial: Row | null;
  onClose: () => void;
  onSaved: (row: Row) => void;
}) {
  const [form, setForm] = useState<Record<string, any>>(() => {
    const base: Record<string, any> = {};
    for (const key of meta.formFields) {
      const f = fields.core.find((x) => x.key === key);
      base[key] = initial?.[key] ?? (f?.type === "select" ? f.options?.[0] ?? "" : "");
    }
    for (const c of fields.custom) base[c.key] = initial?.custom?.[c.key] ?? "";
    return base;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const row = initial
        ? await patch<Row>(`/api/${meta.type}s/${initial.id}`, form)
        : await post<Row>(`/api/${meta.type}s`, form);
      onSaved(row);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const allFields = [...meta.formFields.map((k) => fields.core.find((f) => f.key === k)!).filter(Boolean), ...fields.custom]
    .filter((f) => ROLE_WRITE(permMap[f.key]));
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const relOptions = relationOptions ?? {};

  // Phase 2-lite: deal stage options cascade from the selected pipeline. The
  // selected pipeline is the form's pipelineId (or the org default); the current
  // stage is always included so editing a deal on another pipeline never shows
  // a blank/broken select.
  const stageOptionsFor = (): { id: string; label: string }[] | undefined => {
    if (meta.type !== "opportunity" || !pipelines?.length) return undefined;
    const def = pipelines.find((p) => p.id === form.pipelineId) ?? pipelines.find((p) => p.isDefault) ?? pipelines[0];
    const opts = (def?.stages ?? []).map((s) => ({ id: s.key, label: s.label }));
    if (form.stage && !opts.some((o) => o.id === form.stage)) opts.push({ id: form.stage, label: form.stage });
    return opts;
  };
  const stageOptions = stageOptionsFor();

  return (
    <Modal open onClose={onClose} title={`${initial ? "Edit" : "New"} ${meta.label}`} wide>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {allFields.map((f) => (
          <FormControl
            key={f.key}
            spec={f}
            value={form[f.key]}
            onChange={(v) => set(f.key, v)}
            options={f.key === "stage" && stageOptions ? stageOptions : relOptions[f.key]}
          />
        ))}
      </div>
      {error && <div className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : initial ? "Save changes" : "Create"}</button>
      </div>
    </Modal>
  );
}

function FormControl({ spec, value, onChange, options }: { spec: FieldSpec; value: any; onChange: (v: any) => void; options?: { id: string; label: string }[] }) {
  if (options) {
    return (
      <Field label={spec.label}>
        <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">— none —</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
    );
  }
  if (spec.type === "select") {
    return (
      <Field label={spec.label} required={spec.required}>
        <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {spec.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
    );
  }
  if (spec.type === "number" || spec.type === "currency") {
    return (
      <Field label={spec.label} required={spec.required}>
        <input className="input" type="number" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} />
      </Field>
    );
  }
  if (spec.type === "date") {
    return (
      <Field label={spec.label} required={spec.required}>
        <input className="input" type="date" value={value ? String(value).slice(0, 10) : ""} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  if (spec.type === "boolean") {
    return (
      <Field label={spec.label}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-accent-500" />
      </Field>
    );
  }
  return (
    <Field label={spec.label} required={spec.required}>
      <input className="input" type={spec.type === "email" ? "email" : spec.type === "url" ? "url" : "text"} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

type TimelineEntry = { kind: "note" | "email" | "call" | "meeting"; id: string; title: string; subtitle: string; createdAt: string };

function DetailPanel({ row, meta, fields, visibleColumns, onClose, onEdit, onDeleted }: {
  row: Row; meta: ObjectMeta; fields: { core: FieldSpec[]; custom: any[] }; visibleColumns: string[]; onClose: () => void; onEdit: () => void; onDeleted: () => void;
}) {
  const [notes, setNotes] = useState<any[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);

  useEffect(() => {
    void api<{ items: any[] }>(`/api/notes?pageSize=20`).then((d) => {
      setNotes(d.items.filter((n: any) => n.contactId === row.id || n.accountId === row.id || n.opportunityId === row.id));
    }).catch(() => {});
  }, [row.id]);

  // Phase 2 auto-logging: every email/call/meeting/note against this record,
  // newest first, from the aggregated timeline endpoint. `cancelled` guards
  // against a stale response when the user switches records quickly.
  useEffect(() => {
    const ref = meta.type === "account" ? "accountId" : meta.type === "opportunity" ? "opportunityId" : "contactId";
    let cancelled = false;
    void api<{ items: TimelineEntry[] }>(`/api/timeline?${ref}=${row.id}&limit=30`)
      .then((d) => { if (!cancelled) setTimeline(d.items); })
      .catch(() => { if (!cancelled) setTimeline([]); });
    return () => { cancelled = true; };
  }, [row.id, meta.type]);

  // Post the note against the correct reference field for this object type.
  const addNote = async () => {
    if (!noteBody.trim()) return;
    const refField = meta.type === "account" ? "accountId" : meta.type === "opportunity" ? "opportunityId" : "contactId";
    const note = await post("/api/notes", { body: noteBody, [refField]: row.id });
    setNotes((n) => [note, ...n]);
    setNoteBody("");
  };

  const title = meta.titleField === "name" ? row.name : `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();

  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="flex flex-wrap items-center gap-2">{title || "Record"}{row.status && <Badge tone={statusTone(row.status)}>{row.status}</Badge>}</span>}
      footer={
        <div className="flex justify-between gap-2">
          <button className="btn-danger" onClick={() => { if (confirm("Delete this record?")) { void del(`/api/${meta.type}s/${row.id}`).then(onDeleted); } }}>
            <Trash2 className="size-4" /> Delete
          </button>
          <button className="btn-primary" onClick={onEdit}><Pencil className="size-4" /> Edit</button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {row.tags?.map((t: string) => <Badge key={t} tone="teal">{t}</Badge>)}
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {visibleColumns.map((c: string) => (
          <div key={c} className="flex items-center justify-between border-b border-white/[0.04] pb-2">
            <span className="text-xs uppercase tracking-wider text-slate-500">{fieldLabel(fields.core, c)}</span>
            <span className="text-sm text-slate-200"><Cell field={c} value={row[c]} /></span>
          </div>
        ))}
        {Object.entries(row.custom ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b border-white/[0.04] pb-2">
            <span className="text-xs uppercase tracking-wider text-slate-500">{fields.custom.find((f: any) => f.key === k)?.label ?? k}</span>
            <span className="text-sm text-slate-200">{String(v)}</span>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">Timeline <span className="text-slate-600">(auto-logged)</span></div>
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {timeline.map((t) => (
            <div key={`${t.kind}-${t.id}`} className="flex items-start gap-3 rounded-xl bg-ink-800/50 border border-white/[0.05] px-4 py-3">
              <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${t.kind === "email" ? "bg-accent-500/15 text-accent-300" : t.kind === "call" ? "bg-mint-500/15 text-mint-400" : t.kind === "meeting" ? "bg-teal-500/15 text-teal-400" : "bg-white/[0.06] text-slate-500"}`}>
                {t.kind === "email" ? <Mail className="size-3.5" /> : t.kind === "call" ? <Phone className="size-3.5" /> : t.kind === "meeting" ? <CalendarDays className="size-3.5" /> : <StickyNote className="size-3.5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-slate-200">{t.title}</span>
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-slate-600">{t.kind}</span>
                </div>
                <p className="truncate text-xs text-slate-500">{t.subtitle}</p>
                <p className="mt-0.5 text-[11px] text-slate-700">{new Date(t.createdAt).toLocaleString()}</p>
              </div>
            </div>
          ))}
          {timeline.length === 0 && <p className="text-xs text-slate-600">No activity yet — emails, calls and meetings against this record appear here automatically.</p>}
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">Notes</div>
        <div className="flex gap-2">
          <input className="input" placeholder="Add a note…" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} />
          <button className="btn-primary shrink-0" onClick={addNote}>Add</button>
        </div>
        <div className="mt-3 space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-xl bg-ink-800/50 border border-white/[0.05] px-4 py-3">
              <p className="text-sm text-slate-300">{n.body}</p>
              <p className="mt-1 text-xs text-slate-600">{new Date(n.createdAt).toLocaleString()}</p>
            </div>
          ))}
          {notes.length === 0 && <p className="text-xs text-slate-600">No notes yet.</p>}
        </div>
      </div>

    </Drawer>
  );
}
