import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { StatCard, Badge } from "../components/ui";
import { money, timeAgo } from "../lib/format";
import { STAGE_TONES } from "../lib/objects";
import { useSession } from "../App";
import { Wallet, Users, Target, CheckSquare, ArrowRight, PieChart, AlertTriangle, CalendarClock, ChevronRight } from "lucide-react";

type DashboardData = {
  stats: { contacts: number; accounts: number; leads: number; openDeals: number; wonDeals: number; openTasks: number; overdueTasks: number; pipelineTotal: number };
  pipeline: { stage: string; probability: number; count: number; amount: number }[];
};
type Event = { id: string; type: string; entity: string; createdAt: string; payload: Record<string, any> };
type Task = { id: string; title: string; status: string; dueAt?: string | null; priority?: string };

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

/** Time-of-day greeting (spec §16) — uses real clock, never fabricated data. */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const { user } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    void api<DashboardData>("/api/dashboard").then(setData).catch(() => {});
    void api<{ items: Event[] }>("/api/events/feed").then((d) => setEvents(d.items)).catch(() => {});
    // My open tasks (due soonest) for the "needs attention" panel.
    void api<{ items: Task[] }>("/api/tasks?status=todo&pageSize=5")
      .then((d) => setTasks(d.items))
      .catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-20" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28" />)}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="skeleton h-72 lg:col-span-2" />
          <div className="skeleton h-72" />
        </div>
      </div>
    );
  }

  const { stats, pipeline } = data;
  const maxStage = Math.max(1, ...pipeline.map((p) => p.amount));
  const weighted = pipeline.reduce((s, p) => s + p.amount * p.probability / 100, 0);
  const first = user?.name?.split(" ")[0];

  // Needs-attention (spec §20): overdue tasks, then high-priority open ones.
  const attentionItems = [
    ...tasks.filter((t) => t.status === "todo" && t.dueAt && new Date(t.dueAt).getTime() < Date.now()).map((t) => ({ ...t, kind: "overdue" })),
    ...tasks.filter((t) => t.status === "todo" && t.priority === "high").map((t) => ({ ...t, kind: "high" })),
  ].slice(0, 5);

  return (
    <div className="animate-fade-up space-y-6">
      {/* Personalized header (spec §16) */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {greeting()}{first ? `, ${first}` : ""} 👋
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {stats.overdueTasks > 0
              ? `${stats.overdueTasks} task${stats.overdueTasks === 1 ? "" : "s"} overdue · ${stats.openDeals} open deal${stats.openDeals === 1 ? "" : "s"} need attention today.`
              : `Here's what's happening across your pipeline today — all caught up on tasks.`}
          </p>
        </div>
        <Link to="/deals" className="btn-secondary hidden sm:inline-flex">Open pipeline <ArrowRight className="size-4" /></Link>
      </div>

      {/* KPI cards — each clickable (spec §17) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link to="/deals" className="group">
          <StatCard label="Pipeline value" value={money(stats.pipelineTotal)} sub={`${stats.openDeals} open deals · ${money(weighted)} weighted`} tone="green" icon={<Wallet className="size-4" />} />
        </Link>
        <Link to="/contacts" className="group">
          <StatCard label="Contacts" value={stats.contacts} sub={`${stats.accounts} accounts`} tone="teal" icon={<Users className="size-4" />} />
        </Link>
        <Link to="/leads" className="group">
          <StatCard label="Open leads" value={stats.leads} sub="awaiting follow-up" tone="green" icon={<Target className="size-4" />} />
        </Link>
        <Link to="/activities" className="group">
          <StatCard label="Open tasks" value={stats.openTasks} sub={stats.overdueTasks > 0 ? `${stats.overdueTasks} overdue` : "all caught up"} tone={stats.overdueTasks > 0 ? "amber" : "green"} icon={<CheckSquare className="size-4" />} />
        </Link>
      </div>

      {/* Needs attention + tasks (spec §20/§21) */}
      {attentionItems.length > 0 && (
        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <AlertTriangle className="size-4 text-amber-400" /> Needs attention
            </h2>
            <Link to="/activities" className="text-xs font-medium text-accent-400 hover:text-accent-300">View tasks <ChevronRight className="inline size-3.5" /></Link>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {attentionItems.map((t) => (
              <Link key={t.id} to={`/activities?id=${t.id}`} className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-ink-800/40 px-4 py-3 transition-colors hover:border-[var(--border-strong)] hover:bg-ink-800/70">
                <CalendarClock className={`size-4 shrink-0 ${t.kind === "overdue" ? "text-rose-400" : "text-amber-400"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">{t.title}</div>
                  <div className="text-xs text-slate-500">
                    {t.kind === "overdue" && t.dueAt ? `Overdue · ${timeAgo(t.dueAt)}` : t.priority === "high" ? "High priority" : t.status}
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-slate-600" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Pipeline snapshot */}
        <div className="card p-6 lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><PieChart className="size-4 text-accent-400" /> Pipeline by stage</h2>
            <span className="text-xs text-slate-500">{stats.wonDeals} won · weighted {money(weighted)}</span>
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
                    className="h-full rounded-full bg-gradient-to-r from-accent-500 to-teal-400 transition-all duration-700"
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
            <span className="relative flex size-2" title="Live">
              <span className="relative inline-flex size-2 rounded-full bg-mint-400 shadow-[0_0_0_3px_rgba(45,212,191,0.18)]" />
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
