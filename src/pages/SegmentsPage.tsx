import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ListFilter, Users, X } from "lucide-react";
import { api, del, patch, post, ApiError } from "../lib/api";
import { Badge, Field, Modal, Spinner, EmptyState } from "../components/ui";
import { timeAgo } from "../lib/format";

type Segment = { id: string; name: string; description: string | null; objectType: string; criteria: { filters: { field: string; op: string; value: unknown }[] }; active: boolean; memberCount: number; createdAt: string };
type Member = Record<string, any>;
type CoreField = { key: string; label: string; type: string; options?: string[] };

const OBJECT_TYPES = ["contact", "account", "lead", "opportunity", "task"];
const OPS = [
  ["eq", "is"], ["neq", "is not"], ["contains", "contains"], ["not_contains", "doesn't contain"],
  ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["in", "is one of"], ["not_in", "is none of"],
];

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Segment | null>(null);
  const [viewing, setViewing] = useState<Segment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items: Segment[] }>("/api/segments");
      setSegments(d.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load segments");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const remove = async (s: Segment) => {
    if (!confirm(`Delete segment "${s.name}"?`)) return;
    try {
      await del(`/api/segments/${s.id}`);
      if (viewing?.id === s.id) setViewing(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  };

  const typeTone: Record<string, string> = { contact: "blue", account: "green", lead: "teal", opportunity: "amber", task: "default" };

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Segments</h1>
          <p className="text-sm text-slate-500">Dynamic lists — membership is recomputed live from each segment's filters.</p>
        </div>
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)}><Plus className="size-4" /> New segment</button>
      </div>
      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-32" />)}
        </div>
      ) : segments.length === 0 ? (
        <EmptyState title="No segments yet" hint="Create one — e.g. leads with score ≥ 50, or contacts whose status is qualified." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map((s) => (
            <div key={s.id} className="card group cursor-pointer p-5 transition-colors hover:border-accent-500/40" onClick={() => setViewing(s)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex size-9 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400"><ListFilter className="size-4" /></div>
                <Badge tone={(typeTone[s.objectType] as any) ?? "default"}>{s.objectType}</Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-white">{s.name}</h3>
              <p className="mt-1 line-clamp-2 min-h-8 text-xs text-slate-500">{s.description || "No description"}</p>
              <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3">
                <span className="flex items-center gap-1.5 text-xs text-slate-400"><Users className="size-3.5" /> {s.memberCount} members</span>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setEditing(s)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><Pencil className="size-3.5" /></button>
                  <button onClick={() => void remove(s)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && <MembersPanel segment={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} />}
      {(creating || editing) && (
        <SegmentModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function MembersPanel({ segment, onClose, onEdit }: { segment: Segment; onClose: () => void; onEdit: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api<{ items: Member[]; total: number }>(`/api/segments/${segment.id}/members?pageSize=50`).then((d) => {
      setMembers(d.items); setTotal(d.total);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [segment.id]);

  const title = (m: Member) => m.name ?? (`${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || m.title || m.id.slice(0, 8));

  return (
    <Modal open onClose={onClose} title={`${segment.name} — ${total} members`} wide>
      <p className="mb-4 text-xs text-slate-500">Filters: {segment.criteria?.filters?.length ? segment.criteria.filters.map((f) => `${f.field} ${f.op} ${String(f.value)}`).join(" · ") : "all records"}</p>
      <button className="btn-ghost mb-3 !px-3 !py-1.5" onClick={onEdit}><Pencil className="size-3.5" /> Edit segment</button>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-10" />)}</div>
      ) : members.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-600">No records currently match this segment.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Owner</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-white/[0.03]">
                <td className="px-3 py-2.5 text-slate-200">{title(m)}</td>
                <td className="px-3 py-2.5 text-slate-500">{m.email ?? "—"}</td>
                <td className="px-3 py-2.5"><Badge>{m.status ?? "—"}</Badge></td>
                <td className="px-3 py-2.5 text-slate-500">{m.ownerName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function SegmentModal({ initial, onClose, onDone }: { initial: Segment | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    objectType: initial?.objectType ?? "lead",
    filters: initial?.criteria?.filters?.length ? initial.criteria.filters.map((f) => ({ ...f })) : [{ field: "status", op: "eq", value: "new" }],
  });
  const [fields, setFields] = useState<CoreField[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ core: CoreField[] }>(`/api/fields/${form.objectType}`).then((d) => setFields(d.core)).catch(() => {});
  }, [form.objectType]);

  const setFilter = (i: number, patch: Partial<{ field: string; op: string; value: unknown }>) => {
    setForm((f) => ({ ...f, filters: f.filters.map((row, idx) => idx === i ? { ...row, ...patch } : row) }));
  };

  const submit = async () => {
    if (!form.name.trim()) { setError("Name is required"); return; }
    setBusy(true); setError(null);
    const body = { name: form.name, description: form.description || undefined, objectType: form.objectType, criteria: { filters: form.filters.filter((f) => f.field && f.op) } };
    try {
      if (initial) await patch(`/api/segments/${initial.id}`, body);
      else await post("/api/segments", body);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? "Edit segment" : "New segment"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Hot leads" /></Field>
          <Field label="Object type">
            <select className="input" value={form.objectType} onChange={(e) => setForm({ ...form, objectType: e.target.value })}>
              {OBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Description"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What does this list capture?" /></Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Filters (all must match)</span>
            <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setForm((f) => ({ ...f, filters: [...f.filters, { field: fields[0]?.key ?? "status", op: "eq", value: "" }] }))}>
              <Plus className="size-3" /> Add filter
            </button>
          </div>
          <div className="space-y-2">
            {form.filters.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className="input w-36" value={f.field} onChange={(e) => setFilter(i, { field: e.target.value })}>
                  {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                <select className="input w-32" value={f.op} onChange={(e) => setFilter(i, { op: e.target.value })}>
                  {OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input
                  className="input min-w-0 flex-1"
                  placeholder={fields.find((x) => x.key === f.field)?.type === "number" ? "number" : "value"}
                  value={String(f.value ?? "")}
                  onChange={(e) => setFilter(i, { value: e.target.value })}
                />
                <button onClick={() => setForm((s) => ({ ...s, filters: s.filters.filter((_, idx) => idx !== i) }))} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><X className="size-4" /></button>
              </div>
            ))}
          </div>
        </div>

        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : initial ? "Save changes" : "Create segment"}</button>
        </div>
      </div>
    </Modal>
  );
}
