import { neon } from "@neondatabase/serverless";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = neon(process.env.DATABASE_URL);
const rows = await sql.query("SELECT value FROM migration_meta WHERE key='d1_import_complete'");
if (!rows.length) throw new Error("refusing deployment: verified D1 import marker is missing");
console.log("verified Neon data migration marker present");
