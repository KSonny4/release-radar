import test from "node:test";
import assert from "node:assert/strict";
import { daysBetween, episodeLabel, formatDate, groupAgenda, relativeDay, type AgendaEpisode } from "../src/my-series.ts";

const ep=(show_id:number,airdate:string,season:number|null,number:number|null,name:string|null="Pilot"):AgendaEpisode=>
  ({show_id,show_name:`Show ${show_id}`,image_medium:null,channel:null,season,number,name,airdate,airtime:null,airstamp:null});

test("labels episodes and relative days",()=>{
  assert.equal(episodeLabel(1,3),"S01E03");
  assert.equal(episodeLabel(null,3),"Episode");
  assert.equal(daysBetween("2026-09-25","2026-11-25"),61);
  assert.equal(relativeDay("2026-09-25","2026-09-25"),"Today");
  assert.equal(relativeDay("2026-09-26","2026-09-25"),"Tomorrow");
  assert.equal(relativeDay("2026-09-28","2026-09-25"),"Monday");
  assert.equal(relativeDay("2026-11-25","2026-09-25"),"In 61 days");
  assert.equal(formatDate("2026-11-25","2026-09-25"),"Wed 25 Nov");
  assert.equal(formatDate("2027-01-22","2026-09-25"),"Fri 22 Jan 2027");
});

test("groups the agenda by day and collapses a same-day season drop",()=>{
  const days=groupAgenda([
    ep(1,"2026-11-25",1,1,"TBA"),ep(1,"2026-11-25",1,2),ep(1,"2026-11-25",1,8),
    ep(2,"2026-11-25",3,4,"The One"),
    ep(3,"2027-01-22",1,1)
  ]);
  assert.deepEqual(days.map(d=>d.date),["2026-11-25","2027-01-22"]);
  assert.deepEqual(days[0].items.map(i=>[i.show_id,i.label,i.name,i.count]),[[1,"S01E01–E08",null,3],[2,"S03E04","The One",1]]);
  assert.equal(days[1].items[0].label,"S01E01");
});

test("hides TVmaze placeholder episode names",()=>{
  assert.equal(groupAgenda([ep(1,"2026-11-25",1,1,"TBA")])[0].items[0].name,null);
});
