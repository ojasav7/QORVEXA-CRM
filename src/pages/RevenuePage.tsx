import { useEffect, useMemo, useState } from "react";
import {
  DollarSign, Package, Files, FileText, ShoppingCart, ScrollText, RefreshCw, Receipt,
  CreditCard, BarChart3, Plus, Trash2, X, Check, Send, PenLine, Sparkles, BadgePercent,
  Banknote, FileSignature, CircleCheck, CircleX, CalendarClock, Zap,
} from "lucide-react";
import { api, post, del } from "../lib/api";
import { useSession } from "../App";
import { Badge, EmptyState, Spinner, Field, StatCard, Modal } from "../components/ui";
import { money, date, timeAgo } from "../lib/format";

// ── Types ───────────────────────────────────────────────────────────────────
type Product = { id: string; name: string; sku: string; description: string | null; category: string; listPrice: number; cost: number; taxable: boolean; components: { productId: string; quantity: number }[]; active: boolean; createdAt: string };
type PriceBook = { id: string; name: string; isDefault: boolean; active: boolean; entries: { productId: string; price: number; productName: string | null; sku: string | null }[]; discounts: { productId: string; pct: number }[] };
type QuoteTemplate = { id: string; name: string; layout: string; language: string; header: string | null; footer: string | null; active: boolean };
type QuoteLine = { productId: string; productName: string; sku: string; quantity: number; unitPrice: number; discountPct: number; lineTotal: number };
type Quote = { id: string; quoteNumber: string; name: string; status: string; lines: QuoteLine[]; subtotal: number; discountTotal: number; taxTotal: number; total: number; currency: string; validUntil: string | null; signature: { name?: string; at?: string } | null; approvals: { by: string; name: string | null; role: string; at: string; decision: string }[]; accountId: string | null; accountName: string | null; opportunityName: string | null; template: { name: string; layout: string; language: string } | null; createdAt: string };
type Order = { id: string; orderNumber: string; quoteId: string | null; accountId: string | null; accountName: string | null; status: string; lines: QuoteLine[]; total: number; placedAt: string | null; createdAt: string };
type Contract = { id: string; contractNumber: string; name: string; status: string; accountId: string | null; accountName: string | null; startDate: string | null; endDate: string | null; autoRenew: boolean; renewalNoticeDays: number; clauses: { key: string; label: string; value: string; source: string }[]; analyzedAt: string | null; createdAt: string };
type Subscription = { id: string; name: string; accountId: string | null; accountName: string | null; productName: string | null; sku: string | null; billingPeriod: string; unitPrice: number; quantity: number; status: string; currentPeriodEnd: string | null; autoRenew: boolean; mrr: number; createdAt: string };
type Payment = { id: string; invoiceId: string; invoiceNumber: string | null; accountId: string | null; amount: number; method: string; status: string; failureReason: string | null; refundOf: string | null; paidAt: string | null; createdAt: string };
type Invoice = { id: string; invoiceNumber: string; accountId: string | null; accountName: string | null; subscriptionId: string | null; orderId: string | null; lines: QuoteLine[]; subtotal: number; taxTotal: number; total: number; status: string; dueDate: string | null; issuedAt: string | null; paidAt: string | null; dunningAttempts: number; payments: Payment[]; createdAt: string };
type Metric = { key: string; label: string; value: number; format: "currency" | "count" | "pct"; sources: { entity: string; query: string; note: string }[] };

const STATUS_TONE: Record<string, "default" | "green" | "amber" | "rose" | "blue" | "violet"> = {
  draft: "default", needs_approval: "amber", approved: "blue", sent: "blue", signed: "violet", won: "green",
  lost: "rose", voided: "rose", confirmed: "blue", fulfilled: "green",
  active: "green", past_due: "amber", expired: "default", expiring: "amber", terminated: "rose",
  issued: "blue", paid: "green", overdue: "rose", succeeded: "green", failed: "rose", refunded: "amber",
};
const tierBadge = (s: string) => <Badge tone={STATUS_TONE[s] ?? "default"}>{s.replace("_", " ")}</Badge>;
const CATEGORY_TONE: Record<string, "default" | "blue" | "violet" | "amber"> = { software: "blue", service: "violet", hardware: "amber", bundle: "green" as any, other: "default" };

export default function RevenuePage() {
  const { user } = useSession();
  const [tab, setTab] = useState<"overview" | "products" | "books" | "quotes" | "orders" | "contracts" | "subs" | "billing">("overview");
  const isAdmin = user?.role === "admin";
  const isManager = isAdmin || user?.role === "manager";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <DollarSign className="size-4 text-emerald-400" /> Revenue Cloud
            <span className="chip bg-emerald-500/15 text-emerald-300">products · CPQ · billing</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Products, price books, quotes with approval + e-signature, orders, contracts with AI clause extraction, subscriptions, and invoices/payments with dunning — MRR/ARR derived live.
          </p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06]">
        {([
          ["overview", "Overview", BarChart3],
          ["products", "Products", Package],
          ["books", "Price books", Files],
          ["quotes", "Quotes", FileText],
          ["orders", "Orders", ShoppingCart],
          ["contracts", "Contracts", ScrollText],
          ["subs", "Subscriptions", RefreshCw],
          ["billing", "Billing", Receipt],
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
      {tab === "products" && <ProductsTab isAdmin={isAdmin} />}
      {tab === "books" && <PriceBooksTab isAdmin={isAdmin} />}
      {tab === "quotes" && <QuotesTab isAdmin={isAdmin} isManager={isManager} />}
      {tab === "orders" && <OrdersTab isAdmin={isAdmin} />}
      {tab === "contracts" && <ContractsTab isAdmin={isAdmin} isManager={isManager} />}
      {tab === "subs" && <SubscriptionsTab isAdmin={isAdmin} />}
      {tab === "billing" && <BillingTab isAdmin={isAdmin} />}
    </div>
  );
}

// ── Overview (MRR / ARR) ────────────────────────────────────────────────────
function OverviewTab() {
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [byAccount, setByAccount] = useState<{ accountId: string | null; accountName: string | null; mrr: number; subs: number }[]>([]);

  useEffect(() => {
    void api<{ metrics: Metric[]; byAccount: typeof byAccount }>("/api/revenue/metrics").then((d) => { setMetrics(d.metrics); setByAccount(d.byAccount); }).catch(() => {});
  }, []);

  const val = (key: string) => metrics?.find((m) => m.key === key)?.value ?? null;
  const fmt = (key: string) => {
    const m = metrics?.find((x) => x.key === key);
    if (!m) return "—";
    return m.format === "currency" ? money(m.value) : m.format === "count" ? String(m.value) : `${m.value}%`;
  };
  const maxAcct = Math.max(1, ...byAccount.map((a) => a.mrr));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="MRR" value={fmt("mrr")} sub="monthly recurring revenue" tone="green" />
        <StatCard label="ARR" value={fmt("arr")} sub="annualized (MRR × 12)" tone="blue" />
        <StatCard label="Active subs" value={fmt("activeSubs")} sub={`${fmt("pastDueSubs")} past due`} tone="violet" />
        <StatCard label="Outstanding" value={fmt("outstanding")} sub={`${fmt("overdueTotal")} overdue`} tone="amber" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="New MRR (month)" value={fmt("newMrr")} tone="green" />
        <StatCard label="Churned MRR (month)" value={fmt("churnedMrr")} tone="amber" />
        <StatCard label="Collected (month)" value={fmt("paidThisMonth")} tone="blue" />
        <StatCard label="Active contracts" value={fmt("activeContracts")} tone="violet" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><BarChart3 className="size-4 text-accent-400" /> Metrics with lineage</h3>
          <p className="mt-0.5 text-xs text-slate-500">Every number is derived on read — click a metric to see where it came from.</p>
          <div className="mt-3 space-y-1.5">
            {!metrics && <Spinner />}
            {metrics?.map((m) => (
              <details key={m.key} className="rounded-lg bg-white/[0.03] px-3 py-2">
                <summary className="flex cursor-pointer items-center gap-2 text-sm">
                  <span className="font-medium text-white">{m.label}</span>
                  <span className="ml-auto tabular-nums font-semibold text-emerald-300">{m.format === "currency" ? money(m.value) : m.value}</span>
                </summary>
                {m.sources.map((s) => (
                  <div key={s.note} className="mt-2 space-y-0.5 rounded-lg bg-ink-950/50 p-2.5 text-[11px] text-slate-400">
                    <div><span className="text-slate-300">entity:</span> {s.entity} · <span className="text-slate-300">query:</span> {s.query}</div>
                    <div className="text-slate-500">note: {s.note}</div>
                  </div>
                ))}
              </details>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold text-white">MRR by account</h3>
          <div className="mt-4 space-y-2">
            {byAccount.length === 0 && <p className="text-xs text-slate-600">No active subscriptions yet.</p>}
            {byAccount.map((a) => (
              <div key={a.accountId ?? "none"}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{a.accountName ?? "Unassigned"} <span className="text-slate-600">· {a.subs} sub(s)</span></span>
                  <span className="tabular-nums text-emerald-300">{money(a.mrr)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${(a.mrr / maxAcct) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Products ────────────────────────────────────────────────────────────────
function ProductsTab({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<Product[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const load = () => void api<{ items: Product[] }>("/api/products").then((d) => setItems(d.items)).catch(() => {});
  useEffect(load, []);
  const remove = async (p: Product) => {
    if (!confirm(`Delete product "${p.name}"?`)) return;
    try { await del(`/api/products/${p.id}`); load(); } catch (e: any) { alert(e?.message ?? "Delete failed"); }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">{items.length} product(s) · bundles expand to component lines at quote build time</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New product</button>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<Package className="size-8" />} title="No products yet" hint="Create the catalog — bundles are products with components." />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => (
          <div key={p.id} className="card p-4">
            <div className="flex items-start gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/15 text-sm">{p.category === "bundle" ? "🧩" : p.category === "service" ? "🛠️" : "💾"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-white">{p.name}</span>
                  <Badge tone={CATEGORY_TONE[p.category] ?? "default"}>{p.category}</Badge>
                </div>
                <div className="text-[11px] text-slate-500">{p.sku}{p.description ? ` · ${p.description}` : ""}</div>
              </div>
              {!p.active && <Badge tone="rose">inactive</Badge>}
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="tabular-nums font-semibold text-emerald-300">{money(p.listPrice)}</span>
              <span className="text-[11px] text-slate-600">cost {money(p.cost)}{p.taxable ? " · taxable" : " · non-taxable"}</span>
            </div>
            {p.components.length > 0 && (
              <div className="mt-2 rounded-lg bg-white/[0.03] p-2 text-[11px] text-slate-400">
                bundle: {p.components.map((c) => `${c.quantity}× ${c.productId.slice(0, 8)}`).join(" + ")}
              </div>
            )}
            {isAdmin && (
              <div className="mt-3 flex gap-1.5">
                <button className="btn-ghost" onClick={() => setEditing(p)}><PenLine className="size-3.5" /> Edit</button>
                <button className="btn-ghost text-rose-400 hover:bg-rose-500/10" onClick={() => void remove(p)}><Trash2 className="size-3.5" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
      {(creating || editing) && (
        <ProductModal
          product={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ProductModal({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [category, setCategory] = useState(product?.category ?? "software");
  const [listPrice, setListPrice] = useState(String(product?.listPrice ?? 0));
  const [cost, setCost] = useState(String(product?.cost ?? 0));
  const [taxable, setTaxable] = useState(product?.taxable ?? true);
  const [active, setActive] = useState(product?.active ?? true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: name.trim(), sku: sku.trim(), description: description.trim() || undefined, category, listPrice: Number(listPrice) || 0, cost: Number(cost) || 0, taxable, active, components: [] };
      if (product) await api(`/api/products/${product.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await post("/api/products", body);
      onSaved();
    } catch (e: any) { alert(e?.message ?? "Save failed"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={product ? "Edit product" : "New product"}>
      <div className="space-y-3">
        <Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="SKU" required><input value={sku} onChange={(e) => setSku(e.target.value)} className="input" /></Field>
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
              {["software", "service", "hardware", "bundle", "other"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="List price"><input type="number" value={listPrice} onChange={(e) => setListPrice(e.target.value)} className="input" /></Field>
          <Field label="Cost"><input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className="input" /></Field>
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} className="accent-accent-500" /> Taxable</label>
          <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-accent-500" /> Active</label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim() || !sku.trim() || busy} onClick={() => void save()}>
            {busy ? <Spinner className="size-4" /> : <Check className="size-4" />} Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Price books ─────────────────────────────────────────────────────────────
function PriceBooksTab({ isAdmin }: { isAdmin: boolean }) {
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [creating, setCreating] = useState(false);
  const load = () => {
    void api<{ items: PriceBook[] }>("/api/price-books").then((d) => setBooks(d.items)).catch(() => {});
    void api<{ items: Product[] }>("/api/products").then((d) => setProducts(d.items)).catch(() => {});
  };
  useEffect(load, []);

  const saveEntries = async (book: PriceBook, entries: { productId: string; price: number }[]) => {
    try { await api(`/api/price-books/${book.id}/entries`, { method: "PUT", body: JSON.stringify(entries) }); load(); } catch (e: any) { alert(e?.message ?? "Save failed"); }
  };
  const saveDiscounts = async (book: PriceBook, discounts: { productId: string; pct: number }[]) => {
    try { await api(`/api/price-books/${book.id}/discounts`, { method: "PUT", body: JSON.stringify(discounts) }); load(); } catch (e: any) { alert(e?.message ?? "Save failed"); }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Quotes resolve line prices from a book — falling back to the default book, then product list price.</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New price book</button>
        </div>
      )}
      {books.length === 0 && <EmptyState icon={<Files className="size-8" />} title="No price books" hint="The default book is created lazily on first use." />}
      <div className="grid gap-4 lg:grid-cols-2">
        {books.map((b) => (
          <BookCard key={b.id} book={b} products={products} isAdmin={isAdmin} onSaveEntries={saveEntries} onSaveDiscounts={saveDiscounts} />
        ))}
      </div>
      {creating && (
        <Modal open onClose={() => setCreating(false)} title="New price book">
          <CreateBookForm onDone={() => { setCreating(false); load(); }} />
        </Modal>
      )}
    </div>
  );
}

function BookCard({ book, products, isAdmin, onSaveEntries, onSaveDiscounts }: {
  book: PriceBook; products: Product[]; isAdmin: boolean;
  onSaveEntries: (b: PriceBook, e: { productId: string; price: number }[]) => void;
  onSaveDiscounts: (b: PriceBook, d: { productId: string; pct: number }[]) => void;
}) {
  const [entries, setEntries] = useState(book.entries.map((e) => ({ productId: e.productId, price: e.price })));
  const [discounts, setDiscounts] = useState(book.discounts.map((d) => ({ productId: d.productId, pct: d.pct })));
  const addEntry = () => setEntries((p) => [...p, { productId: products[0]?.id ?? "", price: 0 }]);
  const addDiscount = () => setDiscounts((p) => [...p, { productId: products[0]?.id ?? "", pct: 0 }]);
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white">{book.name}</h3>
        {book.isDefault && <Badge tone="green">default</Badge>}
        {!book.active && <Badge tone="rose">inactive</Badge>}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Prices</h4>
          <div className="mt-2 space-y-1.5">
            {entries.map((e, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={e.productId} onChange={(ev) => setEntries((p) => p.map((x, j) => j === i ? { ...x, productId: ev.target.value } : x))} className="input min-w-0 flex-1 !py-1 text-xs" disabled={!isAdmin}>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="number" value={e.price} onChange={(ev) => setEntries((p) => p.map((x, j) => j === i ? { ...x, price: Number(ev.target.value) || 0 } : x))} className="input w-24 !py-1 text-xs" disabled={!isAdmin} />
                {isAdmin && <button onClick={() => setEntries((p) => p.filter((_, j) => j !== i))} className="text-slate-600 hover:text-rose-400"><X className="size-3.5" /></button>}
              </div>
            ))}
            {entries.length === 0 && <p className="text-xs text-slate-600">No entries — products price at their list price.</p>}
            {isAdmin && <button className="btn-ghost !py-1 text-xs" onClick={addEntry}><Plus className="size-3" /> Add price</button>}
          </div>
          {isAdmin && <button className="btn-primary mt-3 w-full !py-1.5 text-xs" onClick={() => onSaveEntries(book, entries)}><Check className="size-3.5" /> Save prices</button>}
        </div>
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"><BadgePercent className="size-3.5" /> Discounts (%)</h4>
          <div className="mt-2 space-y-1.5">
            {discounts.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={d.productId} onChange={(ev) => setDiscounts((p) => p.map((x, j) => j === i ? { ...x, productId: ev.target.value } : x))} className="input min-w-0 flex-1 !py-1 text-xs" disabled={!isAdmin}>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="number" value={d.pct} onChange={(ev) => setDiscounts((p) => p.map((x, j) => j === i ? { ...x, pct: Number(ev.target.value) || 0 } : x))} className="input w-20 !py-1 text-xs" disabled={!isAdmin} />
                {isAdmin && <button onClick={() => setDiscounts((p) => p.filter((_, j) => j !== i))} className="text-slate-600 hover:text-rose-400"><X className="size-3.5" /></button>}
              </div>
            ))}
            {discounts.length === 0 && <p className="text-xs text-slate-600">No discounts.</p>}
            {isAdmin && <button className="btn-ghost !py-1 text-xs" onClick={addDiscount}><Plus className="size-3" /> Add discount</button>}
          </div>
          {isAdmin && <button className="btn-primary mt-3 w-full !py-1.5 text-xs" onClick={() => onSaveDiscounts(book, discounts)}><Check className="size-3.5" /> Save discounts</button>}
        </div>
      </div>
    </div>
  );
}

function CreateBookForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const save = async () => {
    try { await post("/api/price-books", { name: name.trim(), isDefault }); onDone(); } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };
  return (
    <div className="space-y-3">
      <Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
      <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="accent-accent-500" /> Make the default book</label>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onDone}>Cancel</button>
        <button className="btn-primary" disabled={!name.trim()} onClick={() => void save()}><Check className="size-4" /> Create</button>
      </div>
    </div>
  );
}

// ── Quotes (CPQ) ────────────────────────────────────────────────────────────
function QuotesTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [items, setItems] = useState<Quote[]>([]);
  const [creating, setCreating] = useState(false);
  const [signing, setSigning] = useState<Quote | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 2500); };
  const load = () => void api<{ items: Quote[] }>("/api/quotes").then((d) => setItems(d.items)).catch(() => {});
  useEffect(load, []);

  const act = async (q: Quote, action: string, body?: Record<string, unknown>) => {
    try {
      const d = await post(`/api/quotes/${q.id}/${action}`, body ?? {});
      const status = (d as any)?.quote?.status ?? action;
      flash(`Quote ${q.quoteNumber} → ${status}`);
      load();
    } catch (e: any) { alert(e?.message ?? "Action failed"); }
  };

  return (
    <div className="space-y-4">
      {notice && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}
      {isAdmin && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">draft → needs approval → approved → sent → signed → won/lost/voided · mock e-signature (ADR-014)</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New quote</button>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<FileText className="size-8" />} title="No quotes yet" hint="Build a quote from the price book — it walks the approval → signature flow." />}
      <div className="space-y-2">
        {items.map((q) => (
          <div key={q.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-white">{q.quoteNumber}</span>
              <span className="text-sm text-slate-300">{q.name}</span>
              {tierBadge(q.status)}
              {q.accountName && <span className="text-[11px] text-slate-500">{q.accountName}</span>}
              {q.opportunityName && <span className="text-[11px] text-slate-500">deal: {q.opportunityName}</span>}
              {q.template && <span className="chip bg-white/[0.05] text-[10px] text-slate-400">{q.template.name} · {q.template.layout}</span>}
              <span className="ml-auto flex items-center gap-2 text-sm">
                <span className="tabular-nums font-semibold text-emerald-300">{money(q.total)}</span>
                <span className="text-[11px] text-slate-600">{q.lines.length} line(s)</span>
              </span>
            </div>
            {q.signature?.name && <p className="mt-1 text-[11px] text-slate-500">✍️ signed by {q.signature.name}{q.signature.at ? ` · ${date(q.signature.at)}` : ""}</p>}
            {q.approvals.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">approvals: {q.approvals.map((a) => `${a.name ?? a.role} ${a.decision} ${date(a.at)}`).join(" · ")}</p>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-slate-500">lines ({money(q.subtotal)} − {money(q.discountTotal)} + tax {money(q.taxTotal)})</summary>
              <div className="mt-2 space-y-1">
                {q.lines.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs">
                    <span className="font-medium text-white">{l.productName}</span>
                    <span className="text-slate-500">{l.quantity}× {money(l.unitPrice)}{l.discountPct ? ` (−${l.discountPct}%)` : ""}</span>
                    <span className="ml-auto tabular-nums text-slate-300">{money(l.lineTotal)}</span>
                  </div>
                ))}
              </div>
            </details>
            {isManager && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {q.status === "draft" && <><button className="btn-primary !py-1.5 text-xs" onClick={() => void act(q, "submit")}><Send className="size-3.5" /> Submit for approval</button><button className="btn-ghost !py-1.5 text-xs text-rose-400" onClick={() => void act(q, "outcome", { outcome: "voided" })}>Void</button></>}
                {q.status === "needs_approval" && <><button className="btn-primary !py-1.5 text-xs" onClick={() => void act(q, "approve")}><CircleCheck className="size-3.5" /> Approve</button><button className="btn-ghost !py-1.5 text-xs text-rose-400" onClick={() => void act(q, "outcome", { outcome: "voided" })}>Void</button></>}
                {q.status === "approved" && <><button className="btn-primary !py-1.5 text-xs" onClick={() => void act(q, "send")}><Send className="size-3.5" /> Send to customer</button><button className="btn-ghost !py-1.5 text-xs text-rose-400" onClick={() => void act(q, "outcome", { outcome: "voided" })}>Void</button></>}
                {q.status === "sent" && <><button className="btn-primary !py-1.5 text-xs" onClick={() => setSigning(q)}><FileSignature className="size-3.5" /> E-sign</button><button className="btn-ghost !py-1.5 text-xs" onClick={() => void act(q, "outcome", { outcome: "lost" })}>Mark lost</button><button className="btn-ghost !py-1.5 text-xs text-rose-400" onClick={() => void act(q, "outcome", { outcome: "voided" })}>Void</button></>}
                {q.status === "signed" && <><button className="btn-primary !py-1.5 text-xs" onClick={() => void act(q, "outcome", { outcome: "won" })}><CircleCheck className="size-3.5" /> Mark won</button><button className="btn-ghost !py-1.5 text-xs" onClick={() => void act(q, "outcome", { outcome: "lost" })}>Mark lost</button></>}
              </div>
            )}
          </div>
        ))}
      </div>
      {creating && <QuoteModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {signing && (
        <SignModal
          title={`E-sign ${signing.quoteNumber}`}
          onSubmit={async (name, email) => { await act(signing, "sign", { name, email }); setSigning(null); }}
          onClose={() => setSigning(null)}
        />
      )}
    </div>
  );
}

function QuoteModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [opportunities, setOpportunities] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [priceBookId, setPriceBookId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [lines, setLines] = useState<{ productId: string; quantity: number; discountPct: number }[]>([{ productId: "", quantity: 1, discountPct: 0 }]);
  const [preview, setPreview] = useState<QuoteLine[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ items: Product[] }>("/api/products").then((d) => setProducts(d.items));
    void api<{ items: PriceBook[] }>("/api/price-books").then((d) => { setBooks(d.items); setPriceBookId((prev) => prev || (d.items.find((b) => b.isDefault)?.id ?? "")); });
    void api<{ items: QuoteTemplate[] }>("/api/quotes/templates").then((d) => setTemplates(d.items));
    void api<{ items: { id: string; name: string }[] }>("/api/accounts?pageSize=100").then((d) => setAccounts(d.items));
    void api<{ items: { id: string; name: string }[] }>("/api/opportunities?pageSize=100").then((d) => setOpportunities(d.items));
  }, []);

  const validLines = lines.filter((l) => l.productId && l.quantity > 0);
  const doPreview = async () => {
    try {
      const d = await post<{ lines: QuoteLine[]; subtotal: number; discountTotal: number; taxTotal: number; total: number }>("/api/quotes/preview", { priceBookId: priceBookId || undefined, lines: validLines });
      setPreview(d.lines);
    } catch (e: any) { alert(e?.message ?? "Preview failed"); }
  };
  const save = async () => {
    setBusy(true);
    try {
      await post("/api/quotes", {
        name: name.trim(), accountId: accountId || undefined, opportunityId: opportunityId || undefined,
        priceBookId: priceBookId || undefined, templateId: templateId || undefined,
        validUntil: validUntil ? new Date(validUntil).toISOString() : undefined, lines: validLines,
      });
      onSaved();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="New quote" wide>
      <div className="space-y-3">
        <Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northwind — Retail Platform Expansion" className="input" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input"><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </Field>
          <Field label="Deal">
            <select value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)} className="input"><option value="">—</option>{opportunities.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Price book">
            <select value={priceBookId} onChange={(e) => setPriceBookId(e.target.value)} className="input"><option value="">Default</option>{books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </Field>
          <Field label="Template">
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="input"><option value="">—</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </Field>
          <Field label="Valid until"><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="input" /></Field>
        </div>
        <Field label="Line items">
          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={l.productId} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, productId: e.target.value } : x))} className="input min-w-0 flex-1 !py-1.5 text-xs">
                  <option value="">Product…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                </select>
                <input type="number" min={1} value={l.quantity} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) || 1 } : x))} className="input w-20 !py-1.5 text-xs" title="Qty" />
                <input type="number" min={0} max={100} value={l.discountPct} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, discountPct: Number(e.target.value) || 0 } : x))} className="input w-20 !py-1.5 text-xs" title="Discount %" />
                {lines.length > 1 && <button onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="text-slate-600 hover:text-rose-400"><X className="size-3.5" /></button>}
              </div>
            ))}
            <button className="btn-ghost !py-1 text-xs" onClick={() => setLines((p) => [...p, { productId: "", quantity: 1, discountPct: 0 }])}><Plus className="size-3" /> Add line</button>
          </div>
        </Field>
        {preview && (
          <div className="rounded-lg bg-white/[0.03] p-3 text-xs">
            {preview.map((l, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <span className="font-medium text-white">{l.productName}</span>
                <span className="text-slate-500">{l.quantity}× {money(l.unitPrice)}{l.discountPct ? ` (−${l.discountPct}%)` : ""}</span>
                <span className="ml-auto tabular-nums">{money(l.lineTotal)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={() => void doPreview()} disabled={!validLines.length}><Sparkles className="size-4" /> Preview pricing</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim() || !validLines.length || busy} onClick={() => void save()}>
            {busy ? <Spinner className="size-4" /> : <Check className="size-4" />} Create quote
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SignModal({ title, onSubmit, onClose }: { title: string; onSubmit: (name: string, email?: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={title}>
      <p className="mb-3 text-xs text-slate-500">Mock e-signature — records who signed and when (ADR-014).</p>
      <div className="space-y-3">
        <Field label="Signer name" required><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
        <Field label="Signer email"><input value={email} onChange={(e) => setEmail(e.target.value)} className="input" /></Field>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim() || busy} onClick={() => void (async () => { setBusy(true); try { await onSubmit(name.trim(), email.trim() || undefined); } finally { setBusy(false); } })()}>
            {busy ? <Spinner className="size-4" /> : <FileSignature className="size-4" />} Sign
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Orders ──────────────────────────────────────────────────────────────────
function OrdersTab({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<Order[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [creating, setCreating] = useState(false);
  const load = () => {
    void api<{ items: Order[] }>("/api/orders").then((d) => setItems(d.items)).catch(() => {});
    void api<{ items: Quote[] }>("/api/quotes").then((d) => setQuotes(d.items)).catch(() => {});
  };
  useEffect(load, []);
  const trans = async (o: Order, status: string) => {
    try { await api(`/api/orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); load(); } catch (e: any) { alert(e?.message ?? "Failed"); }
  };
  const remove = async (o: Order) => {
    if (!confirm(`Delete order ${o.orderNumber}?`)) return;
    try { await del(`/api/orders/${o.id}`); load(); } catch (e: any) { alert(e?.message ?? "Delete failed"); }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Create from a signed/approved quote, or manually from line items.</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New order</button>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<ShoppingCart className="size-8" />} title="No orders yet" hint="Create an order from a signed quote." />}
      <div className="space-y-2">
        {items.map((o) => (
          <div key={o.id} className="card flex flex-wrap items-center gap-2 p-4">
            <span className="text-sm font-semibold text-white">{o.orderNumber}</span>
            {tierBadge(o.status)}
            <span className="text-xs text-slate-400">{o.accountName ?? "—"} · {o.lines.length} line(s)</span>
            {o.quoteId && <span className="chip bg-white/[0.05] text-[10px] text-slate-400">from quote</span>}
            <span className="ml-auto text-sm font-semibold tabular-nums text-emerald-300">{money(o.total)}</span>
            {isAdmin && o.status === "draft" && <button className="btn-primary !py-1.5 text-xs" onClick={() => void trans(o, "confirmed")}><Check className="size-3.5" /> Confirm</button>}
            {isAdmin && o.status === "confirmed" && <button className="btn-primary !py-1.5 text-xs" onClick={() => void trans(o, "fulfilled")}><CircleCheck className="size-3.5" /> Fulfill</button>}
            {isAdmin && ["draft", "confirmed", "fulfilled"].includes(o.status) && <button className="btn-ghost !py-1.5 text-xs text-rose-400" onClick={() => void trans(o, "cancelled")}>Cancel</button>}
            {isAdmin && ["draft", "cancelled"].includes(o.status) && <button className="btn-ghost !py-1.5 text-xs" onClick={() => void remove(o)}><Trash2 className="size-3.5" /></button>}
          </div>
        ))}
      </div>
      {creating && <OrderModal quotes={quotes} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </div>
  );
}

function OrderModal({ quotes, onClose, onSaved }: { quotes: Quote[]; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<"quote" | "manual">("quote");
  const [quoteId, setQuoteId] = useState("");
  const [name, setName] = useState("");
  const [lines, setLines] = useState<{ productId: string; quantity: number }[]>([{ productId: "", quantity: 1 }]);
  const [products, setProducts] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ items: Product[] }>("/api/products").then((d) => setProducts(d.items)); }, []);
  const eligible = quotes.filter((q) => ["signed", "approved", "won"].includes(q.status));
  const save = async () => {
    setBusy(true);
    try {
      if (mode === "quote") { if (!quoteId) return alert("Pick a quote"); await post("/api/orders", { quoteId }); }
      else {
        const valid = lines.filter((l) => l.productId && l.quantity > 0);
        if (!name.trim() || !valid.length) return alert("Name + lines required");
        await post("/api/orders", { name: name.trim(), lines: valid });
      }
      onSaved();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="New order">
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {(["quote", "manual"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`chip cursor-pointer ${mode === m ? "bg-accent-500/20 text-accent-200" : "bg-white/[0.04] text-slate-400"}`}>{m === "quote" ? "From quote" : "Manual lines"}</button>
          ))}
        </div>
        {mode === "quote" ? (
          <Field label="Signed / approved quote">
            <select value={quoteId} onChange={(e) => setQuoteId(e.target.value)} className="input">
              <option value="">Choose…</option>
              {eligible.map((q) => <option key={q.id} value={q.id}>{q.quoteNumber} — {q.name} ({q.status}, {money(q.total)})</option>)}
            </select>
            {eligible.length === 0 && <p className="mt-1 text-xs text-amber-400">No signed/approved quotes yet — sign a quote first.</p>}
          </Field>
        ) : (
          <>
            <Field label="Order name" required><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
            <Field label="Lines">
              <div className="space-y-1.5">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select value={l.productId} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, productId: e.target.value } : x))} className="input min-w-0 flex-1 !py-1.5 text-xs">
                      <option value="">Product…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input type="number" min={1} value={l.quantity} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) || 1 } : x))} className="input w-20 !py-1.5 text-xs" />
                    {lines.length > 1 && <button onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="text-slate-600 hover:text-rose-400"><X className="size-3.5" /></button>}
                  </div>
                ))}
                <button className="btn-ghost !py-1 text-xs" onClick={() => setLines((p) => [...p, { productId: "", quantity: 1 }])}><Plus className="size-3" /> Add line</button>
              </div>
            </Field>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={() => void save()}><Check className="size-4" /> Create order</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Contracts ───────────────────────────────────────────────────────────────
function ContractsTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [items, setItems] = useState<Contract[]>([]);
  const [creating, setCreating] = useState(false);
  const [analyzing, setAnalyzing] = useState<Contract | null>(null);
  const [signing, setSigning] = useState<Contract | null>(null);
  const [detail, setDetail] = useState<Contract | null>(null);
  const load = () => void api<{ items: Contract[] }>("/api/contracts").then((d) => setItems(d.items)).catch(() => {});
  useEffect(load, []);
  const remove = async (c: Contract) => {
    if (!confirm(`Delete contract ${c.contractNumber}?`)) return;
    try { await del(`/api/contracts/${c.id}`); load(); } catch (e: any) { alert(e?.message ?? "Delete failed"); }
  };
  const terminate = async (c: Contract) => {
    const reason = prompt("Termination reason (optional)");
    if (reason === null) return;
    try { await post(`/api/contracts/${c.id}/terminate`, { reason: reason.trim() || undefined }); load(); } catch (e: any) { alert(e?.message ?? "Failed"); }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Contracts hold AI-extracted clauses (parties, dates, renewal + payment terms). Signing makes them active.</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New contract</button>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<ScrollText className="size-8" />} title="No contracts yet" hint="Create one and run contract intelligence to extract the terms." />}
      <div className="space-y-2">
        {items.map((c) => (
          <div key={c.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setDetail(c)} className="flex items-center gap-2 text-left">
                <span className="text-sm font-semibold text-white hover:text-accent-300">{c.contractNumber}</span>
                <span className="text-sm text-slate-300">{c.name}</span>
              </button>
              {tierBadge(c.status)}
              <span className="text-[11px] text-slate-500">{c.accountName ?? "—"}</span>
              {c.autoRenew && <span className="chip bg-emerald-500/10 text-[10px] text-emerald-300">auto-renew</span>}
              <span className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
                <span>{c.startDate ? date(c.startDate) : "—"} → {c.endDate ? date(c.endDate) : "—"}</span>
                <span>{((c.clauses ?? []) as unknown[]).length} clause(s){c.analyzedAt ? ` · analyzed ${timeAgo(c.analyzedAt)}` : ""}</span>
              </span>
            </div>
            {isAdmin && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => setAnalyzing(c)}><Sparkles className="size-3.5" /> Contract intelligence</button>
                {["draft", "active"].includes(c.status) && <button className="btn-primary !py-1.5 text-xs" onClick={() => setSigning(c)}><FileSignature className="size-3.5" /> Sign</button>}
                {c.status !== "terminated" && <button className="btn-ghost !py-1.5 text-xs text-rose-400" onClick={() => void terminate(c)}>Terminate</button>}
                {c.status === "draft" && <button className="btn-ghost !py-1.5 text-xs" onClick={() => void remove(c)}><Trash2 className="size-3.5" /></button>}
              </div>
            )}
          </div>
        ))}
      </div>
      {creating && <ContractModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {analyzing && (
        <AnalyzeModal
          contract={analyzing}
          onClose={() => setAnalyzing(null)}
          onDone={(clauses) => { setAnalyzing(null); load(); }}
        />
      )}
      {signing && (
        <SignModal
          title={`E-sign ${signing.contractNumber}`}
          onSubmit={async (name, email) => { await post(`/api/contracts/${signing.id}/sign`, { name, email }); setSigning(null); load(); }}
          onClose={() => setSigning(null)}
        />
      )}
      {detail && (
        <Modal open onClose={() => setDetail(null)} title={`${detail.contractNumber} — ${detail.name}`} wide>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
              {tierBadge(detail.status)}
              <span>account: {detail.accountName ?? "—"}</span>
              <span>term: {detail.startDate ? date(detail.startDate) : "—"} → {detail.endDate ? date(detail.endDate) : "—"}</span>
              <span>auto-renew: {detail.autoRenew ? "yes" : "no"} · notice {detail.renewalNoticeDays}d</span>
            </div>
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Extracted clauses</h4>
              {detail.clauses.length === 0 && <p className="text-xs text-slate-600">No clauses yet — run contract intelligence.</p>}
              {detail.clauses.map((cl, i) => (
                <div key={i} className="rounded-lg bg-white/[0.03] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{cl.label}</span>
                    <span className="text-slate-400">{cl.value}</span>
                    <span className="ml-auto text-[10px] text-slate-600">source: {cl.source}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ContractModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [renewalNoticeDays, setRenewalNoticeDays] = useState(30);
  useEffect(() => { void api<{ items: { id: string; name: string }[] }>("/api/accounts?pageSize=100").then((d) => setAccounts(d.items)); }, []);
  const save = async () => {
    try {
      await post("/api/contracts", {
        name: name.trim(), accountId: accountId || undefined,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
        autoRenew, renewalNoticeDays,
      });
      onSaved();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };
  return (
    <Modal open onClose={onClose} title="New contract">
      <div className="space-y-3">
        <Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
        <Field label="Account">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input"><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" /></Field>
          <Field label="End date"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} className="accent-accent-500" /> Auto-renew</label>
          <Field label="Renewal notice (days)"><input type="number" min={1} max={365} value={renewalNoticeDays} onChange={(e) => setRenewalNoticeDays(Number(e.target.value) || 30)} className="input" /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim()} onClick={() => void save()}><Check className="size-4" /> Create</button>
        </div>
      </div>
    </Modal>
  );
}

function AnalyzeModal({ contract, onClose, onDone }: { contract: Contract; onClose: () => void; onDone: (clauses: unknown[]) => void }) {
  const [text, setText] = useState(`This Services Agreement is made between Qorvexa Demo Inc ("Provider") and ${contract.accountName ?? "the Customer"} ("Customer").\n\nEffective date: ${new Date().toISOString().slice(0, 10)}. The initial term is 12 months, ending on ${contract.endDate ? new Date(contract.endDate).toISOString().slice(0, 10) : "December 31, 2027"}. This agreement shall auto-renew for successive terms unless either party gives 60 days written notice. Payment terms are Net-30. This agreement is governed by the laws of Delaware. The annual fee is $48,000.`);
  const [clauses, setClauses] = useState<unknown[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const d = await post<{ clauses: unknown[]; summary: string }>(`/api/contracts/${contract.id}/analyze`, { text });
      setClauses(d.clauses);
      setSummary(d.summary);
      onDone(d.clauses);
    } catch (e: any) { alert(e?.message ?? "Analysis failed"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Contract intelligence — ${contract.contractNumber}`} wide>
      <div className="space-y-3">
        <Field label="Contract text">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} className="input font-mono text-xs" />
        </Field>
        <div className="flex justify-end">
          <button className="btn-primary" disabled={busy || text.trim().length < 10} onClick={() => void run()}>
            {busy ? <Spinner className="size-4" /> : <Sparkles className="size-4" />} Extract clauses
          </button>
        </div>
        {summary && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{summary}</p>}
        {clauses && (
          <div className="space-y-1.5">
            {(clauses as { key: string; label: string; value: string; source: string }[]).map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                <span className="font-medium text-white">{c.label}</span>
                <span className="text-slate-300">{c.value}</span>
                <span className="ml-auto text-[10px] text-slate-600">{c.source}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Subscriptions ───────────────────────────────────────────────────────────
function SubscriptionsTab({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<Subscription[]>([]);
  const [creating, setCreating] = useState(false);
  const load = () => void api<{ items: Subscription[] }>("/api/subscriptions").then((d) => setItems(d.items)).catch(() => {});
  useEffect(load, []);
  const act = async (s: Subscription, action: string) => {
    try { await post(`/api/subscriptions/${s.id}/${action}`, {}); load(); } catch (e: any) { alert(e?.message ?? "Failed"); }
  };
  const remove = async (s: Subscription) => {
    if (!confirm(`Delete subscription "${s.name}"?`)) return;
    try { await del(`/api/subscriptions/${s.id}`); load(); } catch (e: any) { alert(e?.message ?? "Delete failed"); }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">MRR contribution = unit price × quantity ÷ period months — derived live.</p>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New subscription</button>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<RefreshCw className="size-8" />} title="No subscriptions" hint="Subscriptions drive MRR — the ticker raises renewal invoices." />}
      <div className="space-y-2">
        {items.map((s) => (
          <div key={s.id} className="card flex flex-wrap items-center gap-2 p-4">
            <span className="text-sm font-semibold text-white">{s.name}</span>
            {tierBadge(s.status)}
            <span className="text-[11px] text-slate-500">{s.productName} · {s.accountName ?? "—"}</span>
            <span className="chip bg-white/[0.05] text-[10px] text-slate-400">{s.billingPeriod}</span>
            <span className="ml-auto flex items-center gap-3 text-xs">
              <span className="text-slate-400">{s.quantity}× {money(s.unitPrice)}/{s.billingPeriod}</span>
              <span className="tabular-nums font-semibold text-emerald-300">{money(s.mrr)}/mo</span>
              <span className="text-[11px] text-slate-600">next {s.currentPeriodEnd ? date(s.currentPeriodEnd) : "—"}</span>
            </span>
            {isAdmin && ["active", "past_due"].includes(s.status) && (
              <div className="flex gap-1.5">
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => void act(s, "renew")} title="Raise the next invoice now"><Zap className="size-3.5" /> Renew</button>
                <button className="btn-ghost !py-1.5 text-xs text-rose-400" onClick={() => void act(s, "cancel")}>Cancel</button>
              </div>
            )}
            {isAdmin && ["cancelled", "expired"].includes(s.status) && <button className="btn-ghost !py-1.5 text-xs" onClick={() => void remove(s)}><Trash2 className="size-3.5" /></button>}
          </div>
        ))}
      </div>
      {creating && <SubscriptionModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </div>
  );
}

function SubscriptionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [productId, setProductId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [billingPeriod, setBillingPeriod] = useState("monthly");
  const [unitPrice, setUnitPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [autoRenew, setAutoRenew] = useState(true);
  useEffect(() => {
    void api<{ items: Product[] }>("/api/products").then((d) => { setProducts(d.items); setProductId((p) => p || (d.items[0]?.id ?? "")); });
    void api<{ items: { id: string; name: string }[] }>("/api/accounts?pageSize=100").then((d) => setAccounts(d.items));
  }, []);
  const periodMonths = { monthly: 1, quarterly: 3, annual: 12 }[billingPeriod] ?? 1;
  const price = Number(unitPrice) || products.find((p) => p.id === productId)?.listPrice || 0;
  const save = async () => {
    try {
      await post("/api/subscriptions", {
        name: name.trim(), productId, accountId: accountId || undefined, billingPeriod,
        unitPrice: Number(unitPrice) || price, quantity: Number(quantity) || 1, autoRenew,
      });
      onSaved();
    } catch (e: any) { alert(e?.message ?? "Create failed"); }
  };
  return (
    <Modal open onClose={onClose} title="New subscription">
      <div className="space-y-3">
        <Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northwind — Platform (Monthly)" className="input" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Product">
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input">
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Account">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input"><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Period">
            <select value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)} className="input">
              {["monthly", "quarterly", "annual"].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Unit price"><input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder={String(price || "")} className="input" /></Field>
          <Field label="Quantity"><input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="input" /></Field>
        </div>
        <div className="flex items-center justify-between text-xs">
          <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} className="accent-accent-500" /> Auto-renew</label>
          <span className="tabular-nums text-emerald-300">MRR ≈ {money((price * (Number(quantity) || 1)) / periodMonths)}/mo</span>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim() || !productId} onClick={() => void save()}><Check className="size-4" /> Create</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Billing (invoices + payments + tick) ────────────────────────────────────
function BillingTab({ isAdmin }: { isAdmin: boolean }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [tickResult, setTickResult] = useState<string | null>(null);
  const load = () => {
    void api<{ items: Invoice[] }>("/api/invoices").then((d) => setInvoices(d.items)).catch(() => {});
    void api<{ items: Payment[] }>("/api/payments").then((d) => setPayments(d.items)).catch(() => {});
  };
  useEffect(load, []);
  const act = async (i: Invoice, action: string, body?: Record<string, unknown>) => {
    try { await post(`/api/invoices/${i.id}/${action}`, body ?? {}); load(); } catch (e: any) { alert(e?.message ?? "Failed"); }
  };
  const refund = async (p: Payment) => {
    if (!confirm(`Refund ${money(p.amount)}?`)) return;
    try { await post(`/api/payments/${p.id}/refund`, {}); load(); } catch (e: any) { alert(e?.message ?? "Refund failed"); }
  };
  const tick = async () => {
    try {
      const d = await post<{ tick: { renewed: number; issued: number; overdue: number; contractWarnings: number; contractsExpired: number; subsExpired: number } }>("/api/revenue/tick", {});
      setTickResult(`renewed ${d.tick.renewed} · invoices issued ${d.tick.issued} · overdue ${d.tick.overdue} · contract warnings ${d.tick.contractWarnings} · expired ${d.tick.contractsExpired} contract(s), ${d.tick.subsExpired} sub(s)`);
      load();
    } catch (e: any) { alert(e?.message ?? "Tick failed"); }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">The ticker runs every 60s — this button runs the same engine now.</p>
          <button className="btn-primary" onClick={() => void tick()}><Zap className="size-4" /> Run billing tick</button>
        </div>
      )}
      {tickResult && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">engine pass: {tickResult}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Receipt className="size-4 text-accent-400" /> Invoices</h3>
          <div className="space-y-2">
            {invoices.length === 0 && <EmptyState icon={<Receipt className="size-8" />} title="No invoices" hint="Renewals raise invoices automatically; manual drafts can be issued." />}
            {invoices.map((i) => (
              <div key={i.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-white">{i.invoiceNumber}</span>
                  {tierBadge(i.status)}
                  <span className="text-[11px] text-slate-500">{i.accountName ?? "—"}</span>
                  <span className="ml-auto flex items-center gap-2 text-sm">
                    <span className="tabular-nums font-semibold text-emerald-300">{money(i.total)}</span>
                    <span className="text-[11px] text-slate-600">due {i.dueDate ? date(i.dueDate) : "—"}</span>
                    {i.dunningAttempts > 0 && <Badge tone="amber">{i.dunningAttempts} dunning</Badge>}
                  </span>
                </div>
                {i.payments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {i.payments.map((p) => (
                      <span key={p.id} className={`chip ${p.status === "succeeded" ? "bg-emerald-500/10 text-emerald-300" : p.status === "failed" ? "bg-rose-500/10 text-rose-300" : "bg-amber-500/10 text-amber-300"}`}>
                        {money(p.amount)} · {p.status}{p.failureReason ? ` · ${p.failureReason}` : ""}
                      </span>
                    ))}
                  </div>
                )}
                {isAdmin && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {i.status === "draft" && <button className="btn-primary !py-1.5 text-xs" onClick={() => void act(i, "issue")}><Send className="size-3.5" /> Issue</button>}
                    {["issued", "overdue"].includes(i.status) && <button className="btn-primary !py-1.5 text-xs" onClick={() => setPaying(i)}><CreditCard className="size-3.5" /> Record payment</button>}
                    {["draft", "issued", "overdue"].includes(i.status) && <button className="btn-ghost !py-1.5 text-xs text-rose-400" onClick={() => void act(i, "void")}>Void</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Banknote className="size-4 text-emerald-400" /> Payments</h3>
          <div className="space-y-2">
            {payments.length === 0 && <EmptyState icon={<Banknote className="size-8" />} title="No payments" hint="Record payments against invoices — success settles, failure feeds dunning." />}
            {payments.map((p) => (
              <div key={p.id} className="card flex flex-wrap items-center gap-2 p-3">
                <span className="text-xs font-medium text-white">{p.invoiceNumber ?? "—"}</span>
                <Badge tone={p.status === "succeeded" ? "green" : p.status === "failed" ? "rose" : "amber"}>{p.status}</Badge>
                <span className="text-[11px] text-slate-500">{p.method}</span>
                {p.refundOf && <span className="text-[10px] text-slate-600">refund of {p.refundOf.slice(0, 8)}</span>}
                <span className="ml-auto text-sm tabular-nums text-emerald-300">{money(p.amount)}</span>
                <span className="text-[11px] text-slate-600">{p.paidAt ? timeAgo(p.paidAt) : timeAgo(p.createdAt)}</span>
                {isAdmin && p.status === "succeeded" && <button className="btn-ghost !py-1 text-xs text-rose-400" onClick={() => void refund(p)}>Refund</button>}
              </div>
            ))}
          </div>
        </div>
      </div>
      {paying && (
        <PayModal
          invoice={paying}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); load(); }}
        />
      )}
    </div>
  );
}

function PayModal({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(invoice.total));
  const [method, setMethod] = useState("card");
  const [fail, setFail] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await post(`/api/invoices/${invoice.id}/pay`, { amount: Number(amount) || 0, method, fail });
      onDone();
    } catch (e: any) { alert(e?.message ?? "Payment failed"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Record payment — ${invoice.invoiceNumber}`}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" required><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" /></Field>
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="input">
              {["card", "bank", "other"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} className="accent-accent-500" />
          Simulate failure (card declined) — feeds the dunning loop
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || Number(amount) <= 0} onClick={() => void submit()}>
            {busy ? <Spinner className="size-4" /> : fail ? <CircleX className="size-4" /> : <Check className="size-4" />} {fail ? "Record failure" : "Charge"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
