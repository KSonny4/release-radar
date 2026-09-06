import { neonDatabase } from "../src/db.ts";
import { runScheduledSync } from "../src/sync.ts";
import type { Env } from "../src/types.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL,
  DB: neonDatabase(process.env.DATABASE_URL)
} as unknown as Env;
await runScheduledSync(env, new Date());
console.log("scheduled sync complete");
