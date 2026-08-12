import { useEffect, useState } from "react";
import { Cpu, Plus, Pencil, Trash2, Route as RouteIcon, ShieldCheck, Check, X } from "lucide-react";
import { api, post, del } from "../lib/api";
import { useSession } from "../App";
import { Badge, EmptyState, Spinner, Modal, Field } from "../components/ui";

type Model = {
  id: string;
  name: string;
  provider: string;
  tier: string;
  capabilities: string[];
  costPer1kIn: number;
  costPer1kOut: number;
  latencyMs: number;
  region: string;
  active: boolean;
  routingWeight: number;
};
type Policy = { defaultModel: string; preference: "cost" | "quality" | "latency"; preferredRegion: string | null };

const CAPS = ["summary", "score", "search", "draft", "sentiment", "intent"];
const EMPTY: Model = { id: "", name: "", provider: "mock", tier: "standard", capabilities: ["summary"], costPer1kIn: 0.1, costPer1kOut: 0.2, latencyMs: 120, region: "any", active: true, routingWeight: 1 };

export default function ModelsPage() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  const [models, setModels] = useState<Model[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Model | null>(null);
  const [draft, setDraft] = useState<Model>(EMPTY);
  const [feature, setFeature] = useState("deal.summary");
  const [route, setRoute] = useState<{ picked: string; reason: string; candidates: { name: string; tier: string; cost: number; latencyMs: number; region: string }[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api<{ items: Model[]; policy: Policy }>("/api/models");
      setModels(d.items);
      setPolicy(d.policy);
    } catch { /* quiet */ }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(null), 2000); };

  const savePolicy = async (patch: Partial<Policy>) => {
    if (!policy) return;
    const next = { ...policy, ...patch };
    setPolicy(next);
    try {
      await api("/api/models/policy", { method: "PUT", body: JSON.stringify(next) });
      flash("Routing policy saved");
    } catch { /* ignore */ }
  };

  const saveModel = async () => {
    try {
      if (editing?.id) {
        const { id, ...body } = draft;
        await api(`/api/models/${id}`, { method: "PUT", body: JSON.stringify(body) });
        flash("Model updated");
      } else {
        await post("/api/models", draft);
        flash("Model added");
      }
      setEditing(null);
      void load();
    } catch (e: any) {
      flash(e?.message ?? "Save failed");
    }
  };

  const removeModel = async (m: Model) => {
    await del(`/api/models/${m.id}`).catch(() => {});
    void load();
  };

  const dryRun = async () => {
    try {
      const d = await api<{ decision: typeof route }>(`/api/models/route?feature=${encodeURIComponent(feature)}`);
      setRoute(d.decision);
    } catch { /* ignore */ }
  };

  const toggleCap = (cap: string) => {
    const has = draft.capabilities.includes(cap);
    setDraft({ ...draft, capabilities: has ? draft.capabilities.filter((c) => c !== cap) : [...draft.capabilities, cap] });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <RouteIcon className="size-4 text-accent-300" /> Model router
            <span className="chip bg-white/[0.06] text-slate-300">🆕 multi-model support</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            The catalog + routing policy decide which model serves each AI feature — cost, quality, or latency preference, with region residency pins. Decisions are recorded on every AI insight.
          </p>
        </div>
        {isAdmin && <button className="btn-primary" onClick={() => { setDraft(EMPTY); setEditing({ ...EMPTY, id: "new" }); }}><Plus className="size-4" /> Add model</button>}
      </div>

      {notice && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Spinner /> Loading catalog…</div>
      ) : (
        <>
          {/* Routing policy */}
          {policy && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-white">Routing policy</h3>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <Field label="Default model">
                  <select className="input" value={policy.defaultModel} disabled={!isAdmin} onChange={(e) => void savePolicy({ defaultModel: e.target.value })}>
                    {models.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                  </select>
                </Field>
                <Field label="Preference">
                  <select className="input" value={policy.preference} disabled={!isAdmin} onChange={(e) => void savePolicy({ preference: e.target.value as Policy["preference"] })}>
                    <option value="cost">Cost (cheapest first)</option>
                    <option value="quality">Quality (premium first)</option>
                    <option value="latency">Latency (fastest first)</option>
                  </select>
                </Field>
                <Field label="Preferred region (residency pin)">
                  <select className="input" value={policy.preferredRegion ?? ""} disabled={!isAdmin} onChange={(e) => void savePolicy({ preferredRegion: e.target.value || null })}>
                    <option value="">Any region</option>
                    <option value="eu">EU only</option>
                    <option value="us">US only</option>
                  </select>
                </Field>
              </div>
            </div>
          )}

          {/* Route dry-run */}
          <div className="card p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck className="size-4 text-emerald-400" /> Route explainer</h3>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select className="input w-56" value={feature} onChange={(e) => setFeature(e.target.value)}>
                {Object.entries({
                  "deal.summary": "Deal summary", "contact.summary": "Contact summary", "call.summary": "Call summary",
                  "email.draft": "Email draft", "lead.score": "Lead score", "deal.score": "Deal score",
                  "sentiment": "Sentiment", "intent": "Intent", "search": "Semantic search",
                }).map(([v, l]) => <option key={v} value={v}>{l} ({v})</option>)}
              </select>
              <button className="btn-secondary" onClick={() => void dryRun()}><RouteIcon className="size-4" /> Show decision</button>
            </div>
            {route && (
              <div className="mt-3 rounded-lg bg-ink-950/60 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">→</span>
                  <span className="font-semibold text-accent-300">{route.picked}</span>
                  <span className="text-xs text-slate-500">{route.reason}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {route.candidates.map((c) => (
                    <span key={c.name} className={`chip ${c.name === route.picked ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-500"}`}>
                      {c.name} · {c.tier} · ${c.cost.toFixed(1)}/1k · {c.latencyMs}ms · {c.region}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Catalog */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-white">Model catalog ({models.length})</h3>
            {models.length === 0 && <EmptyState icon={<Cpu className="size-8" />} title="No models configured" hint="Admins can add models with capabilities, cost, latency, and region." />}
            <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Model</th>
                    <th className="px-4 py-2.5">Tier</th>
                    <th className="px-4 py-2.5">Capabilities</th>
                    <th className="px-4 py-2.5">Cost /1k</th>
                    <th className="px-4 py-2.5">Latency</th>
                    <th className="px-4 py-2.5">Region</th>
                    <th className="px-4 py-2.5">Weight</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.id} className={`border-b border-white/[0.03] last:border-0 ${m.active ? "" : "opacity-45"}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium text-white"><Cpu className="size-3.5 text-slate-500" /> {m.name}</div>
                        <div className="text-[11px] text-slate-600">{m.provider}{m.active ? "" : " · disabled"}</div>
                      </td>
                      <td className="px-4 py-3"><Badge tone={m.tier === "premium" ? "gold" : "default"}>{m.tier}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {m.capabilities.map((c) => <span key={c} className="chip bg-white/[0.04] text-slate-400">{c}</span>)}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-300">${(m.costPer1kIn + m.costPer1kOut).toFixed(1)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-300">{m.latencyMs}ms</td>
                      <td className="px-4 py-3">
                        <span className={`chip ${m.region === "any" ? "bg-white/[0.04] text-slate-400" : "bg-accent-500/15 text-accent-300"}`}>{m.region}</span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-300">{m.routingWeight}</td>
                      <td className="px-4 py-3 text-right">
                        {isAdmin && (
                          <div className="flex justify-end gap-1">
                            <button className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white" onClick={() => { setDraft(m); setEditing(m); }}><Pencil className="size-3.5" /></button>
                            <button className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400" onClick={() => void removeModel(m)}><Trash2 className="size-3.5" /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Edit / add modal */}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.id === "new" ? "Add a model" : `Edit ${editing?.name}`}>
        {editing && (
          <div className="space-y-3">
            <Field label="Model name" required>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. eu-mock-premium" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tier">
                <select className="input" value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })}>
                  <option value="standard">standard</option>
                  <option value="premium">premium</option>
                </select>
              </Field>
              <Field label="Region (residency)">
                <select className="input" value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })}>
                  <option value="any">any</option><option value="eu">eu</option><option value="us">us</option>
                </select>
              </Field>
            </div>
            <Field label="Capabilities">
              <div className="flex flex-wrap gap-1.5">
                {CAPS.map((c) => (
                  <button key={c} onClick={() => toggleCap(c)} className={`chip cursor-pointer ${draft.capabilities.includes(c) ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-400"}`}>
                    {draft.capabilities.includes(c) ? <Check className="mr-1 inline size-3" /> : <X className="mr-1 inline size-3" />} {c}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cost in /1k">
                <input type="number" step="0.1" min="0" className="input" value={draft.costPer1kIn} onChange={(e) => setDraft({ ...draft, costPer1kIn: Number(e.target.value) })} />
              </Field>
              <Field label="Cost out /1k">
                <input type="number" step="0.1" min="0" className="input" value={draft.costPer1kOut} onChange={(e) => setDraft({ ...draft, costPer1kOut: Number(e.target.value) })} />
              </Field>
              <Field label="Latency (ms)">
                <input type="number" min="0" className="input" value={draft.latencyMs} onChange={(e) => setDraft({ ...draft, latencyMs: Number(e.target.value) })} />
              </Field>
              <Field label="Routing weight">
                <input type="number" min="0" max="100" className="input" value={draft.routingWeight} onChange={(e) => setDraft({ ...draft, routingWeight: Number(e.target.value) })} />
              </Field>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="accent-accent-500" /> Active
            </label>
            <button className="btn-primary w-full" onClick={() => void saveModel()}><Check className="size-4" /> Save model</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
