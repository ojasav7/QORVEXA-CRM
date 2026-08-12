import { useCallback, useEffect, useState } from "react";
import { Gauge, MailOpen, MousePointerClick, AlertTriangle, Ban, Flag, RefreshCw } from "lucide-react";
import { api, post, ApiError } from "../lib/api";
import { Badge, StatCard, Spinner } from "../components/ui";
import { timeAgo } from "../lib/format";
import { useSession } from "../App";

type Metrics = {
  sent: number; opened: number; openedRate: number; clicked: number; clickRate: number;
  bounced: number; bounceRate: number; unsubscribed: number; complaints: number;
  health: number; grades: Record<string, number>;
};
type Message = { id: string; toEmail: string; subject: string; status: string; openedAt: string | null; clickedAt: string | null; bouncedAt: string | null; unsubscribedAt: string | null; createdAt: string };

export default function DeliverabilityPage() {
  const { user } = useSession();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, d] = await Promise.all([
        api<{ metrics: Metrics; recent: Message[] }>("/api/deliverability"),
        api<{ items: Message[] }>("/api/deliverability/messages?pageSize=12"),
      ]);
      setMetrics(m.metrics);
      setMessages(d.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const simulate = async (messageId: string, kind: "bounce" | "unsubscribe" | "complaint") => {
    setBusy(messageId + kind); setError(null);
    try {
      await post("/api/deliverability/simulate", { messageId, kind });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const healthTone = metrics ? (metrics.health >= 80 ? "text-emerald-400" : metrics.health >= 50 ? "text-amber-400" : "text-rose-400") : "text-slate-400";

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Deliverability</h1>
          <p className="text-sm text-slate-500">Email health computed from your outbound messages — opens, clicks, bounces, and opt-outs.</p>
        </div>
        {user?.role === "admin" && (
          <button className="btn-ghost ml-auto" onClick={() => void load()}><RefreshCw className="size-4" /> Refresh</button>
        )}
      </div>
      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {loading || !metrics ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28" />)}
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card flex items-center gap-4 p-5">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.06]">
                <Gauge className={`size-6 ${healthTone}`} />
              </div>
              <div>
                <div className="text-3xl font-semibold tabular-nums text-white">{metrics.health}</div>
                <div className="text-xs uppercase tracking-wider text-slate-500">health score</div>
              </div>
            </div>
            <StatCard label="Sent" value={metrics.sent} sub={`${Object.values(metrics.grades).reduce((a, b) => a + b, 0)} total`} />
            <StatCard label="Open rate" value={`${metrics.openedRate}%`} tone="green" sub={`${metrics.opened} opened`} />
            <StatCard label="Click rate" value={`${metrics.clickRate}%`} tone="amber" sub={`${metrics.clicked} clicked`} />
          </div>

          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Bounce rate" value={`${metrics.bounceRate}%`} tone={metrics.bounceRate >= 3 ? "amber" : "violet"} sub={`${metrics.bounced} bounced`} />
            <StatCard label="Unsubscribed" value={metrics.unsubscribed} tone="violet" sub="opted out" />
            <StatCard label="Spam complaints" value={metrics.complaints} tone="violet" sub="reported" />
          </div>

          <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-slate-500">
            <AlertTriangle className="size-3.5 text-amber-400" />
            <span className="flex-1">Bounce, unsubscribe and complaint events are <b>simulated</b> (mock provider, ADR-014) — the metrics pipeline itself is real and updates instantly.</span>
          </div>

          <h2 className="mb-3 text-sm font-semibold text-white">Recent messages</h2>
          {messages.length === 0 ? (
            <div className="card p-8 text-center text-sm text-slate-600">No outbound messages yet. Send an email or a campaign to see deliverability data.</div>
          ) : (
            <div className="space-y-2">
              {messages.map((m) => (
                <div key={m.id} className="card flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-200">{m.subject || "(no subject)"}</div>
                    <div className="truncate text-xs text-slate-600">to {m.toEmail} · {timeAgo(m.createdAt)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {m.openedAt && <Badge tone="green"><MailOpen className="size-3" /> opened</Badge>}
                    {m.clickedAt && <Badge tone="blue"><MousePointerClick className="size-3" /> clicked</Badge>}
                    {m.bouncedAt && <Badge tone="rose"><AlertTriangle className="size-3" /> bounced</Badge>}
                    {m.unsubscribedAt && <Badge tone="amber"><Ban className="size-3" /> unsubscribed</Badge>}
                    {!m.openedAt && !m.clickedAt && !m.bouncedAt && !m.unsubscribedAt && <Badge>sent</Badge>}
                  </div>
                  {user?.role === "admin" && (
                    <div className="flex gap-1">
                      <button onClick={() => void simulate(m.id, "bounce")} disabled={busy !== null} title="Simulate hard bounce" className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-400"><AlertTriangle className="size-3.5" /></button>
                      <button onClick={() => void simulate(m.id, "unsubscribe")} disabled={busy !== null} title="Simulate unsubscribe" className="rounded-lg p-1.5 text-slate-500 hover:bg-amber-500/15 hover:text-amber-400"><Ban className="size-3.5" /></button>
                      <button onClick={() => void simulate(m.id, "complaint")} disabled={busy !== null} title="Simulate spam complaint" className="rounded-lg p-1.5 text-slate-500 hover:bg-violet-500/15 hover:text-violet-400"><Flag className="size-3.5" /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {busy && <div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Spinner className="size-3.5" /> Simulating…</div>}
        </>
      )}
    </div>
  );
}
