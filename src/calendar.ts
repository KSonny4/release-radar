import type { Env, EpisodeRow, MovieRow } from "./types";
import { addDays, all, dateOnly } from "./db";
import { BASE_URL } from "./types";

export async function handleCalendarFeed(request:Request,env:Env):Promise<Response|null>{
  if(request.method!=="GET")return null;
  const url=new URL(request.url);
  if(url.pathname!=="/calendar/series.ics"&&url.pathname!=="/calendar/movies.ics")return null;
  if(!env.CALENDAR_TOKEN)return new Response("Calendar feed is not configured",{status:503});
  if(url.searchParams.get("token")!==env.CALENDAR_TOKEN)return new Response("Not found",{status:404});
  return url.pathname.endsWith("series.ics")?seriesFeed(env):movieFeed(env);
}

async function seriesFeed(env:Env):Promise<Response>{
  const rows=await all<EpisodeRow>(env.DB,`SELECT e.*,s.name AS show_name FROM episodes e JOIN shows s ON s.id=e.show_id JOIN followed_shows f ON f.show_id=s.id WHERE e.airdate<=? ORDER BY e.airdate,e.airstamp,e.id`,[dateOnly(addDays(new Date(),730))]);
  const events=rows.filter(e=>e.airdate).map(e=>{
    const se=e.season!==null&&e.number!==null?`S${String(e.season).padStart(2,"0")}E${String(e.number).padStart(2,"0")}`:"Episode";
    const summary=`${e.show_name||"Series"} ${se}${e.name?` · ${e.name}`:""}`;
    return ["BEGIN:VEVENT",`UID:tvmaze-${e.id}@radar.pkubelka.cz`,...eventRevisionLines(e.updated_at),...episodeTimingLines(e),`SUMMARY:${icsEscape(summary)}`,`DESCRIPTION:${icsEscape(`Release Radar · ${BASE_URL}/series/${e.show_id}`)}`,`URL:${BASE_URL}/series/${e.show_id}`,"TRANSP:TRANSPARENT","END:VEVENT"].join("\r\n");
  }).join("\r\n");
  return calendarResponse("Release Radar - Series","Followed TV series episode air times.",events);
}

async function movieFeed(env:Env):Promise<Response>{
  const rows=await all<MovieRow>(env.DB,`SELECT m.* FROM movies m JOIN selected_movies sm ON sm.movie_id=m.id WHERE COALESCE(m.local_release_date,m.release_date)>=? AND COALESCE(m.local_release_date,m.release_date)<=? ORDER BY COALESCE(m.local_release_date,m.release_date),m.id`,[dateOnly(new Date()),dateOnly(addDays(new Date(),730))]);
  const events=rows.map(m=>{
    const date=m.local_release_date||m.release_date;if(!date)return "";
    const start=compactDate(date);const end=compactDate(dateOnly(addDays(new Date(`${date}T00:00:00Z`),1)));
    const details=[m.local_release_type||"Movie",m.rating!==null?`TMDB ${m.rating.toFixed(1)}/10`:""].filter(Boolean).join(" · ");
    return ["BEGIN:VEVENT",`UID:tmdb-${m.id}@radar.pkubelka.cz`,...eventRevisionLines(m.updated_at),`DTSTART;VALUE=DATE:${start}`,`DTEND;VALUE=DATE:${end}`,`SUMMARY:${icsEscape(m.title)}`,`DESCRIPTION:${icsEscape(`${details}\nRelease Radar · ${BASE_URL}/movies/${m.id}`)}`,`URL:${BASE_URL}/movies/${m.id}`,"TRANSP:TRANSPARENT","END:VEVENT"].join("\r\n");
  }).filter(Boolean).join("\r\n");
  return calendarResponse("Release Radar - Movies","Movie release dates you selected in Release Radar.",events);
}

export function episodeTimingLines(e:Pick<EpisodeRow,"airdate"|"airstamp"|"runtime">):string[]{
  if(e.airstamp){
    const start=new Date(e.airstamp);
    if(!Number.isNaN(start.getTime())){
      const lines=[`DTSTART:${utcStamp(start)}`];
      if(e.runtime!==null&&Number.isFinite(e.runtime)&&e.runtime>0){
        const end=new Date(start.getTime()+Math.round(e.runtime)*60_000);
        lines.push(`DTEND:${utcStamp(end)}`);
      }
      return lines;
    }
  }
  if(!e.airdate)return [];
  const start=compactDate(e.airdate);const end=compactDate(dateOnly(addDays(new Date(`${e.airdate}T00:00:00Z`),1)));
  return [`DTSTART;VALUE=DATE:${start}`,`DTEND;VALUE=DATE:${end}`];
}

export function eventRevisionLines(updatedAt:string):string[]{
  const modified=new Date(updatedAt);
  if(Number.isNaN(modified.getTime()))return [`DTSTAMP:${utcStamp(new Date())}`];
  const stamp=utcStamp(modified);
  const sequence=Math.max(0,Math.floor(modified.getTime()/60_000));
  return [`DTSTAMP:${stamp}`,`LAST-MODIFIED:${stamp}`,`SEQUENCE:${sequence}`];
}

function calendarResponse(name:string,description:string,events:string):Response{
  const body=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Release Radar//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH",`X-WR-CALNAME:${icsEscape(name)}`,`X-WR-CALDESC:${icsEscape(description)}`,"X-WR-TIMEZONE:Europe/Prague","REFRESH-INTERVAL;VALUE=DURATION:PT6H","X-PUBLISHED-TTL:PT6H",events,"END:VCALENDAR",""].filter((x,i,a)=>x!==""||i===a.length-1).join("\r\n");
  return new Response(body,{headers:{"Content-Type":"text/calendar; charset=utf-8","Content-Disposition":"inline","Cache-Control":"no-cache, no-store, must-revalidate","Pragma":"no-cache","Expires":"0"}});
}

function compactDate(v:string):string{return v.replace(/-/g,"");}
function utcStamp(d:Date):string{return d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");}
function icsEscape(v:string):string{return v.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");}
