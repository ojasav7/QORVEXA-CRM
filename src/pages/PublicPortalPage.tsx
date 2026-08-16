import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, LifeBuoy, Search, Send, BookOpen } from "lucide-react";
import { Badge } from "../components/ui";

const HONEYPOT = "favorite_color"; // must match server/routes/public-portal.ts

type PortalConfig = { name: string; description: string | null; slug: string; articles: { id: string; title: string; category: string }[] };
type LookupResult = {
  found: boolean;
  ticket: null | {
    reference: string;
    subject: string;
    status: string;
    priority: string;
    resolved: boolean;
    updatedAt: string;
    replies: { id: string; body: string; createdAt: string }[];
  };
};

export default function PublicPortalPage() {
  const { slug = "" } = useParams();
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"submit" | "lookup">("submit");
  const [form, setForm] = useState({ name: "", email: "", subject: "", body: "", [HONEYPOT]: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [lookup, setLookup] = useState({ email: "", reference: "" });
  const [result, setResult] = useState<LookupResult | null>(null);

  useEffect(() => {
    fetch(`/api/public/portal/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then(setConfig)
      .catch(() => setError("This support portal is no longer available."));
  }, [slug]);

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.subject.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/portal/${config?.slug ?? slug}/tickets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, [HONEYPOT]: form[HONEYPOT] ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Submission failed");
      setDone(data.reference ?? "submitted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  const doLookup = async () => {
    if (!lookup.email.trim() || !lookup.reference.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/portal/${config?.slug ?? slug}/lookup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(lookup),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Lookup failed");
      setResult(data as LookupResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
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

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="card w-full max-w-xl animate-fade-up p-8">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-teal-500 text-white shadow-xl shadow-accent-500/30">
            <LifeBuoy className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">{config.name}</h1>
            {config.description && <p className="mt-0.5 text-sm text-slate-500">{config.description}</p>}
          </div>
        </div>

        <div className="mb-5 flex gap-1.5">
          <button onClick={() => { setTab("submit"); setError(null); }} className={`chip transition-colors ${tab === "submit" ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}>
            <Send className="mr-1 size-3" /> Submit a ticket
          </button>
          <button onClick={() => { setTab("lookup"); setError(null); }} className={`chip transition-colors ${tab === "lookup" ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}>
            <Search className="mr-1 size-3" /> Track a ticket
          </button>
        </div>

        {tab === "submit" && !done && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Your name <span className="text-rose-400">*</span></label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Email <span className="text-rose-400">*</span></label>
                <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">Subject <span className="text-rose-400">*</span></label>
              <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="How can we help?" />
            </div>
            <div>
              <label className="label">Details</label>
              <textarea className="input min-h-24" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
            {/* Honeypot — hidden from humans, bots fill it */}
            <div className="hidden" aria-hidden>
              <label>Favorite color<input className="input" tabIndex={-1} autoComplete="off" value={form[HONEYPOT]} onChange={(e) => setForm({ ...form, [HONEYPOT]: e.target.value })} /></label>
            </div>
            {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
            <button className="btn-primary w-full" onClick={submit} disabled={busy || !form.name.trim() || !form.email.trim() || !form.subject.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Submit ticket
            </button>
          </div>
        )}

        {tab === "submit" && done && (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto mb-4 size-12 text-mint-400" />
            <h2 className="text-lg font-bold text-white">Ticket submitted!</h2>
            <p className="mt-2 text-sm text-slate-500">Your reference is <span className="font-mono font-semibold text-accent-400">{done}</span> — keep it to track progress.</p>
          </div>
        )}

        {tab === "lookup" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={lookup.email} onChange={(e) => setLookup({ ...lookup, email: e.target.value })} />
              </div>
              <div>
                <label className="label">Reference</label>
                <input className="input" placeholder="TKT-0001" value={lookup.reference} onChange={(e) => setLookup({ ...lookup, reference: e.target.value })} />
              </div>
            </div>
            {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
            <button className="btn-primary w-full" onClick={doLookup} disabled={busy || !lookup.email.trim() || !lookup.reference.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Track ticket
            </button>

            {result && !result.found && (
              <div className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-400">No ticket found for that email + reference.</div>
            )}
            {result?.found && result.ticket && (
              <div className="rounded-xl border border-white/[0.06] bg-ink-900/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-white">{result.ticket.reference}</span>
                  <Badge tone={result.ticket.resolved ? "green" : "blue"}>{result.ticket.status}</Badge>
                  <Badge tone="default">{result.ticket.priority}</Badge>
                </div>
                <p className="mt-2 text-sm text-slate-300">{result.ticket.subject}</p>
                {result.ticket.replies.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {result.ticket.replies.map((r) => (
                      <div key={r.id} className="rounded-lg bg-white/[0.04] px-3 py-2">
                        <p className="text-xs text-slate-300">{r.body}</p>
                        <p className="mt-1 text-[10px] text-slate-600">{new Date(r.createdAt).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-slate-600">Last updated {new Date(result.ticket.updatedAt).toLocaleString()}</p>
              </div>
            )}
          </div>
        )}

        {config.articles.length > 0 && (
          <div className="mt-6 border-t border-white/[0.06] pt-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-500">
              <BookOpen className="size-3.5" /> Help articles
            </div>
            <div className="space-y-1.5">
              {config.articles.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-sm text-slate-300">
                  <span className="text-accent-400">•</span>
                  <span className="min-w-0 truncate">{a.title}</span>
                  <Badge tone="blue">{a.category}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-slate-600">
          <LifeBuoy className="size-3" /> Powered by QORVEXA
        </div>
      </div>
    </div>
  );
}
