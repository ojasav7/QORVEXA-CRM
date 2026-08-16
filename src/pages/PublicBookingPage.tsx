import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, ChevronRight, Clock, Loader2 } from "lucide-react";

type BookingConfig = {
  name: string;
  description: string | null;
  durationMins: number;
  bufferMins: number;
  timezone: string;
  slug: string;
  startHour: number;
  endHour: number;
};

type Slot = { start: string; available: boolean };

const HONEYPOT = "company_name"; // must match server/routes/public-booking.ts

export default function PublicBookingPage() {
  const { slug = "" } = useParams();
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", notes: "", [HONEYPOT]: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/public/booking/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then(setConfig)
      .catch(() => setError("This booking page is no longer available."));
  }, [slug]);

  // Next 14 days for the date rail — local calendar date (YYYY-MM-DD), so the
  // day the user sees is the day sent to the slots endpoint (which treats the
  // date string as UTC wall-clock, matching the server's slot math).
  const days = useMemo(() => {
    const out: { iso: string; label: string }[] = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const iso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    for (let i = 0; i < 14; i++) {
      out.push({
        iso: iso(d),
        label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, []);

  useEffect(() => {
    if (!date) return;
    setLoadingSlots(true);
    setSelected(null);
    setError(null);
    fetch(`/api/public/booking/${slug}/slots?date=${date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d) => setSlots(d.slots as Slot[]))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [date, slug]);

  const openSlots = (slots ?? []).filter((s) => s.available);
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const submit = async () => {
    if (!selected || !config) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/public/booking/${config.slug}/book`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, startsAt: selected, [HONEYPOT]: form[HONEYPOT] ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Booking failed");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="card w-full max-w-md p-8 text-center">
          <p className="text-sm text-rose-400">{error}</p>
        </div>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="flex min-h-full items-center justify-center p-4">
        <Loader2 className="size-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (done) {
    return (
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="card w-full max-w-md animate-fade-up p-8 text-center">
          <CheckCircle2 className="mx-auto mb-4 size-12 text-mint-400" />
          <h1 className="text-lg font-bold text-white">You're booked in!</h1>
          <p className="mt-2 text-sm text-slate-500">
            {selected && <>Your {config.durationMins}-minute slot on {new Date(selected).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} is confirmed. The host will reach out.</>}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="card w-full max-w-lg animate-fade-up p-8">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-teal-500 text-xl font-bold text-on-brand shadow-xl shadow-accent-500/30">
            <CalendarDays className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">{config.name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-slate-500">
              <span className="flex items-center gap-1"><Clock className="size-3.5" /> {config.durationMins} min</span>
              <span>·</span>
              <span>{config.timezone}</span>
            </p>
          </div>
        </div>
        {config.description && <p className="mb-6 text-sm text-slate-400">{config.description}</p>}

        <div className="mb-5">
          <div className="label">Pick a day</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {days.map((d) => (
              <button
                key={d.iso}
                onClick={() => { setError(null); setDate(d.iso); }}
                className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${date === d.iso ? "border-accent-500/50 bg-accent-500/15 text-white" : "border-white/[0.07] bg-ink-800/50 text-slate-400 hover:text-white"}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {loadingSlots && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Checking availability…
          </div>
        )}
        {!loadingSlots && date && slots && openSlots.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/[0.08] py-8 text-center text-sm text-slate-500">No open slots that day — try another date.</div>
        )}
        {!loadingSlots && date && openSlots.length > 0 && (
          <div className="mb-5">
            <div className="label">Pick a time</div>
            <div className="flex flex-wrap gap-1.5">
              {openSlots.map((s) => (
                <button
                  key={s.start}
                  onClick={() => { setError(null); setSelected(s.start); }}
                  className={`rounded-xl border px-3.5 py-2 text-xs font-medium tabular-nums transition-colors ${selected === s.start ? "border-accent-500/50 bg-accent-500/15 text-white" : "border-white/[0.07] bg-ink-800/50 text-slate-300 hover:text-white"}`}
                >
                  {fmtTime(s.start)}
                </button>
              ))}
            </div>
          </div>
        )}

        {selected && (
          <div className="space-y-4 border-t border-white/[0.06] pt-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Your name <span className="text-rose-400">*</span></label>
                <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Work email <span className="text-rose-400">*</span></label>
                <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">Anything to prepare?</label>
              <textarea className="input min-h-20" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {/* Honeypot — hidden from humans, bots fill it */}
            <div className="hidden" aria-hidden>
              <label>Company name<input className="input" tabIndex={-1} autoComplete="off" value={form[HONEYPOT]} onChange={(e) => setForm({ ...form, [HONEYPOT]: e.target.value })} /></label>
            </div>
            {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
            <button className="btn-primary w-full" onClick={submit} disabled={busy || !form.name.trim() || !form.email.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ChevronRight className="size-4" />} Confirm booking
            </button>
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-slate-600">
          <CalendarDays className="size-3" /> Powered by QORVEXA
        </div>
      </div>
    </div>
  );
}
