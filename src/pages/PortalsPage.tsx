import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ExternalLink, Globe } from "lucide-react";
import { api, del, patch, post, ApiError } from "../lib/api";
import { Badge, EmptyState, Field, Modal, Spinner } from "../components/ui";
import { useSession } from "../App";

type Portal = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  autoCreateContact: boolean;
  active: boolean;
  createdAt: string;
};

export default function PortalsPage() {
  const { user } = useSession();
  const [portals, setPortals] = useState<Portal[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Portal | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items: Portal[] }>("/api/portals");
      setPortals(d.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load portals");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const remove = async (p: Portal) => {
    if (!confirm(`Delete portal "${p.name}"? The public page /p/${p.slug} will stop working.`)) return;
    try {
      await del(`/api/portals/${p.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete");
    }
  };

  const isAdmin = user?.role === "admin";

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Support portals</h1>
          <p className="text-sm text-slate-500">Public self-service pages — customers submit tickets and track them by reference.</p>
        </div>
        {isAdmin && (
          <button className="btn-primary ml-auto" onClick={() => setCreating(true)}><Plus className="size-4" /> New portal</button>
        )}
      </div>
      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-36" />)}
        </div>
      ) : portals.length === 0 ? (
        <EmptyState icon={<Globe className="size-8" />} title="No portals yet" hint="Create one to publish a customer support page — e.g. /p/support." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {portals.map((p) => (
            <div key={p.id} className={`card p-5 ${p.active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex size-9 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400"><Globe className="size-4" /></div>
                <Badge tone={p.active ? "green" : "default"}>{p.active ? "live" : "paused"}</Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-white">{p.name}</h3>
              <p className="mt-1 line-clamp-2 min-h-8 text-xs text-slate-500">{p.description || "No description"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone="blue">/p/{p.slug}</Badge>
                {p.autoCreateContact ? <Badge tone="violet">auto-contact</Badge> : <Badge tone="default">no auto-contact</Badge>}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3">
                <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-accent-400 hover:underline">
                  <ExternalLink className="size-3" /> Open portal
                </a>
                {isAdmin && (
                  <div className="flex gap-1">
                    <button onClick={() => setEditing(p)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><Pencil className="size-3.5" /></button>
                    <button onClick={() => void remove(p)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <PortalModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function PortalModal({ initial, onClose, onDone }: { initial: Portal | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    slug: initial?.slug ?? "",
    description: initial?.description ?? "",
    autoCreateContact: initial?.autoCreateContact ?? true,
    active: initial?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!form.name.trim() || !form.slug.trim()) { setError("Name and slug are required"); return; }
    setBusy(true); setError(null);
    try {
      const body = { ...form, description: form.description || undefined };
      if (initial) await patch(`/api/portals/${initial.id}`, body);
      else await post("/api/portals", body);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? "Edit portal" : "New portal"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Qorvexa Support" /></Field>
          <Field label="Slug" required><input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="support" /></Field>
        </div>
        <Field label="Description"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-6">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.autoCreateContact} onChange={(e) => setForm({ ...form, autoCreateContact: e.target.checked })} className="size-4 accent-accent-500" />
            Auto-create contacts by email
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="size-4 accent-accent-500" />
            Active
          </label>
        </div>
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : initial ? "Save changes" : "Create portal"}</button>
        </div>
      </div>
    </Modal>
  );
}
