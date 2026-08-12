import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Rocket, ExternalLink, Palette } from "lucide-react";
import { api, del, patch, post, ApiError } from "../lib/api";
import { Badge, Field, Modal, Spinner, EmptyState } from "../components/ui";
import { timeAgo } from "../lib/format";
import { useSession } from "../App";

type LandingPage = {
  id: string;
  name: string;
  slug: string;
  headline: string;
  subtext: string | null;
  ctaLabel: string;
  successMessage: string;
  theme: string;
  campaignId: string | null;
  fields: { key: string; enabled: boolean }[];
  active: boolean;
  createdAt: string;
};
type Campaign = { id: string; name: string };

const THEMES: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  indigo: { label: "Indigo", bg: "from-indigo-500 to-violet-600", text: "text-indigo-300", ring: "bg-indigo-500" },
  emerald: { label: "Emerald", bg: "from-emerald-500 to-teal-600", text: "text-emerald-300", ring: "bg-emerald-500" },
  rose: { label: "Rose", bg: "from-rose-500 to-pink-600", text: "text-rose-300", ring: "bg-rose-500" },
  amber: { label: "Amber", bg: "from-amber-500 to-orange-600", text: "text-amber-300", ring: "bg-amber-500" },
  slate: { label: "Slate", bg: "from-slate-500 to-slate-700", text: "text-slate-300", ring: "bg-slate-500" },
};

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name", lastName: "Last name", email: "Email", phone: "Phone", company: "Company",
};

export default function LandingPagesPage() {
  const { user } = useSession();
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LandingPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api<{ items: LandingPage[] }>("/api/landing-pages"),
        api<{ items: Campaign[] }>("/api/campaigns").catch(() => ({ items: [] })),
      ]);
      setPages(p.items);
      setCampaigns(c.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load landing pages");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (p: LandingPage) => {
    try {
      await patch(`/api/landing-pages/${p.id}`, { active: !p.active });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  };

  const remove = async (p: LandingPage) => {
    if (!confirm(`Delete landing page "${p.name}"?`)) return;
    try {
      await del(`/api/landing-pages/${p.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Landing pages</h1>
          <p className="text-sm text-slate-500">Publish no-auth pages at <code className="rounded bg-white/10 px-1">/l/:slug</code> that capture routed leads — optionally attributed to a campaign.</p>
        </div>
        {user?.role === "admin" && (
          <button className="btn-primary ml-auto" onClick={() => setCreating(true)}><Plus className="size-4" /> New page</button>
        )}
      </div>
      {error && <div className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-44" />)}
        </div>
      ) : pages.length === 0 ? (
        <EmptyState
          icon={<Rocket className="size-8" />}
          title="No landing pages yet"
          hint="Create one — a headline, a CTA, and a few fields. Submissions become leads in the pipeline."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((p) => {
            const theme = THEMES[p.theme] ?? THEMES.indigo;
            return (
              <div key={p.id} className={`card p-5 transition-colors ${p.active ? "" : "opacity-60"}`}>
                <div className={`flex h-24 items-center justify-center rounded-xl bg-gradient-to-br ${theme.bg}`}>
                  <div className="text-center">
                    <div className="px-4 text-sm font-semibold text-white line-clamp-2">{p.headline}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-white/70">{p.name}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">{p.name}</h3>
                  <button
                    onClick={() => void toggle(p)}
                    title={p.active ? "Active — click to unpublish" : "Inactive — click to publish"}
                    className={`relative h-5 w-9 rounded-full transition-colors ${p.active ? "bg-accent-500" : "bg-white/10"}`}
                  >
                    <span className={`absolute top-0.5 size-4 rounded-full transition-all ${p.active ? "left-4 bg-on-brand" : "left-0.5 bg-white"}`} />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone="blue">/l/{p.slug}</Badge>
                  {p.campaignId && <Badge tone="violet"><Palette className="size-3" /> attributed</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.fields.filter((f) => f.enabled).map((f) => (
                    <span key={f.key} className="chip">{FIELD_LABELS[f.key] ?? f.key}</span>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3">
                  <span className="text-[11px] text-slate-600">{timeAgo(p.createdAt)}</span>
                  <div className="flex gap-1">
                    <a href={`/l/${p.slug}`} target="_blank" rel="noreferrer" title="Open public page" className="rounded-lg p-1.5 text-accent-400 hover:bg-accent-500/15"><ExternalLink className="size-3.5" /></a>
                    {user?.role === "admin" && (
                      <>
                        <button onClick={() => setEditing(p)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><Pencil className="size-3.5" /></button>
                        <button onClick={() => void remove(p)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400"><Trash2 className="size-3.5" /></button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(creating || editing) && (
        <PageModal
          initial={editing}
          campaigns={campaigns}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

// ── Builder modal ────────────────────────────────────────────────────────────
function PageModal({ initial, campaigns, onClose, onDone }: { initial: LandingPage | null; campaigns: Campaign[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    slug: initial?.slug ?? "",
    headline: initial?.headline ?? "",
    subtext: initial?.subtext ?? "",
    ctaLabel: initial?.ctaLabel ?? "Get started",
    successMessage: initial?.successMessage ?? "Thanks — we'll be in touch soon.",
    theme: initial?.theme ?? "indigo",
    campaignId: initial?.campaignId ?? "",
    fields: initial?.fields?.length ? initial.fields : ["firstName", "lastName", "email", "phone", "company"].map((key) => ({ key, enabled: key === "firstName" || key === "lastName" || key === "email" })),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!form.name.trim() || !form.slug.trim() || !form.headline.trim()) { setError("Name, slug and headline are required"); return; }
    setBusy(true); setError(null);
    try {
      const body = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        headline: form.headline.trim(),
        subtext: form.subtext.trim() || undefined,
        ctaLabel: form.ctaLabel.trim() || undefined,
        successMessage: form.successMessage.trim() || undefined,
        theme: form.theme,
        campaignId: form.campaignId || undefined,
        fields: form.fields,
      };
      if (initial) await patch(`/api/landing-pages/${initial.id}`, body);
      else await post("/api/landing-pages", body);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const setField = (key: string, enabled: boolean) =>
    setForm((f) => ({ ...f, fields: f.fields.map((x) => (x.key === key ? { key, enabled } : x)) }));

  return (
    <Modal open onClose={onClose} title={initial ? "Edit landing page" : "New landing page"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Book a demo" /></Field>
          <Field label="Slug" required><input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="book-a-demo" /></Field>
        </div>
        <Field label="Headline" required><input className="input" value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} placeholder="See QORVEXA in action" /></Field>
        <Field label="Subtext"><textarea className="input min-h-16 resize-y" value={form.subtext} onChange={(e) => setForm({ ...form, subtext: e.target.value })} placeholder="One or two lines of supporting copy…" /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="CTA label"><input className="input" value={form.ctaLabel} onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })} /></Field>
          <Field label="Attribution campaign">
            <select className="input" value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })}>
              <option value="">None</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Theme">
          <div className="flex gap-2">
            {Object.entries(THEMES).map(([key, t]) => (
              <button key={key} onClick={() => setForm({ ...form, theme: key })} className={`h-9 w-9 rounded-xl bg-gradient-to-br ${t.bg} ${form.theme === key ? "ring-2 ring-white/80" : "opacity-70 hover:opacity-100"}`} title={t.label} />
            ))}
          </div>
        </Field>
        <Field label="Form fields">
          <div className="flex flex-wrap gap-2">
            {form.fields.map((f) => (
              <button
                key={f.key}
                onClick={() => setField(f.key, !f.enabled)}
                className={`chip ${f.enabled ? "!bg-accent-500/20 !text-accent-300" : ""}`}
              >
                {FIELD_LABELS[f.key] ?? f.key}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Success message"><input className="input" value={form.successMessage} onChange={(e) => setForm({ ...form, successMessage: e.target.value })} /></Field>

        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? <Spinner className="size-4" /> : initial ? "Save changes" : "Create page"}</button>
        </div>
      </div>
    </Modal>
  );
}
