import { useEffect, useState } from "react";
import {
  Store, Puzzle, Handshake, GitBranch, Database, LayoutDashboard, Plus, Trash2, X, Check,
  Download, Upload, AlertTriangle, RefreshCw, Sparkles, Globe,
} from "lucide-react";
import { api, post, del } from "../lib/api";
import { useSession } from "../App";
import { Badge, EmptyState, Spinner, Field, StatCard, Modal } from "../components/ui";
import { dateTime, timeAgo } from "../lib/format";

// ── Types ───────────────────────────────────────────────────────────────────
type Listing = {
  id: string; slug: string; name: string; kind: string; description: string | null;
  publisher: string; version: string; icon: string | null; active: boolean;
  installCount: number; installed: boolean; createdAt: string;
};
type InstalledApp = {
  id: string; listingId: string | null; slug: string; name: string; kind: string;
  status: string; config: Record<string, unknown>; installedAt: string; uninstalledAt: string | null;
};
type PartnerDeal = {
  id: string; name: string; amount: number; status: string; opportunityId: string | null;
  registeredAt: string; wonAt: string | null; commission: number;
};
type Partner = {
  id: string; name: string; type: string; contactName: string | null; email: string | null; phone: string | null;
  commissionRate: number; status: string; notes: string | null;
  deals: PartnerDeal[]; dealCount: number; wonCount: number; pipelineValue: number; commissionEarned: number;
};
type ChangeSetItem = { entity: string; op: string; key: string; data?: Record<string, unknown> };
type ChangeSet = {
  id: string; name: string; description: string | null; items: ChangeSetItem[];
  status: string; fromEnv: string | null; toEnv: string | null; promotedBy: string | null;
  promotedAt: string | null; error: string | null; createdAt: string;
};
type FieldDef = { id: string; objectType?: string; key: string; label: string; type: string; required: boolean; options: unknown[]; order: number; active: boolean };
type Impact = {
  field: FieldDef; references: { surface: string; name: string; id: string; detail: string }[];
  total: number; recordValues: number;
};
type Overview = {
  listings: number; installed: number; partners: number; partnerDeals: number;
  commissionEarned: number; pipelineValue: number; changeSets: number; promoted: number;
};

const KIND_TONE: Record<string, "default" | "green" | "amber" | "rose" | "blue" | "violet"> = {
  app: "blue", agent: "violet", integration: "amber", template: "green",
  installed: "green", uninstalled: "default",
  registered: "blue", approved: "amber", won: "green", lost: "default",
  draft: "amber", promoted: "green", failed: "rose",
  active: "green", inactive: "default",
  reseller: "blue", referral: "violet", technology: "amber", consultant: "green",
};
const badge = (s: string) => <Badge tone={KIND_TONE[s] ?? "default"}>{s.replace("_", " ")}</Badge>;
const SURFACE_LABEL: Record<string, string> = {
  segment: "Segment", automation: "Workflow", agent: "Agent", leadForm: "Lead form",
  report: "Report", fieldPermission: "Field permission",
};

export default function EcosystemPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<"overview" | "marketplace" | "apps" | "partners" | "changesets" | "schema">("overview");
  const isAdmin = user?.role === "admin";
  const isManager = isAdmin || user?.role === "manager";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Store className="size-4 text-violet-400" /> Ecosystem
            <span className="chip bg-violet-500/15 text-violet-300">marketplace · apps · partners · change sets · schema safety</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            The extensibility loop: a marketplace of apps/agents/integrations that install into the org, partner &amp; channel management with deal registration + derived commissions, change sets that promote config/schema changes between environments, and change-impact analysis before touching a custom field.
          </p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06]">
        {([
          ["overview", "Overview", LayoutDashboard],
          ["marketplace", "Marketplace", Store],
          ["apps", "Apps", Puzzle],
          ["partners", "Partners", Handshake],
          ["changesets", "Change sets", GitBranch],
          ["schema", "Schema", Database],
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
      {tab === "marketplace" && <MarketplaceTab isAdmin={isAdmin} />}
      {tab === "apps" && <AppsTab isAdmin={isAdmin} />}
      {tab === "partners" && <PartnersTab isAdmin={isAdmin} isManager={isManager} />}
      {tab === "changesets" && <ChangeSetsTab isAdmin={isAdmin} />}
      {tab === "schema" && <SchemaTab isAdmin={isAdmin} />}
    </div>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────
function OverviewTab() {
  const [ov, setOv] = useState<Overview | null>(null);
  useEffect(() => {
    void api<{ overview: Overview }>("/api/ecosystem/overview").then((d) => setOv(d.overview)).catch(() => {});
  }, []);
  if (!ov) return <Spinner className="py-16" />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Marketplace listings" value={ov.listings} sub={`${ov.installed} installed`} tone="violet" />
        <StatCard label="Active partners" value={ov.partners} sub={`${ov.partnerDeals} registered deals`} tone="blue" />
        <StatCard label="Commission earned" value={`$${ov.commissionEarned.toLocaleString()}`} sub={`$${ov.pipelineValue.toLocaleString()} pipeline`} tone="green" />
        <StatCard label="Change sets" value={ov.changeSets} sub={`${ov.promoted} promoted`} tone="amber" />
      </div>
      <div className="card p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Ecosystem loop</p>
        <p className="text-sm text-slate-400">
          Publish or install apps from the <span className="text-slate-300">Marketplace</span> tab → review what's running in <span className="text-slate-300">Apps</span> → track co-selling in <span className="text-slate-300">Partners</span> → bundle schema/config changes into <span className="text-slate-300">Change sets</span> and promote them to the sandbox → and check <span className="text-slate-300">Schema</span> impact before deleting a custom field.
        </p>
      </div>
    </div>
  );
}

// ── Marketplace ────────────────────────────────────────────────────────────
function MarketplaceTab({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<Listing[]>([]);
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState(""); const [name, setName] = useState(""); const [kind, setKind] = useState("app");
  const [description, setDescription] = useState(""); const [publisher, setPublisher] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => {
    void api<{ items: Listing[] }>("/api/ecosystem/marketplace").then((d) => setItems(d.items)).catch(() => {});
  };
  useEffect(load, []);
  const save = async () => {
    try {
      await post("/api/ecosystem/marketplace", { slug, name, kind, description: description || null, publisher: publisher || null });
      setCreating(false); setSlug(""); setName(""); setKind("app"); setDescription(""); setPublisher(""); load();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };
  const install = async (l: Listing) => {
    setBusy(l.id);
    try { await post("/api/ecosystem/apps/install", { listingId: l.id }); load(); }
    catch (e: any) { alert(e?.message ?? "Install failed"); }
    finally { setBusy(null); }
  };
  const remove = async (l: Listing) => {
    if (!confirm(`Delete listing "${l.name}"?`)) return;
    try { await del(`/api/ecosystem/marketplace/${l.id}`); load(); } catch (e: any) { alert(e?.message ?? "Delete failed"); }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Publish an app, agent, integration or template. Installing a listing with an agent template creates the agent via the Phase 9 engine.</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Publish listing</button>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<Store className="size-8" />} title="No listings" hint="Publish the first app to the marketplace." />}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {items.map((l) => (
          <div key={l.id} className="card flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 font-medium text-white">
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/[0.06] text-base">{l.icon ?? "🧩"}</span>
                {l.name}
              </div>
              {badge(l.kind)}
            </div>
            <p className="mt-2 text-xs text-slate-500">{l.description ?? "No description."}</p>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
              <span>{l.publisher}</span> · <span>v{l.version}</span> · <span>{l.installCount} installs</span>
            </div>
            <div className="mt-auto flex items-center justify-between pt-3">
              <span className="text-[11px] text-slate-600">{l.active ? "listed" : "hidden"}</span>
              <div className="flex items-center gap-1.5">
                {isAdmin && <button className="icon-btn" onClick={() => remove(l)} title="Delete"><Trash2 className="size-4" /></button>}
                {l.installed ? (
                  <Badge tone="green"><Check className="mr-1 inline size-3" /> Installed</Badge>
                ) : (
                  <button className="btn-primary" onClick={() => install(l)} disabled={busy === l.id}><Download className="size-4" /> Install</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <Modal open onClose={() => setCreating(false)} title="Publish a listing">
          <div className="space-y-3">
            <Field label="Slug"><input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="lead-qualifier" /></Field>
            <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lead Qualifier Agent" /></Field>
            <Field label="Kind">
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="app">App</option><option value="agent">Agent</option>
                <option value="integration">Integration</option><option value="template">Template</option>
              </select>
            </Field>
            <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <Field label="Publisher"><input className="input" value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="Qorvexa Labs" /></Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn-primary" onClick={save}><Check className="size-4" /> Publish</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Apps ───────────────────────────────────────────────────────────────────
function AppsTab({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<InstalledApp[]>([]);
  const load = () => {
    void api<{ items: InstalledApp[] }>("/api/ecosystem/apps").then((d) => setItems(d.items)).catch(() => {});
  };
  useEffect(load, []);
  const uninstall = async (a: InstalledApp) => {
    if (!confirm(`Uninstall "${a.name}"?`)) return;
    try { await post(`/api/ecosystem/apps/${a.id}/uninstall`, {}); load(); } catch (e: any) { alert(e?.message ?? "Uninstall failed"); }
  };

  return (
    <div className="space-y-4">
      {items.length === 0 && <EmptyState icon={<Puzzle className="size-8" />} title="No apps installed" hint="Install one from the Marketplace tab." />}
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((a) => (
          <div key={a.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 font-medium text-white">{a.name} {badge(a.kind)} {badge(a.status)}</div>
                <p className="mt-0.5 text-xs text-slate-500">{a.slug} · installed {timeAgo(a.installedAt)}</p>
              </div>
              {a.status === "installed" && isAdmin && (
                <button className="btn-secondary" onClick={() => uninstall(a)}><X className="size-4" /> Uninstall</button>
              )}
            </div>
            {Object.keys(a.config).length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Applied on install</p>
                {Object.entries(a.config).map(([k, v]) => (
                  <p key={k} className="text-xs text-slate-400"><span className="text-slate-500">{k}:</span> {typeof v === "object" ? JSON.stringify(v) : String(v)}</p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Partners ───────────────────────────────────────────────────────────────
function PartnersTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const canWrite = isAdmin || isManager;
  const [items, setItems] = useState<Partner[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(""); const [type, setType] = useState("reseller"); const [rate, setRate] = useState("0.1");
  const [dealFor, setDealFor] = useState<Partner | null>(null);
  const [dealName, setDealName] = useState(""); const [dealAmount, setDealAmount] = useState("");
  const load = () => {
    void api<{ items: Partner[] }>("/api/ecosystem/partners").then((d) => setItems(d.items)).catch(() => {});
  };
  useEffect(load, []);
  const save = async () => {
    try {
      await post("/api/ecosystem/partners", { name, type, commissionRate: Number(rate) || 0.1 });
      setCreating(false); setName(""); setType("reseller"); setRate("0.1"); load();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };
  const registerDeal = async () => {
    if (!dealFor) return;
    try {
      await post(`/api/ecosystem/partners/${dealFor.id}/deals`, { name: dealName, amount: Number(dealAmount) || 0 });
      setDealFor(null); setDealName(""); setDealAmount(""); load();
    } catch (e: any) { alert(e?.message ?? "Registration failed"); }
  };
  const setStatus = async (p: Partner, d: PartnerDeal, status: string) => {
    try { await post(`/api/ecosystem/partners/deals/${d.id}/status`, { status }); load(); }
    catch (e: any) { alert(e?.message ?? "Update failed"); }
  };

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Resellers, referral and technology partners. Registered deals co-sell; commissions are derived when a deal is won.</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Add partner</button>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<Handshake className="size-8" />} title="No partners yet" hint="Add a partner and register a co-sold deal." />}
      <div className="space-y-3">
        {items.map((p) => (
          <div key={p.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-medium text-white">{p.name} {badge(p.type)} {badge(p.status)}</div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {p.contactName ?? "—"}{p.email ? ` · ${p.email}` : ""}{p.phone ? ` · ${p.phone}` : ""} · rate {(p.commissionRate * 100).toFixed(0)}%
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-right">
                <div><div className="text-sm font-semibold text-white">${p.commissionEarned.toLocaleString()}</div><div className="text-[10px] uppercase tracking-wider text-slate-600">earned</div></div>
                <div><div className="text-sm font-semibold text-white">${p.pipelineValue.toLocaleString()}</div><div className="text-[10px] uppercase tracking-wider text-slate-600">pipeline</div></div>
                {canWrite && <button className="btn-secondary" onClick={() => setDealFor(p)}><Plus className="size-4" /> Deal</button>}
              </div>
            </div>
            {p.deals.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {p.deals.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 text-slate-300">{d.name} {badge(d.status)}</span>
                    <span className="flex items-center gap-3 text-xs text-slate-500">
                      <span>${d.amount.toLocaleString()}</span>
                      {d.status === "won" && <span className="text-mint-400">+${d.commission.toLocaleString()}</span>}
                      {["registered", "approved"].includes(d.status) && canWrite && (
                        <span className="flex gap-1">
                          <button className="text-mint-400 hover:text-mint-300" onClick={() => setStatus(p, d, "won")} title="Mark won">won</button>
                          <button className="text-slate-500 hover:text-slate-300" onClick={() => setStatus(p, d, "lost")} title="Mark lost">lost</button>
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {creating && (
        <Modal open onClose={() => setCreating(false)} title="Add partner">
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Northwind Channel" /></Field>
            <Field label="Type">
              <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="reseller">Reseller</option><option value="referral">Referral</option>
                <option value="technology">Technology</option><option value="consultant">Consultant</option>
              </select>
            </Field>
            <Field label="Commission rate (0–1)"><input type="number" step="0.01" className="input" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn-primary" onClick={save}><Check className="size-4" /> Add</button>
            </div>
          </div>
        </Modal>
      )}
      {dealFor && (
        <Modal open onClose={() => setDealFor(null)} title={`Register a deal for ${dealFor.name}`}>
          <div className="space-y-3">
            <Field label="Deal name"><input className="input" value={dealName} onChange={(e) => setDealName(e.target.value)} placeholder="Northwind — 400-seat rollout" /></Field>
            <Field label="Amount ($)"><input type="number" className="input" value={dealAmount} onChange={(e) => setDealAmount(e.target.value)} /></Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setDealFor(null)}>Cancel</button>
              <button className="btn-primary" onClick={registerDeal}><Check className="size-4" /> Register</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Change sets ────────────────────────────────────────────────────────────
function ChangeSetsTab({ isAdmin }: { isAdmin: boolean }) {
  const { environments } = useSession();
  const [items, setItems] = useState<ChangeSet[]>([]);
  const [diff, setDiff] = useState<ChangeSetItem[] | null>(null);
  const [fromEnv, setFromEnv] = useState("production");
  const [toEnv, setToEnv] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => {
    void api<{ items: ChangeSet[] }>("/api/ecosystem/changesets").then((d) => setItems(d.items)).catch(() => {});
  };
  useEffect(load, []);
  useEffect(() => {
    if (!toEnv) setToEnv(environments.find((e) => e !== "production") ?? "");
  }, [environments, toEnv]);
  const diffEnvs = async () => {
    try {
      const d = await api<{ items: ChangeSetItem[] }>("/api/ecosystem/changesets/diff", { method: "POST", body: JSON.stringify({ from: fromEnv, to: toEnv }), headers: { "content-type": "application/json" } });
      setDiff(d.items);
    } catch (e: any) { alert(e?.message ?? "Diff failed"); }
  };
  const promote = async (cs: ChangeSet) => {
    if (!cs.toEnv) {
      const target = prompt(`Promote "${cs.name}" to which environment?`, toEnv || "sandbox");
      if (!target) return;
      await promoteTo(cs, target);
    } else {
      await promoteTo(cs, cs.toEnv);
    }
  };
  const promoteTo = async (cs: ChangeSet, target: string) => {
    setBusy(cs.id);
    try { await post(`/api/ecosystem/changesets/${cs.id}/promote`, { to: target }); load(); }
    catch (e: any) { alert(e?.message ?? "Promote failed"); }
    finally { setBusy(null); }
  };
  const createFromDiff = async () => {
    if (!diff?.length) return;
    try {
      await post("/api/ecosystem/changesets", { name: name || "From diff", description: description || null, items: diff, fromEnv, toEnv });
      setCreating(false); setName(""); setDescription(""); setDiff(null); load();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Environment diff</p>
            <select className="input w-40" value={fromEnv} onChange={(e) => setFromEnv(e.target.value)}>
              {environments.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <span className="text-slate-600">→</span>
            <select className="input w-40" value={toEnv} onChange={(e) => setToEnv(e.target.value)}>
              {environments.filter((e) => e !== fromEnv).map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <button className="btn-secondary" onClick={diffEnvs}><RefreshCw className="size-4" /> Diff</button>
          </div>
          {diff !== null && (
            <div className="space-y-1.5">
              {diff.length === 0 && <p className="text-sm text-slate-500">No changes between the environments.</p>}
              {diff.map((it, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-slate-300">
                  <Badge tone="amber">{it.op}</Badge>
                  <span className="font-mono text-xs">{it.entity}</span>
                  <span className="font-mono text-xs text-slate-500">{it.key}</span>
                </div>
              ))}
              {diff.length > 0 && (
                <div className="flex items-center gap-2 pt-2">
                  <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Save as change set</button>
                  <button className="btn-secondary" onClick={() => setDiff(null)}>Dismiss</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<GitBranch className="size-8" />} title="No change sets" hint="Diff two environments and save the result as a change set." />}
      <div className="space-y-2">
        {items.map((cs) => (
          <div key={cs.id} className={`card p-4 ${cs.status === "failed" ? "border-rose-500/30" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-medium text-white">{cs.name} {badge(cs.status)}</div>
                <p className="mt-0.5 text-xs text-slate-500">
                  created {dateTime(cs.createdAt)} · {cs.items.length} item(s){cs.fromEnv && cs.toEnv ? ` · ${cs.fromEnv} → ${cs.toEnv}` : ""}
                </p>
                {cs.description && <p className="mt-1 text-xs text-slate-500">{cs.description}</p>}
              </div>
              {cs.status === "draft" && isAdmin && (
                <button className="btn-primary" onClick={() => promote(cs)} disabled={busy === cs.id}><Upload className="size-4" /> Promote</button>
              )}
            </div>
            <div className="mt-3 space-y-1">
              {cs.items.map((it, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-400">
                  <Badge tone={it.op === "delete" ? "rose" : it.op === "create" ? "green" : "amber"}>{it.op}</Badge>
                  <span className="font-mono">{it.entity}</span>
                  <span className="font-mono text-slate-600">{it.key}</span>
                </div>
              ))}
            </div>
            {cs.error && <p className="mt-2 text-xs text-rose-400">{cs.error}</p>}
          </div>
        ))}
      </div>

      {creating && (
        <Modal open onClose={() => setCreating(false)} title="Save change set">
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 field rollout" /></Field>
            <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-white/[0.03] p-2">
              {diff?.map((it, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-400">
                  <Badge tone="amber">{it.op}</Badge><span className="font-mono">{it.entity}</span><span className="font-mono text-slate-600">{it.key}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn-primary" onClick={createFromDiff}><Check className="size-4" /> Save</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Schema change safety ───────────────────────────────────────────────────
function SchemaTab({ isAdmin }: { isAdmin: boolean }) {
  const [objectType, setObjectType] = useState("contact");
  const [custom, setCustom] = useState<FieldDef[]>([]);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = (ot: string) => {
    void api<{ custom: FieldDef[] }>(`/api/fields/${ot}`).then((d) => setCustom(d.custom)).catch(() => setCustom([]));
  };
  useEffect(() => { load(objectType); setImpact(null); }, [objectType]);
  const analyze = async (f: FieldDef) => {
    try {
      const d = await api<Impact>(`/api/ecosystem/schema/impact?objectType=${objectType}&key=${f.key}`);
      setImpact(d);
    } catch (e: any) { alert(e?.message ?? "Impact analysis failed"); }
  };
  const safeDelete = async (f: FieldDef) => {
    if (!confirm(`Delete field "${f.key}" (${objectType})?`)) return;
    setBusy(f.id);
    try { await post("/api/ecosystem/schema/safe-delete", { id: f.id }); setImpact(null); load(objectType); }
    catch (e: any) { alert(e?.message ?? e?.data?.error ?? "Delete blocked"); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Custom fields</p>
        <select className="input w-44" value={objectType} onChange={(e) => setObjectType(e.target.value)}>
          {["contact", "account", "lead", "opportunity", "task"].map((ot) => <option key={ot} value={ot}>{ot}</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-500">Before deleting a custom field, run change-impact analysis — every config surface that references it (segments, workflows, agents, forms, reports, field permissions) plus stored record values is surfaced. Fields in use cannot be deleted (docs/43-schema-change-safety.md).</p>
      {custom.length === 0 && <EmptyState icon={<Database className="size-8" />} title={`No custom fields on ${objectType}`} hint="Add one in Settings → Fields, then come back to explore its impact." />}
      <div className="space-y-2">
        {custom.map((f) => (
          <div key={f.id} className="card flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium text-white"><span className="font-mono text-sm">{f.key}</span> {badge(f.type)}</div>
              <p className="mt-0.5 text-xs text-slate-500">{f.label} · required: {f.required ? "yes" : "no"}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button className="btn-secondary" onClick={() => analyze(f)}><Globe className="size-4" /> Impact</button>
              {isAdmin && <button className="icon-btn" onClick={() => safeDelete(f)} disabled={busy === f.id} title="Safe delete"><Trash2 className="size-4" /></button>}
            </div>
          </div>
        ))}
      </div>

      {impact && (
        <div className={`card p-4 ${impact.total > 0 || impact.recordValues > 0 ? "border-amber-500/30" : "border-mint-500/30"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              {impact.total > 0 || impact.recordValues > 0
                ? <><AlertTriangle className="size-4 text-amber-400" /> {impact.field.objectType}.{impact.field.key} is in use</>
                : <><Check className="size-4 text-mint-400" /> {impact.field.objectType}.{impact.field.key} is safe to delete</>}
            </div>
            <button className="icon-btn" onClick={() => setImpact(null)} title="Dismiss"><X className="size-4" /></button>
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-white/[0.03] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Config references ({impact.total})</p>
              {impact.references.length === 0 && <p className="mt-1 text-sm text-slate-500">None.</p>}
              {impact.references.map((r, i) => (
                <p key={i} className="mt-1 text-sm text-slate-300"><span className="text-slate-500">{SURFACE_LABEL[r.surface] ?? r.surface}:</span> {r.name} <span className="text-xs text-slate-600">— {r.detail}</span></p>
              ))}
            </div>
            <div className="rounded-lg bg-white/[0.03] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Stored record values ({impact.recordValues})</p>
              {impact.recordValues === 0
                ? <p className="mt-1 text-sm text-slate-500">No records carry a value for this field.</p>
                : <p className="mt-1 text-sm text-slate-300">{impact.recordValues} record(s) currently store a value — deleting would silently drop data.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
