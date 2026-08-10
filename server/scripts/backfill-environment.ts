// One-off backfill (ADR-008): `prisma db push` does NOT backfill existing
// MongoDB documents, so rows created before the `environment` column existed
// carry no environment field. Prisma SELECTs synthesize the schema default
// ("production") for missing fields, but WHERE filters do NOT match them —
// so those docs are invisible to environment-scoped queries until backfilled.
// This script stamps every affected collection at the RAW level.
//
// Usage:  npm run backfill:env   (run once after db:push, before serving)
import { db } from "../db";

// Every model that carries the ADR-008 environment column (raw collection names).
const COLLECTIONS = [
  "Contact",
  "Account",
  "Lead",
  "Opportunity",
  "Task",
  "Note",
  "Event",
  "AuditLog",
  "Webhook",
  "WebhookDelivery",
  "FieldDef",
];

async function main() {
  const p = db();
  let total = 0;
  for (const collection of COLLECTIONS) {
    // Match docs where environment is missing or explicitly null, then stamp production.
    const res: any = await p.$runCommandRaw({
      update: collection,
      updates: [
        {
          q: { $or: [{ environment: { $exists: false } }, { environment: null }] },
          u: { $set: { environment: "production" } },
          multi: true,
        },
      ],
    });
    const n = res?.nModified ?? 0;
    if (n) {
      console.log(`  ${collection}: backfilled ${n} docs → production`);
      total += n;
    } else {
      console.log(`  ${collection}: no docs missing environment`);
    }
  }
  console.log(total ? `\n✓ Backfilled ${total} documents.` : "\n✓ Nothing to backfill — all docs already carry an environment.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db().$disconnect();
  });
