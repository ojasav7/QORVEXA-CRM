const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const money = (n: number | null | undefined) => (n == null ? "—" : usd.format(n));

export const date = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export const dateTime = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " · " +
      new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—";

export function timeAgo(d: string | Date): string {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return date(d);
}

export const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
