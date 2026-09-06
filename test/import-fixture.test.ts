import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("D1 export fixture preserves Unicode, nulls, quotes, floats and empty tables", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-radar-export-"));
  const dump = path.join(dir, "dump.sql"), snapshot = path.join(dir, "snapshot.json");
  fs.writeFileSync(dump, `
    CREATE TABLE shows(id INTEGER PRIMARY KEY,name TEXT,type TEXT,language TEXT,genres TEXT,status TEXT,premiered TEXT,ended TEXT,official_site TEXT,rating REAL,weight INTEGER,network TEXT,web_channel TEXT,image_medium TEXT,image_original TEXT,summary TEXT,updated_at TEXT);
    CREATE TABLE episodes(id INTEGER PRIMARY KEY,show_id INTEGER,name TEXT,season INTEGER,number INTEGER,airdate TEXT,airtime TEXT,airstamp TEXT,runtime INTEGER,rating REAL,summary TEXT,image_medium TEXT,updated_at TEXT);
    CREATE TABLE followed_shows(show_id INTEGER PRIMARY KEY,created_at TEXT);
    CREATE TABLE movies(id INTEGER PRIMARY KEY,title TEXT,original_title TEXT,overview TEXT,genres TEXT,release_date TEXT,local_release_date TEXT,local_release_type TEXT,rating REAL,vote_count INTEGER,popularity REAL,original_language TEXT,poster_path TEXT,backdrop_path TEXT,region TEXT,updated_at TEXT);
    CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
    INSERT INTO shows VALUES (1,'Český ? show','Drama',NULL,'[]',NULL,NULL,NULL,NULL,8.5,1,NULL,NULL,NULL,NULL,'It''s fine','2026');
  `);
  execFileSync("python3", ["scripts/d1-export-to-json.py", dump, snapshot]);
  const result = JSON.parse(fs.readFileSync(snapshot, "utf8"));
  assert.equal(result.counts.shows, 1);
  assert.equal(result.counts.episodes, 0);
  assert.equal(result.tables.shows[0].name, "Český ? show");
  assert.equal(result.tables.shows[0].rating, 8.5);
  assert.equal(result.tables.shows[0].language, null);
  assert.equal(result.tables.shows[0].summary, "It's fine");
  fs.rmSync(dir, { recursive: true, force: true });
});
