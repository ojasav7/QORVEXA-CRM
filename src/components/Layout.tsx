import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Building2, Target, Briefcase, CheckSquare,
  Activity, Settings, LogOut, Search, Menu, X, Upload, GitBranch, ListFilter,
  Mail, Phone, CalendarDays, CalendarClock, FileText, Bell, GitMerge, CheckCheck,
  Sun, Moon, LifeBuoy, BookOpen, Globe, Megaphone, Rocket, Waypoints, Gauge,
  BarChart3, LayoutDashboard as ReportIcon, UserRound, Package, Sparkles, Route as RouteIcon, Bot, DollarSign,
  HeartHandshake, HardHat, Store, Shield, Brain, Plus, ChevronDown, HelpCircle,
} from "lucide-react";
import type * as React from "react";
import { useTheme } from "../lib/theme";
import { useSession, useFeature } from "../App";
import { api, post } from "../lib/api";
import { Kbd } from "./ui";
import { initials } from "../lib/format";
import type { Org } from "../lib/api";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";

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
  const { user, org, environment, environments, setEnvironment, refresh } = useSession();
  const showImport = useFeature("import.merge");
  const showEmail = useFeature("comm.email");
  const showCalling = useFeature("comm.calling");
  const showCalendar = useFeature("comm.calendar");
  const showWorkflows = useFeature("automation.workflows");
  const showTickets = useFeature("service.tickets");
  const showKnowledge = useFeature("service.knowledge");
  const showCampaigns = useFeature("marketing.campaigns");
  const showLanding = useFeature("marketing.landing");
  const showJourneys = useFeature("marketing.journeys");
  const showDeliverability = useFeature("marketing.deliverability");
  const showAnalytics = useFeature("analytics.metrics");
  const showReports = useFeature("analytics.reports");
  const showCustomers = useFeature("cdp.profiles");
  const showPortability = useFeature("cdp.portability");
  const showCopilot = useFeature("ai.assistant");
  const showModels = useFeature("ai.modelRouter");
  const showAgents = useFeature("ai.agents");
  const showRevenue = useFeature("revenue.products") || useFeature("revenue.cpq") || useFeature("revenue.billing") || useFeature("revenue.metrics");
  const showSuccess = useFeature("cs.plans") || useFeature("cs.usage") || useFeature("cs.churn") || useFeature("cs.surveys") || useFeature("cs.loyalty");
  const showField = useFeature("field.territories") || useFeature("field.visits") || useFeature("field.workorders") || useFeature("field.inventory");
  const showEcosystem = useFeature("ecosystem.marketplace") || useFeature("ecosystem.partners") || useFeature("ecosystem.changesets") || useFeature("ecosystem.schema");
  const showSecurity = useFeature("sec.mfa") || useFeature("sec.sessions") || useFeature("sec.scim") || useFeature("sec.consent") || useFeature("sec.retention") || useFeature("sec.status") || useFeature("i18n.localization");
  const showBrain = useFeature("diff.brain") || useFeature("diff.graph") || useFeature("diff.memory") || useFeature("diff.orchestration") || useFeature("diff.timemachine") || useFeature("diff.simulator") || useFeature("diff.builder") || useFeature("diff.command") || useFeature("diff.ubq");
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // ⌘K / Ctrl+K toggles the command palette; Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Spec §70 — single-key shortcuts (/ N D T) with focus guards. They must
  // never fire while the user is typing in a form control, while a modal or
  // drawer is open, or when a modifier key is held — otherwise they'd hijack
  // normal typing and browser behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Unmodified keys only — never fire on Ctrl/Cmd/Alt/Shift combos.
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      // Modal / drawer context — let Esc and Tab own the keys there.
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === "/") {
        e.preventDefault(); // stops Firefox quick-find
        setPaletteOpen(true);
      } else if (k === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (k === "n") {
        e.preventDefault();
        navigate("/leads?new=1");
      } else if (k === "d") {
        e.preventDefault();
        navigate("/deals?new=1");
      } else if (k === "t") {
        e.preventDefault();
        navigate("/activities?new=1");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  // Mobile drawer: move focus into it on open, trap Tab inside, close on Escape.
  const drawerRef = useRef<HTMLElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobileOpen) return;
    const panel = drawerRef.current;
    const trigger = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>('a, button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
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
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (trigger ?? menuBtnRef.current)?.focus?.();
    };
  }, [mobileOpen]);

  const go = (type: string, id: string) => {
    const map: Record<string, string> = { contact: "/contacts", account: "/accounts", lead: "/leads", opportunity: "/deals", task: "/activities", note: "/activities" };
    navigate(`${map[type] ?? "/"}?id=${id}`);
  };

  const logout = async () => {
    try {
      await post("/api/auth/logout");
    } catch {
      // Cookie may already be gone — the local state refresh below is what matters.
    }
    // Re-fetch /me so session.user is cleared — navigating to /login while the
    // session state still says "logged in" would bounce straight back to /.
    await refresh();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex h-full">
      {/* Skip link (WCAG 2.4.1) — lets keyboard users bypass the nav */}
      <a href="#main-content" className="skip-link">Skip to content</a>
      {/* Sidebar (spec §11 — persistent dark green, grouped nav) */}
      <aside className="sidebar hidden md:flex w-60 shrink-0 flex-col">
        <Link to="/" className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-teal-500 font-bold text-on-brand shadow-lg shadow-accent-500/30">
            Q
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-[var(--sidebar-active-text)]">QORVEXA</div>
            <div className="text-[10px] font-medium uppercase tracking-widest text-[var(--sidebar-heading)]">{org?.name ?? "CRM"}</div>
          </div>
        </Link>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
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
            <div className="nav-section">Communications</div>
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
          {showWorkflows && (
            <div className="nav-section">Automation</div>
          )}
          {showWorkflows && (
            <NavLink to="/workflows" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <GitMerge className="size-4" />
              Workflows
            </NavLink>
          )}
          {(showTickets || showKnowledge) && (
            <div className="nav-section">Support</div>
          )}
          {showTickets && (
            <NavLink to="/tickets" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <LifeBuoy className="size-4" />
              Tickets
            </NavLink>
          )}
          {showKnowledge && (
            <NavLink to="/knowledge" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <BookOpen className="size-4" />
              Knowledge
            </NavLink>
          )}
          {showTickets && (
            <NavLink to="/portals" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Globe className="size-4" />
              Portals
            </NavLink>
          )}
          {(showCampaigns || showLanding || showJourneys || showDeliverability) && (
            <div className="nav-section">Marketing</div>
          )}
          {showCampaigns && (
            <NavLink to="/campaigns" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Megaphone className="size-4" />
              Campaigns
            </NavLink>
          )}
          {showLanding && (
            <NavLink to="/landing" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Rocket className="size-4" />
              Landing
            </NavLink>
          )}
          {showJourneys && (
            <NavLink to="/journeys" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Waypoints className="size-4" />
              Journeys
            </NavLink>
          )}
          {showDeliverability && (
            <NavLink to="/deliverability" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Gauge className="size-4" />
              Deliverability
            </NavLink>
          )}
          {(showAnalytics || showReports) && (
            <div className="nav-section">Analytics</div>
          )}
          {showAnalytics && (
            <NavLink to="/analytics" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <BarChart3 className="size-4" />
              Dashboards
            </NavLink>
          )}
          {showReports && (
            <NavLink to="/reports" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <ReportIcon className="size-4" />
              Reports
            </NavLink>
          )}
          {(showCustomers || showPortability) && (
            <div className="nav-section">Customer data</div>
          )}
          {showCustomers && (
            <NavLink to="/customers" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <UserRound className="size-4" />
              Customers
            </NavLink>
          )}
          {showPortability && (
            <NavLink to="/portability" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Package className="size-4" />
              Portability
            </NavLink>
          )}
          {(showCopilot || showModels || showAgents) && (
            <div className="nav-section">AI</div>
          )}
          {showCopilot && (
            <NavLink to="/copilot" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Sparkles className="size-4" />
              Copilot
            </NavLink>
          )}
          {showModels && (
            <NavLink to="/models" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <RouteIcon className="size-4" />
              Model router
            </NavLink>
          )}
          {showAgents && (
            <NavLink to="/agents" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Bot className="size-4" />
              Agents
            </NavLink>
          )}
          {showRevenue && (
            <div className="nav-section">Revenue</div>
          )}
          {showRevenue && (
            <NavLink to="/revenue" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <DollarSign className="size-4" />
              Revenue
            </NavLink>
          )}
          {showSuccess && (
            <div className="nav-section">Customer success</div>
          )}
          {showSuccess && (
            <NavLink to="/success" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <HeartHandshake className="size-4" />
              Success
            </NavLink>
          )}
          {showField && (
            <div className="nav-section">Field ops</div>
          )}
          {showField && (
            <NavLink to="/field" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <HardHat className="size-4" />
              Field
            </NavLink>
          )}
          {showEcosystem && (
            <div className="nav-section">Ecosystem</div>
          )}
          {showEcosystem && (
            <NavLink to="/ecosystem" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Store className="size-4" />
              Ecosystem
            </NavLink>
          )}
          {showSecurity && (
            <div className="nav-section">Security</div>
          )}
          {showSecurity && (
            <NavLink to="/security" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Shield className="size-4" />
              Security
            </NavLink>
          )}
          {showBrain && (
            <div className="nav-section">Brain</div>
          )}
          {showBrain && (
            <NavLink to="/brain" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Brain className="size-4" />
              Brain
            </NavLink>
          )}
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
            <Settings className="size-4" />
            Settings
          </NavLink>
        </nav>

        <div className="border-t border-[var(--sidebar-border)] p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-600 to-accent-700 text-xs font-semibold text-on-brand ring-1 ring-white/10">
              {initials(user?.name ?? "?")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-[var(--sidebar-active-text)]">{user?.name}</div>
              <div className="truncate text-[11px] capitalize text-[var(--sidebar-heading)]">{user?.role}</div>
            </div>
            <button onClick={logout} title="Sign out" aria-label="Sign out" className="rounded-lg p-2 text-[var(--sidebar-text)] hover:bg-white/10 hover:text-white transition-colors">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside ref={drawerRef} role="dialog" aria-modal="true" aria-label="Navigation menu" className="sidebar absolute left-0 top-0 h-full w-64 border-r border-[var(--sidebar-border)] p-4">
            <div className="mb-6 flex items-center justify-between">
              <div className="text-sm font-bold text-[var(--sidebar-active-text)]">QORVEXA</div>
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="text-[var(--sidebar-text)]"><X className="size-5" /></button>
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
                <div className="nav-section">Communications</div>
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
              {showWorkflows && (
                <NavLink to="/workflows" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <GitMerge className="size-4" /> Workflows
                </NavLink>
              )}
              {(showTickets || showKnowledge) && (
                <div className="nav-section">Support</div>
              )}
              {showTickets && (
                <NavLink to="/tickets" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <LifeBuoy className="size-4" /> Tickets
                </NavLink>
              )}
              {showKnowledge && (
                <NavLink to="/knowledge" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <BookOpen className="size-4" /> Knowledge
                </NavLink>
              )}
              {showTickets && (
                <NavLink to="/portals" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Globe className="size-4" /> Portals
                </NavLink>
              )}
              {(showCampaigns || showLanding || showJourneys || showDeliverability) && (
                <div className="nav-section">Marketing</div>
              )}
              {showCampaigns && (
                <NavLink to="/campaigns" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Megaphone className="size-4" /> Campaigns
                </NavLink>
              )}
              {showLanding && (
                <NavLink to="/landing" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Rocket className="size-4" /> Landing
                </NavLink>
              )}
              {showJourneys && (
                <NavLink to="/journeys" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Waypoints className="size-4" /> Journeys
                </NavLink>
              )}
              {showDeliverability && (
                <NavLink to="/deliverability" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Gauge className="size-4" /> Deliverability
                </NavLink>
              )}
              {(showAnalytics || showReports) && (
                <div className="nav-section">Analytics</div>
              )}
              {showAnalytics && (
                <NavLink to="/analytics" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <BarChart3 className="size-4" /> Dashboards
                </NavLink>
              )}
              {showReports && (
                <NavLink to="/reports" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <ReportIcon className="size-4" /> Reports
                </NavLink>
              )}
              {(showCustomers || showPortability) && (
                <div className="nav-section">Customer data</div>
              )}
              {showCustomers && (
                <NavLink to="/customers" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <UserRound className="size-4" /> Customers
                </NavLink>
              )}
              {showPortability && (
                <NavLink to="/portability" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Package className="size-4" /> Portability
                </NavLink>
              )}
              {(showCopilot || showModels || showAgents) && (
                <div className="nav-section">AI</div>
              )}
              {showCopilot && (
                <NavLink to="/copilot" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Sparkles className="size-4" /> Copilot
                </NavLink>
              )}
              {showModels && (
                <NavLink to="/models" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <RouteIcon className="size-4" /> Model router
                </NavLink>
              )}
              {showAgents && (
                <NavLink to="/agents" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Bot className="size-4" /> Agents
                </NavLink>
              )}
              {showRevenue && (
                <NavLink to="/revenue" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <DollarSign className="size-4" /> Revenue
                </NavLink>
              )}
              {showSuccess && (
                <NavLink to="/success" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <HeartHandshake className="size-4" /> Success
                </NavLink>
              )}
              {showField && (
                <NavLink to="/field" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <HardHat className="size-4" /> Field
                </NavLink>
              )}
              {showEcosystem && (
                <NavLink to="/ecosystem" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Store className="size-4" /> Ecosystem
                </NavLink>
              )}
              {showSecurity && (
                <NavLink to="/security" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Shield className="size-4" /> Security
                </NavLink>
              )}
              {showBrain && (
                <NavLink to="/brain" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Brain className="size-4" /> Brain
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
        <header className="glass relative z-40 flex h-14 shrink-0 items-center gap-2 px-4">
          <button ref={menuBtnRef} className="md:hidden text-slate-400" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>

          {/* Environment switcher (ADR-008) — persisted in localStorage, sent as X-Environment */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-ink-900/60 py-1 pl-2.5 pr-1">
            <GitBranch className="size-3.5 text-slate-500" />
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              aria-label="Environment"
              className={`bg-transparent text-xs font-medium outline-none cursor-pointer ${environment === "production" ? "text-mint-400" : "text-amber-400"}`}
            >
              {environments.length ? environments.map((e) => <option key={e} value={e} className="bg-ink-850 text-slate-200">{e}</option>) : <option value={environment} className="bg-ink-850 text-slate-200">{environment}</option>}
            </select>
          </div>

          <button
            onClick={() => setPaletteOpen(true)}
            title="Search (press /)"
            className="ml-auto hidden w-full max-w-md flex-1 items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-ink-800/50 px-3 py-2 text-sm text-slate-500 transition-colors hover:border-[var(--border-strong)] hover:text-slate-400 sm:flex"
            aria-label="Open command palette"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search anything…</span>
            <Kbd>⌘K</Kbd>
          </button>

          <button onClick={() => setPaletteOpen(true)} aria-label="Search" className="sm:hidden rounded-lg p-2 text-slate-400 hover:text-slate-200"><Search className="size-5" /></button>

          <QuickCreate />
          {showWorkflows && <NotificationBell />}
          <button
            onClick={() => setShortcutsOpen(true)}
            title="Keyboard shortcuts (press ?)"
            aria-label="Keyboard shortcuts"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <HelpCircle className="size-4" />
          </button>
          <ThemeToggle />
          <button onClick={logout} aria-label="Sign out" className="md:hidden rounded-lg p-2 text-slate-400"><LogOut className="size-4" /></button>
        </header>

        {paletteOpen && (
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            onGo={(type, id) => { setPaletteOpen(false); go(type, id); }}
            onNav={(to) => { setPaletteOpen(false); navigate(to); }}
          />
        )}

        <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

        <main id="main-content" className="flex-1 overflow-y-auto p-4 sm:p-6">
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

/** Header theme toggle — flips data-theme on <html> (persisted). */
function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => setTheme(next)}
      title={`Switch to ${next} mode`}
      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
      aria-label={`Switch to ${next} mode`}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

type NotificationItem = { id: string; title: string; body: string | null; kind: string; link: string | null; read: boolean; createdAt: string };

/** Header bell — unread badge + dropdown of the caller's latest notifications. */
function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const panelId = "notif-panel";
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus into the dropdown when it opens (WCAG 2.4.3).
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>('button, a, [href]');
    first?.focus();
  }, [open]);

  const refreshCount = () => {
    void api<{ unread: number }>("/api/notifications/unread-count").then((d) => setUnread(d.unread)).catch(() => {});
  };
  const load = async () => {
    try {
      const d = await api<{ items: NotificationItem[]; unread: number }>("/api/notifications?pageSize=8");
      setItems(d.items);
      setUnread(d.unread);
    } catch {
      /* bell stays quiet when the API is unavailable */
    }
  };

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 30_000);
    return () => clearInterval(t);
  }, []);

  const markRead = async (n: NotificationItem) => {
    if (n.read) return;
    try {
      await post(`/api/notifications/${n.id}/read`);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      refreshCount();
    } catch { /* ignore */ }
  };

  const markAll = async () => {
    try {
      await post("/api/notifications/read-all");
      setItems((prev) => prev.map((x) => ({ ...x, read: true })));
      setUnread(0);
    } catch { /* ignore */ }
  };

  return (
    <div className="relative">
      <button
        onClick={() => { void load(); setOpen((o) => !o); }}
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        className="relative rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-on-brand">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div ref={panelRef} id={panelId} className="absolute right-0 top-11 z-40 w-80 overflow-hidden rounded-xl border border-white/[0.08] bg-ink-850 shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Notifications</span>
              {unread > 0 && (
                <button onClick={() => void markAll()} className="flex items-center gap-1 text-[11px] font-medium text-accent-400 hover:text-accent-300">
                  <CheckCheck className="size-3.5" /> Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-slate-600">No notifications yet.</div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => void markRead(n)}
                    className={`block w-full border-b border-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.04] ${n.read ? "opacity-55" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-400" />}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white">{n.title}</div>
                        {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</div>}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Command palette (spec §13/§71) ───────────────────────────────────────────
// ⌘K opens a searchable palette: navigation commands always visible, cross-
// object record results when typing (via the existing /api/search endpoint).
// Arrow keys + Enter navigate; Escape closes. No invented APIs — search is the
// same backend the header used before.
type PaletteItem = { id: string; kind: "nav" | "record"; label: string; sub?: string; to?: string; type?: string };

const COMMANDS: { group: string; items: { label: string; to: string; sub?: string }[] }[] = [
  { group: "Go to", items: [
    { label: "Dashboard", to: "/" },
    { label: "Contacts", to: "/contacts" },
    { label: "Accounts", to: "/accounts" },
    { label: "Leads", to: "/leads" },
    { label: "Deals", to: "/deals" },
    { label: "Activities", to: "/activities" },
    { label: "Events", to: "/events" },
    { label: "Settings", to: "/settings" },
  ]},
  { group: "Create", items: [
    { label: "New lead", to: "/leads?new=1" },
    { label: "New contact", to: "/contacts?new=1" },
    { label: "New account", to: "/accounts?new=1" },
    { label: "New deal", to: "/deals?new=1" },
  ]},
];

function CommandPalette({ onClose, onGo, onNav }: { onClose: () => void; onGo: (type: string, id: string) => void; onNav: (to: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PaletteItem[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cross-object search (same backend as the old header search).
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const data = await api<{ items: { type: string; id: string; title: string; subtitle: string }[] }>(`/api/search?q=${encodeURIComponent(q)}`);
        if (!alive) return;
        setResults(data.items.map((r) => ({ id: r.id, kind: "record", type: r.type, label: r.title || "Untitled", sub: r.subtitle || r.type })));
      } catch {
        if (alive) setResults([]);
      }
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  // Search-scoped commands: filter the static nav list by the query too.
  const ql = q.trim().toLowerCase();
  const navItems: PaletteItem[] = COMMANDS.flatMap((g) =>
    g.items.filter((i) => !ql || i.label.toLowerCase().includes(ql) || (i.sub ?? "").toLowerCase().includes(ql)).map((i) => ({ id: `nav-${i.label}`, kind: "nav", label: i.label, sub: i.sub, to: i.to }))
  );
  const all = [...navItems, ...results];

  useEffect(() => {
    setActive(0);
  }, [q]);

  useEffect(() => {
    // Capture the trigger BEFORE moving focus so close restores it.
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const pick = (item: PaletteItem) => {
    if (item.kind === "nav") onNav(item.to!);
    else onGo(item.type!, item.id);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(all.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && all[active]) {
      e.preventDefault();
      pick(all[active]);
    } else if (e.key === "Tab") {
      // Modal focus trap: keep focus inside the palette (the input owns it).
      e.preventDefault();
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="glass w-full max-w-xl overflow-hidden rounded-2xl shadow-2xl shadow-black/50 animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-[var(--glass-border)] px-4 py-3">
          <Search className="size-4 text-slate-500" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search anything…"
            role="combobox"
            aria-expanded={all.length > 0}
            aria-controls="palette-listbox"
            aria-activedescendant={all.length > 0 && active >= 0 && active < all.length ? `palette-opt-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search records and commands"
            className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div id="palette-listbox" role="listbox" aria-label="Commands and results" className="max-h-[50vh] overflow-y-auto py-2">
          {all.length === 0 && ql ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500">No results for “{q}”.</div>
          ) : all.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500">Type to search records, or pick a shortcut below.</div>
          ) : (
            all.map((item, i) => (
              <button
                key={item.id}
                id={`palette-opt-${i}`}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                onClick={() => pick(item)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === active ? "bg-[var(--surface-hover)]" : ""}`}
              >
                {item.kind === "record" ? (
                  <span className="w-16 shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-center text-[10px] font-medium uppercase tracking-wider text-teal-400">{item.type}</span>
                ) : (
                  <span className="w-16 shrink-0 rounded-md bg-accent-500/12 px-1.5 py-0.5 text-center text-[10px] font-medium uppercase tracking-wider text-accent-400">Go</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white">{item.label}</span>
                  {item.sub && <span className="block truncate text-xs text-slate-500">{item.sub}</span>}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--glass-border)] px-4 py-2 text-[10px] text-slate-600">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span><Kbd>↵</Kbd> open</span>
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            <span><Kbd>/</Kbd> search</span>
            <span><Kbd>N</Kbd> lead · <Kbd>D</Kbd> deal · <Kbd>T</Kbd> task</span>
            <span><Kbd>?</Kbd> shortcuts</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Quick create (spec §14) — the primary "+ New" affordance in the topbar ──
function QuickCreate() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const focusItem = (i: number) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (items.length) items[Math.max(0, Math.min(i, items.length - 1))].focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onKey);
    window.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onKey);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusItem(idx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(idx < 0 ? items.length - 1 : idx - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(items.length - 1); }
  };

  const actions = [
    { label: "Lead", to: "/leads?new=1", icon: Target },
    { label: "Contact", to: "/contacts?new=1", icon: Users },
    { label: "Account", to: "/accounts?new=1", icon: Building2 },
    { label: "Deal", to: "/deals?new=1", icon: Briefcase },
    { label: "Task", to: "/activities?new=1", icon: CheckSquare },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn-primary"
        aria-label="Create new record"
      >
        <span className="hidden sm:inline">+ New</span>
        <Plus className="size-4 sm:hidden" />
        <ChevronDown className="hidden size-3.5 opacity-70 sm:inline" />
      </button>
      {open && (
        <div ref={menuRef} role="menu" className="glass absolute right-0 top-full z-40 mt-2 w-48 overflow-hidden rounded-xl p-1.5 shadow-2xl shadow-black/40 animate-fade-up">
          {actions.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              onClick={() => { setOpen(false); navigate(a.to); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-[var(--surface-hover)] hover:text-white"
            >
              <a.icon className="size-4 text-accent-400" />
              New {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}