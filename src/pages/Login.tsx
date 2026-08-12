import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { post, ApiError } from "../lib/api";
import { useSession } from "../App";
import { Spinner } from "../components/ui";
import { useTheme } from "../lib/theme";
import { Moon, Sun } from "lucide-react";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ orgName: "", name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [theme, setTheme] = useTheme();

  // OAuth SSO (Phase 0): show provider buttons the server says are configured.
  useEffect(() => {
    fetch("/api/auth/oauth/providers")
      .then((r) => r.json().catch(() => ({ providers: [] })))
      .then((d) => setProviders(Array.isArray(d.providers) ? d.providers : []))
      .catch(() => {});
  }, []);

  // After the provider redirects back, /?oauth=error=no_account lands here (via
  // RequireAuth preserving the query). Surface it, then clear the param.
  const oauthParam = params.get("oauth") ?? "";
  const oauthError = oauthParam.startsWith("error=")
    ? oauthParam === "error=no_account"
      ? "No QORVEXA account matches that identity — SSO signs into existing accounts only. Use email/password or ask an admin to invite you."
      : "OAuth sign-in failed. Please try again."
    : null;

  // Read the ?oauth=… param once, then clear it (effect, not during render).
  useEffect(() => {
    if (oauthParam.startsWith("error=")) {
      const next = new URLSearchParams(params);
      next.delete("oauth");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthParam]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await post("/api/auth/login", { email: form.email, password: form.password });
      } else {
        await post("/api/auth/register", { orgName: form.orgName, name: form.name, email: form.email, password: form.password });
      }
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="relative flex min-h-full items-center justify-center p-4">
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="absolute right-4 top-4 rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
      <div className="card w-full max-w-md animate-fade-up p-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-violet-500 text-2xl font-bold text-on-brand shadow-xl shadow-accent-500/30">
            Q
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">QORVEXA CRM</h1>
          <p className="mt-1 text-sm text-slate-500">The intelligent operating system for business</p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-ink-800/60 p-1">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); }}
              className={`rounded-lg py-2 text-sm font-medium transition-colors ${mode === m ? "bg-ink-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              {m === "login" ? "Sign in" : "Create workspace"}
            </button>
          ))}
        </div>

        {(providers.length > 0 || oauthError) && (
          <>
            <div className="space-y-2">
              {providers.map((p) => (
                <a
                  key={p}
                  href={`/api/auth/oauth/${p}`}
                  className="flex items-center justify-center gap-2.5 rounded-xl border border-white/[0.08] bg-ink-800/60 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-white/20 hover:bg-ink-700 hover:text-white"
                >
                  <BrandMark provider={p} />
                  Continue with {p === "google" ? "Google" : "GitHub"}
                </a>
              ))}
              {oauthError && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{oauthError}</div>}
              <p className="text-center text-[11px] text-slate-600">
                SSO signs into <span className="text-slate-500">existing</span> QORVEXA accounts by email — no automatic sign-up.
              </p>
            </div>
            <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-widest text-slate-600">
              <span className="h-px flex-1 bg-white/[0.06]" /> or <span className="h-px flex-1 bg-white/[0.06]" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-4">
          {mode === "register" && (
            <>
              <input className="input" placeholder="Company / workspace name" value={form.orgName} onChange={(e) => set("orgName", e.target.value)} required />
              <input className="input" placeholder="Your name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
            </>
          )}
          <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          <input className="input" type="password" placeholder="Password (min 8 chars)" minLength={8} value={form.password} onChange={(e) => set("password", e.target.value)} required />

          {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner className="size-4" /> : mode === "login" ? "Sign in" : "Create workspace"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-600">
          Demo: <span className="font-mono text-slate-500">admin@qorvexa.dev / password123</span> (run <span className="font-mono">npm run seed</span>)
        </p>
      </div>
    </div>
  );
}

function BrandMark({ provider }: { provider: string }) {
  if (provider === "google") {
    return (
      <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
        <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.57-5.17 3.57-8.82Z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.29a12 12 0 0 0 0 10.74l3.98-3.09Z" />
        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z" />
      </svg>
    );
  }
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5A11.5 11.5 0 0 0 8.2 22.66c.58.1.79-.25.79-.56v-2.2c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.28 1.2-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.19 1.83 1.19 3.09 0 4.43-2.7 5.4-5.26 5.69.41.35.77 1.05.77 2.12v3.14c0 .31.2.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
