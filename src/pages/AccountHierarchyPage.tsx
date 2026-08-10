import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, ChevronDown, Building2, ArrowLeft } from "lucide-react";
import { api } from "../lib/api";
import { Badge, Spinner, EmptyState } from "../components/ui";

type Account = { id: string; name: string; industry: string | null; tier: string | null; employees: number | null; parentId: string | null; website: string | null };

export default function AccountHierarchyPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    void api<{ items: Account[] }>("/api/accounts?pageSize=500").then((d) => setAccounts(d.items)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const { byParent, roots, depth } = useMemo(() => {
    const map = new Map<string | null, Account[]>();
    for (const a of accounts) {
      const key = a.parentId;
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    // depth for default expansion (top 2 levels expanded)
    const d = new Map<string, number>();
    const walk = (parentId: string | null, level: number) => {
      for (const a of map.get(parentId) ?? []) {
        d.set(a.id, level);
        walk(a.id, level + 1);
      }
    };
    walk(null, 0);
    return { byParent: map, roots: map.get(null) ?? [], depth: d };
  }, [accounts]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (a: Account) => {
    const children = byParent.get(a.id) ?? [];
    const isCollapsed = collapsed.has(a.id);
    const defaultExpanded = (depth.get(a.id) ?? 0) < 2;
    const show = children.length > 0 && !isCollapsed && defaultExpanded;
    return (
      <div key={a.id}>
        <div
          className="group flex items-center gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-white/[0.04]"
          style={{ marginLeft: `${depth.get(a.id) ?? 0} * 0` }}
        >
          <span className="w-4">
            {children.length > 0 ? (
              <button onClick={() => toggle(a.id)} className="text-slate-500 hover:text-white">
                {isCollapsed || !defaultExpanded ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
            ) : <span className="inline-block size-4" />}
          </span>
          <button onClick={() => navigate(`/accounts?id=${a.id}`)} className="min-w-0 flex-1 text-left">
            <span className="flex items-center gap-2 text-sm font-medium text-white hover:text-accent-400">
              <Building2 className="size-3.5 text-slate-500" />
              {a.name}
              {a.tier && <Badge tone={a.tier === "Enterprise" ? "violet" : a.tier === "Mid-Market" ? "blue" : "default"}>{a.tier}</Badge>}
              {typeof a.employees === "number" && <span className="text-xs text-slate-600">{a.employees} employees</span>}
            </span>
          </button>
          {children.length > 0 && <span className="text-xs text-slate-600">{children.length} child{children.length > 1 ? "ren" : ""}</span>}
        </div>
        {show && <div className="border-l border-white/[0.06] pl-4 ml-[13px]">{children.map(renderNode)}</div>}
      </div>
    );
  };

  const orphans = accounts.filter((a) => a.parentId && !accounts.some((x) => x.id === a.parentId));

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Account hierarchy</h1>
          <p className="text-sm text-slate-500">{accounts.length} accounts · parent/child via <span className="font-mono text-accent-400">parentId</span> — cycles are rejected server-side.</p>
        </div>
        <Link to="/accounts" className="btn-ghost ml-auto"><ArrowLeft className="size-4" /> Back to accounts</Link>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center"><Spinner className="size-6" /></div>
      ) : accounts.length === 0 ? (
        <EmptyState title="No accounts yet" hint="Create accounts and set a parent to build the hierarchy." />
      ) : (
        <div className="card p-4">
          {roots.length > 0 ? roots.map(renderNode) : (
            <div className="p-6 text-center text-sm text-slate-600">
              No root accounts — every account has a parent. {orphans.length > 0 && `Orphaned references: ${orphans.length}.`}
            </div>
          )}
          {orphans.length > 0 && roots.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
              ⚠ {orphans.length} account(s) reference a parent that doesn't exist — they aren't shown in the tree. Reassign their parent from the account page.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
