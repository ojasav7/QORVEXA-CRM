import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Trash2, CheckCircle2, XCircle, CalendarClock, Video, MapPin } from "lucide-react";
import { api, del, patch, post, ApiError } from "../lib/api";
import { Badge, EmptyState, Field, Modal, Spinner } from "../components/ui";
import { timeAgo } from "../lib/format";

type Meeting = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed" | "cancelled" | "no-show";
  location: string | null;
  notes: string | null;
  attendeeName: string | null;
  contactId: string | null;
  ownerId: string;
  createdAt: string;
};

type ContactOption = { id: string; label: string };

const statusTone: Record<Meeting["status"], "blue" | "green" | "rose" | "amber"> = {
  scheduled: "blue",
  completed: "green",
  cancelled: "rose",
  "no-show": "amber",
};

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      // upcoming + recently completed, capped at 200
      const d = await api<{ items: Meeting[] }>("/api/meetings?pageSize=200");
      setMeetings(d.items);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to load meetings" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setStatus = async (m: Meeting, status: Meeting["status"]) => {
    try {
      await patch(`/api/meetings/${m.id}`, { status });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };

  const remove = async (m: Meeting) => {
    if (!confirm(`Delete meeting "${m.title}"?`)) return;
    try {
      await del(`/api/meetings/${m.id}`);
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };

  const groups = useMemo(() => {
    const sorted = [...meetings].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const map = new Map<string, Meeting[]>();
    for (const m of sorted) {
      const key = new Date(m.startsAt).toDateString();
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [meetings]);

  const isUpcoming = (m: Meeting) => m.status === "scheduled" && new Date(m.endsAt).getTime() > Date.now() - 30 * 60_000;

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Calendar</h1>
          <p className="text-sm text-slate-500">Meetings & bookings — public booking-page slots land here as scheduled meetings on the assigned host's calendar.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Schedule meeting</button>
      </div>

      {msg && <div className={`mb-3 rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{msg.text}</div>}

      {groups.length === 0 && (
        <div className="card">
          <EmptyState icon={<CalendarDays className="size-8" />} title="No meetings yet" hint="Schedule a meeting, or publish a booking page and share its URL — prospects book themselves into your calendar." />
        </div>
      )}

      <div className="space-y-6">
        {groups.map(([day, items]) => (
          <div key={day}>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
              <CalendarClock className="size-3.5" />
              {new Date(day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              <span className="text-slate-700">· {items.length} meeting{items.length === 1 ? "" : "s"}</span>
            </div>
            <div className="card divide-y divide-white/[0.04]">
              {items.map((m) => (
                <div key={m.id} className={`flex flex-wrap items-center gap-3 px-5 py-4 ${m.status === "cancelled" ? "opacity-60" : ""}`}>
                  <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${isUpcoming(m) ? "bg-accent-500/15 text-accent-300" : "bg-white/[0.06] text-slate-500"}`}>
                    {isUpcoming(m) ? <Video className="size-4" /> : <CheckCircle2 className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">{m.title}</span>
                      <Badge tone={statusTone[m.status]}>{m.status}</Badge>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                      <span>{new Date(m.startsAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} – {new Date(m.endsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                      {m.location && m.location !== "virtual" && <><span>·</span><span className="flex items-center gap-1"><MapPin className="size-3" /> {m.location}</span></>}
                      {m.attendeeName && <><span>·</span><span>{m.attendeeName}</span></>}
                      <span>·</span>
                      <span>created {timeAgo(m.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {m.status === "scheduled" && (
                      <>
                        <button className="btn-ghost !px-3 !py-1.5" onClick={() => void setStatus(m, "completed")}><CheckCircle2 className="size-3.5" /> Complete</button>
                        <button className="btn-ghost !px-3 !py-1.5" onClick={() => void setStatus(m, "cancelled")}><XCircle className="size-3.5" /> Cancel</button>
                      </>
                    )}
                    {m.status !== "scheduled" && (
                      <button className="btn-ghost !px-3 !py-1.5" onClick={() => void setStatus(m, "scheduled")}>Reopen</button>
                    )}
                    <button onClick={() => void remove(m)} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><Trash2 className="size-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {creating && <MeetingModal onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); }} />}
    </div>
  );
}

function MeetingModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [form, setForm] = useState({ title: "", date: "", time: "", duration: "30", location: "virtual", notes: "", contactId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: { id: string; firstName: string; lastName: string }[] }>("/api/contacts?pageSize=200").then((d) =>
      setContacts(d.items.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}` })))
    ).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.title.trim() || !form.date || !form.time) return setError("Title, date and time are required.");
    const starts = new Date(`${form.date}T${form.time}`);
    if (Number.isNaN(starts.getTime())) return setError("Invalid start time.");
    const ends = new Date(starts.getTime() + Number(form.duration) * 60_000);
    setBusy(true); setError(null);
    try {
      await post("/api/meetings", {
        title: form.title.trim(),
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        location: form.location || "virtual",
        notes: form.notes.trim() || undefined,
        contactId: form.contactId || undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to schedule");
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Modal open onClose={onClose} title="Schedule meeting">
      <div className="space-y-4">
        <Field label="Title" required><input className="input" placeholder="e.g. Discovery call — Elena" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Date" required><input className="input" type="date" min={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Time" required><input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
          <Field label="Duration">
            <select className="input" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })}>
              {["15", "30", "45", "60", "90"].map((d) => <option key={d} value={d} className="bg-ink-850">{d} min</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Linked contact">
            <select className="input" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
              <option value="" className="bg-ink-850">None</option>
              {contacts.map((c) => <option key={c.id} value={c.id} className="bg-ink-850">{c.label}</option>)}
            </select>
          </Field>
          <Field label="Location">
            <select className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
              <option value="virtual" className="bg-ink-850">Virtual</option>
              <option value="phone" className="bg-ink-850">Phone</option>
              <option value="office" className="bg-ink-850">Office</option>
            </select>
          </Field>
        </div>
        <Field label="Notes"><textarea className="input min-h-20" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : <CalendarDays className="size-4" />} Schedule</button>
        </div>
      </div>
    </Modal>
  );
}
