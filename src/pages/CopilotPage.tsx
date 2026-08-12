import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, Search, FileText, Mail, Gauge, MessageSquareText, Brain, Shield,
  History, Copy, Check, AlertTriangle, Cpu, ShieldCheck, Wand2, Trash2, Plus,
  ChevronRight, Eye,
} from "lucide-react";
import { api, post, del } from "../lib/api";
import { useSession } from "../App";
import { Badge, EmptyState, Spinner, Field } from "../components/ui";
import { money, timeAgo } from "../lib/format";

type Insight = {
  id: string;
  kind: string;
  feature: string;
  entity: string | null;
  entityId: string | null;
  title: string | null;
  content: string | null;
  confidence: number;
  lowConfidence: boolean;
  modelId: string | null;
  latencyMs: number;
  payload: Record<string, unknown>;
  redacted: { type: string; count: number }[];
  createdAt: string;
};

type SearchHit = { type: string; id: string; title: string; subtitle: string; confidence: number; evidence: { matchedTerms: string[]; predicate?: string; reason: string } };
type Model = { id: string; name: string; provider: string; tier: string; capabilities: string[]; costPer1kIn: number; costPer1kOut: number; latencyMs: number; region: string; active: boolean; routingWeight: number };

/** Confidence gauge — the 🆕 confidence scoring surfaced everywhere. */
function Confidence({ value }: { value: number }) {
  const tone = value >= 65 ? "bg-emerald-500" : value >= 40 ? "bg-amber-500" : "bg-rose-500";
  const label = value >= 65 ? "text-emerald-400" : value >= 40 ? "text-amber-400" : "text-rose-400";
  return (
    <div className="flex items-center gap-2" title={`AI confidence ${value}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(4, value)}%` }} />
      </div>
      <span className={`text-[11px] font-semibold tabular-nums ${label}`}>{value}%</span>
    </div>
  );
}

function ModelChip({ model, latency }: { model: string | null; latency?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
      <Cpu className="size-3" /> {model ?? "—"}{latency != null ? ` · ${latency}ms` : ""}
    </span>
  );
}

const EXAMPLES = ["won deals over 50k", "elena rodriguez", "high priority tickets", "enterprise accounts"];

export default function CopilotPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"ask" | "generate" | "insights" | "memory" | "firewall">("ask");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [queryMeta, setQueryMeta] = useState<{ groups: string[]; predicate: { field: string; op: string; value: number } | null; types: string[] } | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [memories, setMemories] = useState<{ id: string; key: string; value: unknown; expiresAt: string | null }[]>([]);
  const [firewall, setFirewall] = useState<{ policy: FirewallPolicy; recent: Insight[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void loadInsights(); void loadMemory(); void loadFirewall(); }, []);

  const loadInsights = async () => {
    try {
      const d = await api<{ items: Insight[] }>("/api/ai/insights?limit=12");
      setInsights(d.items);
    } catch { /* quiet */ }
  };
  const loadMemory = async () => {
    try {
      const d = await api<{ items: { id: string; key: string; value: unknown; expiresAt: string | null }[] }>("/api/ai/memory?scopeType=user");
      setMemories(d.items);
    } catch { /* quiet */ }
  };
  const loadFirewall = async () => {
    try {
      setFirewall(await api("/api/ai/firewall"));
    } catch { /* quiet */ }
  };

  const search = async (query: string) => {
    if (!query.trim()) return;
    setSearching(true);
    setResults(null);
    try {
      const d = await api<{ groups: string[]; predicate: { field: string; op: string; value: number } | null; types: string[]; items: SearchHit[] }>(`/api/ai/search?q=${encodeURIComponent(query)}`);
      setResults(d.items);
      setQueryMeta({ groups: d.groups, predicate: d.predicate, types: d.types });
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
      void loadInsights();
    }
  };

  const goTo = (type: string, id: string) => {
    const map: Record<string, string> = { contact: "/contacts", account: "/accounts", lead: "/leads", opportunity: "/deals", ticket: "/tickets" };
    navigate(`${map[type] ?? "/"}?id=${id}`);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard ✓");
      setTimeout(() => setNotice(null), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="size-4 text-violet-400" /> AI Copilot
            <span className="chip bg-violet-500/15 text-violet-300">non-agentic · explainable</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Summaries, drafts, scores, sentiment, intent and semantic search — every output shows its model, its confidence, and its evidence. No autonomous actions.
          </p>
        </div>
        <div className="flex gap-2">
          <span className="chip bg-white/[0.06] text-slate-300"><ShieldCheck className="mr-1 inline size-3" /> Data firewall on</span>
          <span className="chip bg-white/[0.06] text-slate-300">Models: mock (no external calls)</span>
        </div>
      </div>

      <div className="flex gap-1 border-b border-white/[0.06]">
        {([
          ["ask", "Ask", Search],
          ["generate", "Generate", Wand2],
          ["insights", "Insights", History],
          ["memory", "Memory", Brain],
          ["firewall", "Firewall", Shield],
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

      {tab === "ask" && (
        <div className="space-y-4">
          <div className="card p-5">
            <label className="label">Ask anything — natural-language search across the CRM</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void search(q)}
                  placeholder='Try "won deals over 50k" or "elena"'
                  className="input pl-9"
                />
              </div>
              <button className="btn-primary" onClick={() => void search(q)} disabled={searching}>
                {searching ? <Spinner className="size-4" /> : <Sparkles className="size-4" />} Ask
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => { setQ(e); void search(e); }} className="chip cursor-pointer bg-white/[0.04] text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-slate-200">
                  {e}
                </button>
              ))}
            </div>
            {queryMeta && results && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span className="chip bg-white/[0.05] text-slate-400">groups: {queryMeta.groups.join(", ") || "—"}</span>
                {queryMeta.predicate && <span className="chip bg-accent-500/15 text-accent-300">amount {queryMeta.predicate.op === "gte" ? "≥" : "≤"} {money(queryMeta.predicate.value)}</span>}
                <span className="chip bg-white/[0.05] text-slate-400">searched: {queryMeta.types.join(", ")}</span>
              </div>
            )}
          </div>

          {searching && <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Spinner /> Routing + scoring results…</div>}
          {!searching && results && results.length === 0 && (
            <EmptyState icon={<Search className="size-8" />} title="No semantic matches" hint="Try a name, a stage word (won/lost/open), an amount predicate (over 50k), or an entity word (tickets, accounts)." />
          )}
          {!searching && results && results.length > 0 && (
            <div className="space-y-2">
              {results.map((r, i) => (
                <button key={`${r.type}-${r.id}`} onClick={() => goTo(r.type, r.id)} className="card flex w-full items-center gap-3 p-4 text-left transition-colors hover:border-white/[0.12] hover:bg-white/[0.03]">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[10px] font-semibold uppercase text-slate-300">{r.type.slice(0, 3)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{r.title}</div>
                    {r.subtitle && <div className="truncate text-xs text-slate-500">{r.subtitle}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="text-violet-400">#{i + 1}</span>
                      {r.evidence.matchedTerms.length > 0 && <span>matched: {r.evidence.matchedTerms.join(", ")}</span>}
                      {r.evidence.predicate && <span className="text-accent-300">{r.evidence.predicate}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Confidence value={r.confidence} />
                    <ChevronRight className="size-4 text-slate-600" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "generate" && <GeneratePanel onGenerated={() => { void loadInsights(); }} onCopy={copyText} notice={notice} />}

      {tab === "insights" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">AI insight history</h3>
            <span className="text-xs text-slate-500">every generation is persisted + event-logged</span>
          </div>
          {insights.length === 0 && <EmptyState icon={<History className="size-8" />} title="No AI outputs yet" hint="Generate a summary, score, draft, or search from the Ask / Generate tabs." />}
          {insights.map((i) => (
            <div key={i.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={i.kind === "score" ? "blue" : i.kind === "search" ? "violet" : "green"}>{i.kind}</Badge>
                <span className="text-sm font-medium text-white">{i.title ?? i.feature}</span>
                <span className="ml-auto flex items-center gap-2">
                  <Confidence value={i.confidence} />
                  <ModelChip model={i.modelId} latency={i.latencyMs} />
                  <span className="text-[11px] text-slate-600">{timeAgo(i.createdAt)}</span>
                </span>
              </div>
              {i.content && <p className="mt-2 text-sm text-slate-400">{i.content}</p>}
              {(i.redacted.length > 0 || i.lowConfidence) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {i.lowConfidence && <span className="chip bg-rose-500/15 text-rose-400"><AlertTriangle className="mr-1 inline size-3" /> low confidence — ai.confidence_flagged</span>}
                  {i.redacted.map((r) => (
                    <span key={r.type} className="chip bg-amber-500/10 text-amber-400/90">firewall: {r.count}× {r.type} redacted</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "memory" && (
        <MemoryPanel memories={memories} onChanged={() => { void loadMemory(); }} onCopy={copyText} />
      )}

      {tab === "firewall" && (
        <FirewallPanel firewall={firewall} isAdmin={user?.role === "admin"} onSaved={() => { void loadFirewall(); void loadInsights(); }} />
      )}
    </div>
  );
}

// ── Generate panel ───────────────────────────────────────────────────────────

function GeneratePanel({ onGenerated, onCopy, notice }: { onGenerated: () => void; onCopy: (t: string) => void; notice: string | null }) {
  const [mode, setMode] = useState<"summary" | "draft" | "score" | "text">("summary");
  const [entityType, setEntityType] = useState("opportunity");
  const [entities, setEntities] = useState<{ id: string; label: string }[]>([]);
  const [entityId, setEntityId] = useState("");
  const [tone, setTone] = useState("follow_up");
  const [text, setText] = useState("");
  const [tool, setTool] = useState<"sentiment" | "intent">("sentiment");
  const [profiles, setProfiles] = useState<{ id: string; label: string }[]>([]);
  const [profileId, setProfileId] = useState("");
  const [output, setOutput] = useState<Insight | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntities = async (type: string) => {
    const path = type === "opportunity" ? "/api/opportunities" : type === "contact" ? "/api/contacts" : type === "account" ? "/api/accounts" : type === "lead" ? "/api/leads" : "/api/tickets";
    try {
      const d = await api<{ items: any[] }>(`${path}?pageSize=40`);
      setEntities(d.items.map((r) => ({ id: r.id, label: r.name ?? `${r.firstName} ${r.lastName}`.trim() ?? r.subject ?? r.email })));
      setEntityId(d.items[0]?.id ?? "");
    } catch { setEntities([]); }
  };
  const loadProfiles = async () => {
    try {
      const d = await api<{ items: any[] }>("/api/cdp/profiles?limit=40");
      setProfiles(d.items.map((r) => ({ id: r.id, label: `${r.name} <${r.email}>` })));
      setProfileId(d.items[0]?.id ?? "");
    } catch { setProfiles([]); }
  };

  useEffect(() => {
    if (mode === "summary" || mode === "score") void loadEntities(entityType);
    if (mode === "text" && tool === "intent") void loadProfiles();
  }, [mode, tool, entityType]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      if (mode === "summary") {
        const body = entityType === "call" || entityType === "meeting" || entityType === "profile"
          ? { [entityType === "profile" ? "profileId" : `${entityType}Id`]: entityId }
          : { entity: entityType, entityId };
        const endpoint = entityType === "call" ? "/api/ai/summarize/call" : entityType === "meeting" ? "/api/ai/summarize/meeting" : entityType === "profile" ? "/api/ai/summarize/profile" : "/api/ai/summarize";
        const d = await post<{ insight: Insight }>(endpoint, body);
        setOutput(d.insight);
      } else if (mode === "draft") {
        const d = await post<{ insight: Insight }>("/api/ai/draft", { contactId: entityId, tone });
        setOutput(d.insight);
      } else if (mode === "score") {
        const d = await post<{ insight: Insight }>("/api/ai/score", { entity: entityType, entityId });
        setOutput(d.insight);
      } else {
        const d = tool === "sentiment"
          ? await post<{ insight: Insight }>("/api/ai/sentiment", { text })
          : await post<{ insight: Insight }>("/api/ai/intent", { profileId });
        setOutput(d.insight);
      }
      onGenerated();
    } catch (e: any) {
      setError(e?.message ?? "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <div className="flex flex-wrap gap-1.5">
          {([["summary", "Summarize", FileText], ["draft", "Email draft", Mail], ["score", "Score", Gauge], ["text", "Text tools", MessageSquareText]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setMode(k)} className={`chip cursor-pointer ${mode === k ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-400 hover:text-slate-200"}`}>
              <Icon className="mr-1 inline size-3" /> {label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {mode === "summary" && (
            <>
              <Field label="What to summarize">
                <select value={entityType} onChange={(e) => { setEntityType(e.target.value); void loadEntities(e.target.value); }} className="input">
                  <option value="opportunity">Deal</option>
                  <option value="contact">Contact</option>
                  <option value="account">Account</option>
                  <option value="lead">Lead</option>
                  <option value="ticket">Ticket</option>
                  <option value="call">Call (transcript)</option>
                  <option value="meeting">Meeting</option>
                  <option value="profile">Customer 360 profile</option>
                </select>
              </Field>
              {entityType === "call" || entityType === "meeting" ? (
                <CallMeetingPicker kind={entityType} onPick={setEntityId} />
              ) : entityType === "profile" ? (
                <Field label="Profile">
                  <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="input">
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="Record">
                  <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="input">
                    {entities.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}

          {mode === "draft" && (
            <>
              <Field label="Contact">
                <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="input">
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
              </Field>
              <Field label="Tone">
                <div className="flex flex-wrap gap-1.5">
                  {[["follow_up", "Follow-up"], ["proposal", "Proposal"], ["check_in", "Check-in"], ["thank_you", "Thank you"]].map(([v, l]) => (
                    <button key={v} onClick={() => setTone(v)} className={`chip cursor-pointer ${tone === v ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-400"}`}>{l}</button>
                  ))}
                </div>
              </Field>
            </>
          )}

          {mode === "score" && (
            <Field label="Score">
              <select value={entityType} onChange={(e) => { setEntityType(e.target.value); void loadEntities(e.target.value); }} className="input">
                <option value="lead">Lead quality</option>
                <option value="opportunity">Deal health</option>
              </select>
              <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="input mt-2">
                {entities.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </Field>
          )}

          {mode === "text" && (
            <>
              <div className="flex gap-1.5">
                {[["sentiment", "Sentiment"], ["intent", "Intent (profile)"]].map(([v, l]) => (
                  <button key={v} onClick={() => setTool(v as "sentiment" | "intent")} className={`chip cursor-pointer ${tool === v ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-400"}`}>{l}</button>
                ))}
              </div>
              {tool === "sentiment" ? (
                <Field label="Text">
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Paste an email, ticket, or note…" className="input resize-y" />
                </Field>
              ) : (
                <Field label="Customer profile">
                  <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="input">
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}

          <button className="btn-primary w-full" onClick={() => void run()} disabled={busy || (mode === "text" && tool === "sentiment" && text.trim().length < 3)}>
            {busy ? <Spinner className="size-4" /> : <Sparkles className="size-4" />}
            Generate
          </button>
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
      </div>

      <div className="space-y-3">
        {notice && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}
        {!output && !busy && (
          <div className="card flex h-full min-h-48 flex-col items-center justify-center gap-2 p-6 text-center">
            <Sparkles className="size-8 text-slate-700" />
            <div className="text-sm text-slate-500">The generated output appears here — with its model, confidence, and evidence.</div>
          </div>
        )}
        {busy && <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Spinner /> Assembling context → firewall → routing → generating…</div>}
        {output && <InsightCard insight={output} onCopy={onCopy} />}
      </div>
    </div>
  );
}

function CallMeetingPicker({ kind, onPick }: { kind: string; onPick: (id: string) => void }) {
  const [items, setItems] = useState<{ id: string; label: string }[]>([]);
  const [id, setId] = useState("");
  useEffect(() => {
    const path = kind === "call" ? "/api/calls?pageSize=30" : "/api/meetings?pageSize=30";
    void api<{ items: any[] }>(path).then((d) => {
      const mapped = d.items.map((r) => ({
        id: r.id,
        label: kind === "call" ? `${r.direction} · ${r.durationSec ?? 0}s ${r.contactId ? "" : " · no transcript?"}` : `${r.title} · ${r.status}`,
      }));
      setItems(mapped);
      setId(mapped[0]?.id ?? "");
      onPick(mapped[0]?.id ?? "");
    }).catch(() => setItems([]));
  }, [kind]);
  return (
    <Field label={kind === "call" ? "Call" : "Meeting"}>
      <select value={id} onChange={(e) => { setId(e.target.value); onPick(e.target.value); }} className="input">
        {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
      </select>
    </Field>
  );
}

/** The output card — content + confidence + model + evidence + firewall note. */
function InsightCard({ insight, onCopy }: { insight: Insight; onCopy: (t: string) => void }) {
  const payload = insight.payload ?? {};
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={insight.kind === "score" ? "blue" : insight.kind === "sentiment" ? "amber" : insight.kind === "intent" ? "violet" : "green"}>{insight.kind}</Badge>
        <span className="text-sm font-semibold text-white">{insight.title ?? insight.feature}</span>
        <span className="ml-auto flex items-center gap-2">
          <Confidence value={insight.confidence} />
          <ModelChip model={insight.modelId} latency={insight.latencyMs} />
        </span>
      </div>
      {insight.lowConfidence && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="size-3.5" /> Low confidence — treat as a starting point, not a fact (ai.confidence_flagged fired).
        </div>
      )}
      {insight.content && (
        <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-ink-950/60 p-3 font-sans text-sm text-slate-300">{insight.content}</pre>
      )}
      {insight.kind === "score" && Array.isArray(payload.components) && (
        <div className="mt-3 space-y-2">
          {payload.components.map((c: any) => (
            <div key={c.key}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">{c.label} <span className="text-slate-600">× {Math.round(c.weight * 100)}%</span></span>
                <span className="tabular-nums text-slate-300">{c.value}/100</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-accent-400/80" style={{ width: `${c.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {insight.kind === "sentiment" && payload.label !== undefined && (
        <div className="mt-3 text-sm">
          <span className="text-slate-400">Label: </span>
          <span className={`font-semibold ${payload.label === "positive" ? "text-emerald-400" : payload.label === "negative" ? "text-rose-400" : "text-amber-400"}`}>{String(payload.label)}</span>
          <span className="text-slate-600"> · score {(payload.score as number) >= 0 ? "+" : ""}{String(payload.score)}</span>
        </div>
      )}
      {insight.kind === "intent" && Array.isArray(payload.signals) && (
        <div className="mt-3 space-y-1.5">
          {(payload.signals as { label: string; confidence: number; evidence: string }[]).map((s) => (
            <div key={s.label} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
              <span className="text-slate-300">{s.label} <span className="text-slate-600">({s.evidence})</span></span>
              <Confidence value={s.confidence} />
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          {insight.redacted.map((r) => (
            <span key={r.type} className="chip bg-amber-500/10 text-amber-400/90">firewall: {r.count}× {r.type} redacted</span>
          ))}
          {insight.redacted.length === 0 && <span className="chip bg-emerald-500/10 text-emerald-400/80">firewall: no PII in context</span>}
        </div>
        {insight.content && (
          <button className="btn-ghost" onClick={() => onCopy(insight.content!)}><Copy className="size-3.5" /> Copy</button>
        )}
      </div>
    </div>
  );
}

// ── Memory panel ─────────────────────────────────────────────────────────────

function MemoryPanel({ memories, onChanged, onCopy }: { memories: { id: string; key: string; value: unknown; expiresAt: string | null }[]; onChanged: () => void; onCopy: (t: string) => void }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const add = async () => {
    if (!key.trim()) return;
    try {
      await post("/api/ai/memory", { scopeType: "user", key: key.trim(), value: { note: value.trim() } });
      setKey(""); setValue("");
      onChanged();
    } catch { /* ignore */ }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Brain className="size-4 text-violet-400" /> Short-term AI memory</h3>
        <p className="mt-1 text-xs text-slate-500">Per-user scratchpad the copilot can read on future calls. Rows expire (TTL) and are purged by the engine.</p>
        <div className="mt-4 space-y-2">
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="key — e.g. draft.tone" className="input" />
          <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={2} placeholder="value — e.g. prefer security-focused drafts" className="input resize-y" />
          <button className="btn-primary" onClick={() => void add()}><Plus className="size-4" /> Remember</button>
        </div>
      </div>
      <div className="space-y-2">
        {memories.length === 0 && <EmptyState icon={<Brain className="size-8" />} title="No memory rows" hint="Remember something and it shows up here (expires in 24h by default)." />}
        {memories.map((m) => (
          <div key={m.id} className="card flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white">{m.key}</div>
              <div className="truncate text-xs text-slate-500">{JSON.stringify(m.value)}</div>
              {m.expiresAt && <div className="text-[11px] text-slate-600">expires {timeAgo(m.expiresAt)}</div>}
            </div>
            <button className="btn-ghost" onClick={() => onCopy(JSON.stringify(m.value))}><Copy className="size-3.5" /></button>
            <button className="btn-ghost text-rose-400 hover:bg-rose-500/10" onClick={async () => { await del(`/api/ai/memory/${m.id}`).catch(() => {}); onChanged(); }}><Trash2 className="size-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Firewall panel ───────────────────────────────────────────────────────────

type FirewallPolicy = { enabled: boolean; maskMode: "full" | "partial"; redactEmails: boolean; redactPhones: boolean; redactCards: boolean; redactLongNumbers: boolean; allowlist: string[] };

function FirewallPanel({ firewall, isAdmin, onSaved }: { firewall: { policy: FirewallPolicy; recent: Insight[] } | null; isAdmin: boolean; onSaved: () => void }) {
  const [policy, setPolicy] = useState(firewall?.policy);
  useEffect(() => { if (firewall) setPolicy(firewall.policy); }, [firewall]);
  if (!firewall || !policy) return <EmptyState icon={<Shield className="size-8" />} title="Loading firewall policy…" />;
  const toggle = (k: keyof typeof policy) => setPolicy({ ...policy, [k]: !policy[k] });
  const save = async () => {
    try {
      await api("/api/ai/firewall", { method: "PUT", body: JSON.stringify(policy) });
      onSaved();
    } catch { /* ignore */ }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck className="size-4 text-emerald-400" /> Data firewall policy</h3>
        <p className="mt-1 text-xs text-slate-500">Redacts PII from the context BEFORE it reaches a model — outputs are generated from the scrubbed context, so stripped values can never echo back.</p>
        <div className="mt-4 space-y-2.5">
          {([
            ["enabled", "Firewall enabled"],
            ["redactEmails", "Redact email addresses"],
            ["redactPhones", "Redact phone numbers"],
            ["redactCards", "Redact card-like numbers"],
          ] as const).map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
              <span className="text-sm text-slate-300">{label}</span>
              <button onClick={() => toggle(k)} className={`relative h-5 w-9 rounded-full transition-colors ${policy[k] ? "bg-accent-500" : "bg-white/10"}`}>
                <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${policy[k] ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </label>
          ))}
          <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
            <span className="text-sm text-slate-300">Mask mode</span>
            <div className="flex gap-1.5">
              {[["partial", "Partial"], ["full", "Full"]].map(([v, l]) => (
                <button key={v} onClick={() => setPolicy({ ...policy, maskMode: v as FirewallPolicy["maskMode"] })} className={`chip cursor-pointer ${policy.maskMode === v ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-400"}`}>{l}</button>
              ))}
            </div>
          </div>
          {isAdmin && <button className="btn-primary w-full" onClick={() => void save()}><Check className="size-4" /> Save policy</button>}
        </div>
      </div>
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recent redactions</h4>
        {firewall.recent.length === 0 && <EmptyState icon={<Eye className="size-8" />} title="No redactions yet" hint="Generate a summary or draft containing an email or phone to see the firewall in action." />}
        {firewall.recent.map((r) => (
          <div key={r.id} className="card flex items-center justify-between p-3">
            <div className="min-w-0">
              <div className="truncate text-sm text-white">{r.title ?? r.feature}</div>
              <div className="text-[11px] text-slate-600">{timeAgo(r.createdAt)}</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {r.redacted.map((x) => <span key={x.type} className="chip bg-amber-500/10 text-amber-400/90">{x.count}× {x.type}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
