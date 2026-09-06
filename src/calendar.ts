import type { Env, EpisodeRow } from "./types";
import { addDays, all, dateOnly } from "./db";
import { BASE_URL } from "./types";

export async function handleCalendarFeed(request:Request,env:Env):Promise<Response|null>{
  if(request.method!=="GET")return null;
  const url=new URL(request.url);
  if(url.pathname!=="/calendar/series.ics"&&url.pathname!=="/calendar/movies.ics")return null;
  if(!env.CALENDAR_TOKEN)return new Response("Calendar feed is not configured",{status:503});
  if(url.searchParams.get("token")!==env.CALENDAR_TOKEN)return new Response("Not found",{status:404});
  return url.pathname.endsWith("series.ics")?seriesFeed(env):movieFeed();
}

async function seriesFeed(env:Env):Promise<Response>{
  const rows=await all<EpisodeRow>(env.DB,`SELECT e.*,s.name AS show_name FROM episodes e JOIN shows s ON s.id=e.show_id JOIN followed_shows f ON f.show_id=s.id WHERE e.airdate>=? AND e.airdate<=? ORDER BY e.airdate,e.airstamp,e.id`,[dateOnly(new Date()),dateOnly(addDays(new Date(),730))]);
  const events=rows.filter(e=>e.airdate).map(e=>{
    const se=e.season!==null&&e.number!==null?`S${String(e.season).padStart(2,"0")}E${String(e.number).padStart(2,"0")}`:"Episode";
    const summary=`${e.show_name||"Series"} ${se}${e.name?` · ${e.name}`:""}`;
    const start=compactDate(e.airdate!);const end=compactDate(dateOnly(addDays(new Date(`${e.airdate}T00:00:00Z`),1)));
    return ["BEGIN:VEVENT",`UID:tvmaze-${e.id}@radar.pkubelka.cz`,`DTSTAMP:${utcStamp(new Date())}`,`DTSTART;VALUE=DATE:${start}`,`DTEND;VALUE=DATE:${end}`,`SUMMARY:${icsEscape(summary)}`,`DESCRIPTION:${icsEscape(`Release Radar · ${BASE_URL}/series/${e.show_id}`)}`,`URL:${BASE_URL}/series/${e.show_id}`,"TRANSP:TRANSPARENT","END:VEVENT"].join("\r\n");
  }).join("\r\n");
  return calendarResponse("Release Radar - Series","Followed TV series episode air dates.",events);
}

function movieFeed():Response{
  return calendarResponse("Release Radar - Movies","Upcoming movies selected by Release Radar. Selection rules are not configured yet.","");
}

function calendarResponse(name:string,description:string,events:string):Response{
  const body=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Release Radar//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH",`X-WR-CALNAME:${icsEscape(name)}`,`X-WR-CALDESC:${icsEscape(description)}`,"X-WR-TIMEZONE:Europe/Prague","REFRESH-INTERVAL;VALUE=DURATION:PT6H","X-PUBLISHED-TTL:PT6H",events,"END:VCALENDAR",""].filter((x,i,a)=>x!==""||i===a.length-1).join("\r\n");
  return new Response(body,{headers:{"Content-Type":"text/calendar; charset=utf-8","Content-Disposition":"inline","Cache-Control":"private, max-age=300"}});
}

function compactDate(v:string):string{return v.replace(/-/g,"");}
function utcStamp(d:Date):string{return d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");}
function icsEscape(v:string):string{return v.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");}
