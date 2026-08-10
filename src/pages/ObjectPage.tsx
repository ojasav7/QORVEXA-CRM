import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Plus, Search, Pencil, Trash2, Download, Network, GitMerge } from "lucide-react";
import { api, del, patch, post, downloadCsv, ApiError } from "../lib/api";
import { OBJECT_META, type FieldSpec, type ObjectMeta } from "../lib/objects";
import { Badge, EmptyState, Field, Modal, Spinner } from "../components/ui";
import { money, date } from "../lib/format";

type FieldPermInfo = { fieldKey: string; read: boolean; write: boolean; readRoles: string[]; writeRoles: string[] };
const ROLE_READ = (p?: FieldPermInfo) => p === undefined || p.read;
const ROLE_WRITE = (p?: FieldPermInfo) => p === undefined || p.write;

type Row = Record<string, any>;

export default function ObjectPage({ type }: { type: string }) {
  const meta = OBJECT_META[type];
  const navigate = useNavigate();
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
  const selectedId = params.get("id");

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

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const closeDetail = () => {
    const next = new URLSearchParams(params);
    next.delete("id");
    setParams(next);
  };

  const statusOptions = fields.core.find((f) => f.key === "status")?.options ?? [];

  const permMap = useMemo(() => Object.fromEntries(fields.permissions.map((p) => [p.fieldKey, p])), [fields.permissions]);
  const visibleColumns = useMemo(() => meta.columns.filter((c) => ROLE_READ(permMap[c])), [meta.columns, permMap]);

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
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete");
    }
  };

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">{meta.plural}</h1>
          <p className="text-sm text-slate-500">{total} records · {type}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="input w-52 pl-9" />
          </div>
          {statusOptions.length > 0 && (
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="input w-40">
              <option value="">All statuses</option>
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button className="btn-ghost" onClick={exportCsv} title="Export visible records as CSV"><Download className="size-4" /> Export CSV</button>
          {type === "account" && (
            <button className="btn-ghost" onClick={() => navigate("/accounts/hierarchy")} title="Account hierarchy tree"><Network className="size-4" /> Hierarchy</button>
          )}
          {["contact", "account", "lead"].includes(type) && (
            <button className="btn-ghost" onClick={() => setMergeOpen(true)} title="Merge duplicate records"><GitMerge className="size-4" /> Merge duplicates</button>
          )}
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New {meta.label}</button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-6">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title={`No ${meta.plural.toLowerCase()} yet`} hint={`Click “New ${meta.label}” to create your first record.`} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-slate-500">
                {visibleColumns.map((c) => <th key={c} className="px-4 py-3 font-medium">{fieldLabel(fields.core, c)}</th>)}
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setParams({ id: row.id })}
                  className={`cursor-pointer border-b border-white/[0.03] transition-colors hover:bg-white/[0.03] ${selectedId === row.id ? "bg-accent-500/[0.07]" : ""}`}
                >
                  {visibleColumns.map((c) => (
                    <td key={c} className="px-4 py-3">
                      <Cell field={c} value={row[c]} />
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button onClick={() => { setEditing(row); closeDetail(); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><Pencil className="size-4" /></button>
                      <button onClick={() => { if (confirm(`Delete this ${meta.label.toLowerCase()}?`)) void doDelete(row.id); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400"><Trash2 className="size-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / edit modal */}
      {(creating || editing) && (
        <ObjectForm
          meta={meta}
          fields={fields}
          permMap={permMap}
          relationOptions={relationOptions}
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async (row) => {
            setCreating(false);
            setEditing(null);
            await load();
            setParams({ id: row.id });
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
  const map: Record<string, string> = { new: "blue", contacted: "violet", qualified: "amber", converted: "green", customer: "green", lost: "rose", done: "green", won: "green" };
  return map[s] ?? "default";
}

function ObjectForm({ meta, fields, permMap, relationOptions, initial, onClose, onSaved }: {
  meta: ObjectMeta;
  fields: { core: FieldSpec[]; custom: any[] };
  permMap: Record<string, FieldPermInfo>;
  relationOptions?: Record<string, { id: string; label: string }[]>;
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

  return (
    <Modal open onClose={onClose} title={`${initial ? "Edit" : "New"} ${meta.label}`} wide>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {allFields.map((f) => <FormControl key={f.key} spec={f} value={form[f.key]} onChange={(v) => set(f.key, v)} options={relOptions[f.key]} />)}
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

function DetailPanel({ row, meta, fields, visibleColumns, onClose, onEdit, onDeleted }: {
  row: Row; meta: ObjectMeta; fields: { core: FieldSpec[]; custom: any[] }; visibleColumns: string[]; onClose: () => void; onEdit: () => void; onDeleted: () => void;
}) {
  const [notes, setNotes] = useState<any[]>([]);
  const [noteBody, setNoteBody] = useState("");

  useEffect(() => {
    void api<{ items: any[] }>(`/api/notes?pageSize=20`).then((d) => {
      setNotes(d.items.filter((n: any) => n.contactId === row.id || n.accountId === row.id || n.opportunityId === row.id));
    }).catch(() => {});
  }, [row.id]);

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
    <Modal open onClose={onClose} title={title || "Record"} wide>
      <div className="mb-4 flex flex-wrap gap-2">
        {row.tags?.map((t: string) => <Badge key={t} tone="violet">{t}</Badge>)}
        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
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

      <div className="mt-6 flex justify-between">
        <button className="btn-danger" onClick={() => { if (confirm("Delete this record?")) { void del(`/api/${meta.type}s/${row.id}`).then(onDeleted); } }}>
          <Trash2 className="size-4" /> Delete
        </button>
        <button className="btn-primary" onClick={onEdit}><Pencil className="size-4" /> Edit</button>
      </div>
    </Modal>
  );
}
