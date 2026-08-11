import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, CalendarClock, Check, Share2 } from "lucide-react";
import { api, del, patch, post, ApiError, type User } from "../lib/api";
import { Badge, EmptyState, Field, Modal, Spinner } from "../components/ui";
import { useSession } from "../App";

type BookingPage = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  durationMins: number;
  bufferMins: number;
  hostPool: string[];
  availableDays: number[];
  startHour: number;
  endHour: number;
  timezone: string;
  active: boolean;
  createdAt: string;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function BookingPagesPage() {
  const [pages, setPages] = useState<BookingPage[]>([]);
  const [editing, setEditing] = useState<BookingPage | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: BookingPage[] }>("/api/booking-pages");
      setPages(d.items);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to load booking pages" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const copy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };
  const url = (p: BookingPage) => `${window.location.origin}/b/${p.slug}`;

  const toggleActive = async (p: BookingPage) => {
    try {
      await patch(`/api/booking-pages/${p.id}`, { active: !p.active });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };

  const remove = async (p: BookingPage) => {
    if (!confirm(`Delete booking page "${p.name}"? Its public URL stops working immediately.`)) return;
    try {
      await del(`/api/booking-pages/${p.id}`);
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Booking pages</h1>
          <p className="text-sm text-slate-500">Shareable scheduling links — prospects book themselves, hosts are assigned round-robin, and each booking becomes a meeting on the calendar.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New booking page</button>
      </div>

      {msg && <div className={`mb-3 rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{msg.text}</div>}

      <div className="card divide-y divide-white/[0.04]">
        {pages.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
            <CalendarClock className={`size-4 ${p.active ? "text-mint-400" : "text-slate-600"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">{p.name}</span>
                <span className="font-mono text-xs text-slate-600">/b/{p.slug}</span>
                <Badge tone={p.active ? "green" : "rose"}>{p.active ? "live" : "paused"}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {p.durationMins} min + {p.bufferMins} min buffer · {DAY_NAMES.filter((_, i) => p.availableDays.includes(i)).join(", ")} · {p.startHour}:00–{p.endHour}:00 · {p.timezone} · {p.hostPool.length} host{p.hostPool.length === 1 ? "" : "s"}
              </div>
            </div>
            <button className="btn-ghost !px-3 !py-1.5" onClick={() => copy(url(p), `url-${p.id}`)} title="Copy public link">
              {copied === `url-${p.id}` ? <Check className="size-4 text-mint-400" /> : <Share2 className="size-4" />} Link
            </button>
            <button className="btn-ghost !px-3 !py-1.5" onClick={() => void toggleActive(p)}>{p.active ? "Pause" : "Publish"}</button>
            <button className="btn-ghost !px-3 !py-1.5" onClick={() => setEditing(p)}><Pencil className="size-3.5" /> Edit</button>
            <button onClick={() => void remove(p)} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><Trash2 className="size-4" /></button>
          </div>
        ))}
        {pages.length === 0 && (
          <EmptyState icon={<CalendarClock className="size-8" />} title="No booking pages yet" hint="Create one to get a shareable scheduling link — bookings auto-assign hosts round-robin and land on the calendar." />
        )}
      </div>

      {(creating || editing) && (
        <BookingPageModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function BookingPageModal({ initial, onClose, onDone }: { initial: BookingPage | null; onClose: () => void; onDone: () => void }) {
  const { user } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    slug: initial?.slug ?? "",
    description: initial?.description ?? "",
    durationMins: initial?.durationMins ?? 30,
    bufferMins: initial?.bufferMins ?? 5,
    hostPool: initial?.hostPool ?? [],
    availableDays: initial?.availableDays ?? [1, 2, 3, 4, 5],
    startHour: initial?.startHour ?? 9,
    endHour: initial?.endHour ?? 17,
    timezone: initial?.timezone ?? "UTC",
    active: initial?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: User[] }>("/api/users").then((d) => setUsers(d.items.filter((u) => u.active))).catch(() => {});
  }, []);

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

  const toggleHost = (id: string) => setForm((f) => ({ ...f, hostPool: f.hostPool.includes(id) ? f.hostPool.filter((x) => x !== id) : [...f.hostPool, id] }));
  const toggleDay = (d: number) => setForm((f) => ({ ...f, availableDays: f.availableDays.includes(d) ? f.availableDays.filter((x) => x !== d) : [...f.availableDays, d].sort() }));

  const submit = async () => {
    if (!form.name.trim()) return setError("Name is required.");
    if (!form.slug.trim()) return setError("Slug is required.");
    if (form.hostPool.length === 0) return setError("Add at least one host to the pool — bookings assign the next available host.");
    if (form.availableDays.length === 0) return setError("Pick at least one available day.");
    setBusy(true); setError(null);
    try {
      const body = { ...form, description: form.description.trim() || undefined };
      if (initial) await patch(`/api/booking-pages/${initial.id}`, body);
      else await post("/api/booking-pages", body);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit booking page — ${initial.name}` : "New booking page"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Page name" required><input className="input" placeholder="e.g. Intro call" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Slug" required><input className="input font-mono" placeholder="intro-call" value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} /><span className="text-[11px] text-slate-600">public URL: /b/{form.slug || "…"}</span></Field>
        </div>
        <Field label="Description"><input className="input" placeholder="What prospects should expect…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Duration (min)" required><input className="input" type="number" min={10} max={240} value={form.durationMins} onChange={(e) => setForm({ ...form, durationMins: Number(e.target.value) || 0 })} /></Field>
          <Field label="Buffer (min)"><input className="input" type="number" min={0} max={60} value={form.bufferMins} onChange={(e) => setForm({ ...form, bufferMins: Number(e.target.value) || 0 })} /></Field>
          <Field label="Timezone"><input className="input" placeholder="UTC" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Host pool (round-robin)">
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {users.map((u) => (
                <button key={u.id} onClick={() => toggleHost(u.id)} className={`chip transition-colors ${form.hostPool.includes(u.id) ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}>
                  {u.name} · <span className="capitalize">{u.role}</span>
                  {u.id === user?.id && <span className="text-slate-500"> (you)</span>}
                </button>
              ))}
              {users.length === 0 && <span className="text-xs text-slate-600">Invite team members first (Settings → Team).</span>}
            </div>
          </Field>
          <Field label="Available days">
            <div className="flex flex-wrap gap-1.5">
              {DAY_NAMES.map((d, i) => (
                <button key={d} onClick={() => toggleDay(i)} className={`chip transition-colors ${form.availableDays.includes(i) ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}>{d}</button>
              ))}
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Start hour"><input className="input" type="number" min={0} max={23} value={form.startHour} onChange={(e) => setForm({ ...form, startHour: Number(e.target.value) || 0 })} /></Field>
          <Field label="End hour"><input className="input" type="number" min={1} max={24} value={form.endHour} onChange={(e) => setForm({ ...form, endHour: Number(e.target.value) || 24 })} /></Field>
        </div>

        <label className="flex items-center gap-2.5 text-sm text-slate-300">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="size-4 accent-accent-500" />
          Live — accept bookings immediately
        </label>

        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : initial ? "Save changes" : <CalendarClock className="size-4" />} Create page</button>
        </div>
      </div>
    </Modal>
  );
}
