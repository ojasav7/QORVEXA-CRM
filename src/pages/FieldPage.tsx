import { useEffect, useState } from "react";
import {
  Map as MapIcon, CalendarClock, Wrench, PackageSearch, HardHat, Plus, Trash2, X, Check,
  Navigation, Truck, AlertTriangle, RefreshCw, Route as RouteIcon, Radio, Boxes,
} from "lucide-react";
import { api, post, del } from "../lib/api";
import { useSession } from "../App";
import { Badge, EmptyState, Spinner, Field, StatCard, Modal } from "../components/ui";
import { dateTime, timeAgo } from "../lib/format";

// ── Types ───────────────────────────────────────────────────────────────────
type Territory = {
  id: string; name: string; region: string | null; active: boolean; notes: string | null;
  ownerId: string | null; ownerName: string | null; accountIds: string[]; accountNames: (string | null)[];
};
type Technician = {
  id: string; name: string; phone: string | null; skills: string[]; status: string;
  lat: number | null; lng: number | null; territoryId: string | null; territoryName: string | null; openWorkOrders: number;
};
type Visit = {
  id: string; title: string; scheduledAt: string; status: string; checkInAt: string | null;
  checkInLat: number | null; checkInLng: number | null; notes: string | null;
  territoryName: string | null; accountName: string | null; contactName: string | null; technicianName: string | null;
};
type WorkOrder = {
  id: string; title: string; description: string | null; priority: string; status: string;
  slaDueAt: string | null; completedAt: string | null; slaBreached: boolean; partsUsed: { sku: string; qty: number }[];
  technicianId: string | null; territoryName: string | null; accountName: string | null; assetName: string | null; technicianName: string | null;
};
type Asset = {
  id: string; name: string; serialNumber: string | null; type: string | null; status: string;
  warrantyUntil: string | null; lastMaintenanceAt: string | null; maintenanceIntervalDays: number | null;
  location: string | null; maintenanceDue: boolean; accountName: string | null;
};
type InventoryItem = {
  id: string; sku: string; name: string; quantityOnHand: number; reorderLevel: number;
  unitCost: number; location: string | null; lowStock: boolean; stockValue: number;
};
type RoutePlan = { technicianId: string | null; technicianName: string | null; totalKm: number; ordered: (Visit & { legKm: number; cumulativeKm: number })[] };
type Overview = { territories: number; technicians: number; visitsToday: number; visitsPlanned: number; openWorkOrders: number; slaBreached: number; maintenanceDue: number; lowStock: number; assetsTotal: number; inventoryValue: number };

const STATUS_TONE: Record<string, "default" | "green" | "amber" | "rose" | "blue" | "teal"> = {
  planned: "blue", in_transit: "amber", checked_in: "teal", completed: "green", cancelled: "default",
  open: "blue", dispatched: "amber", in_progress: "teal", on_hold: "default",
  available: "green", on_route: "amber", off_duty: "default",
  low: "default", medium: "blue", high: "amber", critical: "rose",
  active: "green", maintenance: "amber", retired: "default",
};
const badge = (s: string) => <Badge tone={STATUS_TONE[s] ?? "default"}>{s.replace("_", " ")}</Badge>;

export default function FieldPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<"overview" | "territories" | "visits" | "workorders" | "inventory">("overview");
  const isAdmin = user?.role === "admin";
  const isManager = isAdmin || user?.role === "manager";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <HardHat className="size-4 text-amber-400" /> Field Operations
            <span className="chip bg-amber-500/15 text-amber-300">territories · visits · dispatch · assets & inventory</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Territories that own accounts + technicians, scheduled visits with GPS check-ins and route optimization, field-service work orders with SLA dispatch, and serialized assets with maintenance schedules + inventory stock.
          </p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06]">
        {([
          ["overview", "Overview", MapIcon],
          ["territories", "Territories", MapIcon],
          ["visits", "Visits & routes", CalendarClock],
          ["workorders", "Work orders", Wrench],
          ["inventory", "Assets & inventory", PackageSearch],
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

      {tab === "overview" && <OverviewTab isAdmin={isAdmin} isManager={isManager} />}
      {tab === "territories" && <TerritoriesTab isAdmin={isAdmin} isManager={isManager} />}
      {tab === "visits" && <VisitsTab isAdmin={isAdmin} isManager={isManager} />}
      {tab === "workorders" && <WorkOrdersTab isAdmin={isAdmin} isManager={isManager} />}
      {tab === "inventory" && <InventoryTab isAdmin={isAdmin} isManager={isManager} />}
    </div>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────
function OverviewTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [ov, setOv] = useState<Overview | null>(null);
  useEffect(() => {
    void api<{ overview: Overview }>("/api/field/overview").then((d) => setOv(d.overview)).catch(() => {});
  }, []);
  if (!ov) return <Spinner className="py-16" />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Territories" value={ov.territories} sub="active territories" tone="blue" />
        <StatCard label="Technicians" value={ov.technicians} sub="in the field" tone="teal" />
        <StatCard label="Visits planned" value={ov.visitsPlanned} sub={`${ov.visitsToday} today`} tone="amber" />
        <StatCard label="Open work orders" value={ov.openWorkOrders} sub={`${ov.slaBreached} past SLA`} tone={ov.slaBreached > 0 ? "amber" : "green"} />
        <StatCard label="Stock value" value={`$${ov.inventoryValue.toLocaleString()}`} sub={`${ov.lowStock} low-stock items`} tone={ov.lowStock > 0 ? "amber" : "green"} />
      </div>
      {(ov.slaBreached > 0 || ov.maintenanceDue > 0 || ov.lowStock > 0) && (
        <div className="card space-y-2 border-amber-500/20 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-300"><AlertTriangle className="size-4" /> Needs attention</div>
          {ov.slaBreached > 0 && <p className="text-sm text-slate-400">• {ov.slaBreached} work order(s) past their SLA deadline — check dispatch.</p>}
          {ov.maintenanceDue > 0 && <p className="text-sm text-slate-400">• {ov.maintenanceDue} asset(s) due for maintenance.</p>}
          {ov.lowStock > 0 && <p className="text-sm text-slate-400">• {ov.lowStock} inventory item(s) at/below reorder level.</p>}
        </div>
      )}
      {(isAdmin || isManager) && (
        <div className="card p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Engine</p>
          <button className="btn-secondary" onClick={async () => { await post("/api/field/tick", {}).catch(() => {}); alert("Field ticker ran — check the event log for maintenance / SLA / reorder alerts."); }}>
            <RefreshCw className="size-4" /> Run field ticker
          </button>
        </div>
      )}
    </div>
  );
}

// ── Territories ────────────────────────────────────────────────────────────
function TerritoriesTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [items, setItems] = useState<Territory[]>([]);
  const [creating, setCreating] = useState(false);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const load = () => {
    void api<{ items: Territory[] }>("/api/field/territories").then((d) => setItems(d.items)).catch(() => {});
    void api<{ items: { id: string; name: string }[] }>("/api/accounts?pageSize=100").then((d) => setAccounts(d.items)).catch(() => {});
    void api<{ items: { id: string; name: string }[] }>("/api/users?pageSize=100").then((d) => setUsers(d.items)).catch(() => {});
  };
  useEffect(load, []);
  const toggleAccount = (id: string) => setAccountIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const save = async () => {
    try {
      await post("/api/field/territories", { name, region, ownerId: ownerId || null, accountIds });
      setCreating(false); setName(""); setRegion(""); setOwnerId(""); setAccountIds([]); load();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };
  const remove = async (t: Territory) => {
    if (!confirm(`Delete territory "${t.name}"?`)) return;
    try { await del(`/api/field/territories/${t.id}`); load(); } catch (e: any) { alert(e?.message ?? "Delete failed"); }
  };

  return (
    <div className="space-y-4">
      {(isAdmin || isManager) && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Territories own accounts + technicians. Assign an account to route its visits to the right team.</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New territory</button>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<MapIcon className="size-8" />} title="No territories yet" hint="Create a territory and assign accounts." />}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {items.map((t) => (
          <div key={t.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 font-medium text-white">{t.name} {t.active ? badge("active") : badge("retired")}</div>
                {t.region && <p className="mt-0.5 text-xs text-slate-500">Region: {t.region}</p>}
              </div>
              <div className="flex items-center gap-1">
                {(isAdmin || isManager) && (
                  <button className="icon-btn" onClick={() => remove(t)} title="Delete"><Trash2 className="size-4" /></button>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-400">Owner: {t.ownerName ?? "—"}</p>
            {t.accountNames.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {t.accountNames.map((a, i) => a && <Badge key={i}>{a}</Badge>)}
              </div>
            )}
            {t.notes && <p className="mt-2 text-xs text-slate-500">{t.notes}</p>}
          </div>
        ))}
      </div>
      {creating && (
        <Modal open onClose={() => setCreating(false)} title="New territory">
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Northeast" /></Field>
            <Field label="Region"><input className="input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="NY / NJ / CT" /></Field>
            <Field label="Owner">
              <select className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">— none —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Assigned accounts">
              <div className="flex flex-wrap gap-1.5">
                {accounts.map((a) => (
                  <button key={a.id} onClick={() => toggleAccount(a.id)}
                    className={`chip ${accountIds.includes(a.id) ? "bg-accent-500/20 text-white" : "bg-white/[0.04] text-slate-400"}`}>
                    {a.name}
                  </button>
                ))}
              </div>
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn-primary" onClick={save}><Check className="size-4" /> Create</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Visits & routes ────────────────────────────────────────────────────────
function VisitsTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [items, setItems] = useState<Visit[]>([]);
  const [techs, setTechs] = useState<Technician[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [creating, setCreating] = useState(false);
  const [route, setRoute] = useState<RoutePlan | null>(null);
  const [techFilter, setTechFilter] = useState("");
  const [title, setTitle] = useState(""); const [scheduledAt, setScheduledAt] = useState("");
  const [accountId, setAccountId] = useState(""); const [territoryId, setTerritoryId] = useState(""); const [technicianId, setTechnicianId] = useState("");
  const load = () => {
    void api<{ items: Visit[] }>(`/api/field/visits${techFilter ? `?technicianId=${techFilter}` : ""}`).then((d) => setItems(d.items)).catch(() => {});
    void api<{ items: Technician[] }>("/api/field/technicians").then((d) => setTechs(d.items)).catch(() => {});
    void api<{ items: { id: string; name: string }[] }>("/api/accounts?pageSize=100").then((d) => setAccounts(d.items)).catch(() => {});
    void api<{ items: Territory[] }>("/api/field/territories").then((d) => setTerritories(d.items)).catch(() => {});
  };
  useEffect(load, [techFilter]);
  const optimize = async () => {
    try {
      const d = await api<{ route: RoutePlan }>(`/api/field/routes/optimize${techFilter ? `?technicianId=${techFilter}` : ""}`);
      setRoute(d.route);
    } catch (e: any) { alert(e?.message ?? "Route planning failed"); }
  };
  const save = async () => {
    try {
      await post("/api/field/visits", { title, scheduledAt, accountId: accountId || null, territoryId: territoryId || null, technicianId: technicianId || null });
      setCreating(false); setTitle(""); setScheduledAt(""); setAccountId(""); setTerritoryId(""); setTechnicianId(""); load();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };
  const act = async (v: Visit, op: string, body: Record<string, unknown> = {}) => {
    try { await post(`/api/field/visits/${v.id}/${op}`, body); load(); } catch (e: any) { alert(e?.message ?? "Action failed"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select className="input w-56" value={techFilter} onChange={(e) => setTechFilter(e.target.value)}>
            <option value="">All technicians</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="btn-secondary" onClick={optimize}><RouteIcon className="size-4" /> Optimize route</button>
        </div>
        {(isAdmin || isManager) && (
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Schedule visit</button>
        )}
      </div>

      {route && (
        <div className="card border-accent-500/20 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Navigation className="size-4 text-accent-400" /> Route {route.technicianName ? `for ${route.technicianName}` : "— all"} · {route.totalKm} km</div>
            <button className="icon-btn" onClick={() => setRoute(null)} title="Dismiss"><X className="size-4" /></button>
          </div>
          {route.ordered.length === 0 && <p className="text-sm text-slate-500">No planned visits to order.</p>}
          <ol className="space-y-1">
            {route.ordered.map((v, i) => (
              <li key={v.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-slate-300"><span className="w-5 text-right font-mono text-xs text-accent-400">{i + 1}.</span> {v.title} <span className="text-xs text-slate-500">({v.accountName ?? "—"})</span></span>
                <span className="text-xs text-slate-500">{v.legKm} km · {v.cumulativeKm} km total</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {items.length === 0 && <EmptyState icon={<CalendarClock className="size-8" />} title="No visits" hint="Schedule a visit for a technician." />}
      <div className="space-y-2">
        {items.map((v) => (
          <div key={v.id} className="card flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium text-white">{v.title} {badge(v.status)}</div>
              <p className="mt-0.5 text-xs text-slate-500">
                {dateTime(v.scheduledAt)} · {v.technicianName ?? "unassigned"} · {v.accountName ?? "—"} {v.territoryName ? `· ${v.territoryName}` : ""}
              </p>
              {v.checkInAt && <p className="mt-0.5 text-xs text-slate-500">Checked in {timeAgo(v.checkInAt)}{v.checkInLat != null ? ` @ ${v.checkInLat.toFixed(4)}, ${v.checkInLng?.toFixed(4)}` : ""}</p>}
              {v.notes && <p className="mt-1 text-xs text-slate-500">{v.notes}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {v.status === "planned" && (isAdmin || isManager) && <button className="btn-secondary" onClick={() => act(v, "start")}><Truck className="size-4" /> Start</button>}
              {["planned", "in_transit"].includes(v.status) && <button className="btn-secondary" onClick={() => act(v, "check-in", { lat: 40.758, lng: -73.985 })}><Radio className="size-4" /> Check in</button>}
              {["checked_in", "in_transit"].includes(v.status) && <button className="btn-primary" onClick={() => act(v, "complete")}><Check className="size-4" /> Complete</button>}
              {["planned", "in_transit"].includes(v.status) && (isAdmin || isManager) && <button className="icon-btn" onClick={() => act(v, "cancel")} title="Cancel"><X className="size-4" /></button>}
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <Modal open onClose={() => setCreating(false)} title="Schedule a visit">
          <div className="space-y-3">
            <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Northwind — quarterly review" /></Field>
            <Field label="Scheduled at"><input type="datetime-local" className="input" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></Field>
            <Field label="Account">
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— none —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Territory">
              <select className="input" value={territoryId} onChange={(e) => setTerritoryId(e.target.value)}>
                <option value="">— none —</option>
                {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Technician">
              <select className="input" value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
                <option value="">— none —</option>
                {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn-primary" onClick={save}><Check className="size-4" /> Schedule</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Work orders ────────────────────────────────────────────────────────────
function WorkOrdersTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [items, setItems] = useState<WorkOrder[]>([]);
  const [techs, setTechs] = useState<Technician[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [priority, setPriority] = useState("medium");
  const [accountId, setAccountId] = useState(""); const [assetId, setAssetId] = useState(""); const [slaDueAt, setSlaDueAt] = useState("");
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [dispatchTech, setDispatchTech] = useState("");
  const load = () => {
    void api<{ items: WorkOrder[] }>("/api/field/workorders").then((d) => setItems(d.items)).catch(() => {});
    void api<{ items: Technician[] }>("/api/field/technicians").then((d) => setTechs(d.items)).catch(() => {});
    void api<{ items: Asset[] }>("/api/field/assets").then((d) => setAssets(d.items)).catch(() => {});
    void api<{ items: { id: string; name: string }[] }>("/api/accounts?pageSize=100").then((d) => setAccounts(d.items)).catch(() => {});
    void api<{ items: Territory[] }>("/api/field/territories").then((d) => setTerritories(d.items)).catch(() => {});
    void api<{ items: InventoryItem[] }>("/api/field/inventory").then((d) => setInventory(d.items)).catch(() => {});
  };
  useEffect(load, []);
  const save = async () => {
    try {
      await post("/api/field/workorders", { title, description, priority, accountId: accountId || null, assetId: assetId || null, slaDueAt: slaDueAt || null });
      setCreating(false); setTitle(""); setDescription(""); setPriority("medium"); setAccountId(""); setAssetId(""); setSlaDueAt(""); load();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };
  const act = async (w: WorkOrder, op: string, body: Record<string, unknown> = {}) => {
    try { await post(`/api/field/workorders/${w.id}/${op}`, body); load(); } catch (e: any) { alert(e?.message ?? "Action failed"); }
  };
  const dispatch = async (w: WorkOrder) => {
    try { await post(`/api/field/workorders/${w.id}/dispatch`, { technicianId: dispatchTech }); setDispatching(null); setDispatchTech(""); load(); }
    catch (e: any) { alert(e?.message ?? "Dispatch failed"); }
  };
  const completeWithParts = async (w: WorkOrder) => {
    const parts = inventory.filter((i) => i.sku).map((i) => ({ sku: i.sku, qty: 0 }));
    const lines = parts.map((p) => `${p.sku} (qty)`).join(", ");
    const input = prompt(`Complete "${w.title}" — optional parts: enter as "SKU:qty,SKU:qty" (leave empty for none). Available: ${lines || "—"}`);
    if (input === null) return;
    const used: { sku: string; qty: number }[] = [];
    for (const part of input.trim().split(",")) {
      const m = part.trim().match(/^([A-Z0-9-]+):(\d+)$/i);
      if (m) used.push({ sku: m[1].toUpperCase(), qty: Number(m[2]) });
    }
    await act(w, "complete", { partsUsed: used });
  };

  return (
    <div className="space-y-4">
      {(isAdmin || isManager) && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Field-service jobs — dispatch a technician, meet the SLA, consume parts from inventory on completion.</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New work order</button>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<Wrench className="size-8" />} title="No work orders" hint="Create a work order and dispatch it." />}
      <div className="space-y-2">
        {items.map((w) => (
          <div key={w.id} className={`card flex flex-wrap items-center justify-between gap-3 p-3 ${w.slaBreached ? "border-rose-500/30" : ""}`}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-medium text-white">
                {w.title} {badge(w.priority)} {badge(w.status)}
                {w.slaBreached && <Badge tone="rose"><AlertTriangle className="mr-1 inline size-3" /> SLA breached</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {w.technicianName ?? "unassigned"} · {w.accountName ?? "—"} {w.assetName ? `· asset: ${w.assetName}` : ""} {w.territoryName ? `· ${w.territoryName}` : ""}
              </p>
              {w.slaDueAt && <p className="mt-0.5 text-xs text-slate-500">SLA due {dateTime(w.slaDueAt)}</p>}
              {w.description && <p className="mt-1 text-xs text-slate-500">{w.description}</p>}
              {w.partsUsed.length > 0 && <p className="mt-1 text-xs text-slate-500">Parts: {w.partsUsed.map((p) => `${p.sku} ×${p.qty}`).join(", ")}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {["open", "dispatched"].includes(w.status) && (isAdmin || isManager) && (
                <button className="btn-secondary" onClick={() => { setDispatching(w.id); setDispatchTech(w.technicianId ?? ""); }}><Navigation className="size-4" /> Dispatch</button>
              )}
              {["open", "dispatched"].includes(w.status) && <button className="btn-secondary" onClick={() => act(w, "start")}><Truck className="size-4" /> Start</button>}
              {["in_progress"].includes(w.status) && <button className="btn-primary" onClick={() => completeWithParts(w)}><Check className="size-4" /> Complete</button>}
              {["open", "dispatched", "in_progress", "on_hold"].includes(w.status) && (isAdmin || isManager) && <button className="icon-btn" onClick={() => act(w, "cancel")} title="Cancel"><X className="size-4" /></button>}
            </div>
            {dispatching === w.id && (
              <div className="flex w-full items-center gap-2 pt-2">
                <select className="input" value={dispatchTech} onChange={(e) => setDispatchTech(e.target.value)}>
                  <option value="">Select technician…</option>
                  {techs.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.status}</option>)}
                </select>
                <button className="btn-primary" onClick={() => dispatch(w)} disabled={!dispatchTech}><Check className="size-4" /> Assign</button>
                <button className="btn-secondary" onClick={() => setDispatching(null)}>Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {creating && (
        <Modal open onClose={() => setCreating(false)} title="New work order">
          <div className="space-y-3">
            <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Northwind — POS terminal swap" /></Field>
            <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <Field label="Priority">
              <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="Account">
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— none —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Asset">
              <select className="input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">— none —</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.serialNumber ?? "no SN"})</option>)}
              </select>
            </Field>
            <Field label="SLA due at"><input type="datetime-local" className="input" value={slaDueAt} onChange={(e) => setSlaDueAt(e.target.value)} /></Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn-primary" onClick={save}><Check className="size-4" /> Create</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Assets & inventory ─────────────────────────────────────────────────────
function InventoryTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [creatingAsset, setCreatingAsset] = useState(false);
  const [creatingItem, setCreatingItem] = useState(false);
  const [aName, setAName] = useState(""); const [aSerial, setASerial] = useState(""); const [aAccount, setAAccount] = useState(""); const [aInterval, setAInterval] = useState("90");
  const [iSku, setISku] = useState(""); const [iName, setIName] = useState(""); const [iQty, setIQty] = useState("0"); const [iReorder, setIReorder] = useState("0");
  const load = () => {
    void api<{ items: Asset[] }>("/api/field/assets").then((d) => setAssets(d.items)).catch(() => {});
    void api<{ items: InventoryItem[] }>("/api/field/inventory").then((d) => setItems(d.items)).catch(() => {});
    void api<{ items: { id: string; name: string }[] }>("/api/accounts?pageSize=100").then((d) => setAccounts(d.items)).catch(() => {});
  };
  useEffect(load, []);
  const saveAsset = async () => {
    try {
      await post("/api/field/assets", { name: aName, serialNumber: aSerial || null, accountId: aAccount || null, maintenanceIntervalDays: Number(aInterval) || null });
      setCreatingAsset(false); setAName(""); setASerial(""); setAAccount(""); load();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };
  const saveItem = async () => {
    try {
      await post("/api/field/inventory", { sku: iSku, name: iName, quantityOnHand: Number(iQty) || 0, reorderLevel: Number(iReorder) || 0 });
      setCreatingItem(false); setISku(""); setIName(""); setIQty("0"); setIReorder("0"); load();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };
  const stock = async (i: InventoryItem, op: "receive" | "consume", qty: number) => {
    try { await post(`/api/field/inventory/${i.id}/${op}`, { qty, reason: op === "consume" ? "manual adjustment" : "restock" }); load(); }
    catch (e: any) { alert(e?.message ?? "Stock move failed"); }
  };
  const maintenance = async (a: Asset) => {
    try { await post(`/api/field/assets/${a.id}/maintenance`, {}); load(); } catch (e: any) { alert(e?.message ?? "Maintenance log failed"); }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Assets <span className="ml-1 text-slate-600">serialized · warranty · maintenance</span></p>
          {(isAdmin || isManager) && <button className="btn-secondary" onClick={() => setCreatingAsset(true)}><Plus className="size-4" /> Add asset</button>}
        </div>
        {assets.length === 0 && <EmptyState icon={<Boxes className="size-8" />} title="No assets" hint="Add a serialized asset." />}
        <div className="grid gap-3 md:grid-cols-2">
          {assets.map((a) => (
            <div key={a.id} className={`card p-4 ${a.maintenanceDue ? "border-amber-500/30" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 font-medium text-white">{a.name} {badge(a.status)} {a.maintenanceDue && <Badge tone="amber"><AlertTriangle className="mr-1 inline size-3" /> Maintenance due</Badge>}</div>
                  <p className="mt-0.5 text-xs text-slate-500">{a.serialNumber ?? "no serial"} · {a.type ?? "hardware"} · {a.accountName ?? "—"}</p>
                </div>
                {a.maintenanceDue && (isAdmin || isManager) && (
                  <button className="btn-primary" onClick={() => maintenance(a)}><Check className="size-4" /> Log maintenance</button>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Warranty {a.warrantyUntil ? `until ${dateTime(a.warrantyUntil)}` : "—"} · interval {a.maintenanceIntervalDays ? `${a.maintenanceIntervalDays}d` : "—"} · last {a.lastMaintenanceAt ? dateTime(a.lastMaintenanceAt) : "never"}
              </p>
              {a.location && <p className="mt-1 text-xs text-slate-500">📍 {a.location}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Inventory <span className="ml-1 text-slate-600">stock · reorder levels</span></p>
          {(isAdmin || isManager) && <button className="btn-secondary" onClick={() => setCreatingItem(true)}><Plus className="size-4" /> Add item</button>}
        </div>
        {items.length === 0 && <EmptyState icon={<PackageSearch className="size-8" />} title="No inventory" hint="Add a stock item with a reorder level." />}
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((i) => (
            <div key={i.id} className={`card p-4 ${i.lowStock ? "border-amber-500/30" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 font-medium text-white">
                    {i.name} {i.lowStock ? <Badge tone="amber"><AlertTriangle className="mr-1 inline size-3" /> Low stock</Badge> : <Badge tone="green">In stock</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{i.sku} · {i.quantityOnHand} on hand (reorder at {i.reorderLevel}) · ${i.unitCost} · ${i.stockValue.toLocaleString()} value {i.location ? `· ${i.location}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {(isAdmin || isManager) && <button className="btn-secondary" onClick={() => stock(i, "receive", 1)}><Plus className="size-4" /> +1</button>}
                  <button className="btn-secondary" onClick={() => stock(i, "consume", 1)}><PackageSearch className="size-4" /> −1</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {creatingAsset && (
        <Modal open onClose={() => setCreatingAsset(false)} title="Add asset">
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={aName} onChange={(e) => setAName(e.target.value)} placeholder="POS Terminal #4" /></Field>
            <Field label="Serial number"><input className="input" value={aSerial} onChange={(e) => setASerial(e.target.value)} placeholder="POS-8821-NW" /></Field>
            <Field label="Account">
              <select className="input" value={aAccount} onChange={(e) => setAAccount(e.target.value)}>
                <option value="">— none —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Maintenance interval (days)"><input type="number" className="input" value={aInterval} onChange={(e) => setAInterval(e.target.value)} /></Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setCreatingAsset(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveAsset}><Check className="size-4" /> Add</button>
            </div>
          </div>
        </Modal>
      )}
      {creatingItem && (
        <Modal open onClose={() => setCreatingItem(false)} title="Add inventory item">
          <div className="space-y-3">
            <Field label="SKU"><input className="input" value={iSku} onChange={(e) => setISku(e.target.value)} placeholder="RX-ROUTER-100" /></Field>
            <Field label="Name"><input className="input" value={iName} onChange={(e) => setIName(e.target.value)} placeholder="Enterprise Router" /></Field>
            <Field label="Quantity on hand"><input type="number" className="input" value={iQty} onChange={(e) => setIQty(e.target.value)} /></Field>
            <Field label="Reorder level"><input type="number" className="input" value={iReorder} onChange={(e) => setIReorder(e.target.value)} /></Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setCreatingItem(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveItem}><Check className="size-4" /> Add</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
