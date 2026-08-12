import { useCallback, useEffect, useState } from "react";
import { api, get, post, del } from "../lib/api";
import { Badge, EmptyState, Spinner } from "../components/ui";
import { dateTime } from "../lib/format";
import { useSession } from "../App";
import { Package, Download, Trash2, RefreshCw, ShieldCheck, FileJson } from "lucide-react";

type ExportRow = {
  id: string;
  status: string;
  path: string | null;
  sizeBytes: number;
  note: string | null;
  error: string | null;
  requestedBy: string;
  createdAt: string;
  completedAt: string | null;
};

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export default function PortabilityPage() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin" || user?.role === "manager";
  const [items, setItems] = useState<ExportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await get<{ items: ExportRow[] }>("/api/portability");
      setItems(d.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doExport = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await post<{ export: ExportRow; counts: Record<string, number> }>("/api/portability/export", {});
      const total = Object.values(res.counts).reduce((s, n) => s + n, 0);
      setNotice({ ok: true, text: `Export complete — ${Object.keys(res.counts).length} collections, ${total.toLocaleString()} rows bundled.` });
      await load();
    } catch (e: any) {
      setNotice({ ok: false, text: e?.message ?? "Export failed" });
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (id: string) => {
    await del(`/api/portability/${id}`);
    await load();
  };

  const download = (row: ExportRow) => {
    const a = document.createElement("a");
    a.href = `/api/portability/${row.id}/download`;
    a.download = row.path?.split("/").pop() ?? "portability.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
            <Package className="size-6 text-accent-400" /> Portability
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            The right to data portability — one click exports your entire workspace (every collection in this environment, plus the audit trail and event log) into a single downloadable JSON bundle.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => void doExport()} disabled={busy} className="btn">
            {busy ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />} {busy ? "Bundling…" : "Export full tenant"}
          </button>
        )}
      </div>

      {notice && (
        <div className={`rounded-xl border px-4 py-2.5 text-xs ${notice.ok ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-rose-500/20 bg-rose-500/10 text-rose-300"}`}>
          {notice.text}
        </div>
      )}

      {!isAdmin && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          <ShieldCheck className="size-4 shrink-0" />
          Only admins can request or delete exports. You can view the export history.
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-14" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={<FileJson className="size-10" />} title="No exports yet" hint="Run the export to produce your first right-to-portability bundle — it includes every collection in this environment." />
      ) : (
        <div className="card overflow-hidden">
          <div className="border-b border-white/[0.06] px-5 py-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Export history</div>
          <div className="divide-y divide-white/[0.03]">
            {items.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <FileJson className="size-5 shrink-0 text-accent-400/70" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-white">{row.path?.split("/").pop() ?? "bundle"}</span>
                    <Badge tone={row.status === "success" ? "green" : row.status === "running" ? "blue" : "rose"}>{row.status}</Badge>
                  </div>
                  <div className="text-xs text-slate-500">{dateTime(row.createdAt)} · {fmtBytes(row.sizeBytes)}</div>
                  {row.error && <div className="mt-0.5 text-xs text-rose-400">{row.error}</div>}
                </div>
                {row.status === "success" && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => download(row)} className="btn-ghost text-xs"><Download className="size-3.5" /> Download</button>
                    {isAdmin && (
                      <button onClick={() => void doDelete(row.id)} className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400" title="Purge export">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                )}
                {row.status === "running" && <RefreshCw className="size-4 animate-spin text-slate-500" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
