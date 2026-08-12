import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";

type FormConfig = { name: string; slug: string; fields: { key: string; label: string; required: boolean; type: string }[]; submitLabel: string };

const HONEYPOT = "company_website"; // must match server/routes/public-leads.ts

export default function FormPage() {
  const { slug = "" } = useParams();
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ duplicate: boolean } | null>(null);

  useEffect(() => {
    fetch(`/api/public/forms/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then(setConfig)
      .catch(() => setError("This form is no longer available."));
  }, [slug]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/public/forms/${config.slug}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, [HONEYPOT]: values[HONEYPOT] ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Submission failed");
      setDone({ duplicate: !!data.duplicate });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
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
          <h1 className="text-lg font-bold text-white">Thanks — we'll be in touch!</h1>
          <p className="mt-2 text-sm text-slate-500">
            {done.duplicate ? "Looks like we already have your details — a member of the team will follow up." : "Your details have been sent to the team."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="card w-full max-w-md animate-fade-up p-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-violet-500 text-2xl font-bold text-on-brand shadow-xl shadow-accent-500/30">Q</div>
          <h1 className="text-xl font-bold tracking-tight text-white">{config.name}</h1>
          <p className="mt-1 text-sm text-slate-500">Powered by QORVEXA</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {config.fields.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">{f.label}{f.required && <span className="text-rose-400"> *</span>}</label>
              <input
                className="input"
                type={f.type === "email" ? "email" : f.type === "number" ? "number" : "text"}
                required={f.required}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          {/* Honeypot — hidden from humans, bots fill it */}
          <div className="hidden" aria-hidden>
            <label>Company website<input className="input" tabIndex={-1} autoComplete="off" value={values[HONEYPOT] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [HONEYPOT]: e.target.value }))} /></label>
          </div>

          {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : config.submitLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
