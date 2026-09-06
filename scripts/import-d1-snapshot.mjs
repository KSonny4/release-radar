import fs from "node:fs";
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

const input = process.argv[2];
if (!input || !process.env.DATABASE_URL) throw new Error("usage: DATABASE_URL=... node import-d1-snapshot.mjs SNAPSHOT.json");
const snapshot = JSON.parse(fs.readFileSync(input, "utf8"));
const sql = neon(process.env.DATABASE_URL);
const tables = {
  shows: ["id","name","type","language","genres","status","premiered","ended","official_site","rating","weight","network","web_channel","image_medium","image_original","summary","updated_at"],
  episodes: ["id","show_id","name","season","number","airdate","airtime","airstamp","runtime","rating","summary","image_medium","updated_at"],
  followed_shows: ["show_id","created_at"],
  movies: ["id","title","original_title","overview","genres","release_date","local_release_date","local_release_type","rating","vote_count","popularity","original_language","poster_path","backdrop_path","region","updated_at"],
  sync_state: ["key","value","updated_at"]
};
const key = {shows:"id", episodes:"id", followed_shows:"show_id", movies:"id", sync_state:"key"};
const stable = rows => JSON.stringify([...rows].map(row => JSON.stringify(row, Object.keys(row).sort())).sort(), null, 0);
const checksum = rows => crypto.createHash("sha256").update(stable(rows)).digest("hex");
const current = await sql.query("SELECT key,value FROM migration_meta WHERE key IN ('d1_import_complete')");
if (current.length) { console.log("D1 import already complete; skipping safely"); process.exit(0); }
const existing = await sql.query("SELECT (SELECT count(*) FROM shows)+(SELECT count(*) FROM episodes)+(SELECT count(*) FROM followed_shows)+(SELECT count(*) FROM movies)+(SELECT count(*) FROM sync_state) AS n");
const queries = [];
for (const [table, columns] of Object.entries(tables)) {
  if (!Object.hasOwn(snapshot.tables || {}, table) || !Object.hasOwn(snapshot.counts || {}, table)) throw new Error(`snapshot is missing table ${table}`);
  const rows = snapshot.tables[table] || [];
  for (let offset=0; offset<rows.length; offset+=500) {
    const chunk = rows.slice(offset, offset+500), params = [], values = chunk.map(row => `(${columns.map(column => { params.push(row[column] ?? null); return `$${params.length}`; }).join(",")})`).join(",");
    const updates = columns.filter(column => column !== key[table]).map(column => `${column}=EXCLUDED.${column}`).join(",");
    queries.push(sql.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${values} ON CONFLICT (${key[table]}) DO UPDATE SET ${updates}`, params));
  }
}
if (Number(existing[0]?.n || 0) === 0) await sql.transaction(queries);
for (const [table, columns] of Object.entries(tables)) {
  const rows = await sql.query(`SELECT * FROM ${table}`);
  if (rows.length !== snapshot.counts[table]) throw new Error(`${table} count mismatch after import`);
  if (checksum(rows) !== checksum(snapshot.tables[table] || [])) throw new Error(`${table} checksum mismatch after import`);
}
await sql.query("INSERT INTO migration_meta(key,value,created_at) VALUES ('d1_import_complete',$1,$2)", ["verified", new Date().toISOString()]);
console.log(`D1 snapshot imported and verified: ${Object.entries(snapshot.counts).map(([table,count])=>`${table}=${count}:${checksum(snapshot.tables[table]||[]).slice(0,12)}`).join(" ")}`);
