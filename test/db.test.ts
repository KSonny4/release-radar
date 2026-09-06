import test from "node:test";
import assert from "node:assert/strict";
import { toPostgresSql } from "../src/db.ts";

test("translates every D1 positional placeholder in order",()=>{
  assert.equal(toPostgresSql("SELECT * FROM shows WHERE name LIKE ? AND rating >= ? LIMIT ? OFFSET ?"),"SELECT * FROM shows WHERE name LIKE $1 AND rating >= $2 LIMIT $3 OFFSET $4");
});

test("leaves SQL without placeholders unchanged",()=>{
  assert.equal(toPostgresSql("SELECT 1"),"SELECT 1");
});
