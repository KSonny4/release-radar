import test from "node:test";
import assert from "node:assert/strict";
import { neonDatabase } from "../src/db.ts";
import { handleRequest } from "../src/app.ts";
import type { Env } from "../src/types.ts";

const url = process.env.DATABASE_URL;
if (!url) test("Neon integration prerequisites", { skip: "DATABASE_URL is not set" }, () => {});
else {
  const db = neonDatabase(url);
  const fixture = -987654321;
  const env = { DATABASE_URL: url, DB: db } as Env;
  test("Neon batch rollback, ILIKE search and null ordering", async () => {
    try {
      await db.prepare("DELETE FROM shows WHERE id IN (?,?)").bind(fixture,fixture-1).run();
      await db.batch([
        db.prepare("INSERT INTO shows(id,name,genres,premiered,updated_at) VALUES (?,?,?,?,?)").bind(fixture,"zz-neon-fixture","[]",null,new Date().toISOString()),
        db.prepare("INSERT INTO shows(id,name,genres,premiered,updated_at) VALUES (?,?,?,?,?)").bind(fixture-1,"Alpha Neon","[]","2020-01-01",new Date().toISOString())
      ]);
      const found = await db.prepare("SELECT id FROM shows WHERE name ILIKE ?").bind("%NEON-FIXTURE%").first();
      assert.equal(found?.id, fixture);
      const ordered = await db.prepare("SELECT id FROM shows WHERE id IN (?,?) ORDER BY premiered ASC NULLS LAST").bind(fixture,fixture-1).all();
      assert.deepEqual(ordered.results?.map((row: any) => row.id), [fixture-1, fixture]);
      try { await db.batch([db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES (?,?,?)").bind("__integration_rollback__","x",new Date().toISOString()),db.prepare("INSERT INTO missing_table VALUES (1)")]); } catch {}
      assert.equal(await db.prepare("SELECT key FROM sync_state WHERE key=?").bind("__integration_rollback__").first(), null);
    } finally {
      await db.prepare("DELETE FROM shows WHERE id IN (?,?)").bind(fixture,fixture-1).run();
    }
  });
  test("Worker health endpoint uses Neon", async () => {
    const response = await handleRequest(new Request("https://radar.pkubelka.cz/healthz"), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  });
}
