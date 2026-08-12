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
