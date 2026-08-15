import { useEffect, useState, type FormEvent } from "react";
import {
  Shield, ShieldCheck, KeyRound, MonitorSmartphone, Lock, Bell, UserRoundCheck,
  Database, Activity, Building2, Languages, RefreshCw, Plus, Trash2, X, Check,
  AlertTriangle, Play, ToggleLeft, ToggleRight, Copy, Fingerprint, Globe, ScrollText, LogOut,
} from "lucide-react";
import { api, post, patch } from "../lib/api";
import { useSession } from "../App";
import { Badge, EmptyState, Spinner, Field, StatCard, Modal } from "../components/ui";
import { dateTime, timeAgo } from "../lib/format";

// ── Types ───────────────────────────────────────────────────────────────────
type Settings = {
  ipRestrictionEnabled: boolean;
  ipAllowlist: string[];
  requireMfa: boolean;
  sessionTtlDays: number;
  encryption: { atRest: boolean; inTransit: boolean; fieldLevel: string[] };
};
type Overview = {
  alerts: Alert[];
  alertCount: number;
  sessions: number;
  consents: number;
  openDsrs: number;
  policies: number;
  subProcessors: number;
  openIncidents: number;
  settings: Settings;
  i18n: { locale: string; timezone: string; currency: string };
  report: { encryptionAtRest: boolean; encryptionInTransit: boolean; mfaEnabledUsers: number; mfaTotalUsers: number };
};
type Alert = {
  id: string; severity: string; category: string; title: string; message: string;
  acknowledgedAt: string | null; createdAt: string;
};
type Session = {
  id: string; device: string; ip: string | null; location: string | null;
  createdAt: string; lastSeenAt: string; expiresAt: string; revokedAt: string | null;
  current: boolean; user: { id: string; name: string; email: string } | null;
};
type ConsentRecord = {
  id: string; contactEmail: string; purpose: string; status: string;
  source: string | null; grantedAt: string | null; withdrawnAt: string | null; updatedAt: string;
};
type Dsr = {
  id: string; type: string; requesterEmail: string; status: string;
  submittedAt: string; completedAt: string | null; notes: string | null;
};
type RetentionPolicy = {
  id: string; name: string; entity: string; olderThanDays: number; action: string;
  status: string; lastRunAt: string | null; lastProcessed: number; createdAt: string;
};
type SubProcessor = {
  id: string; name: string; purpose: string; region: string; dataCategories: string[];
  link: string | null; status: string;
};
type Incident = {
  id: string; component: string; title: string; severity: string; status: string;
  message: string; startedAt: string; resolvedAt: string | null;
};
type UptimeComponent = { up: number; degraded: number; down: number; total: number; uptimePct: number };
type StatusReport = {
  days: number;
  components: Record<string, UptimeComponent>;
  incidents: Incident[];
  uptime: { last90: number; last30: number };
};
type I18nQA = { total: number; locales: { locale: string; translated: number; missing: number; completenessPct: number; sample: { key: string; en: string; value?: string }[] }[]; overallPct: number };
type ScimInfo = { users: number; groups: number; scimTokens: { id: string; name: string; scopes: string[]; createdAt: string }[] };

const SEVERITY_TONE: Record<string, "rose" | "amber" | "blue" | "default"> = {
  critical: "rose", high: "rose", medium: "amber", low: "blue", info: "default",
};
const PURPOSE_LABEL: Record<string, string> = {
  marketing: "Marketing", analytics: "Analytics", processing: "Data processing", communications: "Communications",
};

export default function SecurityPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<"overview" | "mfa" | "sessions" | "policy" | "alerts" | "privacy" | "retention" | "status" | "subprocessors" | "i18n" | "scim">("overview");
  const isAdmin = user?.role === "admin";
  const isManager = isAdmin || user?.role === "manager";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Shield className="size-4 text-amber-400" /> Security &amp; governance
            <span className="chip bg-amber-500/15 text-amber-300">MFA · sessions · IP policy · consent · retention · status · i18n</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Enterprise security, compliance &amp; governance: self-service MFA with recovery codes, DB-backed sessions and device revocation, org IP restriction, security alerts, the consent &amp; privacy center with data-subject requests, retention/deletion policies, the uptime status page, vendor/sub-processor transparency, SCIM provisioning, and localization QA.
          </p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06]">
        {([
          ["overview", "Overview", ShieldCheck],
          ["mfa", "MFA", KeyRound],
          ["sessions", "Sessions", MonitorSmartphone],
          ["policy", "Policy", Lock],
          ["alerts", "Alerts", Bell],
          ["privacy", "Privacy", UserRoundCheck],
          ["retention", "Retention", Database],
          ["status", "Status", Activity],
          ["subprocessors", "Sub-processors", Building2],
          ["i18n", "i18n", Languages],
          ["scim", "SCIM", Fingerprint],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === key ? "border-accent-400 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "mfa" && <MfaTab />}
      {tab === "sessions" && <SessionsTab isManager={isManager} />}
      {tab === "policy" && <PolicyTab isAdmin={isAdmin} />}
      {tab === "alerts" && <AlertsTab isManager={isManager} />}
      {tab === "privacy" && <PrivacyTab isAdmin={isAdmin} isManager={isManager} />}
      {tab === "retention" && <RetentionTab isAdmin={isAdmin} />}
      {tab === "status" && <StatusTab isAdmin={isAdmin} />}
      {tab === "subprocessors" && <SubProcessorsTab isAdmin={isAdmin} />}
      {tab === "i18n" && <I18nTab isAdmin={isAdmin} />}
      {tab === "scim" && <ScimTab isAdmin={isAdmin} />}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function OverviewTab() {
  const [ov, setOv] = useState<Overview | null>(null);
  const load = () => void api<{ data?: Overview }>("/api/security/overview").then((d: any) => setOv(d.data ?? d)).catch(() => {});
  useEffect(load, []);
  if (!ov) return <Spinner className="py-16" />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open alerts" value={ov.alertCount} sub={`${ov.alerts.length} recent security alerts`} tone={ov.alertCount ? "amber" : "green"} />
        <StatCard label="Active sessions" value={ov.sessions} sub="DB-backed device sessions" tone="blue" />
        <StatCard label="Consent records" value={ov.consents} sub={`${ov.openDsrs} open data-subject requests`} tone="violet" />
        <StatCard label="Retention policies" value={ov.policies} sub={`${ov.subProcessors} sub-processors · ${ov.openIncidents} open incidents`} tone="green" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Security posture</p>
          <div className="space-y-2 text-sm">
            <Row label="IP restriction" value={ov.settings.ipRestrictionEnabled ? `Enabled (${ov.settings.ipAllowlist.length} CIDR entr${ov.settings.ipAllowlist.length === 1 ? "y" : "ies"})` : "Disabled"} ok={ov.settings.ipRestrictionEnabled} />
            <Row label="Require MFA for all users" value={ov.settings.requireMfa ? "Required" : "Optional"} ok={ov.settings.requireMfa} />
            <Row label="Session lifetime" value={`${ov.settings.sessionTtlDays} days`} />
            <Row label="Encryption at rest" value={ov.report.encryptionAtRest ? "Enabled" : "Not configured"} ok={ov.report.encryptionAtRest} />
            <Row label="Encryption in transit" value={ov.report.encryptionInTransit ? "Enabled (TLS)" : "Not configured"} ok={ov.report.encryptionInTransit} />
            <Row label="MFA adoption" value={`${ov.report.mfaEnabledUsers} / ${ov.report.mfaTotalUsers} users enrolled`} />
            <Row label="Locale / timezone / currency" value={`${ov.i18n.locale} · ${ov.i18n.timezone} · ${ov.i18n.currency}`} />
          </div>
        </div>
        <div className="card p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Recent alerts</p>
          {ov.alerts.length === 0 ? (
            <EmptyState icon={<ShieldCheck className="size-8" />} title="No open alerts" hint="Security events that need attention will appear here." />
          ) : (
            <div className="space-y-2">
              {ov.alerts.slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-ink-900/50 px-3 py-2.5">
                  <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${a.severity === "high" || a.severity === "critical" ? "text-rose-400" : a.severity === "medium" ? "text-amber-400" : "text-accent-300"}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">{a.title}</span>
                      <Badge tone={SEVERITY_TONE[a.severity] ?? "default"}>{a.severity}</Badge>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{a.message}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={`flex items-center gap-1.5 font-medium ${ok === undefined ? "text-slate-300" : ok ? "text-mint-400" : "text-slate-300"}`}>
        {ok !== undefined && <span className={`size-1.5 rounded-full ${ok ? "bg-mint-400" : "bg-slate-600"}`} />}
        {value}
      </span>
    </div>
  );
}

// ── MFA (self-service) ─────────────────────────────────────────────────────
function MfaTab() {
  const [step, setStep] = useState<"idle" | "setup" | "done" | "enabled">("idle");
  const [setup, setSetup] = useState<{ secret: string; otpauth: string; qrCode: string; previewCode: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const startSetup = async () => {
    setBusy(true); setError(null);
    try {
      const d = await post<any>("/api/security/mfa/setup");
      const s = d.data ?? d;
      setSetup(s);
      setCode(s.previewCode ?? "");
      setStep("setup");
    } catch (e: any) { setError(e?.message ?? "Setup failed"); }
    finally { setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const d = await post<any>("/api/security/mfa/verify", { code });
      const body = d.data ?? d;
      setCodes(body.recoveryCodes ?? []);
      setStep("done");
    } catch (err: any) { setError(err?.message ?? "Verification failed"); }
    finally { setBusy(false); }
  };
  const disable = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await post("/api/security/mfa/disable", { code: disableCode });
      setStep("idle"); setDisableCode(""); setInfo("MFA disabled — your TOTP secret was removed.");
    } catch (err: any) { setError(err?.message ?? "Disable failed"); }
    finally { setBusy(false); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <div className="max-w-2xl space-y-4">
      {info && <div className="rounded-xl bg-mint-500/10 px-4 py-3 text-sm text-mint-400">{info}</div>}
      {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {step === "idle" && (
        <div className="card space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-500/15 p-2.5 text-amber-400"><KeyRound className="size-5" /></div>
            <div>
              <h3 className="text-sm font-semibold text-white">Enable two-factor authentication (TOTP)</h3>
              <p className="mt-1 text-sm text-slate-500">
                Add a second factor to your sign-in: scan the QR code with any authenticator app, then confirm with a 6-digit code. You'll get 10 one-time recovery codes to keep somewhere safe.
              </p>
            </div>
          </div>
          <button className="btn-primary" onClick={() => void startSetup()} disabled={busy}>
            {busy ? <Spinner className="size-4" /> : <><KeyRound className="size-4" /> Start setup</>}
          </button>
        </div>
      )}

      {step === "setup" && setup && (
        <form className="card space-y-4 p-5" onSubmit={verify}>
          <h3 className="text-sm font-semibold text-white">Scan, then confirm</h3>
          <div className="flex flex-wrap items-start gap-4">
            {setup.qrCode && (
              <img src={setup.qrCode} alt="TOTP QR code to scan with your authenticator app" width={168} height={168} className="rounded-xl border border-white/[0.08] bg-white p-2" />
            )}
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <div className="label">Manual entry secret</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-lg bg-ink-900/70 px-3 py-2 text-xs text-amber-300">{setup.secret}</code>
                  <button type="button" onClick={() => void copy(setup.secret)} title="Copy secret" className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                    {copied ? <Check className="size-4 text-mint-400" /> : <Copy className="size-4" />}
                  </button>
                </div>
              </div>
              <div>
                <div className="label">6-digit code from your app</div>
                <input className="input font-mono" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required aria-label="Verification code" />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy}>{busy ? <Spinner className="size-4" /> : "Confirm & enable"}</button>
            <button type="button" className="btn-ghost" onClick={() => setStep("idle")}>Cancel</button>
          </div>
        </form>
      )}

      {step === "done" && (
        <div className="card space-y-4 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-mint-400"><ShieldCheck className="size-5" /> MFA is now enabled</div>
          <div>
            <div className="label">Recovery codes — store these somewhere safe (each can be used once)</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {codes.map((c) => (
                <code key={c} className="rounded-lg bg-ink-900/70 px-3 py-2 text-center text-xs font-mono text-slate-300">{c}</code>
              ))}
            </div>
            <button type="button" className="mt-2 text-xs font-medium text-accent-400 hover:text-accent-300" onClick={() => void copy(codes.join("\n"))}>Copy all</button>
          </div>
          <div className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            Next time you sign in, you'll be asked for a code from your authenticator app (or a recovery code).
          </div>
        </div>
      )}

      {step === "enabled" && (
        <form className="card space-y-4 p-5" onSubmit={disable}>
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck className="size-5 text-mint-400" /> MFA is enabled on your account</div>
          <p className="text-sm text-slate-500">To disable it, confirm with a current code or a recovery code.</p>
          <div className="max-w-xs">
            <div className="label">Current code</div>
            <input className="input font-mono" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} maxLength={16} required aria-label="Current verification code" />
          </div>
          <button className="btn-danger" disabled={busy}>{busy ? <Spinner className="size-4" /> : "Disable MFA"}</button>
        </form>
      )}

      <button className="text-xs font-medium text-slate-500 hover:text-slate-300" onClick={() => { setStep("enabled"); setError(null); }}>
        Already enrolled? Manage / disable
      </button>
    </div>
  );
}

// ── Sessions & devices ─────────────────────────────────────────────────────
function SessionsTab({ isManager }: { isManager: boolean }) {
  const [items, setItems] = useState<Session[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => {
    if (!isManager) return;
    void api<any>("/api/security/sessions").then((d) => setItems((d.data ?? d).items ?? [])).catch(() => {});
  };
  useEffect(load, [isManager]);
  const revoke = async (s: Session) => {
    if (!confirm(`Revoke the session "${s.device}"? The user will be signed out.`)) return;
    setBusy(s.id);
    try { await post(`/api/security/sessions/${s.id}/revoke`); load(); }
    catch (e: any) { alert(e?.message ?? "Revoke failed"); }
    finally { setBusy(null); }
  };
  const revokeAll = async () => {
    if (!confirm("Sign out every other device in this workspace? Your current session stays.")) return;
    try { await post("/api/security/sessions/revoke-all"); load(); }
    catch (e: any) { alert(e?.message ?? "Failed"); }
  };
  if (!isManager) {
    return <EmptyState icon={<Lock className="size-8" />} title="Managers & admins only" hint="Device session management requires the manager or admin role." />;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Every login creates a DB-backed session row. Revoking a session signs that device out immediately.</p>
        <button className="btn-ghost" onClick={() => void revokeAll()}><LogOut className="size-4" /> Sign out other devices</button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<MonitorSmartphone className="size-8" />} title="No sessions yet" hint="Sessions appear after users sign in." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5 font-medium">Device</th>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
                <th className="px-4 py-2.5 font-medium">Last seen</th>
                <th className="px-4 py-2.5 font-medium">Expires</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-white">{s.device}</span>
                    {s.current && <Badge tone="green" >current</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{s.user ? `${s.user.name} (${s.user.email})` : "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{s.ip ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-400">{timeAgo(s.lastSeenAt)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{dateTime(s.expiresAt)}</td>
                  <td className="px-4 py-2.5">
                    {s.revokedAt ? <Badge tone="default">revoked</Badge> : <Badge tone="green">active</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {!s.revokedAt && (
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void revoke(s)} disabled={busy === s.id}>
                        {busy === s.id ? <Spinner className="size-3" /> : "Revoke"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Policy (admin) ─────────────────────────────────────────────────────────
function PolicyTab({ isAdmin }: { isAdmin: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clientIp, setClientIp] = useState("");
  const [cidr, setCidr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    void api<any>("/api/security/policy").then((d) => {
      const body = d.data ?? d;
      setSettings(body.settings);
      setClientIp(body.clientIp ?? "");
    }).catch(() => {});
  };
  useEffect(load, []);
  const save = async () => {
    if (!settings) return;
    setBusy(true); setError(null);
    try {
      const d = await patch<any>("/api/security/policy", settings);
      setSettings((d.data ?? d).settings);
    } catch (e: any) { setError(e?.message ?? "Save failed"); }
    finally { setBusy(false); }
  };
  const checkIp = async (ip: string) => {
    try {
      const d = await post<any>("/api/security/debug/ip-allowed", { ip: ip || clientIp });
      const body = d.data ?? d;
      alert(`${body.ip} is ${body.allowed ? "ALLOWED" : "BLOCKED"} by the current allowlist.`);
    } catch (e: any) { alert(e?.message ?? "Check failed"); }
  };
  if (!isAdmin) {
    return <EmptyState icon={<Lock className="size-8" />} title="Admins only" hint="Security policy configuration requires the admin role." />;
  }
  if (!settings) return <Spinner className="py-16" />;
  const set = (k: string, v: unknown) => setSettings((s) => (s ? { ...s, [k]: v } : s));

  return (
    <div className="max-w-2xl space-y-4">
      {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
      <div className="card space-y-5 p-5">
        <div>
          <h3 className="text-sm font-semibold text-white">IP restriction</h3>
          <p className="mt-1 text-sm text-slate-500">When enabled, only requests from the allowlist are accepted. Your current address: <code className="font-mono text-xs text-amber-300">{clientIp}</code></p>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-slate-300">
          <input type="checkbox" className="checkbox" checked={settings.ipRestrictionEnabled} onChange={(e) => set("ipRestrictionEnabled", e.target.checked)} />
          Enforce IP allowlist on all requests
        </label>
        {settings.ipRestrictionEnabled && (
          <div className="space-y-2">
            <div className="label">Allowlist (CIDR — e.g. <code className="font-mono">203.0.113.0/24</code> or <code className="font-mono">*</code>)</div>
            <div className="flex flex-wrap gap-2">
              {settings.ipAllowlist.map((c, i) => (
                <span key={`${c}-${i}`} className="flex items-center gap-1.5 rounded-lg bg-ink-900/70 px-2.5 py-1.5 font-mono text-xs text-amber-300">
                  {c}
                  <button onClick={() => set("ipAllowlist", settings.ipAllowlist.filter((_, j) => j !== i))} title={`Remove ${c}`} className="text-slate-500 hover:text-rose-400"><X className="size-3.5" /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input className="input font-mono" placeholder="203.0.113.0/24" value={cidr} onChange={(e) => setCidr(e.target.value)} aria-label="Add CIDR entry" />
              <button
                className="btn-ghost"
                onClick={() => {
                  if (!cidr.trim()) return;
                  set("ipAllowlist", [...settings.ipAllowlist, cidr.trim()]);
                  setCidr("");
                }}
              >
                <Plus className="size-4" /> Add
              </button>
            </div>
            <div className="flex gap-2">
              <input className="input font-mono" placeholder={clientIp} aria-label="IP to test" onKeyDown={(e) => { if (e.key === "Enter") void checkIp((e.target as HTMLInputElement).value); }} />
              <button className="btn-ghost" onClick={() => void checkIp("")}>Test my IP</button>
            </div>
            <p className="text-xs text-amber-400/80"><AlertTriangle className="mr-1 inline size-3.5" />Careful: if your own IP isn't in the list, the next request will be blocked (and a security alert raised).</p>
          </div>
        )}

        <div className="h-px bg-white/[0.06]" />

        <label className="flex items-center gap-2.5 text-sm text-slate-300">
          <input type="checkbox" className="checkbox" checked={settings.requireMfa} onChange={(e) => set("requireMfa", e.target.checked)} />
          Require MFA for every user in this workspace
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="label">Session lifetime (days)</div>
            <input type="number" min={1} max={365} className="input" value={settings.sessionTtlDays} onChange={(e) => set("sessionTtlDays", Number(e.target.value))} />
          </div>
        </div>

        <div className="h-px bg-white/[0.06]" />

        <div>
          <h3 className="text-sm font-semibold text-white">Encryption &amp; masking</h3>
          <p className="mt-1 text-sm text-slate-500">Documented posture for your security review (at-rest/in-transit are config flags; field-level masking lists custom fields that are masked in exports).</p>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-slate-300">
          <input type="checkbox" className="checkbox" checked={settings.encryption.atRest} onChange={(e) => set("encryption", { ...settings.encryption, atRest: e.target.checked })} />
          Encryption at rest (AES-256 for hosted volumes)
        </label>
        <label className="flex items-center gap-2.5 text-sm text-slate-300">
          <input type="checkbox" className="checkbox" checked={settings.encryption.inTransit} onChange={(e) => set("encryption", { ...settings.encryption, inTransit: e.target.checked })} />
          Encryption in transit (TLS 1.2+ on every endpoint)
        </label>

        <button className="btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? <Spinner className="size-4" /> : <><Check className="size-4" /> Save policy</>}
        </button>
      </div>
    </div>
  );
}

// ── Alerts ─────────────────────────────────────────────────────────────────
function AlertsTab({ isManager }: { isManager: boolean }) {
  const [items, setItems] = useState<Alert[]>([]);
  const load = () => void api<any>("/api/security/alerts").then((d) => setItems((d.data ?? d).items ?? [])).catch(() => {});
  useEffect(load, []);
  const ack = async (id: string) => {
    try { await post(`/api/security/alerts/${id}/acknowledge`); load(); }
    catch (e: any) { alert(e?.message ?? "Failed"); }
  };
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-8" />} title="No security alerts" hint="Alerts are raised on MFA failures, blocked IPs, DSR activity, and other security events." />
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <div key={a.id} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${a.acknowledgedAt ? "border-white/[0.04] bg-ink-900/30 opacity-60" : "border-white/[0.08] bg-ink-900/60"}`}>
              <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${a.severity === "high" || a.severity === "critical" ? "text-rose-400" : a.severity === "medium" ? "text-amber-400" : "text-accent-300"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">{a.title}</span>
                  <Badge tone={SEVERITY_TONE[a.severity] ?? "default"}>{a.severity}</Badge>
                  <Badge tone="default">{a.category}</Badge>
                  {a.acknowledgedAt && <Badge tone="green">acknowledged</Badge>}
                </div>
                <div className="mt-1 text-sm text-slate-500">{a.message}</div>
                <div className="mt-1 text-xs text-slate-600">{timeAgo(a.createdAt)}</div>
              </div>
              {isManager && !a.acknowledgedAt && (
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void ack(a.id)}>Acknowledge</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Privacy: consent + DSRs ────────────────────────────────────────────────
function PrivacyTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [records, setRecords] = useState<ConsentRecord[]>([]);
  const [dsrs, setDsrs] = useState<Dsr[]>([]);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [purpose, setPurpose] = useState("marketing");
  const [status, setStatus] = useState("granted");
  const [dsrOpen, setDsrOpen] = useState(false);
  const [dsrType, setDsrType] = useState("export");
  const [dsrEmail, setDsrEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void api<any>("/api/security/consent").then((d) => setRecords((d.data ?? d).items ?? [])).catch(() => {});
    void api<any>("/api/security/dsrs").then((d) => setDsrs((d.data ?? d).items ?? [])).catch(() => {});
  };
  useEffect(load, []);
  const saveConsent = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await post("/api/security/consent", { contactEmail: email, purpose, status });
      setCreating(false); setEmail(""); load();
    } catch (err: any) { setError(err?.message ?? "Failed"); }
    finally { setBusy(false); }
  };
  const submitDsr = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await post("/api/security/dsrs", { type: dsrType, requesterEmail: dsrEmail });
      setDsrOpen(false); setDsrEmail(""); load();
    } catch (err: any) { setError(err?.message ?? "Failed"); }
    finally { setBusy(false); }
  };
  const fulfill = async (dsr: Dsr) => {
    if (!confirm(`Fulfill the ${dsr.type} request for ${dsr.requesterEmail}?`)) return;
    try { await post(`/api/security/dsrs/${dsr.id}/fulfill`); load(); }
    catch (e: any) { alert(e?.message ?? "Fulfill failed"); }
  };

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Consent records <span className="font-normal text-slate-500">(consent.updated events)</span></h3>
        {isManager && (
          <button className="btn-ghost" onClick={() => setCreating((c) => !c)}><Plus className="size-4" /> {creating ? "Cancel" : "Record consent"}</button>
        )}
      </div>
      {creating && (
        <form className="card grid gap-3 p-4 sm:grid-cols-2" onSubmit={saveConsent}>
          <div className="sm:col-span-2"><Field label="Contact email" required><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field></div>
          <Field label="Purpose" required>
            <select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {Object.entries(PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k} className="bg-ink-850">{v}</option>)}
            </select>
          </Field>
          <Field label="Status" required>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="granted" className="bg-ink-850">Granted</option>
              <option value="withdrawn" className="bg-ink-850">Withdrawn</option>
              <option value="pending" className="bg-ink-850">Pending</option>
            </select>
          </Field>
          <div className="sm:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? <Spinner className="size-4" /> : "Save record"}</button></div>
        </form>
      )}
      {records.length === 0 ? (
        <EmptyState icon={<UserRoundCheck className="size-8" />} title="No consent records" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5 font-medium">Contact</th>
                <th className="px-4 py-2.5 font-medium">Purpose</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-b border-white/[0.03]">
                  <td className="px-4 py-2.5 text-white">{r.contactEmail}</td>
                  <td className="px-4 py-2.5 text-slate-400">{PURPOSE_LABEL[r.purpose] ?? r.purpose}</td>
                  <td className="px-4 py-2.5">
                    {r.status === "granted" ? <Badge tone="green">granted</Badge> : r.status === "withdrawn" ? <Badge tone="rose">withdrawn</Badge> : <Badge tone="amber">pending</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{r.source ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{timeAgo(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="h-px bg-white/[0.06]" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Data-subject requests <span className="font-normal text-slate-500">(privacy center)</span></h3>
        <button className="btn-ghost" onClick={() => setDsrOpen(true)}><ScrollText className="size-4" /> New request</button>
      </div>
      {dsrs.length === 0 ? (
        <EmptyState icon={<UserRoundCheck className="size-8" />} title="No DSRs yet" hint="Access, export, delete, and rectify requests land here for admin fulfillment." />
      ) : (
        <div className="space-y-2">
          {dsrs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-ink-900/50 px-4 py-3">
              <Badge tone="violet">{d.type}</Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{d.requesterEmail}</div>
                <div className="text-xs text-slate-500">submitted {timeAgo(d.submittedAt)}{d.completedAt ? ` · completed ${timeAgo(d.completedAt)}` : ""}</div>
              </div>
              {d.status !== "completed" ? <Badge tone="amber">{d.status}</Badge> : <Badge tone="green">completed</Badge>}
              {isAdmin && d.status !== "completed" && (
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void fulfill(d)}>Fulfill</button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={dsrOpen} onClose={() => setDsrOpen(false)} title="New data-subject request">
        <form className="space-y-3" onSubmit={submitDsr}>
          <Field label="Request type" required>
            <select className="input" value={dsrType} onChange={(e) => setDsrType(e.target.value)}>
              <option value="export" className="bg-ink-850">Export my data</option>
              <option value="access" className="bg-ink-850">Access my data</option>
              <option value="delete" className="bg-ink-850">Delete my data (right to be forgotten)</option>
              <option value="rectify" className="bg-ink-850">Rectify my data</option>
            </select>
          </Field>
          <Field label="Requester email" required>
            <input className="input" type="email" value={dsrEmail} onChange={(e) => setDsrEmail(e.target.value)} required />
          </Field>
          <div className="flex gap-2 pt-1">
            <button className="btn-primary" disabled={busy}>{busy ? <Spinner className="size-4" /> : "Submit request"}</button>
            <button type="button" className="btn-ghost" onClick={() => setDsrOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ── Retention ──────────────────────────────────────────────────────────────
function RetentionTab({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<RetentionPolicy[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(""); const [entity, setEntity] = useState("lead");
  const [olderThanDays, setOlderThanDays] = useState(365); const [action, setAction] = useState("anonymize");
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => {
    void api<any>("/api/security/retention").then((d) => {
      const body = d.data ?? d;
      setItems(body.items ?? []);
      setEntities(body.entities ?? []);
    }).catch(() => {});
  };
  useEffect(load, []);
  const create = async (e: FormEvent) => {
    e.preventDefault(); setBusy("creating");
    try {
      await post("/api/security/retention", { name, entity, olderThanDays, action });
      setCreating(false); setName(""); load();
    } catch (err: any) { alert(err?.message ?? "Create failed"); }
    finally { setBusy(null); }
  };
  const run = async (p: RetentionPolicy) => {
    setBusy(p.id);
    try { await post(`/api/security/retention/${p.id}/run`); load(); }
    catch (err: any) { alert(err?.message ?? "Run failed"); }
    finally { setBusy(null); }
  };
  const toggle = async (p: RetentionPolicy) => {
    try { await post(`/api/security/retention/${p.id}/toggle`); load(); }
    catch (err: any) { alert(err?.message ?? "Toggle failed"); }
  };
  if (!isAdmin) {
    return <EmptyState icon={<Lock className="size-8" />} title="Admins only" hint="Retention policies require the admin role." />;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Policies delete or anonymize stale records past the cutoff. The security engine runs active policies every minute (retention.policy_applied).</p>
        <button className="btn-ghost" onClick={() => setCreating((c) => !c)}><Plus className="size-4" /> {creating ? "Cancel" : "New policy"}</button>
      </div>
      {creating && (
        <form className="card grid gap-3 p-4 sm:grid-cols-2" onSubmit={create}>
          <div className="sm:col-span-2"><Field label="Policy name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field></div>
          <Field label="Entity" required>
            <select className="input" value={entity} onChange={(e) => setEntity(e.target.value)}>
              {entities.map((en) => <option key={en} value={en} className="bg-ink-850">{en}</option>)}
            </select>
          </Field>
          <Field label="Older than (days)" required>
            <input className="input" type="number" min={1} max={3650} value={olderThanDays} onChange={(e) => setOlderThanDays(Number(e.target.value))} required />
          </Field>
          <Field label="Action" required>
            <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="anonymize" className="bg-ink-850">Anonymize PII</option>
              <option value="delete" className="bg-ink-850">Delete rows</option>
            </select>
          </Field>
          <div className="flex items-end"><button className="btn-primary" disabled={busy !== null}>{busy !== null ? <Spinner className="size-4" /> : "Create policy"}</button></div>
        </form>
      )}
      {items.length === 0 ? (
        <EmptyState icon={<Database className="size-8" />} title="No retention policies" />
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] bg-ink-900/50 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{p.name}</span>
                  {p.status === "active" ? <Badge tone="green">active</Badge> : <Badge tone="default">paused</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {p.entity} older than {p.olderThanDays} days → <span className="text-slate-400">{p.action}</span>
                  {p.lastRunAt ? ` · last run ${timeAgo(p.lastRunAt)} (${p.lastProcessed} processed)` : " · never run"}
                </div>
              </div>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void run(p)} disabled={busy === p.id}>
                {busy === p.id ? <Spinner className="size-3" /> : <><Play className="size-3.5" /> Run now</>}
              </button>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void toggle(p)} title={p.status === "active" ? "Pause" : "Resume"}>
                {p.status === "active" ? <ToggleRight className="size-4" /> : <ToggleLeft className="size-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Status page & uptime ───────────────────────────────────────────────────
function StatusTab({ isAdmin }: { isAdmin: boolean }) {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [days, setDays] = useState(30);
  const [creating, setCreating] = useState(false);
  const [incTitle, setIncTitle] = useState(""); const [incSeverity, setIncSeverity] = useState("minor"); const [incMessage, setIncMessage] = useState("");
  const load = (d = days) => {
    void api<any>(`/api/security/status?days=${d}`).then((resp) => {
      const body = resp.data ?? resp;
      setReport(body);
    }).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const createIncident = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post("/api/security/status/incidents", { title: incTitle, severity: incSeverity, message: incMessage });
      setCreating(false); setIncTitle(""); setIncMessage(""); load();
    } catch (err: any) { alert(err?.message ?? "Failed"); }
  };
  const resolve = async (i: Incident) => {
    try { await post(`/api/security/status/incidents/${i.id}/resolve`); load(); }
    catch (err: any) { alert(err?.message ?? "Failed"); }
  };
  if (!report) return <Spinner className="py-16" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Uptime SLA dashboard — the engine records an API tick every minute; incidents are tracked until resolved.</p>
        <div className="flex items-center gap-1.5">
          <label htmlFor="status-days" className="text-xs text-slate-500">Window</label>
          <select id="status-days" className="input w-28 py-1.5 text-xs" value={days} onChange={(e) => { const d = Number(e.target.value); setDays(d); load(d); }}>
            {[7, 30, 90].map((d) => <option key={d} value={d} className="bg-ink-850">{d} days</option>)}
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(report.components ?? {}).map(([name, c]) => (
          <StatCard
            key={name}
            label={`${name} (${c.total} checks)`}
            value={`${c.uptimePct}%`}
            sub={`${c.up} up · ${c.degraded} degraded · ${c.down} down`}
            tone={c.uptimePct >= 99 ? "green" : c.uptimePct >= 95 ? "amber" : "violet"}
          />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="Uptime — last 30 days" value={`${report.uptime?.last30 ?? 100}%`} tone="green" />
        <StatCard label="Uptime — last 90 days" value={`${report.uptime?.last90 ?? 100}%`} tone="green" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <h3 className="text-sm font-semibold text-white">Incidents</h3>
        {isAdmin && <button className="btn-ghost" onClick={() => setCreating((c) => !c)}><Plus className="size-4" /> {creating ? "Cancel" : "Declare incident"}</button>}
      </div>
      {creating && (
        <form className="card grid gap-3 p-4 sm:grid-cols-2" onSubmit={createIncident}>
          <div className="sm:col-span-2"><Field label="Title" required><input className="input" value={incTitle} onChange={(e) => setIncTitle(e.target.value)} required /></Field></div>
          <Field label="Severity" required>
            <select className="input" value={incSeverity} onChange={(e) => setIncSeverity(e.target.value)}>
              <option value="minor" className="bg-ink-850">Minor</option>
              <option value="major" className="bg-ink-850">Major</option>
              <option value="critical" className="bg-ink-850">Critical</option>
            </select>
          </Field>
          <Field label="Message" required><input className="input" value={incMessage} onChange={(e) => setIncMessage(e.target.value)} required /></Field>
          <div className="sm:col-span-2"><button className="btn-primary">Declare</button></div>
        </form>
      )}
      {report.incidents?.length ? (
        <div className="space-y-2">
          {report.incidents.map((i) => (
            <div key={i.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-ink-900/50 px-4 py-3">
              <Activity className={`size-4 ${i.severity === "critical" ? "text-rose-400" : i.severity === "major" ? "text-amber-400" : "text-accent-300"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{i.title}</span>
                  <Badge tone={i.severity === "critical" ? "rose" : i.severity === "major" ? "amber" : "blue"}>{i.severity}</Badge>
                  <Badge tone={i.status === "resolved" ? "green" : "default"}>{i.status}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{i.message} · {timeAgo(i.startedAt)}</div>
              </div>
              {isAdmin && i.status !== "resolved" && (
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void resolve(i)}>Resolve</button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Activity className="size-8" />} title="No open incidents" hint="All systems operational." />
      )}
    </div>
  );
}

// ── Sub-processors (vendor transparency) ───────────────────────────────────
function SubProcessorsTab({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<SubProcessor[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", purpose: "", region: "", link: "" });
  const load = () => void api<any>("/api/security/subprocessors").then((d) => setItems((d.data ?? d).items ?? [])).catch(() => {});
  useEffect(load, []);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post("/api/security/subprocessors", { ...form, link: form.link || undefined });
      setCreating(false); setForm({ name: "", purpose: "", region: "", link: "" }); load();
    } catch (err: any) { alert(err?.message ?? "Create failed"); }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Vendor / sub-processor transparency — the list you'd publish in your security documentation. Data categories describe what each vendor touches.</p>
        {isAdmin && <button className="btn-ghost" onClick={() => setCreating((c) => !c)}><Plus className="size-4" /> {creating ? "Cancel" : "Add sub-processor"}</button>}
      </div>
      {creating && (
        <form className="card grid gap-3 p-4 sm:grid-cols-2" onSubmit={create}>
          <Field label="Vendor name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
          <Field label="Region" required><input className="input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} required /></Field>
          <div className="sm:col-span-2"><Field label="Purpose" required><input className="input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} required /></Field></div>
          <div className="sm:col-span-2"><Field label="Privacy link"><input className="input" type="url" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><button className="btn-primary">Add vendor</button></div>
        </form>
      )}
      {items.length === 0 ? (
        <EmptyState icon={<Building2 className="size-8" />} title="No sub-processors listed" />
      ) : (
        <div className="space-y-2">
          {items.map((s) => (
            <div key={s.id} className="rounded-xl border border-white/[0.06] bg-ink-900/50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">{s.name}</span>
                <Badge tone={s.status === "active" ? "green" : s.status === "retired" ? "default" : "amber"}>{s.status}</Badge>
                {s.link && <a href={s.link} target="_blank" rel="noreferrer" className="text-xs text-accent-400 hover:text-accent-300">privacy policy ↗</a>}
              </div>
              <div className="mt-1 text-xs text-slate-500">{s.purpose} · <span className="text-slate-400">{s.region}</span></div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(s.dataCategories ?? []).map((c) => <Badge key={c} tone="default">{c}</Badge>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── i18n & localization QA ─────────────────────────────────────────────────
function I18nTab({ isAdmin }: { isAdmin: boolean }) {
  const [i18n, setI18n] = useState<{ locale: string; timezone: string; currency: string } | null>(null);
  const [locales, setLocales] = useState<string[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [timezones, setTimezones] = useState<string[]>([]);
  const [qa, setQa] = useState<I18nQA | null>(null);
  const [catalogSize, setCatalogSize] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => {
    void api<any>("/api/security/i18n").then((d) => {
      const body = d.data ?? d;
      setI18n(body.i18n); setLocales(body.locales ?? []); setCurrencies(body.currencies ?? []);
      setTimezones(body.timezones ?? []); setQa(body.qa); setCatalogSize(body.catalogSize ?? 0);
    }).catch(() => {});
  };
  useEffect(load, []);
  const save = async () => {
    if (!i18n) return;
    setBusy(true);
    try { await patch("/api/security/i18n", i18n); setMsg("Locale config saved."); setTimeout(() => setMsg(null), 2500); }
    catch (e: any) { alert(e?.message ?? "Save failed"); }
    finally { setBusy(false); }
  };
  const seed = async () => {
    try { await post("/api/security/i18n/seed"); load(); }
    catch (e: any) { alert(e?.message ?? "Seed failed"); }
  };
  return (
    <div className="space-y-4">
      <div className="card max-w-2xl space-y-4 p-5">
        <h3 className="text-sm font-semibold text-white">Workspace localization</h3>
        {i18n && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Locale">
              <select className="input" value={i18n.locale} onChange={(e) => setI18n({ ...i18n, locale: e.target.value })} disabled={!isAdmin}>
                {locales.map((l) => <option key={l} value={l} className="bg-ink-850">{l}</option>)}
              </select>
            </Field>
            <Field label="Timezone">
              <select className="input" value={i18n.timezone} onChange={(e) => setI18n({ ...i18n, timezone: e.target.value })} disabled={!isAdmin}>
                {timezones.map((t) => <option key={t} value={t} className="bg-ink-850">{t}</option>)}
              </select>
            </Field>
            <Field label="Currency">
              <select className="input" value={i18n.currency} onChange={(e) => setI18n({ ...i18n, currency: e.target.value })} disabled={!isAdmin}>
                {currencies.map((c) => <option key={c} value={c} className="bg-ink-850">{c}</option>)}
              </select>
            </Field>
          </div>
        )}
        {isAdmin && (
          <button className="btn-primary" onClick={() => void save()} disabled={busy || !i18n}>
            {busy ? <Spinner className="size-4" /> : <><Check className="size-4" /> Save</>}
          </button>
        )}
        {msg && <div className="rounded-xl bg-mint-500/10 px-4 py-2.5 text-sm text-mint-400">{msg}</div>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Localization QA <span className="font-normal text-slate-500">({catalogSize} keys in the en catalog)</span></h3>
        {isAdmin && <button className="btn-ghost" onClick={() => void seed()}><RefreshCw className="size-4" /> Seed catalog</button>}
      </div>
      {qa && qa.locales.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Overall completeness: <span className="font-semibold text-white">{qa.overallPct}%</span> across {qa.locales.length} locale(s).</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {qa.locales.map((l) => (
              <div key={l.locale} className="card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{l.locale}</span>
                  <Badge tone={l.completenessPct >= 90 ? "green" : l.completenessPct >= 50 ? "amber" : "rose"}>{l.completenessPct}%</Badge>
                </div>
                <div className="mt-1 text-xs text-slate-500">{l.translated}/{qa.total} translated · {l.missing} missing</div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-accent-500" style={{ width: `${l.completenessPct}%` }} />
                </div>
                <div className="mt-3 space-y-1">
                  {l.sample.map((s) => (
                    <div key={s.key} className="flex items-baseline justify-between gap-2 text-xs">
                      <code className="truncate text-slate-600">{s.key}</code>
                      <span className="truncate text-slate-400">{s.value ?? <span className="text-slate-600">— missing</span>}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {qa && qa.locales.length === 0 && (
        <EmptyState icon={<Languages className="size-8" />} title="No translations yet" hint="Seed the catalog to generate the en baseline + sample translations for QA." />
      )}
    </div>
  );
}

// ── SCIM ───────────────────────────────────────────────────────────────────
function ScimTab({ isAdmin }: { isAdmin: boolean }) {
  const [info, setInfo] = useState<ScimInfo | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    void api<any>("/api/security/scim").then((d) => setInfo(d.data ?? d)).catch(() => {});
  }, [isAdmin]);
  if (!isAdmin) {
    return <EmptyState icon={<Lock className="size-8" />} title="Admins only" hint="SCIM provisioning setup requires the admin role." />;
  }
  if (!info) return <Spinner className="py-16" />;
  return (
    <div className="max-w-3xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Provisioned users" value={info.users} tone="blue" />
        <StatCard label="Provisioned groups" value={info.groups} tone="violet" />
        <StatCard label="SCIM tokens" value={info.scimTokens.length} sub="Bearer tokens with the scim scope" tone="green" />
      </div>
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-white">Endpoint</h3>
        <p className="mt-1 text-sm text-slate-500">Point your identity provider (Okta, Entra ID, OneLogin…) at this SCIM 2.0 endpoint. Authenticate with a bearer API token that has the <code className="font-mono text-xs text-amber-300">scim</code> scope — create one on the API tokens screen.</p>
        <code className="mt-2 block rounded-lg bg-ink-900/70 px-3 py-2 font-mono text-xs text-slate-300">POST /api/scim/v2/Users · GET /api/scim/v2/Users · GET /api/scim/v2/Groups · POST /api/scim/v2/Groups</code>
      </div>
      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">SCIM tokens</h3>
        {info.scimTokens.length === 0 ? (
          <p className="text-sm text-slate-500">No tokens with the <code className="font-mono text-xs text-amber-300">scim</code> scope yet.</p>
        ) : (
          <div className="space-y-2">
            {info.scimTokens.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] px-3 py-2">
                <span className="text-sm text-white">{t.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">created {dateTime(t.createdAt)}</span>
                  <Badge tone="default">{(t.scopes ?? []).join(", ")}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">Groups map to roles</h3>
        <p className="text-sm text-slate-500">A SCIM group's <code className="font-mono text-xs text-amber-300">displayName</code> must be one of <code className="font-mono text-xs">admin</code>, <code className="font-mono text-xs">manager</code>, or <code className="font-mono text-xs">rep</code>; members are assigned that role. Deactivating a user (<code className="font-mono text-xs">active: false</code>) disables their account.</p>
      </div>
    </div>
  );
}
