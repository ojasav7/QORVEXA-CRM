import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Building2, Target, Briefcase, CheckSquare,
  Activity, Settings, LogOut, Search, Menu, X, Upload, GitBranch, ListFilter,
  Mail, Phone, CalendarDays, CalendarClock, FileText,
} from "lucide-react";
import { useSession, useFeature } from "../App";
import { post } from "../lib/api";
import { initials } from "../lib/format";
import { api } from "../lib/api";
import type { Org } from "../lib/api";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/accounts", label: "Accounts", icon: Building2 },
  { to: "/leads", label: "Leads", icon: Target },
  { to: "/deals", label: "Deals", icon: Briefcase },
  { to: "/activities", label: "Activities", icon: CheckSquare },
  { to: "/segments", label: "Segments", icon: ListFilter },
  { to: "/events", label: "Events", icon: Activity },
];

export default function Layout() {
  const { user, org, environment, environments, setEnvironment } = useSession();
  const showImport = useFeature("import.merge");
  const showEmail = useFeature("comm.email");
  const showCalling = useFeature("comm.calling");
  const showCalendar = useFeature("comm.calendar");
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ type: string; id: string; title: string; subtitle: string }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      try {
        const data = await api<{ items: typeof results }>(`/api/search?q=${encodeURIComponent(q)}`);
        setResults(data.items);
        setSearchOpen(true);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const go = (type: string, id: string) => {
    const map: Record<string, string> = { contact: "/contacts", account: "/accounts", lead: "/leads", opportunity: "/deals", task: "/activities", note: "/activities" };
    navigate(`${map[type] ?? "/"}?id=${id}`);
    setQ("");
    setSearchOpen(false);
  };

  const logout = async () => {
    await post("/api/auth/logout");
    navigate("/login");
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-white/[0.06] bg-ink-900/60 backdrop-blur-xl">
        <Link to="/" className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-violet-500 font-bold text-white shadow-lg shadow-accent-500/30">
            Q
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white">QORVEXA</div>
            <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">{org?.name ?? "CRM"}</div>
          </div>
        </Link>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
          {showImport && (
            <NavLink to="/import" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Upload className="size-4" />
              Import
            </NavLink>
          )}
          {(showEmail || showCalling || showCalendar) && (
            <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Communications</div>
          )}
          {showEmail && (
            <NavLink to="/emails" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Mail className="size-4" />
              Email
            </NavLink>
          )}
          {showEmail && (
            <NavLink to="/emails/templates" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <FileText className="size-4" />
              Templates
            </NavLink>
          )}
          {showCalling && (
            <NavLink to="/calls" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Phone className="size-4" />
              Calls
            </NavLink>
          )}
          {showCalendar && (
            <NavLink to="/meetings" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <CalendarDays className="size-4" />
              Calendar
            </NavLink>
          )}
          {showCalendar && (
            <NavLink to="/booking" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <CalendarClock className="size-4" />
              Booking
            </NavLink>
          )}
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
            <Settings className="size-4" />
            Settings
          </NavLink>
        </nav>

        <div className="border-t border-white/[0.06] p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ink-600 to-ink-700 text-xs font-semibold text-white ring-1 ring-white/10">
              {initials(user?.name ?? "?")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{user?.name}</div>
              <div className="truncate text-[11px] capitalize text-slate-500">{user?.role}</div>
            </div>
            <button onClick={logout} title="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-white/10 hover:text-white transition-colors">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-ink-900 border-r border-white/[0.08] p-4">
            <div className="mb-6 flex items-center justify-between">
              <div className="text-sm font-bold text-white">QORVEXA</div>
              <button onClick={() => setMobileOpen(false)} className="text-slate-400"><X className="size-5" /></button>
            </div>
            <nav className="space-y-1">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <item.icon className="size-4" /> {item.label}
                </NavLink>
              ))}
              {showImport && (
                <NavLink to="/import" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Upload className="size-4" /> Import
                </NavLink>
              )}
              {(showEmail || showCalling || showCalendar) && (
                <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Communications</div>
              )}
              {showEmail && (
                <NavLink to="/emails" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Mail className="size-4" /> Email
                </NavLink>
              )}
              {showEmail && (
                <NavLink to="/emails/templates" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <FileText className="size-4" /> Templates
                </NavLink>
              )}
              {showCalling && (
                <NavLink to="/calls" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Phone className="size-4" /> Calls
                </NavLink>
              )}
              {showCalendar && (
                <NavLink to="/meetings" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <CalendarDays className="size-4" /> Calendar
                </NavLink>
              )}
              {showCalendar && (
                <NavLink to="/booking" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <CalendarClock className="size-4" /> Booking
                </NavLink>
              )}
              <NavLink to="/settings" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                <Settings className="size-4" /> Settings
              </NavLink>
            </nav>
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-ink-950/70 px-4 backdrop-blur-xl">
          <button className="md:hidden text-slate-400" onClick={() => setMobileOpen(true)}><Menu className="size-5" /></button>

          {/* Environment switcher (ADR-008) — persisted in localStorage, sent as X-Environment */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-ink-900/60 py-1 pl-2.5 pr-1">
            <GitBranch className="size-3.5 text-slate-500" />
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              title="Environment"
              className={`bg-transparent text-xs font-medium outline-none cursor-pointer ${environment === "production" ? "text-mint-400" : "text-amber-400"}`}
            >
              {environments.length ? environments.map((e) => <option key={e} value={e} className="bg-ink-850 text-slate-200">{e}</option>) : <option value={environment} className="bg-ink-850 text-slate-200">{environment}</option>}
            </select>
          </div>

          <div className="relative ml-auto max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => results.length && setSearchOpen(true)}
              placeholder="Search contacts, accounts, deals…"
              className="input pl-9"
            />
            {searchOpen && results.length > 0 && (
              <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-xl border border-white/[0.08] bg-ink-850 shadow-2xl shadow-black/50">
                {results.map((r) => (
                  <button key={`${r.type}-${r.id}`} onClick={() => go(r.type, r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.05] transition-colors">
                    <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">{r.type}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-white">{r.title || "Untitled"}</span>
                      {r.subtitle && <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={logout} className="md:hidden rounded-lg p-2 text-slate-400"><LogOut className="size-4" /></button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <OutletContent />
        </main>
      </div>
    </div>
  );
}

// Outlet via children-less route: use useOutlet instead
import { useOutlet } from "react-router-dom";
function OutletContent() {
  return useOutlet();
}
