import { useCallback, useEffect, useState } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, Plus, Trash2, Mic, FileText } from "lucide-react";
import { api, del, post, ApiError } from "../lib/api";
import { Badge, EmptyState, Field, Modal, Spinner } from "../components/ui";
import { timeAgo } from "../lib/format";

type Call = {
  id: string;
  direction: "in" | "out";
  phone: string;
  durationSec: number;
  status: "completed" | "no-answer" | "voicemail";
  recordingUrl: string | null;
  transcript: string | null;
  notes: string | null;
  contactId: string | null;
  accountId: string | null;
  opportunityId: string | null;
  startedAt: string;
};

type ContactOption = { id: string; label: string };

const statusTone: Record<Call["status"], "green" | "amber" | "default"> = { completed: "green", "no-answer": "amber", voicemail: "default" };

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [logging, setLogging] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: Call[] }>("/api/calls?pageSize=50");
      setCalls(d.items);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to load calls" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const remove = async (c: Call) => {
    if (!confirm("Delete this call log entry?")) return;
    try {
      await del(`/api/calls/${c.id}`);
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed" });
    }
  };

  const fmtDur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Calls</h1>
          <p className="text-sm text-slate-500">Click-to-call from any record, plus a full call log with optional recording + transcription (mock provider).</p>
        </div>
        <button className="btn-primary" onClick={() => setLogging(true)}><Plus className="size-4" /> Log a call</button>
      </div>

      {msg && <div className={`mb-3 rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{msg.text}</div>}

      <div className="card divide-y divide-white/[0.04]">
        {calls.map((c) => (
          <div key={c.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${c.direction === "in" ? "bg-mint-500/15 text-mint-400" : "bg-accent-500/15 text-accent-300"}`}>
                {c.direction === "in" ? <PhoneIncoming className="size-4" /> : <PhoneOutgoing className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <a href={`tel:${c.phone}`} className="text-sm font-medium text-white hover:text-accent-300" onClick={(e) => e.stopPropagation()}>{c.phone}</a>
                  <Badge tone={statusTone[c.status]}>{c.status}</Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  <span>{c.direction === "out" ? "Outbound" : "Inbound"}</span>
                  <span>·</span>
                  <span>{fmtDur(c.durationSec)}</span>
                  <span>·</span>
                  <span>{timeAgo(c.startedAt)}</span>
                  {c.recordingUrl && <Badge tone="amber"><Mic className="size-3" /> recorded</Badge>}
                </div>
              </div>
              <button
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                className="btn-ghost !px-3 !py-1.5"
                disabled={!c.recordingUrl && !c.transcript && !c.notes}
              >
                <FileText className="size-3.5" /> {expanded === c.id ? "Hide" : "Details"}
              </button>
              <button onClick={() => void remove(c)} className="rounded-lg p-2 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400"><Trash2 className="size-4" /></button>
            </div>
            {expanded === c.id && (c.recordingUrl || c.transcript || c.notes) && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {c.recordingUrl && (
                  <div className="rounded-xl bg-ink-800/60 border border-white/[0.05] p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-600"><Mic className="size-3" /> Recording</div>
                    <audio controls preload="none" className="w-full" src={c.recordingUrl} />
                  </div>
                )}
                {c.transcript && (
                  <div className="rounded-xl bg-ink-800/60 border border-white/[0.05] p-3">
                    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-600">Transcript</div>
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">{c.transcript}</pre>
                  </div>
                )}
                {c.notes && (
                  <div className={`rounded-xl bg-ink-800/60 border border-white/[0.05] p-3 ${c.recordingUrl || c.transcript ? "" : "sm:col-span-2"}`}>
                    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-600">Notes</div>
                    <p className="whitespace-pre-wrap text-xs text-slate-300">{c.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {calls.length === 0 && (
          <EmptyState icon={<Phone className="size-8" />} title="No calls logged" hint="Log your first call — completed calls fire a call.completed event and land on the record timeline." />
        )}
      </div>

      {logging && <LogCallModal onClose={() => setLogging(false)} onDone={async () => { setLogging(false); await load(); }} />}
    </div>
  );
}

function LogCallModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [form, setForm] = useState({ direction: "out", phone: "", status: "completed", durationSec: "", notes: "", contactId: "", recording: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: { id: string; firstName: string; lastName: string; phone: string | null }[] }>("/api/contacts?pageSize=200").then((d) =>
      setContacts(d.items.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}${c.phone ? ` · ${c.phone}` : ""}` })))
    ).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.phone.trim()) return setError("Phone number is required.");
    setBusy(true); setError(null);
    try {
      await post("/api/calls", {
        direction: form.direction,
        phone: form.phone.trim(),
        status: form.status,
        durationSec: form.status === "completed" && form.durationSec ? Number(form.durationSec) : undefined,
        notes: form.notes.trim() || undefined,
        contactId: form.contactId || undefined,
        recording: form.recording,
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to log call");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Log a call">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Direction">
            <div className="flex gap-2">
              {([["out", "Outbound"], ["in", "Inbound"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setForm({ ...form, direction: v })} className={`chip transition-colors ${form.direction === v ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}>{l}</button>
              ))}
            </div>
          </Field>
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="completed" className="bg-ink-850">Completed</option>
              <option value="no-answer" className="bg-ink-850">No answer</option>
              <option value="voicemail" className="bg-ink-850">Voicemail</option>
            </select>
          </Field>
        </div>
        <Field label="Phone number" required><input className="input" placeholder="+1 212 555 0111" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Duration (seconds)"><input className="input" type="number" min={0} placeholder={form.status === "completed" ? "auto (2–12 min)" : "0"} value={form.durationSec} onChange={(e) => setForm({ ...form, durationSec: e.target.value })} /></Field>
          <Field label="Linked contact">
            <select className="input" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
              <option value="" className="bg-ink-850">None</option>
              {contacts.map((c) => <option key={c.id} value={c.id} className="bg-ink-850">{c.label}</option>)}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-slate-300">
          <input type="checkbox" checked={form.recording} onChange={(e) => setForm({ ...form, recording: e.target.checked })} className="size-4 accent-accent-500" />
          Request recording + transcript <span className="text-xs text-slate-600">(mock provider — real telephony lands later)</span>
        </label>
        <Field label="Notes"><textarea className="input min-h-20" placeholder="Key takeaways…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : <Phone className="size-4" />} Log call</button>
        </div>
      </div>
    </Modal>
  );
}
