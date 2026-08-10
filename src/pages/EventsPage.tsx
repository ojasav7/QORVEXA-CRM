import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { Badge, EmptyState, Spinner } from "../components/ui";
import { dateTime } from "../lib/format";

type Event = { id: string; type: string; entity: string; entityId: string; actorId: string; payload: Record<string, any>; createdAt: string };

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items: Event[]; total: number }>(
        `/api/events?pageSize=100${typeFilter ? `&type=${encodeURIComponent(typeFilter)}` : ""}`
      );
      setEvents(d.items);
      setTotal(d.total);
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => { void load(); }, [load]);

  const types = Array.from(new Set(events.map((e) => e.type))).slice(0, 12);

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Event bus</h1>
          <p className="text-sm text-slate-500">{total} events · every state change is emitted, persisted, and webhook-deliverable</p>
        </div>
        <div className="ml-auto flex gap-2">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(typeFilter === t ? "" : t)}
              className={`chip transition-colors ${typeFilter === t ? "bg-accent-500/25 text-accent-300 border border-accent-500/30" : "bg-white/[0.06] text-slate-400 hover:text-white"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="size-6" /></div>
      ) : events.length === 0 ? (
        <div className="card"><EmptyState title="No events yet" hint="Events fire on every record change — create or edit a deal to see them stream in." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y divide-white/[0.04]">
            {events.map((e) => (
              <div key={e.id} className="px-5 py-4 transition-colors hover:bg-white/[0.02]">
                <button className="flex w-full items-center gap-3 text-left" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                  <span className="size-2 shrink-0 rounded-full bg-accent-400/60" />
                  <span className="font-mono text-sm text-accent-300">{e.type}</span>
                  <span className="text-xs text-slate-500">on <span className="font-mono">{e.entity}</span></span>
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-600">{dateTime(e.createdAt)}</span>
                </button>
                {expanded === e.id && (
                  <pre className="mt-3 overflow-x-auto rounded-xl bg-ink-950/70 border border-white/[0.05] p-4 font-mono text-xs text-slate-400">
{JSON.stringify({ id: e.id, entityId: e.entityId, actorId: e.actorId, payload: e.payload }, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
