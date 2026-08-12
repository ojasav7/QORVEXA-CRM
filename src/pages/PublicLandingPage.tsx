import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Rocket, CheckCircle2 } from "lucide-react";
import { api, post, ApiError } from "../lib/api";
import { Spinner } from "../components/ui";

// Public landing page (Phase 5) — NO auth. Renders the configured headline /
// subtext + themed form; submissions create routed leads server-side
// (honeypot + rate limit, ADR-012 discipline). Mirrors the public booking /
// portal page patterns.
type PageConfig = {
  name: string;
  headline: string;
  subtext: string | null;
  ctaLabel: string;
  successMessage: string;
  theme: string;
  fields: { key: string; enabled: boolean }[];
};

const THEME_GRADIENTS: Record<string, string> = {
  indigo: "from-indigo-500 to-violet-600",
  emerald: "from-emerald-500 to-teal-600",
  rose: "from-rose-500 to-pink-600",
  amber: "from-amber-500 to-orange-600",
  slate: "from-slate-500 to-slate-700",
};

export default function PublicLandingPage() {
  const { slug } = useParams();
  const [page, setPage] = useState<PageConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState(""); // honeypot

  useEffect(() => {
    void api<PageConfig>(`/api/public/pages/${slug}`)
      .then(setPage)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Page not found"));
  }, [slug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/api/public/pages/${slug}/submit`, { ...form, website });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6">
        <div className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400"><Rocket className="size-6" /></div>
          <h1 className="mt-4 text-lg font-semibold text-white">Page not found</h1>
          <p className="mt-1 text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }
  if (!page) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6">
        <Spinner className="size-6" />
      </div>
    );
  }

  const gradient = THEME_GRADIENTS[page.theme] ?? THEME_GRADIENTS.indigo;
  const enabled = page.fields.filter((f) => f.enabled);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.12),transparent_55%)] p-6">
      <div className="w-full max-w-md">
        <div className={`rounded-3xl bg-gradient-to-br ${gradient} p-1`}>
          <div className="rounded-[calc(1.5rem-2px)] bg-ink-900 p-8">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-xl bg-white/10 text-white"><Rocket className="size-4" /></div>
              <span className="text-xs font-semibold uppercase tracking-widest text-white/60">{page.name}</span>
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">{page.headline}</h1>
            {page.subtext && <p className="mt-2 text-sm text-slate-400">{page.subtext}</p>}

            {done ? (
              <div className="mt-6 rounded-2xl bg-emerald-500/10 p-6 text-center">
                <CheckCircle2 className="mx-auto size-10 text-emerald-400" />
                <p className="mt-3 text-sm font-medium text-emerald-300">{page.successMessage}</p>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-6 space-y-3">
                {/* honeypot — hidden from humans, filled by bots */}
                <input className="hidden" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website" />
                {enabled.map((f) => (
                  <input
                    key={f.key}
                    className="input"
                    required={f.key === "email"}
                    type={f.key === "email" ? "email" : "text"}
                    placeholder={f.key === "firstName" ? "First name" : f.key === "lastName" ? "Last name" : f.key === "company" ? "Company" : f.key === "phone" ? "Phone" : "Value"}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                ))}
                <button type="submit" disabled={busy} className={`btn-primary w-full ${gradient ? "" : ""}`}>
                  {busy ? <Spinner className="size-4" /> : page.ctaLabel}
                </button>
                {error && <div className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-xs text-rose-400">{error}</div>}
              </form>
            )}
          </div>
        </div>
        <p className="mt-4 text-center text-[11px] text-slate-600">Powered by QORVEXA CRM</p>
      </div>
    </div>
  );
}
