import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { api, del, patch, post, ApiError } from "../lib/api";
import { Badge, EmptyState, Field, Modal, Spinner } from "../components/ui";
import { date, timeAgo } from "../lib/format";

type Task = {
  id: string;
  title: string;
  description?: string | null;
  dueAt: string | null;
  status: string;
  priority: string;
  createdAt: string;
};
type Note = { id: string; body: string; createdAt: string };

const PRIORITY_TONE: Record<string, string> = { high: "rose", medium: "amber", low: "default" };

export default function ActivitiesPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, n] = await Promise.all([
        api<{ items: Task[] }>("/api/tasks?pageSize=100"),
        api<{ items: Note[] }>("/api/notes?pageSize=50"),
      ]);
      setTasks(t.items);
      setNotes(n.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (task: Task) => {
    const next = task.status === "done" ? "todo" : "done";
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    try {
      await patch(`/api/tasks/${task.id}`, { status: next });
    } catch { /* rollback handled by reload */ }
  };

  const removeTask = async (id: string) => {
    setTasks((ts) => ts.filter((t) => t.id !== id));
    await del(`/api/tasks/${id}`).catch(() => {});
  };

  const overdue = tasks.filter((t) => t.status !== "done" && t.dueAt && new Date(t.dueAt) < new Date());
  const upcoming = tasks.filter((t) => t.status !== "done" && (!t.dueAt || new Date(t.dueAt) >= new Date()));
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Activities</h1>
          <p className="text-sm text-slate-500">{tasks.filter((t) => t.status !== "done").length} open · {overdue.length} overdue · {notes.length} notes</p>
        </div>
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)}><Plus className="size-4" /> New task</button>
      </div>

      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {loading ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="size-6" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {overdue.length > 0 && <TaskGroup title="⚠ Overdue" tasks={overdue} tone="rose" toggle={toggle} onRemove={removeTask} />}
            <TaskGroup title="Upcoming" tasks={upcoming} toggle={toggle} onRemove={removeTask} />
            <TaskGroup title="Completed" tasks={done} toggle={toggle} onRemove={removeTask} dim />
          </div>

          {/* Notes */}
          <div className="card p-6">
            <h2 className="mb-4 text-sm font-semibold text-white">Recent notes</h2>
            <div className="space-y-3">
              {notes.map((n) => (
                <div key={n.id} className="rounded-xl border border-white/[0.05] bg-ink-800/50 px-4 py-3">
                  <p className="text-sm text-slate-300">{n.body}</p>
                  <p className="mt-1.5 text-[11px] text-slate-600">{timeAgo(n.createdAt)}</p>
                </div>
              ))}
              {notes.length === 0 && <p className="text-xs text-slate-600">No notes yet — add them from a record's detail view.</p>}
            </div>
          </div>
        </div>
      )}

      {creating && (
        <NewTaskModal onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await load(); }} />
      )}
    </div>
  );
}

function TaskGroup({ title, tasks, toggle, onRemove, tone = "default", dim }: {
  title: string; tasks: Task[]; toggle: (t: Task) => void; onRemove: (id: string) => void; tone?: string; dim?: boolean;
}) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <h2 className={`mb-3 text-xs font-semibold uppercase tracking-wider ${tone === "rose" ? "text-rose-400" : "text-slate-500"}`}>
        {title} · {tasks.length}
      </h2>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className={`card flex items-center gap-3 px-4 py-3.5 ${dim ? "opacity-50" : ""}`}>
            <button onClick={() => toggle(task)} className="shrink-0 text-slate-500 transition-colors hover:text-mint-400">
              {task.status === "done" ? <CheckCircle2 className="size-5 text-mint-400" /> : <Circle className="size-5" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-medium ${task.status === "done" ? "text-slate-500 line-through" : "text-white"}`}>{task.title}</p>
              <p className="text-[11px] text-slate-500">
                {task.priority !== "medium" && <Badge tone={(PRIORITY_TONE[task.priority] as any) ?? "default"}>{task.priority}</Badge>}{" "}
                {task.dueAt && <span className="tabular-nums">{date(task.dueAt)}</span>}
              </p>
            </div>
            <button onClick={() => onRemove(task.id)} className="rounded-lg p-1.5 text-slate-600 hover:bg-rose-500/15 hover:text-rose-400">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: "", priority: "medium", dueAt: "" });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      await post("/api/tasks", { ...form, dueAt: form.dueAt || null });
      onCreated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New task">
      <div className="space-y-4">
        <Field label="Title" required><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Priority">
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </Field>
          <Field label="Due date"><input className="input" type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.title.trim()}>{busy ? <Spinner className="size-4" /> : "Create task"}</button>
        </div>
      </div>
    </Modal>
  );
}
