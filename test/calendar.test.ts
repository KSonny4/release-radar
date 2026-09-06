import test from "node:test";
import assert from "node:assert/strict";
import { episodeTimingLines, eventRevisionLines } from "../src/calendar.ts";

test("uses TVmaze airstamp as an exact UTC start and runtime for end",()=>{
  assert.deepEqual(
    episodeTimingLines({airdate:"2026-09-10",airstamp:"2026-09-10T21:00:00+02:00",runtime:45}),
    ["DTSTART:20260910T190000Z","DTEND:20260910T194500Z"]
  );
});

test("keeps date-only episodes all-day when TVmaze has no exact airstamp",()=>{
  assert.deepEqual(
    episodeTimingLines({airdate:"2026-09-10",airstamp:null,runtime:45}),
    ["DTSTART;VALUE=DATE:20260910","DTEND;VALUE=DATE:20260911"]
  );
});

test("does not invent an end time when runtime is unknown",()=>{
  assert.deepEqual(
    episodeTimingLines({airdate:"2026-09-10",airstamp:"2026-09-10T21:00:00+02:00",runtime:null}),
    ["DTSTART:20260910T190000Z"]
  );
});

test("emits stable revision metadata so calendar clients recognise event updates",()=>{
  assert.deepEqual(
    eventRevisionLines("2026-09-06T21:51:53.123Z"),
    ["DTSTAMP:20260906T215153Z","LAST-MODIFIED:20260906T215153Z","SEQUENCE:29812191"]
  );
});
