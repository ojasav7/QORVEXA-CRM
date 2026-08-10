import { useCallback, useEffect, useMemo, useState } from "react";
import { Upload, FileUp, Play, CheckCircle2, AlertTriangle, GitMerge, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Badge, Field, Spinner } from "../components/ui";
import { useSession } from "../App";

const OBJECT_TYPES = ["contact", "account", "lead", "opportunity", "task"];

const SAMPLES: Record<string, string> = {
  contact: "firstName,lastName,email,title,phone\nAda,Lovelace,ada@acme.com,Analyst,+1 555 0100\nGrace,Hopper,grace@acme.com,Engineer,+1 555 0101",
  account: "name,industry,tier,employees\nAcme Corp,Technology,Enterprise,1200\nBeta Ltd,Finance,SMB,80",
  lead: "firstName,lastName,email,company,source\nNikola,Tesla,nikola@volt.example,Volt Industries,Website",
  opportunity: "name,amount,stage\nAcme — Q4 Expansion,50000,qualified",
  task: "title,priority,status,dueAt\nCall Acme,high,todo,2026-12-01",
};

type DryRunRow = {
  row: number;
  status: "new" | "duplicate" | "failed";
  existingId?: string;
  matchedOn?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  error?: string;
};

type Resolution = { mode: "create" | "merge"; targetId?: string; fields?: string[] };

export default function ImportPage() {
  const { environment } = useSession();
  const [objectType, setObjectType] = useState("contact");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<DryRunRow[] | null>(null);
  const [previewCounts, setPreviewCounts] = useState<{ new: number; duplicate: number } | null>(null);
  const [resolutions, setResolutions] = useState<Record<number, Resolution>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ imported: number; merged: number; duplicates: number; failed: number } | null>(null);

  const runPreview = async () => {
    setBusy("preview"); setError(null); setSummary(null);
    try {
      const d = await api<{ result: { rows: DryRunRow[]; counts: { new: number; duplicate: number } } }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ objectType, csv, dryRun: true }),
      });
      setPreview(d.result.rows);
      setPreviewCounts(d.result.counts);
      // Default: merge duplicates into their auto-detected target, create the rest.
      const res: Record<number, Resolution> = {};
      for (const r of d.result.rows) {
        if (r.status === "duplicate" && r.existingId) res[r.row] = { mode: "merge", targetId: r.existingId, fields: Object.keys(r.changes ?? {}) };
      }
      setResolutions(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  };

  const setMode = (row: number, mode: "create" | "merge", targetId?: string) =>
    setResolutions((prev) => ({ ...prev, [row]: { ...prev[row], mode, ...(mode === "merge" ? { targetId } : {}) } }));

  const toggleField = (row: number, field: string) =>
    setResolutions((prev) => {
      const cur = prev[row];
      if (cur?.mode !== "merge") return prev;
      const fields = cur.fields ?? [];
      return { ...prev, [row]: { ...cur, fields: fields.includes(field) ? fields.filter((f) => f !== field) : [...fields, field] } };
    });

  const runImport = async () => {
    setBusy("run"); setError(null);
    try {
      const d = await api<{ imported: number; merged: number; duplicates: number; failed: number }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ objectType, csv, merge: resolutions }),
      });
      setSummary({ imported: d.imported, merged: d.merged, duplicates: d.duplicates, failed: d.failed });
      setPreview(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  };

  const changedFields = useMemo(() => {
    const seen = new Set<string>();
    for (const r of preview ?? []) for (const k of Object.keys(r.changes ?? {})) seen.add(k);
    return [...seen];
  }, [preview]);

  const fileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  }, []);

  return (
    <div className="animate-fade-up mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-white">Import</h1>
        <p className="text-sm text-slate-500">
          Paste or upload CSV — first row must be field keys. Preview flags duplicates, then resolve each row (create or merge) before anything is written.{" "}
          <Badge tone="blue">env: {environment}</Badge>
        </p>
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Object type">
            <select className="input w-44" value={objectType} onChange={(e) => { setObjectType(e.target.value); setPreview(null); setSummary(null); }}>
              {OBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <label className="btn-ghost">
            <FileUp className="size-4" /> Upload .csv
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={fileInput} />
          </label>
          <button className="btn-ghost" onClick={() => setCsv(SAMPLES[objectType] ?? "")}>
            Load sample
          </button>
          <button className="btn-primary ml-auto" onClick={runPreview} disabled={busy !== null || csv.trim().length < 3}>
            {busy === "preview" ? <Spinner className="size-4" /> : <Play className="size-4" />} Preview import
          </button>
        </div>

        <div className="mt-4">
          <textarea
            className="input min-h-40 font-mono text-xs leading-relaxed"
            placeholder={`firstName,lastName,email,title\nAda,Lovelace,ada@acme.com,Analyst`}
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setPreview(null); setSummary(null); }}
          />
        </div>

        {error && <div className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
      </div>

      {previewCounts && !summary && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <Badge tone="green">{previewCounts.new} new</Badge>
          <Badge tone="amber">{previewCounts.duplicate} duplicate</Badge>
          <span className="ml-auto text-slate-500">Resolve each duplicate below, then run.</span>
          <button className="btn-primary" onClick={runImport} disabled={busy !== null}>
            {busy === "run" ? <Spinner className="size-4" /> : <Upload className="size-4" />} Run import
          </button>
        </div>
      )}

      {preview && preview.length > 0 && (
        <div className="card mt-4 divide-y divide-white/[0.04]">
          {preview.map((r) => {
            const res = resolutions[r.row];
            const isMerge = res?.mode === "merge";
            return (
              <div key={r.row} className="px-6 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xs text-slate-500">Row {r.row}</span>
                  {r.status === "new" ? <Badge tone="green">new</Badge> : r.status === "duplicate" ? <Badge tone="amber">duplicate{r.matchedOn ? ` · ${r.matchedOn}` : ""}</Badge> : <Badge tone="rose">failed</Badge>}
                  {r.status === "duplicate" && (
                    <div className="ml-auto flex items-center gap-2">
                      <button className={`btn-ghost !px-3 !py-1 !text-xs ${!isMerge ? "!bg-ink-700 !text-white" : ""}`} onClick={() => setMode(r.row, "create")}>
                        Create new
                      </button>
                      <button className={`btn-ghost !px-3 !py-1 !text-xs ${isMerge ? "!bg-accent-500/25 !text-accent-300" : ""}`} onClick={() => setMode(r.row, "merge", r.existingId)}>
                        <GitMerge className="size-3.5" /> Merge into existing
                      </button>
                      {isMerge && (
                        <span className="font-mono text-xs text-slate-500" title={res.targetId}>
                          → {res.targetId?.slice(-6)}
                        </span>
                      )}
                    </div>
                  )}
                  {r.error && <span className="text-xs text-rose-400">{r.error}</span>}
                </div>
                {r.status === "duplicate" && isMerge && r.changes && Object.keys(r.changes).length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-500">
                          <th className="py-1 pr-4 font-medium">Field</th>
                          <th className="py-1 pr-4 font-medium">From</th>
                          <th className="py-1 pr-4 font-medium">To</th>
                          <th className="py-1 font-medium">Merge?</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {Object.entries(r.changes).map(([field, c]) => {
                          const on = res.fields?.includes(field) ?? true;
                          return (
                            <tr key={field} className="border-t border-white/[0.04]">
                              <td className="py-1.5 pr-4 text-white">{field}</td>
                              <td className="py-1.5 pr-4 text-slate-500">{String(c.from ?? "") || "—"}</td>
                              <td className="py-1.5 pr-4 text-accent-300">{String(c.to ?? "") || "—"}</td>
                              <td className="py-1.5">
                                <button
                                  onClick={() => toggleField(r.row, field)}
                                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${on ? "bg-accent-500/25 text-accent-300" : "bg-white/[0.06] text-slate-500"}`}
                                >
                                  {on ? "on" : "off"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {r.status === "duplicate" && isMerge && (!r.changes || Object.keys(r.changes).length === 0) && (
                  <p className="mt-2 text-xs text-slate-500">No field differences detected for this row — merge will be a no-op.</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {summary && (
        <div className="card mt-4 p-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-mint-400" />
            <h2 className="text-base font-semibold text-white">Import complete</h2>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Created", summary.imported, "text-mint-400"],
              ["Merged", summary.merged, "text-accent-300"],
              ["Duplicates", summary.duplicates, "text-amber-400"],
              ["Failed", summary.failed, "text-rose-400"],
            ].map(([label, val, tone]) => (
              <div key={label as string} className="rounded-xl bg-ink-800/60 p-4 text-center">
                <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{val}</div>
                <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">{label}</div>
              </div>
            ))}
          </div>
          <button className="btn-ghost mt-4" onClick={() => { setPreview(null); setSummary(null); setCsv(""); }}>
            <X className="size-4" /> Start another import
          </button>
        </div>
      )}

      {changedFields.length > 0 && (
        <p className="mt-3 text-xs text-slate-600">
          {changedFields.length} changed field{changedFields.length > 1 ? "s" : ""}: <span className="font-mono">{changedFields.join(", ")}</span>
        </p>
      )}

      {preview === null && !summary && !error && (
        <div className="mt-6 flex items-center gap-2 text-xs text-slate-600">
          <AlertTriangle className="size-3.5" />
          Merges are field-scoped and show diffs before anything is written — nothing changes until you run the import.
        </div>
      )}
    </div>
  );
}
