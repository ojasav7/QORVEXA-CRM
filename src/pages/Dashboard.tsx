import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { StatCard, Badge } from "../components/ui";
import { money, timeAgo } from "../lib/format";
import { STAGE_TONES } from "../lib/objects";

type DashboardData = {
  stats: { contacts: number; accounts: number; leads: number; openDeals: number; wonDeals: number; openTasks: number; overdueTasks: number; pipelineTotal: number };
  pipeline: { stage: string; probability: number; count: number; amount: number }[];
};
type Event = { id: string; type: string; entity: string; createdAt: string; payload: Record<string, any> };

const EVENT_LABEL: Record<string, string> = {
  "deal.stage_changed": "Deal stage changed",
  "contact.created": "Contact created",
  "lead.created": "Lead created",
  "account.created": "Account created",
  "deal.created": "Deal created",
  "user.logged_in": "User logged in",
  "task.updated": "Task updated",
  "org.created": "Workspace created",
  "webhook.created": "Webhook created",
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    void api<DashboardData>("/api/dashboard").then(setData).catch(() => {});
    void api<{ items: Event[] }>("/api/events/feed").then((d) => setEvents(d.items)).catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28" />)}
      </div>
    );
  }

  const { stats, pipeline } = data;
  const maxStage = Math.max(1, ...pipeline.map((p) => p.amount));

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Good to see you 👋</h1>
          <p className="mt-1 text-sm text-slate-500">Here's what's happening across your pipeline today.</p>
        </div>
        <Link to="/deals" className="btn-ghost hidden sm:inline-flex">Open pipeline →</Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pipeline value" value={money(stats.pipelineTotal)} sub={`${stats.openDeals} open deals`} tone="blue" />
        <StatCard label="Contacts" value={stats.contacts} sub={`${stats.accounts} accounts`} tone="green" />
        <StatCard label="Open leads" value={stats.leads} sub="awaiting follow-up" tone="violet" />
        <StatCard label="Open tasks" value={stats.openTasks} sub={stats.overdueTasks > 0 ? `${stats.overdueTasks} overdue ⚠` : "all caught up"} tone={stats.overdueTasks > 0 ? "amber" : "green"} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Pipeline snapshot */}
        <div className="card p-6 lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Pipeline by stage</h2>
            <span className="text-xs text-slate-500">{stats.wonDeals} won · weighted {money(pipeline.reduce((s, p) => s + p.amount * p.probability / 100, 0))}</span>
          </div>
          <div className="space-y-4">
            {pipeline.map((p) => (
              <div key={p.stage}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 capitalize text-slate-300">
                    <Badge tone={(STAGE_TONES[p.stage] as any) ?? "default"}>{p.stage}</Badge>
                    <span className="text-slate-500">{p.count} deals</span>
                  </span>
                  <span className="font-medium tabular-nums text-slate-400">{money(p.amount)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent-500 to-violet-400 transition-all duration-700"
                    style={{ width: `${Math.max(3, (p.amount / maxStage) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live event feed */}
        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Activity feed</h2>
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-mint-400" />
            </span>
          </div>
          <div className="space-y-4">
            {events.map((e) => (
              <div key={e.id} className="flex gap-3">
                <div className="mt-1.5 size-2 shrink-0 rounded-full bg-accent-400/60" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-300">{EVENT_LABEL[e.type] ?? e.type.replace(/\./g, " ")}</p>
                  <p className="text-xs text-slate-600">
                    {timeAgo(e.createdAt)}
                    {e.payload?.from && e.payload?.to && <span className="ml-1">· {e.payload.from} → {e.payload.to}</span>}
                  </p>
                </div>
              </div>
            ))}
            {events.length === 0 && <p className="text-xs text-slate-600">No events yet — create a deal to see the event bus in action.</p>}
          </div>
          <Link to="/events" className="mt-5 block text-center text-xs font-medium text-accent-400 hover:text-accent-300">View all events →</Link>
        </div>
      </div>
    </div>
  );
}
