import type { ReactNode } from "react";
import { DemoRequest } from "./DemoRequest";

const ASCII = String.raw`
 ██████╗  ██████╗ ██████╗ ██╗   ██╗███████╗██╗  ██╗ █████╗
██╔═══██╗██╔═══██╗██╔══██╗██║   ██║██╔════╝╚██╗██╔╝██╔══██╗
██║   ██║██║   ██║██████╔╝██║   ██║█████╗   ╚███╔╝ ███████║
██║▄▄ ██║██║   ██║██╔══██╗╚██╗ ██╔╝██╔══╝   ██╔██╗ ██╔══██║
╚██████╔╝╚██████╔╝██║  ██║ ╚████╔╝ ███████╗██╔╝ ██╗██║  ██║
 ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝
`;

const FEATURES = [
  {
    icon: "⚡",
    title: "Unified CRM",
    body: "Contacts, accounts, leads, deals, tickets — one data model with relationships, custom fields, and full audit trails. Every mutation is tracked with field-level diffs.",
  },
  {
    icon: "🔄",
    title: "Automation Engine",
    body: "Visual trigger → condition → action builder. Auto-assign leads, send emails, create tasks, and update records when events fire — all from the event bus.",
  },
  {
    icon: "📊",
    title: "Live Analytics",
    body: "Dashboards computed on read — never stale. Sales velocity, win rate, campaign ROI, SLA health, and revenue metrics with full data lineage on every number.",
  },
  {
    icon: "🤖",
    title: "AI Copilot",
    body: "Summaries, email drafts, sentiment analysis, and natural-language search — powered by a model router that picks the best provider for each task. Data firewall redacts PII before any prompt.",
  },
  {
    icon: "🎯",
    title: "Marketing Automation",
    body: "Email campaigns with A/B testing, landing pages with lead capture, and journey orchestration. Track deliverability with a real-time health score.",
  },
  {
    icon: "🛡️",
    title: "Enterprise Security",
    body: "MFA, IP allowlisting, DB-backed sessions, SCIM 2.0 provisioning, GDPR consent management, and data retention policies. SOC 2-ready from day one.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Connect your data",
    body: "Import contacts, leads, and deals from CSV or connect your existing tools. QORVEXA deduplicates and merges records automatically.",
  },
  {
    step: "02",
    title: "Set up your pipeline",
    body: "Define stages, assign owners, and configure round-robin routing. Your sales team gets a pipeline board with drag-and-drop and real-time forecasting.",
  },
  {
    step: "03",
    title: "Automate the busywork",
    body: "Build workflows that trigger on events — new lead → assign owner → send welcome email → create follow-up task. No code required.",
  },
  {
    step: "04",
    title: "Measure everything",
    body: "Dashboards update in real time. Track revenue, pipeline health, campaign performance, and customer satisfaction — all with explainable data lineage.",
  },
];

const USE_CASES = [
  { label: "Sales Teams", desc: "Pipeline management, lead routing, deal forecasting, and activity tracking in one place." },
  { label: "Customer Support", desc: "Ticketing with SLA tracking, knowledge base, self-service portal, and escalation workflows." },
  { label: "Marketing", desc: "Campaign automation, landing pages, A/B testing, and deliverability monitoring." },
  { label: "Revenue Operations", desc: "CPQ, contracts, subscriptions, invoicing, and MRR/ARR metrics with full audit trails." },
];

const STATS: [string, string][] = [
  ["6", "object types"],
  ["100%", "mutations audited"],
  ["<200ms", "dashboard load"],
  ["0", "stale metrics"],
];

export function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 text-xs">
          <span className="font-bold tracking-[0.3em] text-primary">QORVEXA</span>
          <nav className="hidden gap-6 text-muted-foreground sm:flex">
            <a href="#features" className="hover:text-primary">features</a>
            <a href="#how-it-works" className="hover:text-primary">how it works</a>
            <a href="#use-cases" className="hover:text-primary">use cases</a>
            <a href="/app" className="hover:text-primary">sign in</a>
          </nav>
          <a
            href="#demo"
            className="rounded-md bg-primary px-3 py-1.5 font-bold text-primary-foreground transition hover:opacity-90"
          >
            Request a demo
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5">
        {/* HERO */}
        <section className="py-16 sm:py-24">
          <div className="overflow-x-auto">
            <pre
              aria-label="QORVEXA"
              className="glow-text w-max text-[0.42rem] leading-[1.15] text-primary sm:text-[0.7rem] md:text-[0.95rem]"
            >
              {ASCII}
            </pre>
          </div>

          <h1 className="mt-10 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">
            The operating system for your entire business.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            QORVEXA unifies CRM, support, marketing, and revenue operations into a single platform.
            Every record, every event, every metric — connected, audited, and AI-powered.
          </p>

          <div className="mt-8 flex flex-wrap gap-3 text-xs sm:text-sm">
            <a
              href="/app"
              className="rounded-md bg-primary px-6 py-3 font-bold text-primary-foreground transition hover:opacity-90"
            >
              Open the app →
            </a>
            <a
              href="#demo"
              className="rounded-md border border-border px-5 py-3 font-semibold text-foreground transition hover:border-primary hover:text-primary"
            >
              Request a demo
            </a>
            <a
              href="#features"
              className="rounded-md border border-border px-5 py-3 font-semibold text-foreground transition hover:border-primary hover:text-primary"
            >
              See features
            </a>
          </div>

          <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
            {STATS.map(([v, l]) => (
              <div key={l} className="bg-card px-5 py-6">
                <dt className="text-2xl font-bold text-primary sm:text-3xl">{v}</dt>
                <dd className="mt-1 text-[0.7rem] uppercase tracking-widest text-muted-foreground">
                  {l}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* FEATURES */}
        <section id="features" className="border-t border-border py-16">
          <SectionLabel>// features</SectionLabel>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.title} className="panel p-6">
                <span className="text-2xl">{f.icon}</span>
                <h3 className="mt-4 text-base font-bold">{f.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="border-t border-border py-16">
          <SectionLabel>// how it works</SectionLabel>
          <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((h) => (
              <div key={h.step} className="bg-card p-6">
                <span className="text-xs text-accent">{h.step}</span>
                <h3 className="mt-3 text-base font-bold">{h.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{h.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* USE CASES */}
        <section id="use-cases" className="border-t border-border py-16">
          <SectionLabel>// built for</SectionLabel>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {USE_CASES.map((u) => (
              <article key={u.label} className="panel p-6">
                <h3 className="text-base font-bold">{u.label}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{u.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* TECHNICAL DIFFERENTIATORS */}
        <section className="border-t border-border py-16">
          <SectionLabel>// what makes it different</SectionLabel>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Capability
              title="Event-sourced architecture"
              items={[
                "Every state change emits a persisted event — deal.stage_changed, lead.routed, ticket.escalated",
                "Events are visible in the UI, auditable, and deliverable to webhooks",
                "Event bus powers automation, marketing journeys, AI learning, and CDP behavior tracking",
              ]}
            />
            <Capability
              title="AI with a data firewall"
              items={[
                "Prompts are server-built and PII is redacted before any model sees them",
                "Model router picks the best provider for each task with full explainability",
                "Confidence scoring flags low-quality outputs for human review",
              ]}
            />
            <Capability
              title="Real-time analytics"
              items={[
                "Metrics computed on read — dashboards are never stale",
                "Every number carries data lineage showing exactly where it came from",
                "Threshold alerts notify admins when metrics go out of bounds",
              ]}
            />
            <Capability
              title="Enterprise-ready security"
              items={[
                "MFA with TOTP + recovery codes, DB-backed sessions with device tracking",
                "IP/CIDR allowlisting, SCIM 2.0 provisioning, GDPR consent management",
                "Full audit trail with field-level diffs on every mutation",
              ]}
            />
          </div>
        </section>

        {/* STACK */}
        <section className="border-t border-border py-16">
          <SectionLabel>// built on</SectionLabel>
          <table className="mt-8 w-full text-sm">
            <tbody>
              {[
                ["API", "Express 5 (REST) + signed-cookie sessions"],
                ["Database", "MongoDB 7 via Prisma 6"],
                ["Frontend", "React 19 + Vite 8 + Tailwind v4"],
                ["AI", "OpenAI GPT-4o with data firewall + redaction"],
                ["Email", "Resend / SendGrid with webhook tracking"],
                ["Telephony", "Twilio with status callbacks"],
              ].map(([layer, tech]) => (
                <tr key={layer} className="border-b border-border">
                  <th className="w-28 py-3 text-left align-top font-bold text-accent">{layer}</th>
                  <td className="py-3 text-muted-foreground">{tech}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <DemoRequest />

        <section className="border-t border-border py-20 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">
            One platform. Every team. Zero data silos.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground">
            Sales, support, marketing, and revenue — connected by an event bus, secured by enterprise-grade controls, and enhanced by AI.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="/app"
              className="rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Open the app
            </a>
            <a
              href="#demo"
              className="rounded-md border border-border px-6 py-3 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary"
            >
              Request a demo
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>QORVEXA CRM — the operating system for your business.</span>
          <span>Multi-tenant · event-sourced · audited</span>
        </div>
      </footer>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs uppercase tracking-[0.35em] text-accent">{children}</h2>
  );
}

function Capability({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="panel p-6">
      <h3 className="text-base font-bold">{title}</h3>
      <ul className="mt-4 space-y-3">
        {items.map((i) => (
          <li key={i} className="flex gap-3 text-sm text-muted-foreground">
            <span className="text-primary">→</span>
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
