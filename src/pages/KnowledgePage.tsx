import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Pencil, Trash2, Eye, BookOpen } from "lucide-react";
import { api, del, patch, post, ApiError } from "../lib/api";
import { Badge, EmptyState, Field, Modal, Spinner } from "../components/ui";
import { timeAgo } from "../lib/format";
import { useSession } from "../App";

type Article = {
  id: string;
  title: string;
  slug: string;
  body: string;
  category: string;
  tags: string[];
  published: boolean;
  authorName: string | null;
  viewCount: number;
  updatedAt: string;
};

const CATEGORIES = ["general", "billing", "technical", "account", "other"];

export default function KnowledgePage() {
  const { user } = useSession();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<Article | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      const d = await api<{ items: Article[] }>(`/api/knowledge?${params}`);
      setArticles(d.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load articles");
    } finally {
      setLoading(false);
    }
  }, [q, category]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (a: Article) => {
    if (!confirm(`Delete article "${a.title}"?`)) return;
    try {
      await del(`/api/knowledge/${a.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete");
    }
  };

  const published = articles.filter((a) => a.published).length;

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Knowledge base</h1>
          <p className="text-sm text-slate-500">{articles.length} articles · {published} published · published articles appear in the public portal.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles…" className="input w-48 pl-9" />
          </div>
          <select className="input w-40" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {user?.role === "admin" && (
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New article</button>
          )}
        </div>
      </div>
      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-44" />)}
        </div>
      ) : articles.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-8" />} title="No articles yet" hint="Write up FAQs and how-tos — published articles show up on your public portal." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((a) => (
            <div key={a.id} className="card group flex flex-col p-5 transition-all hover:-translate-y-0.5 hover:border-accent-500/30">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="blue">{a.category}</Badge>
                <Badge tone={a.published ? "green" : "default"}>{a.published ? "published" : "draft"}</Badge>
                {a.tags.slice(0, 2).map((t) => <Badge key={t} tone="violet">{t}</Badge>)}
              </div>
              <h3 className="text-sm font-semibold text-white">{a.title}</h3>
              <p className="mt-1 line-clamp-3 flex-1 text-xs text-slate-500">{a.body}</p>
              <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3 text-[11px] text-slate-600">
                <span className="flex items-center gap-1"><Eye className="size-3" /> {a.viewCount} views</span>
                <span>{a.authorName ?? "—"} · {timeAgo(a.updatedAt)}</span>
                <div className="flex gap-1">
                  {user?.role === "admin" && (
                    <>
                      <button onClick={() => setEditing(a)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><Pencil className="size-3.5" /></button>
                      <button onClick={() => void remove(a)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ArticleModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function ArticleModal({ initial, onClose, onDone }: { initial: Article | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    category: initial?.category ?? "general",
    body: initial?.body ?? "",
    tags: (initial?.tags ?? []).join(", "),
    published: initial?.published ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!form.title.trim()) { setError("Title is required"); return; }
    setBusy(true); setError(null);
    try {
      const body = {
        title: form.title.trim(),
        category: form.category,
        body: form.body,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        published: form.published,
      };
      if (initial) await patch(`/api/knowledge/${initial.id}`, body);
      else await post("/api/knowledge", body);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? "Edit article" : "New article"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Title" required><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Category">
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Body" required><textarea className="input min-h-48" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Write the answer…" /></Field>
        <div className="flex items-center gap-4">
          <Field label="Tags (comma separated)"><input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="billing, refunds" /></Field>
          <label className="flex cursor-pointer items-center gap-2 pt-5 text-sm text-slate-300">
            <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} className="size-4 accent-accent-500" />
            Published (visible in portal)
          </label>
        </div>
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner className="size-4" /> : initial ? "Save changes" : "Create article"}</button>
        </div>
      </div>
    </Modal>
  );
}
