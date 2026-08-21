import { useEffect, useId, useRef, Children, cloneElement, isValidElement, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";

export function Spinner({ className = "" }: { className?: string }) {
  return <div className={`inline-block size-4 animate-spin rounded-full border-2 border-current/20 border-t-current ${className}`} role="status" aria-label="Loading" />;
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && (
        <div className="mb-1 flex size-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-ink-800/60 text-slate-500">
          {icon}
        </div>
      )}
      <div className="text-sm font-semibold text-slate-300">{title}</div>
      {hint && <div className="max-w-sm text-xs leading-relaxed text-slate-500">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

const modalSizes = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  size?: keyof typeof modalSizes;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previous = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const active = document.activeElement as HTMLElement | null;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (active === first || !panel?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Focus the first focusable (or the panel) on open; lock page scroll.
    (focusables()[0] ?? panel)?.focus();
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const resolved = wide ? "lg" : size;

  // Portal out of any transform-bearing ancestor (animate-fade-up creates a
  // containing block that makes fixed positioning relative to it instead of
  // the viewport — the modal would scroll/move with the page).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-8 animate-fade-in"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`card animate-fade-up mx-auto w-full max-h-[calc(100vh-2rem)] overflow-hidden outline-none ${modalSizes[resolved]}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-4">
          <h2 id={titleId} className="text-base font-semibold tracking-tight text-white">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-[var(--surface-hover)] hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/** Contextual side drawer (spec §28/§43) — right-side on desktop, bottom sheet
    on mobile. Focus-trapped and scroll-locked like Modal, but preserves the
    underlying page (no navigation). */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === list[0] || !panel?.contains(active))) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && active === list[list.length - 1]) {
        e.preventDefault();
        list[0].focus();
      }
    };
    (focusables()[0] ?? panel)?.focus();
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full flex-col outline-none sm:w-[26rem] md:w-[30rem] animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="glass flex h-full flex-col overflow-hidden rounded-l-2xl border-l border-[var(--glass-border)]">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-white">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close panel"
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-[var(--surface-hover)] hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="shrink-0 border-t border-[var(--border-subtle)] px-5 py-3">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Toasts (spec §37) — lightweight global feedback, no new dependency ──
type ToastTone = "success" | "error" | "info";
export type Toast = { id: number; tone: ToastTone; message: string };

let toastId = 0;

export function ToastHost({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), t.tone === "error" ? 6000 : 3200));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  const tones: Record<ToastTone, string> = {
    success: "border-emerald-500/30 text-emerald-300",
    error: "border-rose-500/30 text-rose-300",
    info: "border-accent-500/30 text-accent-300",
  };
  const icons: Record<ToastTone, ReactNode> = {
    success: <CheckCircle2 className="size-4" />,
    error: <AlertCircle className="size-4" />,
    info: <Info className="size-4" />,
  };

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-ink-850/95 px-4 py-3 text-sm shadow-2xl shadow-black/40 backdrop-blur-xl animate-fade-up ${tones[t.tone]}`}
        >
          <span className="mt-0.5 shrink-0">{icons[t.tone]}</span>
          <span className="min-w-0 flex-1 text-slate-200">{t.message}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-300"><X className="size-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

/** Small hook-free helper for the couple of call sites that need an id-less toast. */
export function makeToast(tone: ToastTone, message: string): Toast {
  return { id: ++toastId, tone, message };
}

const LABELABLE = new Set(["input", "select", "textarea"]);

/** Find the first form control among children (handles nesting/fragments). */
function firstControl(node: ReactNode): ReactElement | null {
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  const type = node.type;
  if (typeof type === "string" && LABELABLE.has(type)) return node;
  const kids = Children.toArray(node.props.children);
  for (const k of kids) {
    const hit = firstControl(k);
    if (hit) return hit;
  }
  return null;
}

export function Field({ label, children, required, hint, id }: { label: string; children: ReactNode; required?: boolean; hint?: string; id?: string }) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const control = firstControl(children);
  const controlProps = (control?.props ?? {}) as Record<string, unknown>;
  // If the control already carries its own id, point htmlFor at it; otherwise
  // inject our generated id (plus aria-describedby for the hint) via clone.
  const actualId = typeof controlProps.id === "string" ? controlProps.id : controlId;
  let content = children;
  if (control && !controlProps.id) {
    const extra: Record<string, unknown> = { id: controlId };
    if (hint) extra["aria-describedby"] = `${controlId}-hint`;
    content = cloneElement(control, extra);
  }
  return (
    <div>
      <label className="label" htmlFor={actualId}>
        {label} {required && <span className="text-accent-400">*</span>}
      </label>
      {content}
      {hint && <p id={`${controlId}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const badgeColors: Record<string, string> = {
  default: "bg-white/[0.05] text-slate-300",
  green: "bg-emerald-500/12 text-emerald-400",
  blue: "bg-accent-500/12 text-accent-300",
  amber: "bg-amber-500/12 text-amber-400",
  rose: "bg-rose-500/12 text-rose-400",
  teal: "bg-teal-500/12 text-teal-400",
  gold: "bg-yellow-500/12 text-yellow-400",
};

const badgeDots: Record<string, string> = {
  green: "bg-emerald-400",
  blue: "bg-accent-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  teal: "bg-teal-400",
  gold: "bg-yellow-400",
  default: "bg-slate-500",
};

export function Badge({ children, tone = "default", dot }: { children: ReactNode; tone?: keyof typeof badgeColors; dot?: boolean }) {
  return (
    <span className={`chip ${badgeColors[tone] ?? badgeColors.default}`}>
      {dot && <span className={`size-1.5 rounded-full ${badgeDots[tone] ?? badgeDots.default}`} />}
      {children}
    </span>
  );
}

const statTones = {
  blue: "text-accent-300",
  green: "text-mint-400",
  amber: "text-amber-400",
  teal: "text-teal-400",
} as const;

export function StatCard({
  label,
  value,
  sub,
  tone = "blue",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: keyof typeof statTones;
  icon?: ReactNode;
}) {
  return (
    <div className="card group relative p-5 transition-colors hover:border-[var(--border-strong)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
        {icon && <div className="flex size-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-ink-800/60 text-slate-500">{icon}</div>}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${statTones[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

/** Consistent page header: title + description on the left, actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-ink-800/60 text-accent-400">
            {icon}
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Segmented tab bar — the shared tab control for multi-section pages. */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    if (!buttons.length) return;
    const idx = buttons.findIndex((b) => b.getAttribute("aria-selected") === "true");
    const cur = Math.max(idx, 0);
    let next = -1;
    if (e.key === "ArrowRight") next = (cur + 1) % buttons.length;
    else if (e.key === "ArrowLeft") next = (cur - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const tab = tabs[next];
    buttons[next].focus();
    onChange(tab.key);
  };

  return (
    <div ref={listRef} role="tablist" aria-label="Sections" onKeyDown={onKeyDown} className="mb-6 flex flex-wrap items-center gap-1 border-b border-[var(--border-subtle)]">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          tabIndex={active === t.key ? 0 : -1}
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
            active === t.key
              ? "border-accent-400 text-white"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Inline alert banner (success / error / info). */
export function Alert({ tone = "info", children, onDismiss }: { tone?: "info" | "success" | "error"; children: ReactNode; onDismiss?: () => void }) {
  const tones = {
    info: "border-accent-500/25 bg-accent-500/10 text-accent-300",
    success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    error: "border-rose-500/25 bg-rose-500/10 text-rose-400",
  } as const;
  return (
    <div className={`mb-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      <div className="min-w-0">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 rounded-md p-0.5 text-current/70 transition-colors hover:text-current">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
