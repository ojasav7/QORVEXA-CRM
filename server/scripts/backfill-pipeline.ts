// One-off backfill (Phase 2-lite multi-pipeline): deals created before the
// `pipelineId` column existed carry NO pipelineId field. Prisma WHERE filters
// only match explicit null (Mongo missing ≠ null) — so those deals would be
// invisible to pipeline-scoped list queries until stamped. This script assigns
// every legacy deal to its org's default pipeline at the RAW level (same
// pattern as backfill-environment.ts, ADR-008).
//
// Usage:  npm run backfill:pipeline   (run once after db:push, before serving)
import { db } from "../db";
import { ensureDefaultPipeline } from "../lib/pipelines";

async function main() {
  const p = db();
  const orgs: any[] = await p.organization.findMany({ select: { id: true } });
  let total = 0;
  for (const org of orgs) {
    const defaultId = await ensureDefaultPipeline(org.id, "production");
    // Match docs where pipelineId is missing or explicitly null, then stamp.
    // NB: orgId/pipelineId are stored as ObjectIds — read and write them with
    // extended JSON ($oid) so Prisma's typed queries can match them later.
    const res: any = await p.$runCommandRaw({
      update: "Opportunity",
      updates: [
        {
          q: { orgId: { $oid: org.id }, $or: [{ pipelineId: { $exists: false } }, { pipelineId: null }] },
          u: { $set: { pipelineId: { $oid: defaultId } } },
          multi: true,
        },
      ],
    });
    const n = res?.nModified ?? 0;
    if (n) {
      console.log(`  org ${org.id}: backfilled ${n} deals → default pipeline`);
      total += n;
    }
  }
  console.log(total ? `\n✓ Backfilled ${total} deals onto their org's default pipeline.` : "\n✓ Nothing to backfill — all deals already carry a pipelineId.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db().$disconnect();
  });
