import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot, ShieldAlert, ShieldCheck, History, FlaskConical, BarChart3,
  Play, Plus, Trash2, Check, X, Power, PowerOff, Sparkles, AlertTriangle,
  Zap, Mail, ListChecks, Ticket as TicketIcon, Pencil, Wallet, Cpu, Brain,
} from "lucide-react";
import { api, post, del } from "../lib/api";
import { useSession } from "../App";
import { Badge, EmptyState, Spinner, Field, StatCard } from "../components/ui";
import { money, timeAgo } from "../lib/format";

type Agent = {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  trigger: { kind: "event" | "manual"; event?: string };
  rules: { field: string; op: string; value: unknown }[];
  tools: string[];
  tierPolicy: Record<string, string>;
  memoryEnabled: boolean;
  active: boolean;
  killSwitched: boolean;
  runCount: number;
  successCount: number;
  approveCount: number;
  costTotal: number;
  createdBy: string;
  createdAt: string;
};
type AgentRun = {
  id: string;
  agentId: string;
  trigger: string;
  eventType: string | null;
  entity: string;
  entityId: string;
  context: { modelId?: string; redactions?: { type: string; count: number }[] } | null;
  reasoning: string | null;
  status: string;
  riskSummary: { green: number; yellow: number; red: number } | null;
  cost: number;
  createdAt: string;
};
type AgentAction = {
  id: string;
  runId: string;
  agentId: string;
  tool: string;
  riskTier: "green" | "yellow" | "red";
  params: Record<string, unknown>;
  reason: string;
  status: string;
  result: Record<string, unknown> | null;
  cost: number;
  approvedBy: string | null;
  createdAt: string;
};
type AgentMemory = { id: string; key: string; value: unknown; entity: string; entityId: string; expiresAt: string | null };
type AgentTest = { id: string; name: string; entity: string; entityId: string; status: string; actions: { tool: string; riskTier: string; reason: string }[]; riskSummary: { green: number; yellow: number; red: number } | null; predictedCost: number; note: string; createdAt: string };

const KIND_LABEL: Record<string, string> = { lead: "Lead", sales: "Sales", service: "Service", renewal: "Renewal", custom: "Custom" };
const TIER_DOT: Record<string, string> = { green: "🟢", yellow: "🟡", red: "🔴" };

function RiskBadge({ tier }: { tier: string }) {
  const map: Record<string, { tone: "green" | "amber" | "rose"; label: string }> = {
    green: { tone: "green", label: "🟢 auto" },
    yellow: { tone: "amber", label: "🟡 approval" },
    red: { tone: "rose", label: "🔴 human" },
  };
  const m = map[tier] ?? { tone: "default" as const, label: tier };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: "green" | "amber" | "rose" | "blue" | "default"; label: string }> = {
    executed: { tone: "green", label: "executed" },
    waiting_approval: { tone: "amber", label: "waiting approval" },
    proposed: { tone: "amber", label: "proposed" },
    rejected: { tone: "rose", label: "rejected" },
    failed: { tone: "rose", label: "failed" },
    skipped: { tone: "default", label: "skipped" },
    passed: { tone: "green", label: "passed" },
    blocked: { tone: "rose", label: "blocked" },
  };
  const m = map[status] ?? { tone: "default" as const, label: status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export default function AgentsPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<"agents" | "approvals" | "runs" | "lab" | "analytics">("agents");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<{ kind: string; name: string; description: string; trigger: { kind: string; event?: string }; tools: string[] }[]>([]);
  const [toolTiers, setToolTiers] = useState<Record<string, string>>({});
  const [orgKill, setOrgKill] = useState(false);
  const [approvals, setApprovals] = useState<AgentAction[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [detail, setDetail] = useState<{ agent: Agent; runs: AgentRun[]; actions: AgentAction[]; memory: AgentMemory[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isAdmin = user?.role === "admin";
  const isManager = isAdmin || user?.role === "manager";

  const load = async () => {
    try {
      const d = await api<{ items: Agent[]; templates: typeof templates; toolTiers: Record<string, string>; orgKillSwitched: boolean }>("/api/agents");
      setAgents(d.items);
      setTemplates(d.templates);
      setToolTiers(d.toolTiers);
      setOrgKill(d.orgKillSwitched);
    } catch { /* quiet */ }
    void loadApprovals();
    void loadRuns();
  };
  const loadApprovals = async () => {
    try { const d = await api<{ items: AgentAction[] }>("/api/agents/approvals"); setApprovals(d.items); } catch { /* quiet */ }
  };
  const loadRuns = async () => {
    try { const d = await api<{ items: AgentRun[] }>("/api/agents/runs?limit=20"); setRuns(d.items); } catch { /* quiet */ }
  };

  useEffect(() => { void load(); }, []);

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(null), 2500); };

  const toggleOrgKill = async () => {
    try {
      await post("/api/agents/kill-switch", { on: !orgKill });
      setOrgKill(!orgKill);
      flash(`Org-wide kill switch ${!orgKill ? "ENGAGED ⛔" : "released"}`);
    } catch (e: any) { flash(e?.message ?? "Failed"); }
  };

  const agentById = (id: string) => agents.find((a) => a.id === id);
  const agentName = (id: string) => agentById(id)?.name ?? id.slice(0, 8);

  const runAgentOn = async (agentId: string, entity: string, entityId: string) => {
    try {
      const d = await post<{ run: AgentRun; actions: AgentAction[]; status: string; cost: number; modelId: string; redactions: { type: string; count: number }[] }>(`/api/agents/${agentId}/run`, { entity, entityId });
      setDetail((prev) => prev?.agent.id === agentId ? { ...prev, runs: [d.run, ...prev.runs] } : prev);
      void load();
      return d;
    } catch (e: any) { throw e; }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Bot className="size-4 text-violet-400" /> AI Agents
            <span className="chip bg-violet-500/15 text-violet-300">autonomous · governed</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Pre-built agents do real work on your records — every action is risk-tiered (🟢 auto / 🟡 approval / 🔴 human), metered, and audited. The kill switch stops everything instantly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => void toggleOrgKill()}
              className={orgKill ? "btn-danger" : "btn-ghost"}
              title="Org-wide kill switch — stops every agent instantly"
            >
              {orgKill ? <PowerOff className="size-4" /> : <Power className="size-4" />}
              {orgKill ? "Kill switch engaged" : "Org kill switch"}
            </button>
          )}
          {orgKill && <span className="chip bg-rose-500/15 text-rose-400"><AlertTriangle className="mr-1 inline size-3" /> all agents frozen</span>}
        </div>
      </div>

      {notice && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}

      <div className="flex gap-1 border-b border-white/[0.06]">
        {([
          ["agents", "Agents", Bot],
          ["approvals", `Approvals${approvals.length ? ` (${approvals.length})` : ""}`, ShieldAlert],
          ["runs", "Runs", History],
          ["lab", "Testing lab", FlaskConical],
          ["analytics", "Analytics", BarChart3],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === key ? "border-accent-400 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "agents" && (
        <AgentsTab
          agents={agents} templates={templates} toolTiers={toolTiers} isAdmin={isAdmin}
          onChanged={() => void load()} onFlash={flash}
          onOpenDetail={async (id) => { const d = await api<typeof detail>(`/api/agents/${id}`); setDetail(d); }}
          onRun={(agentId, entity, entityId) => runAgentOn(agentId, entity, entityId)}
        />
      )}

      {tab === "approvals" && (
        <ApprovalsTab approvals={approvals} isManager={isManager} isAdmin={isAdmin} agentName={agentName}
          onChanged={() => { void loadApprovals(); void loadRuns(); void load(); }} onFlash={flash} />
      )}

      {tab === "runs" && <RunsTab runs={runs} agentName={agentName} />}

      {tab === "lab" && <LabTab agents={agents} isAdmin={isAdmin} onRun={runAgentOn} />}

      {tab === "analytics" && <AnalyticsTab />}

      {detail && (
        <AgentDetail
          detail={detail}
          onClose={() => setDetail(null)}
          onChanged={() => void load()}
          onFlash={flash}
          onRun={(entity, entityId) => runAgentOn(detail.agent.id, entity, entityId)}
        />
      )}
    </div>
  );
}

// ── Agents tab ───────────────────────────────────────────────────────────────

function AgentsTab({ agents, templates, toolTiers, isAdmin, onChanged, onFlash, onOpenDetail, onRun }: {
  agents: Agent[]; templates: { kind: string; name: string; description: string; trigger: { kind: string; event?: string }; tools: string[] }[];
  toolTiers: Record<string, string>; isAdmin: boolean; onChanged: () => void; onFlash: (m: string) => void;
  onOpenDetail: (id: string) => void; onRun: (agentId: string, entity: string, entityId: string) => Promise<unknown>;
}) {
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<{ agentId: string; entity: string; entityId: string } | null>(null);
  const [runResult, setRunResult] = useState<{ run: AgentRun; actions: AgentAction[]; status: string; cost: number; modelId: string } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const toggleKill = async (a: Agent) => {
    try {
      await post(`/api/agents/${a.id}/kill`, { on: !a.killSwitched });
      onChanged();
      onFlash(`${a.name} ${!a.killSwitched ? "kill-switched ⛔" : "re-enabled"}`);
    } catch (e: any) { onFlash(e?.message ?? "Failed"); }
  };
  const remove = async (a: Agent) => {
    if (!confirm(`Delete agent "${a.name}" and its full audit trail?`)) return;
    try { await del(`/api/agents/${a.id}`); onChanged(); onFlash("Agent deleted"); } catch (e: any) { onFlash(e?.message ?? "Failed"); }
  };
  const runNow = async (a: Agent) => {
    setRunError(null); setRunResult(null);
    const entity = running?.agentId === a.id ? running.entity : "opportunity";
    const entityId = running?.agentId === a.id ? running.entityId : "";
    if (!entityId) return onFlash("Pick a record first (or open the agent for its Run button)");
    setRunning({ agentId: a.id, entity, entityId });
    try {
      const d = await onRun(a.id, entity, entityId);
      setRunResult(d as typeof runResult);
      onChanged();
    } catch (e: any) { setRunError(e?.message ?? "Run failed"); }
    finally { setRunning(null); }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Plus className="size-4 text-accent-400" /> Create an agent</h3>
              <p className="mt-0.5 text-xs text-slate-500">Start from a pre-built template (lead / sales / service / renewal) or build custom.</p>
            </div>
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New agent</button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {templates.map((t) => (
              <button key={t.kind} onClick={() => setCreating(true)} className="card p-4 text-left transition-colors hover:border-accent-500/40">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-violet-500/15 text-sm">{KIND_LABEL[t.kind]?.slice(0, 1)}</span>
                  <span className="text-sm font-semibold text-white">{t.name}</span>
                </div>
                <p className="mt-2 line-clamp-3 text-xs text-slate-500">{t.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.tools.map((tool) => (
                    <span key={tool} className="chip bg-white/[0.05] text-[10px] text-slate-400">{actionIcon(tool)} {tool.replace("_", " ")}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {agents.length === 0 && (
        <EmptyState icon={<Bot className="size-8" />} title="No agents yet" hint="Create one from a template above, or from the seed data — then run it against a record or watch it fire on its event trigger." />
      )}

      <div className="space-y-2">
        {agents.map((a) => (
          <div key={a.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => void onOpenDetail(a.id)} className="flex items-center gap-2 text-left">
                <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-accent-500/20 text-sm">{a.kind === "custom" ? "🤖" : a.kind === "lead" ? "🎯" : a.kind === "sales" ? "💰" : a.kind === "service" ? "🎧" : "🔄"}</span>
                <div>
                  <div className="text-sm font-semibold text-white hover:text-accent-300">{a.name}</div>
                  <div className="text-[11px] text-slate-500">{KIND_LABEL[a.kind] ?? a.kind} · trigger {a.trigger.kind === "event" ? a.trigger.event : "manual"} · {a.runCount} runs · {money(a.costTotal)}</div>
                </div>
              </button>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {a.killSwitched && <span className="chip bg-rose-500/15 text-rose-400">⛔ switched off</span>}
                {a.tools.map((t) => <span key={t} className="chip bg-white/[0.05] text-[10px] text-slate-400">{actionIcon(t)} <span className="text-slate-600">{TIER_DOT[toolTiers[t] ?? "green"]}</span></span>)}
                {isAdmin && (
                  <>
                    <button onClick={() => void toggleKill(a)} className="btn-ghost" title={a.killSwitched ? "Re-enable" : "Kill switch"}>
                      {a.killSwitched ? <Power className="size-3.5 text-emerald-400" /> : <PowerOff className="size-3.5 text-rose-400" />}
                    </button>
                    <button onClick={() => void onOpenDetail(a.id)} className="btn-ghost" title="Detail / run"><Play className="size-3.5" /></button>
                    <button onClick={() => void remove(a)} className="btn-ghost text-rose-400 hover:bg-rose-500/10" title="Delete"><Trash2 className="size-3.5" /></button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {runResult && (
        <div className="card border-accent-500/30 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-white">Run {runResult.status}</span>
            <StatusBadge status={runResult.status} />
            <span className="chip bg-white/[0.05] text-[11px] text-slate-400"><Cpu className="mr-1 inline size-3" /> {runResult.modelId} · {money(runResult.cost)}</span>
          </div>
          {runResult.actions.map((ac) => (
            <div key={ac.id} className="mt-2 flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
              <span>{TIER_DOT[ac.riskTier]}</span>
              <span className="font-medium text-white">{actionTool(ac.tool)}</span>
              <span className="text-slate-500">{ac.reason}</span>
              <span className="ml-auto"><StatusBadge status={ac.status} /></span>
            </div>
          ))}
        </div>
      )}
      {runError && <p className="text-xs text-rose-400">⚠ {runError}</p>}

      {creating && (
        <CreateAgentModal templates={templates} toolTiers={toolTiers}
          onClose={() => setCreating(false)}
          onCreated={async (body) => {
            try {
              await post("/api/agents", body);
              setCreating(false);
              onChanged();
              onFlash("Agent created");
            } catch (e: any) { onFlash(e?.message ?? "Create failed"); }
          }} />
      )}
    </div>
  );
}

const actionTool = (tool: string) => ({ create_task: "create task", notify: "notify", create_ticket: "create ticket", update_record: "update record", send_email: "send email" } as Record<string, string>)[tool] ?? tool;

const actionIcon = (tool: string) =>
  tool === "send_email" ? <Mail className="size-3" /> : tool === "create_task" ? <ListChecks className="size-3" /> : tool === "create_ticket" ? <TicketIcon className="size-3" /> : tool === "update_record" ? <Pencil className="size-3" /> : <Zap className="size-3" />;

// ── Create agent modal ───────────────────────────────────────────────────────

function CreateAgentModal({ templates, toolTiers, onClose, onCreated }: {
  templates: { kind: string; name: string; description: string; trigger: { kind: string; event?: string }; tools: string[] }[];
  toolTiers: Record<string, string>; onClose: () => void; onCreated: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [kind, setKind] = useState("lead");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<"event" | "manual">("event");
  const [event, setEvent] = useState("lead.created");
  const [tools, setTools] = useState<string[]>(["create_task", "notify", "update_record"]);
  const [tierPolicy, setTierPolicy] = useState<Record<string, string>>({});
  const ALL_TOOLS = Object.keys(toolTiers);
  const preset = templates.find((t) => t.kind === kind);

  const pickKind = (k: string) => {
    setKind(k);
    const t = templates.find((x) => x.kind === k);
    if (t) {
      setName(t.name);
      setTrigger(t.trigger.kind as "event" | "manual");
      setEvent(t.trigger.event ?? "lead.created");
      setTools(t.tools);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-850 shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Bot className="size-4 text-violet-400" /> Create agent</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t) => (
              <button key={t.kind} onClick={() => pickKind(t.kind)} className={`chip cursor-pointer ${kind === t.kind ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-400 hover:text-slate-200"}`}>
                {KIND_LABEL[t.kind] ?? t.kind}
              </button>
            ))}
          </div>
          {preset && <p className="text-xs text-slate-500">{preset.description}</p>}

          <Field label="Agent name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Inbound Lead Agent" className="input" />
          </Field>

          <Field label="Trigger">
            <div className="flex gap-1.5">
              <button onClick={() => setTrigger("event")} className={`chip cursor-pointer ${trigger === "event" ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-400"}`}>Event</button>
              <button onClick={() => setTrigger("manual")} className={`chip cursor-pointer ${trigger === "manual" ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-400"}`}>Manual only</button>
            </div>
            {trigger === "event" && (
              <select value={event} onChange={(e) => setEvent(e.target.value)} className="input mt-2">
                {["lead.created", "contact.created", "deal.created", "deal.stage_changed", "ticket.created", "form.submitted", "task.completed"].map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            )}
          </Field>

          <Field label={`Tools (default risk tier — ${TIER_DOT.green} auto / ${TIER_DOT.yellow} approval / ${TIER_DOT.red} human)`}>
            <div className="space-y-1.5">
              {ALL_TOOLS.map((t) => (
                <label key={t} className="flex cursor-pointer items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                  <span className="flex items-center gap-2 text-sm text-slate-300">{actionIcon(t)} {t.replace("_", " ")} <span className="text-[10px] text-slate-600">{TIER_DOT[toolTiers[t] ?? "green"]}</span></span>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={tools.includes(t)} onChange={() => setTools((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])} className="accent-accent-500" />
                    {tools.includes(t) && (
                      <select
                        value={tierPolicy[t] ?? toolTiers[t] ?? "green"}
                        onChange={(e) => setTierPolicy((prev) => ({ ...prev, [t]: e.target.value }))}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-md border border-white/[0.08] bg-ink-900 px-1.5 py-1 text-[11px] text-slate-300 outline-none"
                      >
                        <option value="green">🟢 auto</option>
                        <option value="yellow">🟡 approval</option>
                        <option value="red">🔴 human</option>
                      </select>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim() || tools.length === 0} onClick={() => void onCreated({ name: name.trim(), kind, trigger: { kind: trigger, event: trigger === "event" ? event : undefined }, tools, tierPolicy })}>
            <Sparkles className="size-4" /> Create agent
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Approvals tab ────────────────────────────────────────────────────────────

function ApprovalsTab({ approvals, isManager, isAdmin, agentName, onChanged, onFlash }: {
  approvals: AgentAction[]; isManager: boolean; isAdmin: boolean; agentName: (id: string) => string; onChanged: () => void; onFlash: (m: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (action: AgentAction, approve: boolean) => {
    setBusy(action.id);
    try {
      await post(`/api/agents/actions/${action.id}/${approve ? "approve" : "reject"}`, {});
      onFlash(approve ? `Approved ${actionTool(action.tool)} — executed` : "Action rejected");
      onChanged();
    } catch (e: any) { onFlash(e?.message ?? "Failed"); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Human-in-the-loop queue</h3>
        <span className="text-xs text-slate-500">🟡 customer-facing sends & changes · 🔴 admins only</span>
      </div>
      {approvals.length === 0 && <EmptyState icon={<ShieldCheck className="size-8" />} title="Nothing waiting on a human" hint="When an agent proposes a yellow or red action, it lands here for approval before anything happens." />}
      {approvals.map((a) => (
        <div key={a.id} className="card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <RiskBadge tier={a.riskTier} />
            <span className="text-sm font-medium text-white">{actionTool(a.tool)}</span>
            <span className="text-xs text-slate-500">by {agentName(a.agentId)} · {timeAgo(a.createdAt)}</span>
            <span className="ml-auto text-[11px] tabular-nums text-slate-600">{money(a.cost)}</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-400">{a.reason}</p>
          {a.params && Object.keys(a.params).length > 0 && (
            <pre className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink-950/60 p-2.5 text-[11px] text-slate-400">{JSON.stringify(a.params, null, 2)}</pre>
          )}
          {isManager && (
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" disabled={busy === a.id || (a.riskTier === "red" && !isAdmin)} onClick={() => void decide(a, true)}>
                {busy === a.id ? <Spinner className="size-4" /> : <Check className="size-4" />} Approve & execute
              </button>
              <button className="btn-ghost text-rose-400 hover:bg-rose-500/10" disabled={busy === a.id} onClick={() => void decide(a, false)}><X className="size-4" /> Reject</button>
              {a.riskTier === "red" && !isAdmin && <span className="self-center text-[11px] text-rose-400">red-tier requires an admin</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Runs tab ─────────────────────────────────────────────────────────────────

function RunsTab({ runs, agentName }: { runs: AgentRun[]; agentName: (id: string) => string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Run audit trail</h3>
        <span className="text-xs text-slate-500">every decision + action is persisted, metered, and event-logged</span>
      </div>
      {runs.length === 0 && <EmptyState icon={<History className="size-8" />} title="No runs yet" hint="Manual runs, event-triggered runs, and test-lab simulations all land here." />}
      {runs.map((r) => (
        <div key={r.id} className="card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-white">{agentName(r.agentId)}</span>
            <StatusBadge status={r.status} />
            <span className="chip bg-white/[0.05] text-[11px] text-slate-400">{r.entity} · {r.entityId.slice(0, 8)}</span>
            {r.trigger === "event" && r.eventType && <span className="chip bg-accent-500/10 text-[11px] text-accent-300">⚡ {r.eventType}</span>}
            <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
              {r.riskSummary && <span>{TIER_DOT.green}{r.riskSummary.green} {TIER_DOT.yellow}{r.riskSummary.yellow} {TIER_DOT.red}{r.riskSummary.red}</span>}
              <span className="chip bg-white/[0.05] text-slate-400"><Cpu className="mr-1 inline size-3" /> {r.context?.modelId ?? "—"}</span>
              <span>{money(r.cost)}</span>
              <span>{timeAgo(r.createdAt)}</span>
            </span>
          </div>
          {r.reasoning && <p className="mt-1.5 text-xs text-slate-400">🧠 {r.reasoning}</p>}
          {r.context?.redactions && r.context.redactions.length > 0 && (
            <div className="mt-1.5 flex gap-1.5">
              {r.context.redactions.map((x) => <span key={x.type} className="chip bg-amber-500/10 text-[10px] text-amber-400/90">firewall: {x.count}× {x.type}</span>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Testing lab ──────────────────────────────────────────────────────────────

function LabTab({ agents, onRun }: { agents: Agent[]; isAdmin: boolean; onRun: (agentId: string, entity: string, entityId: string) => Promise<unknown> }) {
  const [agentId, setAgentId] = useState("");
  const [entity, setEntity] = useState("opportunity");
  const [entities, setEntities] = useState<{ id: string; label: string }[]>([]);
  const [entityId, setEntityId] = useState("");
  const [scenario, setScenario] = useState("");
  const [result, setResult] = useState<{ test: AgentTest; status: string; note: string; riskSummary: { green: number; yellow: number; red: number }; cost: number } | null>(null);
  const [history, setHistory] = useState<AgentTest[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<{ run: AgentRun; actions: AgentAction[] } | null>(null);

  useEffect(() => { if (agents.length && !agentId) setAgentId(agents[0].id); }, [agents]);
  useEffect(() => { void loadEntities(entity); }, [entity, agentId]);
  useEffect(() => { if (agentId) void api<{ items: AgentTest[] }>(`/api/agents/${agentId}/tests`).then((d) => setHistory(d.items)).catch(() => {}); }, [agentId]);

  const loadEntities = async (type: string) => {
    const path = type === "opportunity" ? "/api/opportunities" : type === "contact" ? "/api/contacts" : type === "account" ? "/api/accounts" : type === "lead" ? "/api/leads" : "/api/tickets";
    try {
      const d = await api<{ items: any[] }>(`${path}?pageSize=40`);
      const mapped = d.items.map((r) => ({ id: r.id, label: (r.name ?? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() ?? r.subject ?? r.email ?? r.id).toString().slice(0, 60) }));
      setEntities(mapped);
      setEntityId(mapped[0]?.id ?? "");
    } catch { setEntities([]); }
  };

  const runTest = async () => {
    if (!agentId || !entityId) return;
    setBusy(true);
    setLive(null);
    try {
      const d = await post<{ test: AgentTest; status: string; note: string; riskSummary: { green: number; yellow: number; red: number }; cost: number }>(`/api/agents/${agentId}/test`, { entity, entityId, name: scenario.trim() || `scenario ${Date.now().toString().slice(-4)}` });
      setResult(d);
      const h = await api<{ items: AgentTest[] }>(`/api/agents/${agentId}/tests`);
      setHistory(h.items);
    } catch (e: any) { setResult(null); setLive(null); alert(e?.message ?? "Test failed"); }
    finally { setBusy(false); }
  };

  const runLive = async () => {
    if (!agentId || !entityId) return;
    try {
      const d = await onRun(agentId, entity, entityId) as { run: AgentRun; actions: AgentAction[] };
      setLive(d);
    } catch (e: any) { alert(e?.message ?? "Run failed"); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><FlaskConical className="size-4 text-accent-400" /> Simulation lab</h3>
        <p className="mt-1 text-xs text-slate-500">Dry-run a scenario with NO execution. <span className="text-emerald-400">passed</span> = go-live safe · <span className="text-rose-400">blocked</span> = a 🔴 human action was proposed.</p>
        <div className="mt-4 space-y-3">
          <Field label="Agent">
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="input">
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Record type">
            <div className="flex flex-wrap gap-1.5">
              {[["opportunity", "Deal"], ["lead", "Lead"], ["contact", "Contact"], ["account", "Account"], ["ticket", "Ticket"]].map(([v, l]) => (
                <button key={v} onClick={() => { setEntity(v); setLive(null); setResult(null); }} className={`chip cursor-pointer ${entity === v ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-400"}`}>{l}</button>
              ))}
            </div>
          </Field>
          <Field label="Record">
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="input">
              {entities.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </Field>
          <Field label="Scenario name">
            <input value={scenario} onChange={(e) => setScenario(e.target.value)} placeholder="e.g. hot-lead inbound" className="input" />
          </Field>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => void runTest()} disabled={busy || !entityId}>
              {busy ? <Spinner className="size-4" /> : <FlaskConical className="size-4" />} Run simulation
            </button>
            <button className="btn-ghost" onClick={() => void runLive()} disabled={!entityId}><Play className="size-4" /> Run live (executes)</button>
          </div>
        </div>
        {result && (
          <div className={`mt-4 rounded-xl border p-4 ${result.status === "passed" ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-rose-500/30 bg-rose-500/[0.06]"}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">{result.status === "passed" ? "✓ Go-live safe" : "✗ Blocked by governance"}</span>
              <StatusBadge status={result.status} />
            </div>
            <p className="mt-1 text-xs text-slate-400">{result.note}</p>
            <div className="mt-2 flex gap-1.5">
              <span className="chip bg-white/[0.05] text-slate-400">{TIER_DOT.green} {result.riskSummary.green} auto</span>
              <span className="chip bg-white/[0.05] text-slate-400">{TIER_DOT.yellow} {result.riskSummary.yellow} approval</span>
              <span className="chip bg-white/[0.05] text-slate-400">{TIER_DOT.red} {result.riskSummary.red} human</span>
              <span className="chip bg-white/[0.05] text-slate-400">est. {money(result.cost)}</span>
            </div>
            {result.test.actions.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {result.test.actions.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-ink-950/50 px-3 py-2 text-xs">
                    <span>{TIER_DOT[a.riskTier]}</span><span className="font-medium text-white">{actionTool(a.tool)}</span><span className="text-slate-500">{a.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {live && (
          <div className="mt-4 rounded-xl border border-accent-500/30 bg-accent-500/[0.06] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Zap className="size-4 text-accent-400" /> Live run <StatusBadge status={live.run.status} /></div>
            {live.actions.map((a) => (
              <div key={a.id} className="mt-2 flex items-center gap-2 rounded-lg bg-ink-950/50 px-3 py-2 text-xs">
                <span>{TIER_DOT[a.riskTier]}</span><span className="font-medium text-white">{actionTool(a.tool)}</span><span className="text-slate-500">{a.reason}</span>
                <span className="ml-auto"><StatusBadge status={a.status} /></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Test history</h4>
        {history.length === 0 && <EmptyState icon={<FlaskConical className="size-8" />} title="No simulations yet" hint="Run a scenario above — it never executes real actions." />}
        {history.map((t) => (
          <div key={t.id} className="card flex items-center gap-3 p-3">
            <StatusBadge status={t.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-white">{t.name}</div>
              <div className="truncate text-[11px] text-slate-500">{t.entity} · {timeAgo(t.createdAt)} · est. {money(t.predictedCost)}</div>
            </div>
            {t.riskSummary && <span className="text-[11px] text-slate-500">{TIER_DOT.green}{t.riskSummary.green} {TIER_DOT.yellow}{t.riskSummary.yellow} {TIER_DOT.red}{t.riskSummary.red}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Analytics + metering ─────────────────────────────────────────────────────

function AnalyticsTab() {
  const [data, setData] = useState<{ agents: any[]; totals: { runs: number; actions: number; costTotal: number; waitingApproval: number } } | null>(null);
  const [meter, setMeter] = useState<{ total: number; currency: string; model: string; agents: any[]; byEntity: { entity: string; _sum: { cost: number } | null; _count: { _all: number } }[] } | null>(null);

  useEffect(() => {
    void api<{ agents: any[]; totals: { runs: number; actions: number; costTotal: number; waitingApproval: number } }>("/api/agents/analytics").then(setData).catch(() => {});
    void api<{ total: number; currency: string; model: string; agents: any[]; byEntity: { entity: string; _sum: { cost: number } | null; _count: { _all: number } }[] }>("/api/agents/metering").then(setMeter).catch(() => {});
  }, []);

  const maxAgentCost = Math.max(1, ...(meter?.agents.map((a) => a.costTotal) ?? [0]));
  const maxEntityCost = Math.max(1, ...(meter?.byEntity.map((e) => e._sum?.cost ?? 0) ?? [0]));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total runs" value={data?.totals.runs ?? "—"} tone="blue" />
        <StatCard label="Total actions" value={data?.totals.actions ?? "—"} tone="violet" />
        <StatCard label="Waiting on humans" value={data?.totals.waitingApproval ?? "—"} tone="amber" />
        <StatCard label="Simulated spend" value={meter ? money(meter.total) : "—"} sub={meter ? `model ${meter.model}` : undefined} tone="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><BarChart3 className="size-4 text-accent-400" /> Per-agent performance</h3>
          <div className="mt-3 space-y-2">
            {!data && <Spinner />}
            {data?.agents.map((a) => (
              <div key={a.id} className="rounded-lg bg-white/[0.03] p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-white">{a.name}</span>
                  <Badge tone={a.kind === "custom" ? "default" : "blue"}>{a.kind}</Badge>
                  {a.killSwitched && <span className="chip bg-rose-500/15 text-[10px] text-rose-400">⛔</span>}
                  <span className="ml-auto text-xs text-slate-500">{a.runs} runs · {a.actions} actions</span>
                </div>
                <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
                  <span>success <span className="font-semibold text-emerald-400">{a.successRate}%</span></span>
                  <span>escalation <span className="font-semibold text-amber-400">{a.escalationRate}%</span></span>
                  <span>waiting <span className="font-semibold text-slate-300">{a.waitingApproval}</span></span>
                  <span>spend <span className="font-semibold text-slate-300">{money(a.costTotal)}</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Wallet className="size-4 text-emerald-400" /> Cost metering</h3>
          <p className="mt-0.5 text-xs text-slate-500">{meter?.currency ?? "simulated"} · cheapest routed model: <span className="text-slate-300">{meter?.model ?? "—"}</span></p>
          <div className="mt-4 space-y-2">
            {!meter && <Spinner />}
            {meter?.agents.map((a) => (
              <div key={a.id}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{a.name} <span className="text-slate-600">· {a.runCount} runs</span></span>
                  <span className="tabular-nums text-slate-400">{money(a.costTotal)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${(a.costTotal / maxAgentCost) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <h4 className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">By entity</h4>
          <div className="mt-2 space-y-2">
            {meter?.byEntity.map((e) => (
              <div key={e.entity}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{e.entity} <span className="text-slate-600">· {e._count._all} runs</span></span>
                  <span className="tabular-nums text-slate-400">{money(e._sum?.cost ?? 0)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-violet-400/70" style={{ width: `${((e._sum?.cost ?? 0) / maxEntityCost) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Agent detail drawer ──────────────────────────────────────────────────────

function AgentDetail({ detail, onClose, onChanged, onFlash, onRun }: {
  detail: { agent: Agent; runs: AgentRun[]; actions: AgentAction[]; memory: AgentMemory[] };
  onClose: () => void; onChanged: () => void; onFlash: (m: string) => void;
  onRun: (entity: string, entityId: string) => Promise<unknown>;
}) {
  const { agent, runs, actions, memory } = detail;
  const [entity, setEntity] = useState("opportunity");
  const [entities, setEntities] = useState<{ id: string; label: string }[]>([]);
  const [entityId, setEntityId] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<{ run: AgentRun; actions: AgentAction[] } | null>(null);

  const loadEntities = async (type: string) => {
    const path = type === "opportunity" ? "/api/opportunities" : type === "contact" ? "/api/contacts" : type === "account" ? "/api/accounts" : type === "lead" ? "/api/leads" : "/api/tickets";
    try {
      const d = await api<{ items: any[] }>(`${path}?pageSize=40`);
      const mapped = d.items.map((r) => ({ id: r.id, label: (r.name ?? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() ?? r.subject ?? r.email ?? r.id).toString().slice(0, 60) }));
      setEntities(mapped);
      setEntityId(mapped[0]?.id ?? "");
    } catch { setEntities([]); }
  };
  useEffect(() => { void loadEntities(entity); }, [entity]);

  const run = async () => {
    if (!entityId) return;
    setBusy(true);
    try {
      const d = await onRun(entity, entityId) as { run: AgentRun; actions: AgentAction[] };
      setLive(d);
      onChanged();
    } catch (e: any) { onFlash(e?.message ?? "Run failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col border-l border-white/[0.08] bg-ink-850 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-4">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-accent-500/20 text-lg">{agent.kind === "custom" ? "🤖" : agent.kind === "lead" ? "🎯" : agent.kind === "sales" ? "💰" : agent.kind === "service" ? "🎧" : "🔄"}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{agent.name}</div>
            <div className="text-[11px] text-slate-500">{KIND_LABEL[agent.kind]} · trigger {agent.trigger.kind === "event" ? agent.trigger.event : "manual"} · {agent.runCount} runs · {money(agent.costTotal)} spent</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.map((t) => <span key={t} className="chip bg-white/[0.05] text-[11px] text-slate-300">{actionIcon(t)} {t.replace("_", " ")}</span>)}
          </div>
          {agent.description && <p className="text-xs text-slate-500">{agent.description}</p>}

          <div className="card p-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><Play className="size-3.5 text-accent-400" /> Run manually</h4>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {[["opportunity", "Deal"], ["lead", "Lead"], ["contact", "Contact"], ["account", "Account"], ["ticket", "Ticket"]].map(([v, l]) => (
                  <button key={v} onClick={() => { setEntity(v); setLive(null); }} className={`chip cursor-pointer ${entity === v ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-400"}`}>{l}</button>
                ))}
              </div>
              <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="input">
                {entities.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
              <button className="btn-primary w-full" onClick={() => void run()} disabled={busy || !entityId}>
                {busy ? <Spinner className="size-4" /> : <Play className="size-4" />} Run agent
              </button>
              {live && (
                <div className="rounded-lg border border-accent-500/30 bg-accent-500/[0.06] p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-white"><Zap className="size-4 text-accent-400" /> Run {live.run.status}</div>
                  {live.actions.map((a) => (
                    <div key={a.id} className="mt-1.5 flex items-center gap-2 rounded-lg bg-ink-950/50 px-2.5 py-1.5 text-xs">
                      <span>{TIER_DOT[a.riskTier]}</span><span className="font-medium text-white">{actionTool(a.tool)}</span><span className="text-slate-500">{a.reason}</span>
                      <span className="ml-auto"><StatusBadge status={a.status} /></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recent runs</h4>
            <div className="mt-2 space-y-2">
              {runs.length === 0 && <p className="text-xs text-slate-600">No runs yet.</p>}
              {runs.map((r) => (
                <div key={r.id} className="rounded-lg bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2 text-xs">
                    <StatusBadge status={r.status} />
                    <span className="text-slate-400">{r.entity} · {r.entityId.slice(0, 8)}</span>
                    {r.trigger === "event" && <span className="text-accent-300">⚡ {r.eventType}</span>}
                    <span className="ml-auto text-slate-500">{money(r.cost)} · {timeAgo(r.createdAt)}</span>
                  </div>
                  {r.reasoning && <p className="mt-1 text-[11px] text-slate-500">🧠 {r.reasoning}</p>}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Agent memory</h4>
            <div className="mt-2 space-y-1.5">
              {memory.length === 0 && <p className="text-xs text-slate-600">No memory rows — enabled {agent.memoryEnabled ? "✓" : "✗"}.</p>}
              {memory.map((m) => (
                <div key={m.id} className="rounded-lg bg-white/[0.03] p-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-white">{m.key} <span className="text-slate-600">· {m.entity} {m.entityId.slice(0, 6)}</span></span>
                    {m.expiresAt && <span className="text-[10px] text-slate-600">exp {timeAgo(m.expiresAt)}</span>}
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap text-[11px] text-slate-400">{JSON.stringify(m.value, null, 2)}</pre>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recent actions</h4>
            <div className="mt-2 space-y-1.5">
              {actions.length === 0 && <p className="text-xs text-slate-600">No actions yet.</p>}
              {actions.slice(0, 15).map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                  <span>{TIER_DOT[a.riskTier]}</span>
                  <span className="font-medium text-white">{actionTool(a.tool)}</span>
                  <span className="truncate text-slate-500">{a.reason}</span>
                  <span className="ml-auto"><StatusBadge status={a.status} /></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
