import type { Env, ShowRow } from "./types";
import { addDays, all, dateOnly } from "./db";
import { getSeriesGroupCards } from "./series-groups";
import { attr, empty, esc, htmlResponse, isAdmin, layout } from "./ui";

export interface FollowedShowRow extends ShowRow {
  manual:boolean;
  next_season:number|null; next_number:number|null; next_name:string|null; next_airdate:string|null; next_airstamp:string|null;
  upcoming:number|string; last_airdate:string|null;
}
export interface AgendaEpisode { show_id:number; show_name:string; image_medium:string|null; channel:string|null; season:number|null; number:number|null; name:string|null; airdate:string; airtime:string|null; airstamp:string|null; }
export interface AgendaItem { show_id:number; show_name:string; image_medium:string|null; channel:string|null; label:string; name:string|null; count:number; airtime:string|null; airstamp:string|null; }
export interface AgendaDay { date:string; items:AgendaItem[]; }

const AGENDA_LIMIT=400;
const WEEKDAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export async function mySeriesPage(request:Request,env:Env):Promise<Response>{
  const today=dateOnly(new Date());
  const [shows,episodes,groups]=await Promise.all([
    all<FollowedShowRow>(env.DB,`SELECT s.*,(m.show_id IS NOT NULL) AS manual,
      n.season AS next_season,n.number AS next_number,n.name AS next_name,n.airdate AS next_airdate,n.airstamp AS next_airstamp,
      (SELECT COUNT(*) FROM episodes e WHERE e.show_id=s.id AND e.airdate>=?) AS upcoming,
      (SELECT MAX(e.airdate) FROM episodes e WHERE e.show_id=s.id AND e.airdate<?) AS last_airdate
      FROM followed_shows f JOIN shows s ON s.id=f.show_id
      LEFT JOIN manual_followed_shows m ON m.show_id=s.id
      LEFT JOIN LATERAL (SELECT * FROM episodes e WHERE e.show_id=s.id AND e.airdate>=? ORDER BY e.airdate,e.airstamp NULLS LAST,e.season,e.number LIMIT 1) n ON true
      ORDER BY n.airdate ASC NULLS LAST,lower(s.name),s.name`,[today,today,today]),
    all<AgendaEpisode>(env.DB,`SELECT e.show_id,s.name AS show_name,s.image_medium,COALESCE(s.web_channel,s.network) AS channel,e.season,e.number,e.name,e.airdate,e.airtime,e.airstamp
      FROM episodes e JOIN followed_shows f ON f.show_id=e.show_id JOIN shows s ON s.id=e.show_id
      WHERE e.airdate>=? ORDER BY e.airdate,e.airstamp NULLS LAST,lower(s.name),e.season,e.number LIMIT ${AGENDA_LIMIT}`,[today]),
    getSeriesGroupCards(env,"",true)
  ]);
  const admin=isAdmin(request,env);
  const days=groupAgenda(episodes);
  const withDate=shows.filter(s=>s.next_airdate);
  const weekEnd=dateOnly(addDays(new Date(),7));
  const thisWeek=episodes.filter(e=>e.airdate<=weekEnd).length;
  const next=withDate[0];

  const hero=`<section class="page-head my-head"><div><p class="eyebrow">My Series</p><h1>What you follow, and when it airs.</h1><p>Every series in your calendar, with its next episode. Dates come from TVmaze and refresh daily.</p></div>
    <div class="stats">${stat(shows.length,"series followed")}${stat(withDate.length,"with a date")}${stat(thisWeek,"episodes this week")}</div></section>
    ${next?`<a class="next-up" href="/series/${next.id}">${thumb(next.image_medium,next.name,"next-thumb")}<div><p class="eyebrow">Next up · ${esc(relativeDay(next.next_airdate!,today))}</p><h2>${esc(next.name)}</h2><p>${esc(episodeLabel(next.next_season,next.next_number))}${next.next_name&&next.next_name!=="TBA"?` · ${esc(next.next_name)}`:""} · ${esc(formatDate(next.next_airdate!,today))}${next.web_channel||next.network?` · ${esc(next.web_channel||next.network)}`:""}</p></div></a>`:""}`;

  const collections=groups.length?`<div class="collections"><span class="meta">Collections:</span>${groups.map(g=>`<span class="chip">${esc(g.title)}</span>`).join("")}<span class="meta">New shows in these franchises are added automatically.</span></div>`:"";

  const agenda=days.length?`<div class="agenda">${days.map(day=>`<section class="agenda-day"><header><strong>${esc(relativeDay(day.date,today))}</strong><span>${esc(formatDate(day.date,today))}</span></header>${day.items.map(agendaRow).join("")}</section>`).join("")}</div>${episodes.length>=AGENDA_LIMIT?`<p class="meta">Showing the next ${AGENDA_LIMIT} episodes.</p>`:""}`
    :empty(shows.length?"None of your series has an announced upcoming episode yet.":"You are not following any series yet.");

  const list=shows.length?`<div class="followed-list">${shows.map(s=>followedRow(s,today,admin)).join("")}</div>`
    :`<div class="empty">Nothing here yet. <a href="/series">Browse series</a> and add them to your calendar.</div>`;

  const body=`${hero}${collections}
    <section class="section-head"><div><p class="eyebrow">Schedule</p><h2>Coming up</h2></div></section>${agenda}
    <section class="section-head"><div><p class="eyebrow">Following</p><h2>Your series (${shows.length})</h2></div>${admin?`<a href="/admin/series?calendar=saved">Manage</a>`:""}</section>${list}`;
  return htmlResponse(layout("My Series",body,request,env));
}

/** Groups episodes by day and collapses same-show drops (e.g. a whole season released at once) into one row. */
export function groupAgenda(episodes:AgendaEpisode[]):AgendaDay[]{
  const days:AgendaDay[]=[];
  const pending=new Map<string,AgendaEpisode[]>();
  for(const e of episodes){
    const key=`${e.airdate}|${e.show_id}`;
    const list=pending.get(key);
    if(list){list.push(e);continue;}
    pending.set(key,[e]);
    let day=days[days.length-1];
    if(!day||day.date!==e.airdate){day={date:e.airdate,items:[]};days.push(day);}
    day.items.push({show_id:e.show_id,show_name:e.show_name,image_medium:e.image_medium,channel:e.channel,label:"",name:null,count:0,airtime:e.airtime,airstamp:e.airstamp});
  }
  for(const day of days)for(const item of day.items){
    const eps=pending.get(`${day.date}|${item.show_id}`)!;
    const first=eps[0],last=eps[eps.length-1];
    item.count=eps.length;
    if(eps.length===1){item.label=episodeLabel(first.season,first.number);item.name=first.name&&first.name!=="TBA"?first.name:null;}
    else item.label=first.season!==null&&first.season===last.season&&first.number!==null&&last.number!==null
      ?`${episodeLabel(first.season,first.number)}–E${pad(last.number)}`:`${eps.length} episodes`;
  }
  return days;
}

export function episodeLabel(season:number|null,number:number|null):string{
  if(season===null||number===null)return "Episode";
  return `S${pad(season)}E${pad(number)}`;
}

export function daysBetween(from:string,to:string):number{return Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000);}

export function relativeDay(date:string,today:string):string{
  const d=daysBetween(today,date);
  if(d===0)return "Today";
  if(d===1)return "Tomorrow";
  if(d<0)return d===-1?"Yesterday":`${-d} days ago`;
  if(d<7)return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `In ${d} days`;
}

export function formatDate(date:string,today:string):string{
  const d=new Date(`${date}T00:00:00Z`);
  const base=`${WEEKDAYS[d.getUTCDay()].slice(0,3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return date.slice(0,4)===today.slice(0,4)?base:`${base} ${d.getUTCFullYear()}`;
}

function followedRow(s:FollowedShowRow,today:string,admin:boolean):string{
  const upcoming=Number(s.upcoming||0);
  const channel=s.web_channel||s.network;
  const nextLine=s.next_airdate
    ?`<div class="when"><b>${esc(relativeDay(s.next_airdate,today))}</b><span>${esc(formatDate(s.next_airdate,today))}</span></div><div class="what"><strong>${esc(episodeLabel(s.next_season,s.next_number))}</strong>${s.next_name&&s.next_name!=="TBA"?`<span>${esc(s.next_name)}</span>`:""}${upcoming>1?`<span>+${upcoming-1} more scheduled</span>`:""}</div>`
    :`<div class="when muted"><b>${s.status==="Ended"?"Ended":"No date yet"}</b><span>${s.last_airdate?`Last aired ${esc(formatDate(s.last_airdate,today))}`:esc(s.status||"")}</span></div><div class="what"></div>`;
  const toggle=admin?`<form data-calendar-toggle="series" method="post" action="/admin/series/${s.id}/unfollow"><button class="button secondary" title="Remove from calendar" aria-label="Remove from calendar">✓ Added</button></form>`:"";
  return `<article class="followed-row"><a class="followed-main" href="/series/${s.id}">${thumb(s.image_medium,s.name,"row-thumb")}<div class="followed-title"><h3>${esc(s.name)}</h3><p class="meta">${esc([channel,s.status,s.manual?null:"via collection"].filter(Boolean).join(" · "))}</p></div>${nextLine}</a>${toggle}</article>`;
}

function agendaRow(i:AgendaItem):string{
  const time=i.airtime&&i.airstamp?new Date(i.airstamp).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Prague"}):"";
  return `<a class="agenda-row" href="/series/${i.show_id}">${thumb(i.image_medium,i.show_name,"agenda-thumb")}<div><strong>${esc(i.show_name)}</strong><span>${esc(i.label)}${i.name?` · ${esc(i.name)}`:""}${i.count>1?` · ${i.count} episodes`:""}</span></div><em>${esc([time,i.channel].filter(Boolean).join(" · "))}</em></a>`;
}

function thumb(src:string|null,name:string,cls:string):string{
  return src?`<img class="${cls}" loading="lazy" src="${attr(src)}" alt="">`:`<div class="${cls} thumb-placeholder">${esc(name.slice(0,1))}</div>`;
}
function stat(n:number,label:string):string{return `<div class="stat"><b>${n.toLocaleString()}</b><span>${esc(label)}</span></div>`;}
function pad(n:number):string{return String(n).padStart(2,"0");}
