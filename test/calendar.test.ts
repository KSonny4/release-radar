import test from "node:test";
import assert from "node:assert/strict";
import { episodeTimingLines, eventRevisionLines, handleCalendarFeed } from "../src/calendar.ts";

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

test("series feed keeps historical episodes instead of applying a today lower bound",async()=>{
  let sql="";
  let params:unknown[]=[];
  const statement:any={
    bind(...values:unknown[]){params=values;return statement;},
    async first(){return null;},
    async all(){return {results:[{
      id:123,
      show_id:456,
      show_name:"History Show",
      name:"Old Episode",
      season:1,
      number:2,
      airdate:"2020-01-02",
      airtime:null,
      airstamp:null,
      runtime:45,
      rating:null,
      summary:null,
      image_medium:null,
      updated_at:"2020-01-03T00:00:00.000Z"
    }]};},
    async run(){return undefined;}
  };
  const env:any={
    CALENDAR_TOKEN:"test-token",
    DB:{
      prepare(query:string){sql=query;return statement;},
      async batch(){return [];}
    }
  };

  const response=await handleCalendarFeed(new Request("https://radar.pkubelka.cz/calendar/series.ics?token=test-token"),env);
  assert.ok(response);
  const body=await response.text();

  assert.equal(params.length,1);
  assert.match(sql,/WHERE e\.airdate<=\?/);
  assert.doesNotMatch(sql,/e\.airdate>=/);
  assert.match(body,/DTSTART;VALUE=DATE:20200102/);
  assert.match(body,/SUMMARY:History Show S01E02 · Old Episode/);
});
