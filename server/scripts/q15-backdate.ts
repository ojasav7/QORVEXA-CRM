// Transient Phase 15 verify helper (same pattern as q14-backdate.ts):
//   • --expire-snapshot: backdates ONE TimeMachineSnapshot's retentionUntil to
//     yesterday so the next snapshot capture prunes it (retention verification).
//   • --old-deal: creates ONE opportunity whose createdAt is 90 days ago — a
//     deterministic "stale pipeline" / Detective long-stage target.
import { db } from "../db";

const OLD = 90 * 24 * 3_600_000;

async function main() {
  const p = db();
  const org = await p.organization.findFirst({ where: { slug: "qorvexa-demo" } });
  if (!org) throw new Error("Seed first (npm run seed)");
  const orgId = org.id;

  if (process.argv.includes("--expire-snapshot")) {
    // Expire the OLDEST snapshot (idempotent — only acts when one is unexpired).
    const snap = await p.timeMachineSnapshot.findFirst({ where: { orgId, environment: "production" }, orderBy: { createdAt: "asc" } });
    if (!snap) throw new Error("No snapshots to expire — create one first");
    if (snap.retentionUntil && new Date(snap.retentionUntil).getTime() < Date.now()) {
      console.log("A snapshot is already expired — nothing to do");
    } else {
      await p.timeMachineSnapshot.update({ where: { id: snap.id }, data: { retentionUntil: new Date(Date.now() - 24 * 3_600_000) } });
      console.log(`Expired snapshot ${snap.id}`);
    }
    await p.$disconnect();
    return;
  }

  if (process.argv.includes("--old-deal")) {
    const admin = await p.user.findFirst({ where: { orgId, role: "admin" } });
    if (!admin) throw new Error("No admin user in seeded org");
    const cut = new Date(Date.now() - OLD);
    const existing = await p.opportunity.findFirst({ where: { orgId, name: { startsWith: "Stale Deal" } } });
    if (existing) {
      console.log(`Old deal already exists: ${existing.id}`);
    } else {
      const created = await p.opportunity.create({
        data: {
          orgId, ownerId: admin.id, environment: "production",
          name: `Stale Deal ${Date.now()}`, stage: "qualified", amount: 15000, probability: 30,
          tags: [], custom: {}, visibility: "org", createdAt: cut, updatedAt: cut,
        },
      });
      console.log(`Old deal created: ${created.id}`);
    }
    await p.$disconnect();
    return;
  }

  throw new Error("usage: --expire-snapshot | --old-deal");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
