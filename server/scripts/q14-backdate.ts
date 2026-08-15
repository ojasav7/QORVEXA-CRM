// Transient Phase 14 verify helper (same pattern as the Phase 5 q5-backdate.ts):
//   • --del: creates ONE lead whose createdAt is 400 days old (the delete target).
//   • --anon: creates ONE lead whose createdAt is 400 days old (the anonymize
//     target — created AFTER the delete policy has run, so the delete policy
//     cannot consume it).
//   • --recover-ip: resets org settings.security.ipRestrictionEnabled=false so
//     the smoke suite can recover from a self-inflicted IP-allowlist lockout.
import { db } from "../db";

const OLD = 400 * 24 * 3_600_000;
const TARGETS: Record<string, { email: string; first: string; last: string; score: number }> = {
  "--del": { email: "retention-del@qorvexa.dev", first: "Retention", last: "Delete", score: 10 },
  "--anon": { email: "retention-anon@qorvexa.dev", first: "Retention", last: "Anonymize", score: 20 },
};

async function main() {
  const p = db();
  const org = await p.organization.findFirst({ where: { slug: "qorvexa-demo" } });
  if (!org) throw new Error("Seed first (npm run seed)");
  const orgId = org.id;

  if (process.argv.includes("--recover-ip")) {
    const settings = (org.settings ?? {}) as Record<string, unknown>;
    const security = (settings.security ?? {}) as Record<string, unknown>;
    security.ipRestrictionEnabled = false;
    settings.security = security;
    await p.organization.update({ where: { id: orgId }, data: { settings: settings as object } });
    console.log("IP restriction disabled (recovery)");
    await p.$disconnect();
    return;
  }

  const admin = await p.user.findFirst({ where: { orgId, role: "admin" } });
  if (!admin) throw new Error("No admin user in seeded org");
  const cut = new Date(Date.now() - OLD);
  const mode = process.argv.find((a) => a in TARGETS) ?? "--del";
  const t = TARGETS[mode];

  // Idempotent: drop leftovers from previous runs (exact email + anonymized row).
  await p.lead.deleteMany({
    where: {
      orgId,
      OR: [
        { email: t.email },
        { email: { startsWith: "redacted-" } },
      ],
    },
  });

  const created = await p.lead.create({
    data: {
      orgId, ownerId: admin.id, environment: "production",
      firstName: t.first, lastName: t.last, email: t.email,
      company: "Old Co", source: "verify", score: t.score, status: "new",
      tags: [], custom: {}, visibility: "org", createdAt: cut, updatedAt: cut,
    },
  });
  console.log(`Backdated lead created: ${created.id} (${t.email})`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
