// ── Lightweight chart primitives (no chart library — SVG + CSS) ─────────────
// Spec §51/§52: reports should be visual (bars, donuts, trends, deltas), and
// analytics should re-render when the "analyze by" attribute changes. All of
// these are theme-aware (Tailwind classes + mid-tone series colors that read
// on both dark and light cards). No purple — the series palette sticks to the
// green-first semantic family (teal/emerald/lime/amber/rose/cyan/pink).
import type { ReactNode } from "react";

export type Segment = { label: string; value: number };

/** Series colors — cycle through these in chart order (green-first, no purple). */
export const SERIES = ["#2dd4bf", "#34d399", "#a3e635", "#fbbf24", "#fb7185", "#22d3ee", "#f472b6", "#94a3b8"];
export const colorFor = (i: number) => SERIES[i % SERIES.length];

/** Header wrapper for a chart block. */
export function ChartCard({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** ↑/↓ pill — green when positive, rose when negative (spec §51 delta). */
export function Delta({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${up ? "bg-emerald-500/12 text-emerald-400" : "bg-rose-500/12 text-rose-400"}`}>
      {up ? "↑" : "↓"} {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}

/** Horizontal percentage bar with label (spec §52 "Website █████ 45%"). */
export function HBarRow({ label, value, pct, max, fmt, color }: {
  label: string; value: number; pct: number; max: number; fmt?: (v: number) => string; color: string;
}) {
  return (
    <div className="group">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium text-slate-300">{label}</span>
        <span className="shrink-0 text-xs tabular-nums text-slate-500">
          {fmt ? fmt(value) : value.toLocaleString()}
          <span className="ml-1.5 font-semibold text-slate-300">{Math.round(pct)}%</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-800" role="img" aria-label={`${label}: ${Math.round(pct)} percent`}>
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/** Vertical bar chart (monthly trends). Values normalized to the max. */
export function MonthBars({ data, fmt }: { data: { label: string; value: number }[]; fmt?: (v: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1.5 sm:gap-2" role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(", ")}>
      {data.map((d, i) => (
        <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-slate-500">{d.value > 0 ? (fmt ? fmt(d.value) : d.value.toLocaleString()) : ""}</span>
          <div
            className="w-full rounded-t-md transition-all duration-500 ease-out"
            style={{ height: `${Math.max((d.value / max) * 120, 3)}px`, backgroundColor: colorFor(i) }}
            title={`${d.label}: ${d.value}`}
          />
          <span className="w-full truncate text-center text-[10px] font-medium text-slate-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** SVG donut with center total. */
export function Donut({ segments, centerLabel, centerValue, fmt }: {
  segments: Segment[]; centerLabel?: string; centerValue?: number; fmt?: (v: number) => string;
}) {
  const total = Math.max(segments.reduce((s, x) => s + x.value, 0), 1);
  const R = 56;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = segments.map((s, i) => {
    const frac = s.value / total;
    const dash = frac * C;
    const offset = -acc * C;
    acc += frac;
    return { key: s.label, dash, offset, color: colorFor(i), frac };
  });
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 140 140" className="size-full -rotate-90">
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--border-subtle)" strokeWidth="14" />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx="70" cy="70" r={R} fill="none"
              stroke={a.color} strokeWidth="14"
              strokeDasharray={`${a.dash} ${C - a.dash}`}
              strokeDashoffset={a.offset}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums text-white">{centerValue !== undefined ? (fmt ? fmt(centerValue) : centerValue.toLocaleString()) : ""}</span>
          {centerLabel && <span className="text-[10px] uppercase tracking-wider text-slate-500">{centerLabel}</span>}
        </div>
      </div>
      <div className="grid w-full grid-cols-1 gap-1.5 sm:grid-cols-2 sm:flex-1">
        {segments.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorFor(i) }} />
            <span className="min-w-0 truncate text-slate-300">{s.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-slate-500">{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Small stat strip for a chart footer (n, total). */
export function ChartMeta({ children }: { children: ReactNode }) {
  return <div className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-[11px] text-slate-600">{children}</div>;
}
