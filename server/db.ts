import { PrismaClient } from "@prisma/client";

// Lazy singleton — the client is only constructed when first used, so the
// app can boot (and serve /api/health) even before a database is reachable.
let prisma: PrismaClient | null = null;

export function db(): PrismaClient {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/** Quick connectivity probe used by /api/health and startup logging. */
export async function dbHealthy(): Promise<boolean> {
  try {
    await db().$runCommandRaw({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}
