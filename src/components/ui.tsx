import { type ReactNode, useEffect } from "react";
import { X } from "lucide-react";

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div className={`inline-block size-4 animate-spin rounded-full border-2 border-white/20 border-t-accent-400 ${className}`} />
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      {icon && <div className="text-slate-600">{icon}</div>}
      <div className="text-sm font-medium text-slate-400">{title}</div>
      {hint && <div className="max-w-xs text-xs text-slate-600">{hint}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 sm:p-8" onClick={onClose}>
      <div
        className={`card animate-fade-up my-auto w-full ${wide ? "max-w-2xl" : "max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white transition-colors">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="label">
        {label} {required && <span className="text-accent-400">*</span>}
      </label>
      {children}
    </div>
  );
}

const badgeColors: Record<string, string> = {
  default: "bg-white/[0.06] text-slate-300",
  green: "bg-emerald-500/15 text-emerald-400",
  blue: "bg-accent-500/15 text-accent-300",
  amber: "bg-amber-500/15 text-amber-400",
  rose: "bg-rose-500/15 text-rose-400",
  violet: "bg-violet-500/15 text-violet-400",
  gold: "bg-yellow-500/15 text-yellow-400",
};

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: keyof typeof badgeColors }) {
  return <span className={`chip ${badgeColors[tone] ?? badgeColors.default}`}>{children}</span>;
}

export function StatCard({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: "blue" | "green" | "amber" | "violet" }) {
  const tones = {
    blue: "text-accent-300",
    green: "text-mint-400",
    amber: "text-amber-400",
    violet: "text-violet-400",
  } as const;
  return (
    <div className="card p-5 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${tones[tone ?? "blue"]}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
