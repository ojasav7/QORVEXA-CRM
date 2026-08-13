// Seed script — the "cold-start onboarding data seeding" feature from the blueprint.
// Usage:  npm run seed
// Creates (idempotent, by fixed emails): demo org, users, accounts, contacts,
// leads, opportunities across the pipeline, tasks, notes, custom fields.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { db } from "./db";
import { PIPELINE } from "./lib/registry";
import { stageProbability } from "./lib/registry";
import { emitEvent } from "./lib/events";
import { ensureDefaultPipeline, listPipelines, slugifyStageKey } from "./lib/pipelines";
import { trackingToken } from "./lib/comm";
// Phase 7 · CDP / Customer 360
import { ensureProfileForRecord } from "./lib/cdp";
import { refreshHealth } from "./lib/health";
// Phase 8 · AI Assistant Layer
import { ensureDefaultModels, saveInsight, scoreLead, summarizeRecord } from "./lib/ai";
// Phase 9 · AI Agent Platform
import { runAgent } from "./lib/agents";
// Phase 11 · Customer Success
import { addSurveyResponse, createProgram, enrollMember } from "./lib/success";

const ORG_EMAIL = "admin@qorvexa.dev";
const ORG_NAME = "Qorvexa Demo Inc";
const ORG_SLUG = "qorvexa-demo";

async function ensureUser(p: PrismaClient, orgId: string, name: string, email: string, role: string, title: string) {
  const existing = await p.user.findUnique({ where: { email } });
  if (existing) return existing;
  return p.user.create({
    data: { orgId, name, email, passwordHash: await bcrypt.hash("password123", 10), role, title },
  });
}

async function main() {
  const p = db();
  console.log("Seeding QORVEXA demo data…");

  let org = await p.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) org = await p.organization.create({ data: { name: ORG_NAME, slug: ORG_SLUG, settings: {} } });
  const orgId = org.id;

  const admin = await ensureUser(p, orgId, "Ava Morgan", ORG_EMAIL, "admin", "Head of Revenue");
  const priya = await ensureUser(p, orgId, "Priya Sharma", "priya@qorvexa.dev", "manager", "Sales Manager");
  const leo = await ensureUser(p, orgId, "Leo Fischer", "leo@qorvexa.dev", "rep", "Account Executive");

  // Custom fields demo (idempotent)
  const existingField = await p.fieldDef.findFirst({ where: { orgId, objectType: "contact", key: "linkedin" } });
  if (!existingField) {
    await p.fieldDef.createMany({
      data: [
        { orgId, objectType: "contact", key: "linkedin", label: "LinkedIn", type: "url", order: 0 },
        { orgId, objectType: "contact", key: "employeeSize", label: "Employee size", type: "number", order: 1 },
        { orgId, objectType: "account", key: "annualRevenue", label: "Annual revenue", type: "number", order: 0 },
      ],
    });
  }

  // Accounts
  const accountSeeds = [
    { name: "Northwind Traders", industry: "Retail", tier: "Enterprise", employees: 4200, website: "northwind.example" },
    { name: "Globex Corporation", industry: "Manufacturing", tier: "Mid-Market", employees: 850, website: "globex.example" },
    { name: "Initech", industry: "Technology", tier: "SMB", employees: 120, website: "initech.example" },
    { name: "Umbrella Labs", industry: "Healthcare", tier: "Enterprise", employees: 3100, website: "umbrella.example" },
  ];
  const accounts: Record<string, string> = {};
  for (const a of accountSeeds) {
    const existing = await p.account.findFirst({ where: { orgId, name: a.name } });
    if (existing) {
      accounts[a.name] = existing.id;
      continue;
    }
    const created = await p.account.create({ data: { orgId, ownerId: leo.id, ...a, tags: ["key-account"], visibility: "org", custom: a.name === "Northwind Traders" ? { annualRevenue: 240_000_000 } : {} } });
    accounts[a.name] = created.id;
    await emitEvent({ orgId, type: "account.created", entity: "account", entityId: created.id, actorId: admin.id });
  }

  // Contacts
  const contactSeeds = [
    { firstName: "Elena", lastName: "Rodriguez", email: "elena@northwind.example", title: "VP Operations", account: "Northwind Traders", phone: "+1 212 555 0111" },
    { firstName: "Marcus", lastName: "Chen", email: "marcus@globex.example", title: "CTO", account: "Globex Corporation", phone: "+1 415 555 0122" },
    { firstName: "Sarah", lastName: "Kim", email: "sarah@initech.example", title: "Head of Growth", account: "Initech", phone: "+1 206 555 0133" },
    { firstName: "David", lastName: "Okafor", email: "david@umbrella.example", title: "COO", account: "Umbrella Labs", phone: "+1 617 555 0144" },
    { firstName: "Hana", lastName: "Tanaka", email: "hana@northwind.example", title: "Procurement Lead", account: "Northwind Traders", phone: "+1 212 555 0155" },
  ];
  for (const c of contactSeeds) {
    const existing = await p.contact.findFirst({ where: { orgId, email: c.email } });
    if (existing) continue;
    const created = await p.contact.create({
      data: {
        orgId, ownerId: leo.id, accountId: accounts[c.account], firstName: c.firstName, lastName: c.lastName,
        email: c.email, title: c.title, phone: c.phone, source: "Referral", status: "contacted",
        tags: ["prospect"], visibility: "org", custom: { linkedin: `https://linkedin.com/in/${c.firstName.toLowerCase()}-${c.lastName.toLowerCase()}`, employeeSize: c.account === "Northwind Traders" ? 4200 : undefined },
      },
    });
    await emitEvent({ orgId, type: "contact.created", entity: "contact", entityId: created.id, actorId: leo.id });
  }

  // Leads
  const leadSeeds = [
    { firstName: "Tom", lastName: "Baxter", email: "tom@brightstart.example", company: "Brightstart", source: "Website", score: 72 },
    { firstName: "Ivy", lastName: "Nguyen", email: "ivy@nexuswave.example", company: "Nexuswave", source: "Cold outreach", score: 45 },
    { firstName: "Omar", lastName: "Haddad", email: "omar@falconpeak.example", company: "Falconpeak", source: "Event", score: 88 },
    { firstName: "Zoe", lastName: "Lindqvist", email: "zoe@holmwood.example", company: "Holmwood Group", source: "Referral", score: 61 },
  ];
  for (const l of leadSeeds) {
    const existing = await p.lead.findFirst({ where: { orgId, email: l.email } });
    if (existing) continue;
    const created = await p.lead.create({ data: { orgId, ownerId: priya.id, ...l, status: l.score >= 70 ? "qualified" : "contacted", tags: [], visibility: "org", custom: {} } });
    await emitEvent({ orgId, type: "lead.created", entity: "lead", entityId: created.id, actorId: priya.id });
  }

  // Pipelines (Phase 2-lite) — a default "Sales" pipeline seeded from the
  // registry + a second "Renewals" pipeline to demo multi-pipeline.
  const salesPipelineId = await ensureDefaultPipeline(orgId, "production");
  // Backfill: deals created before the pipelineId column existed have NO
  // pipelineId field (Prisma/Mongo treats missing ≠ null) — stamp them onto the
  // default pipeline at the RAW level so list filters resolve them (see
  // server/scripts/backfill-pipeline.ts for the standalone version).
  await (p as any).$runCommandRaw({
    update: "Opportunity",
    updates: [
      {
        // orgId/pipelineId are stored as ObjectIds — extended JSON ($oid).
        q: { orgId: { $oid: orgId }, $or: [{ pipelineId: { $exists: false } }, { pipelineId: null }] },
        u: { $set: { pipelineId: { $oid: salesPipelineId } } },
        multi: true,
      },
    ],
  });
  let renewalsPipelineId: string | null = null;
  const existingPipelines = await listPipelines(orgId, "production");
  const renewals = existingPipelines.find((pp) => pp.name === "Renewals");
  if (renewals) {
    renewalsPipelineId = renewals.id;
  } else {
    const renewalsStages = [
      { label: "Renewal due", probability: 30 },
      { label: "Proposal", probability: 55 },
      { label: "Negotiation", probability: 75 },
      { label: "Won", probability: 100 },
      { label: "Lost", probability: 0 },
    ].map((s, i) => ({ key: slugifyStageKey(s.label), label: s.label, probability: s.probability, order: i }));
    const createdRenewals = await (p as any).pipeline.create({
      data: { orgId, environment: "production", name: "Renewals", isDefault: false, stages: renewalsStages },
    });
    renewalsPipelineId = createdRenewals.id;
  }
  // Re-fetch AFTER both pipelines exist so stage-probability lookups resolve.
  const pipelinesAfter = await listPipelines(orgId, "production");

  // Opportunities across the pipeline (all on Sales except one on Renewals)
  const dealSeeds = [
    { name: "Northwind — Retail Platform Expansion", account: "Northwind Traders", amount: 180_000, stage: "negotiation", closeInDays: 21, pipelineId: salesPipelineId },
    { name: "Globex — ERP Integration", account: "Globex Corporation", amount: 95_000, stage: "proposal", closeInDays: 35, pipelineId: salesPipelineId },
    { name: "Initech — Growth Plan", account: "Initech", amount: 24_000, stage: "qualified", closeInDays: 60, pipelineId: salesPipelineId },
    { name: "Umbrella — Compliance Suite", account: "Umbrella Labs", amount: 320_000, stage: "discovery", closeInDays: 90, pipelineId: salesPipelineId },
    { name: "Northwind — Support Add-on", account: "Northwind Traders", amount: 12_000, stage: "won", closeInDays: -14, pipelineId: salesPipelineId },
    { name: "Globex — Pilot", account: "Globex Corporation", amount: 8_000, stage: "lost", closeInDays: -30, pipelineId: salesPipelineId },
    { name: "Umbrella — License Renewal", account: "Umbrella Labs", amount: 40_000, stage: "proposal", closeInDays: 45, pipelineId: renewalsPipelineId },
  ];
  for (const d of dealSeeds) {
    const existing = await p.opportunity.findFirst({ where: { orgId, name: d.name } });
    if (existing) continue;
    const closeDate = new Date(Date.now() + d.closeInDays * 86_400_000);
    // probability from the pipeline's stage definition (the registry default
    // pipeline keeps the old values; Renewals uses its own).
    const stageDef = pipelinesAfter.find((pp) => pp.id === d.pipelineId)?.stages.find((s) => s.key === d.stage);
    const probability = stageDef?.probability ?? stageProbability(d.stage);
    const created = await p.opportunity.create({
      data: { orgId, ownerId: leo.id, accountId: accounts[d.account], name: d.name, amount: d.amount, stage: d.stage, probability, closeDate, pipelineId: d.pipelineId, tags: [], visibility: "org", custom: {} },
    });
    await emitEvent({ orgId, type: "deal.created", entity: "opportunity", entityId: created.id, actorId: leo.id, payload: { stage: d.stage } });
  }

  // Tasks + notes
  const tasks = [
    { title: "Send proposal to Globex", dueInDays: 2, priority: "high", status: "todo" },
    { title: "Follow up with Elena (Northwind)", dueInDays: 1, priority: "medium", status: "todo" },
    { title: "Update Umbrella deal stage", dueInDays: 0, priority: "medium", status: "in_progress" },
  ];
  for (const t of tasks) {
    const existing = await p.task.findFirst({ where: { orgId, title: t.title } });
    if (existing) continue;
    await p.task.create({ data: { orgId, ownerId: leo.id, title: t.title, dueAt: new Date(Date.now() + t.dueInDays * 86_400_000), priority: t.priority, status: t.status, tags: [], visibility: "org", custom: {} } });
  }
  await p.note.create({ data: { orgId, authorId: leo.id, accountId: accounts["Northwind Traders"], body: "Elena wants a security review before we close. Shared the SOC2 report." } });

  // ── Phase 2 · Communication Core (email templates, messages, calls, meetings, booking) ──
  // Email templates (idempotent by name)
  const templateSeeds = [
    {
      name: "Intro call follow-up",
      category: "follow-up",
      subject: "Great talking — next steps",
      body: "Hi {{contact.firstName}},\n\nThanks for the time today. As promised, here's the next step for {{account.name}}:\n\n- Proposal & pricing → this week\n- Security questionnaire → shared separately\n\nTalk soon,\nLeo",
    },
    {
      name: "Proposal sent",
      category: "sales",
      subject: "Proposal for {{account.name}} — {{deal.name}}",
      body: "Hi {{contact.firstName}},\n\nAttached is our proposal for {{deal.name}} ({{deal.amount}}). We'd love to walk through it whenever suits.\n\nBest,\nLeo",
    },
    {
      name: "Renewal reminder",
      category: "marketing",
      subject: "Your {{account.name}} renewal is coming up",
      body: "Hi {{contact.firstName}},\n\nYour {{account.name}} renewal is due soon. Let's find a time to review usage and pricing.\n\nThanks,\nThe Qorvexa team",
    },
  ];
  for (const t of templateSeeds) {
    const existing = await p.emailTemplate.findFirst({ where: { orgId, name: t.name } });
    if (existing) continue;
    await p.emailTemplate.create({ data: { orgId, environment: "production", name: t.name, category: t.category, subject: t.subject, body: t.body, active: true, createdBy: leo.id } });
  }

  // A sent email (with tracking token) + a received reply thread, auto-logged to a contact.
  const elena = await p.contact.findFirst({ where: { orgId, email: "elena@northwind.example" } });
  const marcus = await p.contact.findFirst({ where: { orgId, email: "marcus@globex.example" } });
  const northwindDeal = await p.opportunity.findFirst({ where: { orgId, name: "Northwind — Retail Platform Expansion" } });
  if (elena && !(await p.message.findFirst({ where: { orgId, subject: "Great talking — next steps" } }))) {
    const thread = trackingToken();
    await p.message.create({
      data: {
        orgId, environment: "production", direction: "out", threadId: thread, trackingToken: trackingToken(),
        fromEmail: leo.email, toEmail: elena.email!, subject: "Great talking — next steps",
        body: "Hi Elena,\n\nThanks for the time today. Here's the next step for Northwind Traders:\n\n- Proposal & pricing → this week\n- Security questionnaire → shared separately\n\nTalk soon,\nLeo",
        status: "sent", ownerId: leo.id, contactId: elena.id, opportunityId: northwindDeal?.id ?? null,
        createdAt: new Date(Date.now() - 86_400_000),
      },
    });
  }
  if (marcus && !(await p.message.findFirst({ where: { orgId, subject: "Re: Qorvexa trial feedback" } }))) {
    await p.message.create({
      data: {
        orgId, environment: "production", direction: "in", threadId: trackingToken(),
        fromEmail: "marcus@globex.example", toEmail: leo.email, subject: "Re: Qorvexa trial feedback",
        body: "The pipeline view is great. Could you send over the pricing page again?",
        status: "sent", ownerId: leo.id, contactId: marcus.id,
        createdAt: new Date(Date.now() - 3_600_000),
      },
    });
  }

  // Call log demo (one completed call, recording + transcript via mock provider).
  if (elena && !(await p.call.findFirst({ where: { orgId, phone: "+1 212 555 0111" } }))) {
    await p.call.create({
      data: {
        orgId, environment: "production", direction: "out", phone: "+1 212 555 0111", durationSec: 642,
        status: "completed", notes: "Elena wants a security review before closing. Shared SOC2 report.",
        contactId: elena.id, ownerId: leo.id, startedAt: new Date(Date.now() - 48 * 3_600_000),
        recordingUrl: "/api/mock/media/calls/demo.wav",
        transcript: "You: Thanks for taking the time to talk today.\nElena: We're focused on reducing manual data entry.\nYou: I'll send over a proposal with next steps by end of week.",
      },
    });
  }

  // Meetings — one upcoming scheduled, one completed.
  if (elena && !(await p.meeting.findFirst({ where: { orgId, title: "Northwind — security review" } }))) {
    await p.meeting.create({
      data: {
        orgId, environment: "production", title: "Northwind — security review",
        startsAt: new Date(Date.now() + 2 * 86_400_000), endsAt: new Date(Date.now() + 2 * 86_400_000 + 30 * 60_000),
        status: "scheduled", location: "virtual", contactId: elena.id, ownerId: leo.id,
      },
    });
  }
  if (marcus && !(await p.meeting.findFirst({ where: { orgId, title: "Globex — trial review" } }))) {
    await p.meeting.create({
      data: {
        orgId, environment: "production", title: "Globex — trial review",
        startsAt: new Date(Date.now() - 2 * 86_400_000), endsAt: new Date(Date.now() - 2 * 86_400_000 + 30 * 60_000),
        status: "completed", location: "virtual", contactId: marcus.id, ownerId: leo.id,
      },
    });
  }

  // One public booking page (host pool = managers + reps, round-robin).
  if (!(await p.bookingPage.findFirst({ where: { orgId, slug: "intro-call" } }))) {
    await p.bookingPage.create({
      data: {
        orgId, name: "Intro call — Qorvexa", slug: "intro-call", description: "A 30-minute intro call to see QORVEXA in action.",
        durationMins: 30, bufferMins: 5, hostPool: [priya.id, leo.id], cursor: 0,
        availableDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17, timezone: "UTC", active: true,
      },
    });
  }

  // ── Phase 3 · Automation & Workflow Engine ───────────────────────────────
  // Two demo workflows (idempotent by name) proving trigger → condition → action
  // over the event bus, plus one notification so the header bell has content.
  const workflowSeeds = [
    {
      name: "Celebrate won deals",
      description: "When a deal moves to won with a value of $50k+, notify the owner and schedule a handover task.",
      trigger: { kind: "event", event: "deal.stage_changed", to: "won" },
      conditions: [{ field: "amount", op: "gte", value: 50000 }],
      actions: [
        { type: "notify", title: "Deal won 🎉", body: "{{name}} closed for {{amount}} — great work!", target: "owner" },
        { type: "create_task", title: "Handover follow-up: {{name}}", description: "Coordinate delivery kickoff for {{name}}.", dueInDays: 3, priority: "high" },
      ],
    },
    {
      name: "Hot lead follow-up",
      description: "When a lead with score ≥ 70 arrives, ping the owner to qualify it fast.",
      trigger: { kind: "event", event: "lead.created" },
      conditions: [{ field: "score", op: "gte", value: 70 }],
      actions: [{ type: "notify", title: "Hot lead inbound 🔥", body: "{{firstName}} {{lastName}} from {{company}} (score {{score}}) needs a callback.", target: "owner" }],
    },
  ];
  for (const w of workflowSeeds) {
    const existing = await p.automation.findFirst({ where: { orgId, name: w.name } });
    if (existing) continue;
    await p.automation.create({
      data: {
        orgId, environment: "production", name: w.name, description: w.description,
        trigger: w.trigger as object, conditions: w.conditions as object, actions: w.actions as object,
        active: true, createdBy: admin.id,
      },
    });
  }
  if (!(await p.notification.findFirst({ where: { orgId, title: "Welcome to Phase 3 ✨" } }))) {
    await p.notification.create({
      data: {
        orgId, environment: "production", userId: admin.id, kind: "system",
        title: "Welcome to Phase 3 ✨",
        body: "Workflows are live — the event bus now automates follow-ups. Try building one in Workflows, or use the test button to try these on a deal.",
        link: "/workflows",
      },
    });
  }

  // ── Phase 4 · Customer Service / Helpdesk ──────────────────────────────
  // SLA policy (default targets; idempotent), a public portal page, knowledge
  // articles, and tickets across statuses/priorities — including one breached,
  // one escalated, one on legal hold, plus a reply thread so the UI has data.
  const existingSla = await p.slaPolicy.findFirst({ where: { orgId, environment: "production" } });
  if (!existingSla) {
    await p.slaPolicy.create({
      data: {
        orgId, environment: "production", name: "Default", active: true,
        targets: {
          low: { responseHours: 24 }, medium: { responseHours: 8 },
          high: { responseHours: 4 }, urgent: { responseHours: 1 },
        },
      },
    });
  }
  if (!(await p.portalPage.findFirst({ where: { orgId, slug: "support" } }))) {
    await p.portalPage.create({
      data: {
        orgId, environment: "production", name: "Qorvexa Support", slug: "support",
        description: "We usually reply within a day. Submit a ticket and track it by reference.",
        autoCreateContact: true, active: true,
      },
    });
  }
  const kbSeeds = [
    {
      title: "How to export your data", slug: "export-data", category: "account", published: true,
      body: "Go to Settings → Export to download a CSV of any object type. Exports respect the current environment.",
      tags: ["export", "data"],
    },
    {
      title: "Billing & refunds", slug: "billing-refunds", category: "billing", published: true,
      body: "Refunds are processed within 5 business days of approval. Enterprise customers get Net-30 terms.",
      tags: ["billing", "refund"],
    },
    {
      title: "Setting up email tracking", slug: "email-tracking", category: "technical", published: true,
      body: "Outbound emails automatically include an open pixel and click redirect. Open and click events appear on the email's timeline.",
      tags: ["email", "tracking"],
    },
  ];
  for (const a of kbSeeds) {
    const existing = await p.knowledgeArticle.findFirst({ where: { orgId, slug: a.slug } });
    if (existing) continue;
    await p.knowledgeArticle.create({
      data: { orgId, environment: "production", ...a, authorId: admin.id, tags: a.tags, published: a.published, viewCount: Math.floor(Math.random() * 40) },
    });
  }

  const elenaContact = await p.contact.findFirst({ where: { orgId, email: "elena@northwind.example" } });
  const marcusContact = await p.contact.findFirst({ where: { orgId, email: "marcus@globex.example" } });
  const sarahContact = await p.contact.findFirst({ where: { orgId, email: "sarah@initech.example" } });
  const northwindAccount = accounts["Northwind Traders"];
  const ticketSeeds: {
    reference: string; subject: string; status: string; priority: string; channel: string; source: string;
    contactId?: string; accountId?: string; ownerId: string; description: string;
    slaDueAt?: Date; breachedAt?: Date | null; escalated?: boolean; escalatedAt?: Date | null; legalHold?: boolean;
    firstResponseAt?: Date; resolvedAt?: Date | null; createdAt?: Date;
  }[] = [
    {
      reference: "TKT-0001", subject: "Cannot log into the dashboard", status: "open", priority: "urgent", channel: "portal", source: "portal",
      contactId: elenaContact?.id, accountId: northwindAccount, ownerId: leo.id,
      description: "Elena reports a 401 on login after the password reset. Needs urgent look.",
      slaDueAt: new Date(Date.now() - 2 * 3_600_000), breachedAt: new Date(Date.now() - 2 * 3_600_000),
      escalated: true, escalatedAt: new Date(Date.now() - 1 * 3_600_000),
      firstResponseAt: new Date(Date.now() - 5 * 3_600_000), createdAt: new Date(Date.now() - 8 * 3_600_000),
    },
    {
      reference: "TKT-0002", subject: "Invoice #2210 looks incorrect", status: "pending", priority: "medium", channel: "email", source: "email",
      contactId: marcusContact?.id, ownerId: priya.id,
      description: "Marcus says the invoice total doesn't match the agreed proposal amount.",
      slaDueAt: new Date(Date.now() + 3 * 3_600_000),
      firstResponseAt: new Date(Date.now() - 20 * 3_600_000), createdAt: new Date(Date.now() - 26 * 3_600_000),
    },
    {
      reference: "TKT-0003", subject: "Feature request: bulk edit contacts", status: "new", priority: "low", channel: "web", source: "portal",
      contactId: sarahContact?.id, ownerId: leo.id,
      description: "Would love a checkbox-select + bulk edit on the contacts table.",
      slaDueAt: new Date(Date.now() + 20 * 3_600_000), createdAt: new Date(Date.now() - 1 * 3_600_000),
    },
    {
      reference: "TKT-0004", subject: "Security review questionnaire", status: "resolved", priority: "high", channel: "email", source: "email",
      contactId: elenaContact?.id, accountId: northwindAccount, ownerId: leo.id,
      description: "Shared the SOC2 report and completed the vendor security questionnaire.",
      slaDueAt: new Date(Date.now() - 10 * 3_600_000),
      firstResponseAt: new Date(Date.now() - 48 * 3_600_000), resolvedAt: new Date(Date.now() - 12 * 3_600_000),
      createdAt: new Date(Date.now() - 60 * 3_600_000),
    },
    {
      reference: "TKT-0005", subject: "Contract dispute — Umbrella account", status: "open", priority: "urgent", channel: "web", source: "portal",
      contactId: marcusContact?.id, ownerId: admin.id,
      description: "Legal requested a hold on this ticket pending dispute review. No edits allowed.",
      slaDueAt: new Date(Date.now() + 6 * 3_600_000), legalHold: true, createdAt: new Date(Date.now() - 4 * 3_600_000),
    },
  ];
  for (const t of ticketSeeds) {
    const existing = await p.ticket.findFirst({ where: { orgId, reference: t.reference } });
    if (existing) continue;
    await p.ticket.create({
      data: {
        orgId, environment: "production", reference: t.reference, subject: t.subject, status: t.status,
        priority: t.priority, channel: t.channel, source: t.source, ownerId: t.ownerId,
        contactId: t.contactId ?? null, accountId: t.accountId ?? null,
        description: t.description, slaDueAt: t.slaDueAt ?? null, breachedAt: t.breachedAt ?? null,
        escalated: t.escalated ?? false, escalatedAt: t.escalatedAt ?? null, legalHold: t.legalHold ?? false,
        firstResponseAt: t.firstResponseAt ?? null, resolvedAt: t.resolvedAt ?? null,
        createdAt: t.createdAt ?? new Date(), updatedAt: new Date(), tags: [], custom: {}, visibility: "org",
      },
    });
  }
  // A public reply thread on the open urgent ticket.
  const tkt1 = await p.ticket.findFirst({ where: { orgId, reference: "TKT-0001" } });
  if (tkt1 && !(await p.ticketReply.findFirst({ where: { orgId, ticketId: tkt1.id } }))) {
    await p.ticketReply.create({ data: { orgId, environment: "production", ticketId: tkt1.id, authorId: leo.id, body: "On it — checking the auth logs now.", internal: false } });
    await p.ticketReply.create({ data: { orgId, environment: "production", ticketId: tkt1.id, authorId: leo.id, body: "Found it: the reset token was expired. Issued a fresh link.", internal: true } });
  }

  // ── Phase 5 · Marketing Automation & Journey Orchestration ──────────────
  // A contact segment (the campaign audience), a campaign with A/B subjects,
  // a landing page tied to it, a welcome journey, and deliverability message
  // state so every Marketing page has data on first login.
  const segmentSeeds = [
    {
      name: "All prospects", objectType: "contact",
      criteria: { filters: [{ field: "status", op: "in", value: ["new", "contacted", "qualified"] }] },
    },
    {
      name: "Enterprise accounts", objectType: "account",
      criteria: { filters: [{ field: "tier", op: "eq", value: "Enterprise" }] },
    },
  ];
  for (const s of segmentSeeds) {
    const existing = await p.segment.findFirst({ where: { orgId, name: s.name } });
    if (existing) continue;
    await p.segment.create({ data: { orgId, environment: "production", name: s.name, objectType: s.objectType, criteria: s.criteria as object, active: true, createdBy: admin.id } });
  }

  const prospectsSegment = await p.segment.findFirst({ where: { orgId, name: "All prospects" } });
  const welcomeTemplate = await p.emailTemplate.findFirst({ where: { orgId, name: "Renewal reminder" } });
  let campaign: any = null;
  if (!(await p.campaign.findFirst({ where: { orgId, name: "Q3 Product Update" } }))) {
    campaign = await p.campaign.create({
      data: {
        orgId, environment: "production", name: "Q3 Product Update",
        description: "Announcing the new automation engine to every prospect.",
        status: "sent", subject: "What's new in QORVEXA — Q3",
        body: "Hi {{contact.firstName}},\n\nWe just shipped workflow automation, a helpdesk, and customer journeys. Here's a 2-minute rundown:\n\n- Workflows: automate follow-ups over the event bus\n- Tickets + SLAs: support that escalates itself\n- Journeys: timed email + task sequences\n\nWant a 15-minute tour? Reply and we'll set it up.\n\nBest,\nThe Qorvexa team",
        audienceSegmentId: prospectsSegment?.id ?? null, templateId: welcomeTemplate?.id ?? null,
        ab: { enabled: true, splitA: 60, subjectB: "Q3 is here — automation, helpdesk, journeys" },
        winner: "A", sentCount: 0, createdBy: admin.id,
      },
    });
  } else {
    campaign = await p.campaign.findFirst({ where: { orgId, name: "Q3 Product Update" } });
  }
  // Recipients + messages for the sent campaign (with A/B variants + tracking
  // state) so stats/ROI/winner surfaces have data.
  if (campaign && !(await p.campaignRecipient.findFirst({ where: { orgId, campaignId: campaign.id } }))) {
    const recipients = [
      { contact: elenaContact, variant: "A", opened: true, clicked: true },
      { contact: marcusContact, variant: "A", opened: true, clicked: false },
      { contact: sarahContact, variant: "B", opened: false, clicked: false },
    ];
    for (const r of recipients) {
      if (!r.contact) continue;
      const msg = await p.message.create({
        data: {
          orgId, environment: "production", direction: "out", threadId: trackingToken(), trackingToken: trackingToken(),
          fromEmail: admin.email, toEmail: r.contact.email!, subject: r.variant === "A" ? campaign.subject : (campaign.ab as any).subjectB,
          body: campaign.body, status: r.opened ? (r.clicked ? "clicked" : "opened") : "sent",
          campaignId: campaign.id, templateId: campaign.templateId, contactId: r.contact.id, ownerId: admin.id,
          openedAt: r.opened ? new Date(Date.now() - 2 * 3_600_000) : null,
          clickedAt: r.clicked ? new Date(Date.now() - 90 * 60_000) : null,
          createdAt: new Date(Date.now() - 48 * 3_600_000),
        },
      });
      await p.campaignRecipient.create({
        data: {
          orgId, environment: "production", campaignId: campaign.id, contactId: r.contact.id, messageId: msg.id,
          variant: r.variant, status: r.opened ? (r.clicked ? "clicked" : "opened") : "sent",
          openedAt: r.opened ? new Date(Date.now() - 2 * 3_600_000) : null,
          clickedAt: r.clicked ? new Date(Date.now() - 90 * 60_000) : null,
          createdAt: new Date(Date.now() - 48 * 3_600_000),
        },
      });
    }
    await p.campaign.update({ where: { id: campaign.id }, data: { sentCount: 3, openedCount: 2, clickedCount: 1, updatedAt: new Date() } });
  }

  // Landing page (attributed to the campaign) + a public demo page.
  if (!(await p.landingPage.findFirst({ where: { orgId, slug: "demo" } }))) {
    await p.landingPage.create({
      data: {
        orgId, environment: "production", name: "Book a demo", slug: "demo",
        headline: "See QORVEXA run your whole business",
        subtext: "A 20-minute tour of the pipeline, automation, and journeys — no commitment.",
        ctaLabel: "Book my demo", successMessage: "Thanks — we'll be in touch within a day.",
        theme: "indigo", campaignId: campaign?.id ?? null,
        fields: [
          { key: "firstName", enabled: true }, { key: "lastName", enabled: true }, { key: "email", enabled: true },
          { key: "phone", enabled: false }, { key: "company", enabled: true },
        ],
        active: true,
      },
    });
  }

  // A welcome journey: lead.created → wait 1 day → welcome email → notify owner.
  if (!(await p.journey.findFirst({ where: { orgId, name: "New lead welcome" } }))) {
    await p.journey.create({
      data: {
        orgId, environment: "production", name: "New lead welcome",
        description: "Every new lead gets a follow-up email a day after they arrive, then the owner is pinged.",
        trigger: { kind: "event", event: "lead.created" },
        steps: [
          { type: "wait", days: 1 },
          { type: "send_email", templateId: welcomeTemplate?.id ?? null, subject: "Welcome to the Qorvexa family", body: "Hi {{lead.firstName}},\n\nThanks for your interest in QORVEXA — here's where to start.\n\nBest,\nThe Qorvexa team" },
          { type: "notify", title: "Lead welcome email sent 🎉", body: "{{lead.firstName}} {{lead.lastName}} was sent the welcome email." },
          { type: "end" },
        ],
        active: true, createdBy: admin.id,
      },
    });
  }

  // Deliverability state: the Phase-2 sent email already exists; give the
  // campaign recipients opened/clicked state (above) + one bounced message so
  // the Deliverability page shows a non-perfect health score.
  const bounceTarget = await p.message.findFirst({ where: { orgId, subject: "Great talking — next steps" } });
  if (bounceTarget && !bounceTarget.bouncedAt) {
    await p.message.update({ where: { id: bounceTarget.id }, data: { bouncedAt: new Date(Date.now() - 12 * 3_600_000), updatedAt: new Date() } });
  }

  // ── Phase 6 · Analytics, Forecasting & Business Intelligence ─────────────
  // A forecast snapshot (so the Analytics page has history on first login) +
  // two saved report configs. Metrics themselves are computed on read.
  if (!(await p.forecast.findFirst({ where: { orgId } }))) {
    const openDeals = await p.opportunity.findMany({ where: { orgId, stage: { notIn: ["won", "lost"] } }, select: { stage: true, amount: true, probability: true, ownerId: true } });
    const buckets = { pipeline: 0, weighted: 0, commit: 0, bestCase: 0 };
    const stageMap = new Map<string, { probability: number; count: number; amount: number; weighted: number }>();
    const ownerMap = new Map<string, { pipeline: number; weighted: number }>();
    for (const d of openDeals) {
      const amount = Number(d.amount) || 0;
      const prob = Number(d.probability) || 0;
      buckets.pipeline += amount;
      buckets.weighted += amount * (prob / 100);
      if (prob >= 75) buckets.commit += amount;
      if (prob >= 50) buckets.bestCase += amount;
      const s = stageMap.get(d.stage) ?? { probability: prob, count: 0, amount: 0, weighted: 0 };
      s.count++; s.amount += amount; s.weighted += amount * (prob / 100);
      s.probability = Math.max(s.probability, prob);
      stageMap.set(d.stage, s);
      const o = ownerMap.get(d.ownerId) ?? { pipeline: 0, weighted: 0 };
      o.pipeline += amount; o.weighted += amount * (prob / 100);
      ownerMap.set(d.ownerId, o);
    }
    const owners = await p.user.findMany({ where: { orgId, id: { in: [...ownerMap.keys()] } }, select: { id: true, name: true } });
    const nameById = new Map(owners.map((u) => [u.id, u.name]));
    await p.forecast.create({
      data: {
        orgId, environment: "production",
        buckets: {
          pipeline: Math.round(buckets.pipeline * 100) / 100,
          weighted: Math.round(buckets.weighted * 100) / 100,
          commit: Math.round(buckets.commit * 100) / 100,
          bestCase: Math.round(buckets.bestCase * 100) / 100,
        },
        stages: [...stageMap.entries()].map(([stage, v]) => ({ stage, probability: v.probability, count: v.count, amount: Math.round(v.amount * 100) / 100, weighted: Math.round(v.weighted * 100) / 100 })),
        byOwner: [...ownerMap.entries()].map(([ownerId, v]) => ({ ownerId, ownerName: nameById.get(ownerId) ?? "System", pipeline: Math.round(v.pipeline * 100) / 100, weighted: Math.round(v.weighted * 100) / 100, commit: 0, bestCase: 0 })),
        metricKeys: ["pipelineValue", "weightedPipeline", "winRate", "salesVelocity"],
        createdBy: admin.id,
      },
    });
  }
  const reportSeeds = [
    { name: "Executive pulse", description: "The headline numbers for the week.", kind: "executive", keys: [] },
    { name: "Sales deep dive", description: "Win rate, velocity, and weighted pipeline.", kind: "sales", keys: ["openDeals", "pipelineValue", "weightedPipeline", "winRate", "avgDealSize", "salesVelocity", "pipelineCoverage"] },
  ];
  for (const r of reportSeeds) {
    const existing = await p.report.findFirst({ where: { orgId, name: r.name } });
    if (existing) continue;
    await p.report.create({
      data: { orgId, environment: "production", name: r.name, description: r.description, kind: r.kind, keys: r.keys, active: true, createdBy: admin.id },
    });
  }

  // ── Phase 7 · CDP / Customer 360 ────────────────────────────────────────
  // Unified identities: every contact + lead resolves into an IdentityProfile
  // (email is the canonical key). A duplicate-identity lead with the SAME email
  // as an existing contact is then created and merged in — the live demo of
  // identity resolution (customer.identity_merged on the profile).
  const profileResult = { created: 0, merged: 0 };
  const allContacts = await p.contact.findMany({ where: { orgId, environment: "production" }, select: { id: true, email: true, firstName: true, lastName: true, phone: true, accountId: true, title: true } });
  const allLeads = await p.lead.findMany({ where: { orgId, environment: "production" }, select: { id: true, email: true, firstName: true, lastName: true, phone: true, company: true } });
  for (const c of allContacts) {
    const res = await ensureProfileForRecord(orgId, "production", "contact", c, admin.id);
    if (res?.created) profileResult.created++;
    else if (res?.merged) profileResult.merged++;
  }
  for (const l of allLeads) {
    const res = await ensureProfileForRecord(orgId, "production", "lead", l, admin.id);
    if (res?.created) profileResult.created++;
    else if (res?.merged) profileResult.merged++;
  }
  // The duplicate identity: a landing-page lead that IS Elena Rodriguez (same
  // email) — identity resolution must unify it into her existing profile.
  if (!(await p.lead.findFirst({ where: { orgId, email: "elena@northwind.example", source: "Landing page" } }))) {
    const dupLead = await p.lead.create({
      data: {
        orgId, ownerId: priya.id, firstName: "Elena", lastName: "Rodriguez", email: "elena@northwind.example",
        company: "Northwind Traders", source: "Landing page", score: 55, status: "contacted", tags: [], visibility: "org", custom: {},
      },
    });
    const res = await ensureProfileForRecord(orgId, "production", "lead", dupLead, admin.id);
    if (res?.merged) profileResult.merged++;
  }
  const profiles = await p.identityProfile.findMany({ where: { orgId, environment: "production" } });

  // Behavioral events (source: seed) — page views, a product-usage session, a
  // purchase (the won Support Add-on), campaign opens, and a support ticket, so
  // the Customer 360 touchpoint stream has real data on first login.
  if (!(await p.behaviorEvent.findFirst({ where: { orgId, type: "page_view" } }))) {
    const byEmail = new Map(profiles.map((pr) => [pr.email, pr.id]));
    const h = 3_600_000;
    const seedBehaviors = [
      { type: "page_view", email: "elena@northwind.example", entity: "landing", meta: { page: "/demo", campaign: "Q3 Product Update" }, occurredAt: new Date(Date.now() - 6 * h) },
      { type: "product_use", email: "elena@northwind.example", entity: "app", meta: { feature: "workflows", sessionMin: 24 }, occurredAt: new Date(Date.now() - 5 * h) },
      { type: "purchase", email: "elena@northwind.example", value: 12_000, entity: "opportunity", meta: { product: "Support Add-on" }, occurredAt: new Date(Date.now() - 3 * h) },
      { type: "page_view", email: "marcus@globex.example", entity: "landing", meta: { page: "/pricing" }, occurredAt: new Date(Date.now() - 9 * h) },
      { type: "email_opened", email: "elena@northwind.example", entity: "message", meta: { campaign: "Q3 Product Update" }, occurredAt: new Date(Date.now() - 2 * h) },
      { type: "email_opened", email: "marcus@globex.example", entity: "message", meta: { campaign: "Q3 Product Update" }, occurredAt: new Date(Date.now() - 2 * h) },
      { type: "support_ticket", email: "elena@northwind.example", entity: "ticket", meta: { subject: "Cannot log into the dashboard", priority: "urgent" }, occurredAt: new Date(Date.now() - 8 * h) },
      { type: "ad_click", email: "sarah@initech.example", entity: "ad", meta: { network: "LinkedIn", campaign: "Q3-ads" }, occurredAt: new Date(Date.now() - 20 * h) },
    ];
    for (const b of seedBehaviors) {
      await p.behaviorEvent.create({
        data: {
          orgId, environment: "production", type: b.type, profileId: byEmail.get(b.email) ?? null,
          entity: b.entity, value: (b as any).value ?? null, meta: b.meta, source: "seed",
          occurredAt: b.occurredAt,
        },
      });
    }
  }

  // A persisted health snapshot so the Customers page shows health history on
  // first login (customer.health_changed / customer.churn_risk_changed fire).
  if (!(await p.healthScore.findFirst({ where: { orgId } })) && profiles.length) {
    await refreshHealth(orgId, "production", admin.id);
  }
  const mergedProfiles = profiles.filter((pr) => ((pr.memberIds as string[]) ?? []).length > 1).length;
  console.log(`  CDP: ${profiles.length} unified profiles (${mergedProfiles} merged identities), ${profileResult.created} created, ${profileResult.merged} identity merges`);

  // ── Phase 8 · AI Assistant Layer (non-agentic copilot) ──────────────────
  // Model catalog (lazily seeded defaults), routing + firewall policy in org
  // settings, a couple of persisted AIInsight rows (so the Copilot page has
  // history + the explainability demo on first login), and short-term AI memory.
  await ensureDefaultModels(orgId, "production");
  const orgRow = await p.organization.findUnique({ where: { id: orgId } });
  const orgSettings = (orgRow?.settings ?? {}) as Record<string, unknown>;
  const aiSettings = (orgSettings.ai ?? {}) as Record<string, unknown>;
  if (!aiSettings.preference) {
    orgSettings.ai = {
      ...aiSettings,
      defaultModel: "mock-fast",
      preference: "cost",
      preferredRegion: null,
      firewall: {
        enabled: true, redactEmails: true, redactPhones: true, redactCards: true,
        redactLongNumbers: true, maskMode: "partial", allowlist: [],
      },
    };
    await p.organization.update({ where: { id: orgId }, data: { settings: orgSettings as object } });
  }
  // A seeded deal summary + lead score — generated through the same
  // deterministic engine the API uses, so the Copilot page has history.
  if (!(await p.aiInsight.findFirst({ where: { orgId, kind: "summary" } }))) {
    const seedDeal = await p.opportunity.findFirst({ where: { orgId, name: "Northwind — Retail Platform Expansion" } });
    if (seedDeal) {
      const result = await summarizeRecord(orgId, "production", "opportunity", seedDeal.id);
      await saveInsight(orgId, "production", admin.id, { ...result, modelId: "mock-fast", latencyMs: 120 });
    }
  }
  if (!(await p.aiInsight.findFirst({ where: { orgId, kind: "score" } }))) {
    const seedLead = await p.lead.findFirst({ where: { orgId, email: "tom@brightstart.example" } });
    if (seedLead) {
      const result = await scoreLead(orgId, "production", seedLead.id);
      await saveInsight(orgId, "production", admin.id, { ...result, modelId: "mock-fast", latencyMs: 120 });
    }
  }
  // Short-term AI memory demo (the copilot's per-user scratchpad).
  if (!(await p.aiMemory.findFirst({ where: { orgId, key: "draft.tone" } }))) {
    await p.aiMemory.create({
      data: {
        orgId, environment: "production", scopeType: "user", scopeId: admin.id, key: "draft.tone",
        value: { tone: "follow_up" }, expiresAt: new Date(Date.now() + 7 * 86_400_000), createdBy: admin.id,
      },
    });
  }
  const modelCount = await p.modelRoute.count({ where: { orgId } });
  const insightCount = await p.aiInsight.count({ where: { orgId } });
  console.log(`  AI: model router (${modelCount} models) + data firewall policy + ${insightCount} seeded AI insight(s) + memory`);

  // ── Phase 9 · AI Agent Platform (autonomous, governed) ──────────────────
  // The four pre-built agents (blueprint): Lead / Sales / Customer Service /
  // Renewal. Seeded with their template trigger + tools + the governance tier
  // defaults; the tierPolicy column demonstrates a 🟡 override (renewal
  // send_email stays yellow = approval required) and a 🔴 custom guard.
  const agentTemplates = [
    {
      name: "Lead Agent", kind: "lead",
      description: "Qualifies inbound leads: flags hot leads to the owner and schedules the first follow-up task.",
      trigger: { kind: "event", event: "lead.created" },
      rules: [], tools: ["create_task", "notify", "update_record"],
    },
    {
      name: "Sales Agent", kind: "sales",
      description: "Drives the deal pipeline: celebrates wins, prepares negotiations, and analyzes losses.",
      trigger: { kind: "event", event: "deal.stage_changed" },
      rules: [], tools: ["create_task", "notify"],
    },
    {
      name: "Customer Service Agent", kind: "service",
      description: "Protects SLAs: high/urgent tickets get an immediate owner ping + a response task.",
      trigger: { kind: "event", event: "ticket.created" },
      rules: [], tools: ["create_task", "notify"],
    },
    {
      name: "Renewal Agent", kind: "renewal",
      description: "Safeguards recurring revenue: spots deals closing within 30 days and proposes the renewal conversation.",
      trigger: { kind: "event", event: "deal.stage_changed" },
      rules: [], tools: ["create_task", "notify", "send_email"],
      tierPolicy: { send_email: "yellow" },
    },
  ];
  for (const t of agentTemplates) {
    if (!(await p.agent.findFirst({ where: { orgId, environment: "production", name: t.name } }))) {
      await p.agent.create({
        data: {
          orgId, environment: "production", name: t.name, kind: t.kind, description: t.description,
          trigger: t.trigger as object, rules: t.rules as unknown as object,
          tools: t.tools as unknown as object, tierPolicy: (t as any).tierPolicy ?? {},
          memoryEnabled: true, active: true, createdBy: admin.id,
        },
      });
    }
  }
  // One seeded demo run on the Sales Agent (a won deal) so the Agents page has
  // an audit trail + cost metering on first login.
  const salesAgent = await p.agent.findFirst({ where: { orgId, environment: "production", kind: "sales" } });
  const wonDeal = await p.opportunity.findFirst({ where: { orgId, environment: "production", stage: "won" } });
  if (salesAgent && wonDeal && !(await p.agentRun.findFirst({ where: { orgId, agentId: salesAgent.id } }))) {
    try {
      await runAgent({ agent: salesAgent, entity: "opportunity", entityId: wonDeal.id, trigger: "manual", actorId: admin.id });
    } catch (e) {
      console.log("  (seed) agent demo run skipped:", (e as Error).message);
    }
  }
  const agentCount = await p.agent.count({ where: { orgId, environment: "production" } });
  const agentRunCount = await p.agentRun.count({ where: { orgId, environment: "production" } });
  console.log(`  Agents: ${agentCount} pre-built agents seeded (Lead/Sales/Service/Renewal), ${agentRunCount} demo run(s)`);

  // ── Phase 10 · Revenue Cloud (products, CPQ, contracts, billing) ─────────
  // Product catalog (idempotent by sku) — a few software/services + one
  // BUNDLE (Starter + Support expanded at quote build time).
  const productSeeds = [
    { name: "Qorvexa Platform — Starter", sku: "QX-STARTER", category: "software", listPrice: 600, cost: 40, description: "Up to 10 seats" },
    { name: "Qorvexa Platform — Growth", sku: "QX-GROWTH", category: "software", listPrice: 2_000, cost: 120, description: "Up to 50 seats" },
    { name: "Qorvexa Platform — Enterprise", sku: "QX-ENT", category: "software", listPrice: 4_000, cost: 240, description: "Unlimited seats + SSO" },
    { name: "Implementation Services", sku: "QX-IMPL", category: "service", listPrice: 12_000, cost: 3_000, description: "Onboarding + data migration" },
    { name: "Premium Support", sku: "QX-SUPPORT", category: "service", listPrice: 1_200, cost: 200, description: "24/7 priority support" },
    { name: "Security Compliance Pack", sku: "QX-SEC", category: "software", listPrice: 800, cost: 60, description: "SOC2 + HIPAA modules" },
  ];
  const productIds: Record<string, string> = {};
  for (const s of productSeeds) {
    let product = await p.product.findFirst({ where: { orgId, environment: "production", sku: s.sku } });
    if (!product) {
      product = await p.product.create({ data: { orgId, environment: "production", ...s, taxable: true, components: [], active: true } });
    }
    productIds[s.sku] = product.id;
  }
  const starterBundle = await p.product.findFirst({ where: { orgId, environment: "production", sku: "QX-BUNDLE-STARTER" } });
  if (!starterBundle) {
    await p.product.create({
      data: {
        orgId, environment: "production", name: "Starter Bundle (Platform + Support)", sku: "QX-BUNDLE-STARTER",
        category: "bundle", listPrice: 1_700, cost: 240, description: "Starter platform + premium support", taxable: true,
        components: [{ productId: productIds["QX-STARTER"], quantity: 1 }, { productId: productIds["QX-SUPPORT"], quantity: 1 }], active: true,
      },
    });
  }
  // Price books: the default "Standard" book is created HERE (the engine's
  // lazy ensureDefaultPriceBook only fires on first quote build — the seed
  // must not depend on it) with entries + one discount (Growth at 10%), plus
  // one secondary book for enterprise deals.
  const standardBook = await p.priceBook.findFirst({ where: { orgId, environment: "production", isDefault: true } });
  const standardEntries = [{ productId: productIds["QX-STARTER"], price: 600 }, { productId: productIds["QX-GROWTH"], price: 2_000 }, { productId: productIds["QX-ENT"], price: 4_000 }];
  if (standardBook) {
    const entries = (standardBook.entries ?? []) as { productId: string; price: number }[];
    if (!entries.length) {
      await p.priceBook.update({
        where: { id: standardBook.id },
        data: { entries: standardEntries, discounts: [{ productId: productIds["QX-GROWTH"], pct: 10 }] },
      });
    }
  } else {
    await p.priceBook.create({
      data: { orgId, environment: "production", name: "Standard", isDefault: true, active: true, entries: standardEntries, discounts: [{ productId: productIds["QX-GROWTH"], pct: 10 }] },
    });
  }
  const entBook = await p.priceBook.findFirst({ where: { orgId, environment: "production", name: "Enterprise 2026" } });
  if (!entBook) {
    await p.priceBook.create({
      data: {
        orgId, environment: "production", name: "Enterprise 2026", isDefault: false, active: true,
        entries: [{ productId: productIds["QX-ENT"], price: 3_800 }, { productId: productIds["QX-SEC"], price: 750 }], discounts: [],
      },
    });
  }
  // Quote template
  const tpl = await p.quoteTemplate.findFirst({ where: { orgId, environment: "production", name: "Standard Proposal" } });
  if (!tpl) {
    await p.quoteTemplate.create({ data: { orgId, environment: "production", name: "Standard Proposal", layout: "professional", language: "en", header: "Thank you for choosing Qorvexa", footer: "Prices valid for 30 days. Annual plans billed yearly.", active: true } });
  }
  // Contracts + subscriptions + invoices so the Revenue page has live data.
  const northwind = accounts["Northwind Traders"];
  const globex = accounts["Globex Corporation"];
  const now = new Date();
  const contract = await p.contract.findFirst({ where: { orgId, environment: "production", name: "Northwind — Platform Agreement" } });
  if (!contract) {
    await p.contract.create({
      data: {
        orgId, environment: "production", contractNumber: "CTR-0001", name: "Northwind — Platform Agreement",
        accountId: northwind, status: "active", startDate: new Date(now.getTime() - 90 * 86_400_000),
        endDate: new Date(now.getTime() + 275 * 86_400_000), autoRenew: true, renewalNoticeDays: 60,
        clauses: [
          { key: "party_1", label: "Party 1", value: "Qorvexa Demo Inc", source: "between clause" },
          { key: "party_2", label: "Party 2", value: "Northwind Traders", source: "between clause" },
          { key: "effective_date", label: "Effective date", value: now.toISOString().slice(0, 10), source: "effective date clause" },
          { key: "end_date", label: "End date", value: new Date(now.getTime() + 275 * 86_400_000).toISOString().slice(0, 10), source: "end date clause" },
          { key: "auto_renew", label: "Auto-renewal", value: "Yes (60 day notice)", source: "auto-renew clause" },
          { key: "payment_terms", label: "Payment terms", value: "Net-30", source: "net 30 clause" },
        ],
        analyzedAt: new Date(), createdBy: admin.id,
      },
    });
  }
  const nwSub = await p.subscription.findFirst({ where: { orgId, environment: "production", name: "Northwind — Platform (Monthly)" } });
  if (!nwSub) {
    await p.subscription.create({
      data: {
        orgId, environment: "production", accountId: northwind, productId: productIds["QX-ENT"], name: "Northwind — Platform (Monthly)",
        billingPeriod: "monthly", unitPrice: 4_000, quantity: 1, status: "active", startedAt: new Date(now.getTime() - 90 * 86_400_000),
        currentPeriodEnd: new Date(now.getTime() + 25 * 86_400_000), autoRenew: true, createdBy: admin.id,
      },
    });
  }
  const gxSub = await p.subscription.findFirst({ where: { orgId, environment: "production", name: "Globex — Growth (Annual)" } });
  if (!gxSub) {
    await p.subscription.create({
      data: {
        orgId, environment: "production", accountId: globex, productId: productIds["QX-GROWTH"], name: "Globex — Growth (Annual)",
        billingPeriod: "annual", unitPrice: 24_000, quantity: 1, status: "active", startedAt: new Date(now.getTime() - 30 * 86_400_000),
        currentPeriodEnd: new Date(now.getTime() + 335 * 86_400_000), autoRenew: true, createdBy: admin.id,
      },
    });
  }
  // One PAID invoice (Northwind's last cycle) + one ISSUED (Globex annual renewal due soon).
  let paidInv = await p.invoice.findFirst({ where: { orgId, environment: "production", invoiceNumber: "INV-0001" } });
  if (!paidInv) {
    paidInv = await p.invoice.create({
      data: {
        orgId, environment: "production", invoiceNumber: "INV-0001", accountId: northwind, subscriptionId: nwSub?.id ?? null,
        lines: [{ productId: productIds["QX-ENT"], productName: "Qorvexa Platform — Enterprise", sku: "QX-ENT", quantity: 1, unitPrice: 4_000, lineTotal: 4_000 }],
        subtotal: 4_000, taxTotal: 320, total: 4_320, currency: "USD", status: "paid", dueDate: new Date(now.getTime() - 10 * 86_400_000),
        issuedAt: new Date(now.getTime() - 24 * 86_400_000), paidAt: new Date(now.getTime() - 8 * 86_400_000), createdBy: admin.id,
      },
    });
  }
  const paidPayment = await p.payment.findFirst({ where: { orgId, environment: "production", invoiceId: paidInv.id } });
  if (!paidPayment) {
    await p.payment.create({
      data: { orgId, environment: "production", invoiceId: paidInv.id, accountId: northwind, amount: 4_320, method: "card", status: "succeeded", paidAt: paidInv.paidAt, createdBy: admin.id },
    });
  }
  const issuedInv = await p.invoice.findFirst({ where: { orgId, environment: "production", invoiceNumber: "INV-0002" } });
  if (!issuedInv) {
    await p.invoice.create({
      data: {
        orgId, environment: "production", invoiceNumber: "INV-0002", accountId: globex, subscriptionId: gxSub?.id ?? null,
        lines: [{ productId: productIds["QX-GROWTH"], productName: "Qorvexa Platform — Growth", sku: "QX-GROWTH", quantity: 1, unitPrice: 24_000, lineTotal: 24_000 }],
        subtotal: 24_000, taxTotal: 1_920, total: 25_920, currency: "USD", status: "issued", dueDate: new Date(now.getTime() + 10 * 86_400_000),
        issuedAt: new Date(now.getTime() - 2 * 86_400_000), createdBy: admin.id,
      },
    });
  }
  const productCount = await p.product.count({ where: { orgId, environment: "production" } });
  const subCount = await p.subscription.count({ where: { orgId, environment: "production" } });
  const invCount = await p.invoice.count({ where: { orgId, environment: "production" } });
  console.log(`  Revenue: ${productCount} products (incl. 1 bundle), price books + quote templates, ${subCount} subscription(s), ${invCount} invoice(s) seeded`);

  // ── Phase 11 · Customer Success, Retention & Expansion ─────────────────
  // Success plans (with milestones + QBRs) for the key accounts, usage
  // telemetry (feature adoption incl. one declining account), NPS/CSAT
  // surveys + responses (incl. negative feedback auto-promoted to the
  // roadmap), a loyalty program with members + referrals, and a persisted
  // churn snapshot so the Success page has data on first login.
  const nowMs = Date.now();

  // Success plans
  const nwPlan = await p.successPlan.findFirst({ where: { orgId, environment: "production", name: "Northwind — Onboarding" } });
  if (!nwPlan) {
    await p.successPlan.create({
      data: {
        orgId, environment: "production", accountId: northwind, name: "Northwind — Onboarding", kind: "onboarding",
        status: "active", ownerId: leo.id, startDate: new Date(nowMs - 45 * 86_400_000), targetDate: new Date(nowMs + 20 * 86_400_000),
        milestones: [
          { id: "m1", title: "Kickoff call with Elena", dueDate: new Date(nowMs - 40 * 86_400_000).toISOString(), status: "done", completedAt: new Date(nowMs - 38 * 86_400_000).toISOString() },
          { id: "m2", title: "Import contacts + pipeline", dueDate: new Date(nowMs - 20 * 86_400_000).toISOString(), status: "done", completedAt: new Date(nowMs - 18 * 86_400_000).toISOString() },
          { id: "m3", title: "Enable workflows + automations", dueDate: new Date(nowMs + 5 * 86_400_000).toISOString(), status: "open", completedAt: null },
          { id: "m4", title: "Train the sales team", dueDate: new Date(nowMs + 15 * 86_400_000).toISOString(), status: "open", completedAt: null },
        ],
        qbrs: [{ id: "q1", title: "30-day check-in", date: new Date(nowMs - 15 * 86_400_000).toISOString(), attendees: ["Ava Morgan", "Elena Rodriguez"], notes: "Usage strong; wants security review before expansion." }],
        notes: "Expansion candidate — Q3.", createdBy: admin.id,
      },
    });
  }
  const gxPlan = await p.successPlan.findFirst({ where: { orgId, environment: "production", name: "Globex — Success Plan" } });
  if (!gxPlan) {
    await p.successPlan.create({
      data: {
        orgId, environment: "production", accountId: globex, name: "Globex — Success Plan", kind: "success",
        status: "active", ownerId: priya.id, startDate: new Date(nowMs - 60 * 86_400_000), targetDate: new Date(nowMs + 90 * 86_400_000),
        milestones: [
          { id: "g1", title: "Adopt the journeys module", dueDate: new Date(nowMs - 10 * 86_400_000).toISOString(), status: "open", completedAt: null },
          { id: "g2", title: "QBR with Marcus", dueDate: new Date(nowMs + 5 * 86_400_000).toISOString(), status: "open", completedAt: null },
        ],
        qbrs: [], notes: "Usage declining — watch closely.", createdBy: admin.id,
      },
    });
  }

  // Usage telemetry: Northwind healthy across features, Globex declining
  // (adoption-drop demo), Umbrella inactive, Initech moderate.
  if (!(await p.usageEvent.findFirst({ where: { orgId, source: "seed" } }))) {
    const seedUsage = [
      // Northwind — heavy, healthy (last 10 days)
      { account: northwind, contact: elenaContact?.id, feature: "pipelines", daysAgo: 1 },
      { account: northwind, contact: elenaContact?.id, feature: "email", daysAgo: 2 },
      { account: northwind, contact: elenaContact?.id, feature: "workflows", daysAgo: 3 },
      { account: northwind, contact: elenaContact?.id, feature: "tickets", daysAgo: 4 },
      { account: northwind, contact: elenaContact?.id, feature: "analytics", daysAgo: 6 },
      { account: northwind, contact: elenaContact?.id, feature: "meetings", daysAgo: 8 },
      // Globex — declining: only 1 feature recently vs 4 in the prior window
      { account: globex, contact: marcusContact?.id, feature: "email", daysAgo: 2 },
      { account: globex, contact: marcusContact?.id, feature: "pipelines", daysAgo: 45 },
      { account: globex, contact: marcusContact?.id, feature: "analytics", daysAgo: 40 },
      { account: globex, contact: marcusContact?.id, feature: "workflows", daysAgo: 35 },
      // Umbrella — inactive (last event 60+ days ago)
      { account: accounts["Umbrella Labs"], contact: undefined, feature: "pipelines", daysAgo: 70 },
      { account: accounts["Umbrella Labs"], contact: undefined, feature: "email", daysAgo: 65 },
      // Initech — moderate, steady
      { account: accounts["Initech"], contact: sarahContact?.id, feature: "pipelines", daysAgo: 5 },
      { account: accounts["Initech"], contact: sarahContact?.id, feature: "email", daysAgo: 12 },
      { account: accounts["Initech"], contact: sarahContact?.id, feature: "tickets", daysAgo: 20 },
    ];
    for (const u of seedUsage) {
      await p.usageEvent.create({
        data: {
          orgId, environment: "production", accountId: u.account, contactId: u.contact ?? null,
          type: "feature_used", feature: u.feature, source: "seed",
          occurredAt: new Date(nowMs - u.daysAgo * 86_400_000),
        },
      });
    }
  }

  // Surveys + responses (feedback → roadmap).
  let npsSurvey: any = await p.survey.findFirst({ where: { orgId, environment: "production", name: "Q3 NPS pulse" } });
  if (!npsSurvey) {
    npsSurvey = await p.survey.create({
      data: { orgId, environment: "production", name: "Q3 NPS pulse", kind: "nps", question: "How likely are you to recommend QORVEXA?", active: true, createdBy: admin.id },
    });
  }
  if (!(await p.surveyResponse.findFirst({ where: { orgId, environment: "production", surveyId: npsSurvey.id } }))) {
    await addSurveyResponse(orgId, "production", { surveyId: npsSurvey.id, score: 9, comment: "Great product, easy to adopt", contactId: elenaContact?.id ?? null, accountId: northwind }, { id: admin.id });
    await addSurveyResponse(orgId, "production", { surveyId: npsSurvey.id, score: 7, contactId: marcusContact?.id ?? null, accountId: globex }, { id: admin.id });
    await addSurveyResponse(orgId, "production", { surveyId: npsSurvey.id, score: 3, comment: "The bulk edit is broken and support is slow", contactId: sarahContact?.id ?? null, accountId: accounts["Initech"] }, { id: admin.id });
  }
  const csatSurvey = await p.survey.findFirst({ where: { orgId, environment: "production", name: "Support CSAT" } });
  if (!csatSurvey) {
    await p.survey.create({
      data: { orgId, environment: "production", name: "Support CSAT", kind: "csat", question: "How satisfied were you with our support?", active: true, createdBy: admin.id },
    });
  }

  // Loyalty program (Qorvexa Advocates) + members + referrals.
  let program: any = await p.loyaltyProgram.findFirst({ where: { orgId, environment: "production", name: "Qorvexa Advocates" } });
  if (!program) {
    program = await createProgram(orgId, "production", { name: "Qorvexa Advocates" }, { id: admin.id });
  }
  if (elenaContact && !(await p.loyaltyMember.findFirst({ where: { orgId, environment: "production", programId: program.id, contactId: elenaContact.id } }))) {
    const member = await enrollMember(orgId, "production", program.id, { contactId: elenaContact.id }, { id: admin.id });
    await p.loyaltyMember.update({ where: { id: member.id }, data: { points: 1600 } }); // gold tier
  }
  if (!(await p.referralRecord.findFirst({ where: { orgId, environment: "production", referredEmail: "hana@northwind.example" } }))) {
    await p.referralRecord.create({
      data: {
        orgId, environment: "production", programId: program.id, referrerContactId: elenaContact?.id ?? null,
        referredEmail: "hana@northwind.example", referredName: "Hana Tanaka", status: "converted",
        pointsAwarded: 500, convertedAt: new Date(nowMs - 10 * 86_400_000), createdBy: admin.id,
      },
    });
  }
  if (!(await p.referralRecord.findFirst({ where: { orgId, environment: "production", referredEmail: "oliver@acmecorp.example" } }))) {
    await p.referralRecord.create({
      data: {
        orgId, environment: "production", programId: program.id, referrerContactId: marcusContact?.id ?? null,
        referredEmail: "oliver@acmecorp.example", referredName: "Oliver Stone", status: "pending", createdBy: admin.id,
      },
    });
  }

  // A churn snapshot so the Churn tab has history on first login.
  if (!(await p.churnScore.findFirst({ where: { orgId, environment: "production" } }))) {
    const { refreshChurn } = await import("./lib/success");
    await refreshChurn(orgId, "production", admin.id);
  }

  const planCount = await p.successPlan.count({ where: { orgId, environment: "production" } });
  const usageCount = await p.usageEvent.count({ where: { orgId, environment: "production" } });
  const surveyCount = await p.survey.count({ where: { orgId, environment: "production" } });
  console.log(`  Success: ${planCount} plan(s), ${usageCount} usage event(s), ${surveyCount} survey(s), loyalty program + ${program?.name ?? ""} members, churn snapshots seeded`);

  // ── Phase 12 · Field Operations ────────────────────────────────────────
  // Territories (with assigned accounts), technicians (with skills + last
  // GPS fix), visits (one checked in with GPS, one planned), work orders
  // (one open with a near-term SLA, one completed with parts), assets (one
  // maintenance-due), and inventory (one at/below reorder level) so the
  // Field page has data on first login.
  const h = 3_600_000;

  // Territories
  const northeast = await p.territory.findFirst({ where: { orgId, environment: "production", name: "Northeast" } });
  let northeastId: string;
  if (northeast) {
    northeastId = northeast.id;
  } else {
    const t = await p.territory.create({
      data: {
        orgId, environment: "production", name: "Northeast", region: "NY / NJ / CT", ownerId: priya.id,
        accountIds: [accounts["Northwind Traders"], accounts["Initech"]], active: true,
        notes: "Enterprise accounts — dispatch priority.", createdBy: admin.id,
      },
    });
    northeastId = t.id;
  }
  const west = await p.territory.findFirst({ where: { orgId, environment: "production", name: "West" } });
  let westId: string;
  if (west) {
    westId = west.id;
  } else {
    const t = await p.territory.create({
      data: {
        orgId, environment: "production", name: "West", region: "CA / WA", ownerId: leo.id,
        accountIds: [accounts["Globex Corporation"]], active: true, notes: "Mid-market west.", createdBy: admin.id,
      },
    });
    westId = t.id;
  }

  // Technicians — one per territory + a float. Sam works out of the Northeast.
  const sam = await p.technician.findFirst({ where: { orgId, environment: "production", name: "Sam Rivera" } });
  let samId: string;
  if (sam) {
    samId = sam.id;
  } else {
    const t = await p.technician.create({
      data: {
        orgId, environment: "production", name: "Sam Rivera", phone: "+1 212 555 7001",
        territoryId: northeastId, skills: ["install", "repair"], status: "on_route", lat: 40.758, lng: -73.985,
        createdBy: admin.id,
      },
    });
    samId = t.id;
  }
  const jordan = await p.technician.findFirst({ where: { orgId, environment: "production", name: "Jordan Lee" } });
  let jordanId: string;
  if (jordan) {
    jordanId = jordan.id;
  } else {
    const t = await p.technician.create({
      data: {
        orgId, environment: "production", name: "Jordan Lee", phone: "+1 415 555 7002",
        territoryId: westId, skills: ["network", "audit"], status: "available", lat: 37.7749, lng: -122.4194,
        createdBy: admin.id,
      },
    });
    jordanId = t.id;
  }

  // Visits — one checked in with GPS (Northwind), one planned (Globex).
  if (!(await p.visit.findFirst({ where: { orgId, environment: "production", title: "Northwind — quarterly hardware review" } }))) {
    await p.visit.create({
      data: {
        orgId, environment: "production", territoryId: northeastId, accountId: accounts["Northwind Traders"],
        technicianId: samId, title: "Northwind — quarterly hardware review",
        scheduledAt: new Date(nowMs - 2 * h), status: "checked_in",
        checkInAt: new Date(nowMs - 90 * 60_000), checkInLat: 40.758, checkInLng: -73.985,
        notes: "Reviewing the POS fleet.", createdBy: admin.id,
      },
    });
  }
  if (!(await p.visit.findFirst({ where: { orgId, environment: "production", title: "Globex — network audit" } }))) {
    await p.visit.create({
      data: {
        orgId, environment: "production", territoryId: westId, accountId: accounts["Globex Corporation"],
        technicianId: jordanId, title: "Globex — network audit",
        scheduledAt: new Date(nowMs + 3 * h), status: "planned", createdBy: admin.id,
      },
    });
  }

  // Work orders — one open with a near-term SLA (dispatch demo), one completed
  // with parts used (inventory consumption demo).
  if (!(await p.workOrder.findFirst({ where: { orgId, environment: "production", title: "Northwind — POS terminal swap" } }))) {
    await p.workOrder.create({
      data: {
        orgId, environment: "production", territoryId: northeastId, accountId: accounts["Northwind Traders"],
        technicianId: samId, title: "Northwind — POS terminal swap", description: "Replace failing register 4.",
        priority: "high", status: "dispatched", slaDueAt: new Date(nowMs + 6 * h), createdBy: admin.id,
      },
    });
  }
  if (!(await p.workOrder.findFirst({ where: { orgId, environment: "production", title: "Globex — router replacement" } }))) {
    await p.workOrder.create({
      data: {
        orgId, environment: "production", territoryId: westId, accountId: accounts["Globex Corporation"],
        technicianId: jordanId, title: "Globex — router replacement", description: "Replaced core router.",
        priority: "medium", status: "completed", completedAt: new Date(nowMs - 24 * h),
        partsUsed: [{ sku: "RX-ROUTER-100", qty: 1 }], createdBy: admin.id,
      },
    });
  }

  // Assets — a POS terminal with maintenance due, a router under warranty.
  if (!(await p.asset.findFirst({ where: { orgId, environment: "production", serialNumber: "POS-8821-NW" } }))) {
    await p.asset.create({
      data: {
        orgId, environment: "production", accountId: accounts["Northwind Traders"], name: "POS Terminal #4",
        serialNumber: "POS-8821-NW", type: "hardware", status: "active",
        warrantyUntil: new Date(nowMs + 300 * 86_400_000),
        lastMaintenanceAt: new Date(nowMs - 95 * 86_400_000), maintenanceIntervalDays: 90,
        location: "Northwind — Flagship store", notes: "Swap due — see work order.", createdBy: admin.id,
      },
    });
  }
  if (!(await p.asset.findFirst({ where: { orgId, environment: "production", serialNumber: "RTR-4491-GX" } }))) {
    await p.asset.create({
      data: {
        orgId, environment: "production", accountId: accounts["Globex Corporation"], name: "Core Router",
        serialNumber: "RTR-4491-GX", type: "hardware", status: "active",
        warrantyUntil: new Date(nowMs + 400 * 86_400_000),
        lastMaintenanceAt: new Date(nowMs - 30 * 86_400_000), maintenanceIntervalDays: 180,
        location: "Globex — HQ data closet", createdBy: admin.id,
      },
    });
  }

  // Inventory — one item at/below reorder level (reorder_triggered demo).
  if (!(await p.inventoryItem.findFirst({ where: { orgId, environment: "production", sku: "RX-ROUTER-100" } }))) {
    await p.inventoryItem.create({
      data: {
        orgId, environment: "production", sku: "RX-ROUTER-100", name: "Enterprise Router", quantityOnHand: 2,
        reorderLevel: 5, unitCost: 420, location: "NYC warehouse", notes: "Reordered monthly.", createdBy: admin.id,
      },
    });
  }
  if (!(await p.inventoryItem.findFirst({ where: { orgId, environment: "production", sku: "POS-TERM-200" } }))) {
    await p.inventoryItem.create({
      data: {
        orgId, environment: "production", sku: "POS-TERM-200", name: "POS Terminal", quantityOnHand: 12,
        reorderLevel: 4, unitCost: 890, location: "NYC warehouse", createdBy: admin.id,
      },
    });
  }

  // ── Phase 13 · Ecosystem ───────────────────────────────────────────────
  // Marketplace listings (one installed agent app, one integration), one
  // installed app row, two partners (one with a won deal + commission, one
  // with an open registered deal), and a demo change set the diff/promote
  // flow can exercise against the sandbox.
  if (!(await p.marketplaceListing.findFirst({ where: { orgId, environment: "production", slug: "lead-qualifier" } }))) {
    await p.marketplaceListing.create({
      data: {
        orgId, environment: "production", slug: "lead-qualifier", name: "Lead Qualifier Agent",
        kind: "agent", description: "Auto-qualifies inbound leads with a risk-tiered follow-up task + notification.",
        publisher: "Qorvexa Labs", version: "1.2.0", icon: "🎯",
        config: { agentTemplate: "lead" }, installCount: 1, createdBy: admin.id,
      },
    });
  }
  if (!(await p.marketplaceListing.findFirst({ where: { orgId, environment: "production", slug: "webhook-studio" } }))) {
    await p.marketplaceListing.create({
      data: {
        orgId, environment: "production", slug: "webhook-studio", name: "Webhook Studio",
        kind: "integration", description: "Pipe deal-stage changes to external systems via webhooks.",
        publisher: "Acme Integrations", version: "0.9.0", icon: "🔌",
        config: { webhookEvents: ["deal.stage_changed"] }, installCount: 0, createdBy: admin.id,
      },
    });
  }
  if (!(await p.marketplaceListing.findFirst({ where: { orgId, environment: "production", slug: "nps-survey-template" } }))) {
    await p.marketplaceListing.create({
      data: {
        orgId, environment: "production", slug: "nps-survey-template", name: "NPS Survey Template",
        kind: "template", description: "A drop-in NPS survey template with scoring + roadmap promotion.",
        publisher: "Qorvexa Labs", version: "1.0.0", icon: "📋",
        config: {}, installCount: 0, createdBy: admin.id,
      },
    });
  }
  // Installed app — the Lead Qualifier was installed (its agent row exists).
  if (!(await p.app.findFirst({ where: { orgId, environment: "production", slug: "lead-qualifier" } }))) {
    const listing = await p.marketplaceListing.findFirst({ where: { orgId, environment: "production", slug: "lead-qualifier" } });
    await p.app.create({
      data: {
        orgId, environment: "production", listingId: listing?.id ?? null, slug: "lead-qualifier",
        name: "Lead Qualifier Agent", kind: "agent", status: "installed",
        config: { agentId: null }, installedBy: admin.id, installedAt: new Date(nowMs - 72 * h),
      },
    });
  }

  // Partners — Northwind channel partner (won deal → commission) + a referral
  // partner with an open registered deal (pipeline).
  const northwindPartner = await p.partnerAccount.findFirst({ where: { orgId, environment: "production", name: "Northwind Channel" } });
  let northwindPartnerId: string;
  if (northwindPartner) {
    northwindPartnerId = northwindPartner.id;
  } else {
    const pp = await p.partnerAccount.create({
      data: {
        orgId, environment: "production", name: "Northwind Channel", type: "reseller",
        contactName: "Elena Rodriguez", email: "elena@northwind.example", phone: "+1 212 555 0111",
        commissionRate: 0.12, status: "active", notes: "Enterprise reseller.", createdBy: admin.id,
      },
    });
    northwindPartnerId = pp.id;
  }
  if (!(await p.partnerDeal.findFirst({ where: { orgId, environment: "production", name: "Northwind — 400-seat rollout" } }))) {
    await p.partnerDeal.create({
      data: {
        orgId, environment: "production", partnerId: northwindPartnerId, name: "Northwind — 400-seat rollout",
        amount: 96_000, status: "won", registeredAt: new Date(nowMs - 45 * 24 * h), wonAt: new Date(nowMs - 30 * 24 * h), createdBy: admin.id,
      },
    });
  }
  const globexPartner = await p.partnerAccount.findFirst({ where: { orgId, environment: "production", name: "Globex Referrals" } });
  let globexPartnerId: string;
  if (globexPartner) {
    globexPartnerId = globexPartner.id;
  } else {
    const pp = await p.partnerAccount.create({
      data: {
        orgId, environment: "production", name: "Globex Referrals", type: "referral",
        contactName: "Marcus Chen", email: "marcus@globex.example",
        commissionRate: 0.08, status: "active", notes: "Referral partner.", createdBy: admin.id,
      },
    });
    globexPartnerId = pp.id;
  }
  if (!(await p.partnerDeal.findFirst({ where: { orgId, environment: "production", name: "Globex — expansion" } }))) {
    await p.partnerDeal.create({
      data: {
        orgId, environment: "production", partnerId: globexPartnerId, name: "Globex — expansion",
        amount: 24_000, status: "approved", registeredAt: new Date(nowMs - 10 * 24 * h), createdBy: admin.id,
      },
    });
  }

  // Change set — a demo bundle (a custom field + the Lead agent) the promote
  // flow can push into the sandbox.
  if (!(await p.changeSet.findFirst({ where: { orgId, environment: "production", name: "Q3 field rollout" } }))) {
    await p.changeSet.create({
      data: {
        orgId, environment: "production", name: "Q3 field rollout",
        description: "Custom field + agent template for the sandbox preview.",
        items: [
          { entity: "fieldDef", op: "create", key: "contact:employeeCount", data: { objectType: "contact", key: "employeeCount", label: "Employee count", type: "number", required: false, options: [], order: 50 } },
          { entity: "agent", op: "create", key: "lead", data: { name: "Lead Qualifier", kind: "lead", trigger: { kind: "event", event: "lead.created" }, rules: [], tools: ["create_task", "notify", "update_record"], tierPolicy: {}, memoryEnabled: true, active: true } },
        ],
        status: "draft", createdBy: admin.id,
      },
    });
  }

  const ecosystemListings = await p.marketplaceListing.count({ where: { orgId, environment: "production" } });
  const ecosystemApps = await p.app.count({ where: { orgId, environment: "production" } });
  const ecosystemPartners = await p.partnerAccount.count({ where: { orgId, environment: "production" } });
  const ecosystemDeals = await p.partnerDeal.count({ where: { orgId, environment: "production" } });
  const ecosystemChangeSets = await p.changeSet.count({ where: { orgId, environment: "production" } });
  console.log(`  Ecosystem: ${ecosystemListings} listing(s), ${ecosystemApps} app(s), ${ecosystemPartners} partner(s), ${ecosystemDeals} partner deal(s), ${ecosystemChangeSets} change set(s)`);

  const territoryCount = await p.territory.count({ where: { orgId, environment: "production" } });
  const technicianCount = await p.technician.count({ where: { orgId, environment: "production" } });
  const visitCount = await p.visit.count({ where: { orgId, environment: "production" } });
  const workOrderCount = await p.workOrder.count({ where: { orgId, environment: "production" } });
  const assetCount = await p.asset.count({ where: { orgId, environment: "production" } });
  const inventoryCount = await p.inventoryItem.count({ where: { orgId, environment: "production" } });
  console.log(`  Field: ${territoryCount} territory(ies), ${technicianCount} technician(s), ${visitCount} visit(s), ${workOrderCount} work order(s), ${assetCount} asset(s), ${inventoryCount} inventory item(s)`);

  console.log(`✓ Seeded demo org "${ORG_NAME}"`);
  console.log(`  Login → admin@qorvexa.dev / password123`);
  console.log(`  Users: priya@qorvexa.dev, leo@qorvexa.dev (same password)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db().$disconnect();
  });
