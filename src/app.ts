import type { Env, EpisodeRow, ExecutionContextLike, MovieRow, ShowRow } from "./types";
import { BASE_URL } from "./types";
import { addDays, all, dateOnly, nowIso, scalar } from "./db";
import { runManualSync } from "./sync";
import { MOVIE_GENRES, TV_GENRES, attr, chip, clean, empty, episodeRow, esc, forbidden, htmlResponse, icsDateTime, icsEscape, isAdmin, jsonResponse, layout, movieGrid, numParam, pager, parseGenres, redirect, safeNext, selected, showGrid } from "./ui";

const PAGE_SIZE=48;

export async function handleRequest(request:Request,env:Env,ctx:ExecutionContextLike):Promise<Response>{
  const url=new URL(request.url), path=url.pathname.length>1?url.pathname.replace(/\/+$/," ").trim():"/";
  if(path==="/healthz") return health(env,url);
  if(path==="/login"){if(request.method==="GET")return loginPage(request,env);if(request.method==="POST")return login(request,env);}
  if(path==="/logout") return new Response(null,{status:303,headers:{Location:"/","Set-Cookie":"rr_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"}});
  if(path==="/calendar/series.ics"&&request.method==="GET")return seriesCalendar(url,env);
  if(path==="/admin"&&request.method==="GET"){if(!isAdmin(request,env))return redirect("/login?next=/admin");return adminPage(request,env);}
  if(path==="/admin/sync"&&request.method==="POST"){if(!isAdmin(request,env))return forbidden();const f=await request.formData();ctx.waitUntil(runManualSync(env,String(f.get("kind")||"all")));return redirect("/admin?sync=started");}
  const follow=path.match(/^\/series\/(\d+)\/(follow|unfollow)$/);if(follow&&request.method==="POST"){if(!isAdmin(request,env))return forbidden();const id=Number(follow[1]);if(follow[2]==="follow")await env.DB.prepare("INSERT INTO followed_shows(show_id,created_at) VALUES (?,?) ON CONFLICT(show_id) DO NOTHING").bind(id,nowIso()).run();else await env.DB.prepare("DELETE FROM followed_shows WHERE show_id=?").bind(id).run();return redirect(`/series/${id}`);}
  const show=path.match(/^\/series\/(\d+)$/);if(show&&request.method==="GET")return showDetail(Number(show[1]),request,env);
  const movie=path.match(/^\/movies\/(\d+)$/);if(movie&&request.method==="GET")return movieDetail(Number(movie[1]),request,env);
  if(path==="/series"&&request.method==="GET")return seriesBrowse(url,request,env);
  if(path==="/movies"&&request.method==="GET")return movieBrowse(url,request,env);
  if(path==="/new-series"&&request.method==="GET")return newSeries(url,request,env);
  if(path==="/"&&request.method==="GET")return dashboard(request,env);
  return htmlResponse(layout("Not found",`<section class="panel"><h1>404</h1><p>That page does not exist.</p></section>`,request,env),404);
}

async function health(env:Env,url:URL):Promise<Response>{try{await env.DB.prepare("SELECT 1").first();return jsonResponse({ok:true,worker:"release-radar",hostname:url.hostname});}catch{return jsonResponse({ok:false,db:"error"},503);}}

async function dashboard(request:Request,env:Env):Promise<Response>{
  const today=dateOnly(new Date()), week=dateOnly(addDays(new Date(),7)), month=dateOnly(addDays(new Date(),30));
  const [shows,movies,followed,newShows,episodes,soonMovies,states]=await Promise.all([
    scalar(env.DB,"SELECT COUNT(*) AS n FROM shows"),scalar(env.DB,"SELECT COUNT(*) AS n FROM movies"),scalar(env.DB,"SELECT COUNT(*) AS n FROM followed_shows"),
    all<ShowRow>(env.DB,`SELECT s.*,EXISTS(SELECT 1 FROM followed_shows f WHERE f.show_id=s.id) AS followed FROM shows s WHERE premiered>=? AND premiered<=? ORDER BY COALESCE(rating,0) DESC,COALESCE(weight,0) DESC LIMIT 12`,[today,week]),
    all<EpisodeRow>(env.DB,`SELECT e.*,s.name AS show_name FROM episodes e JOIN shows s ON s.id=e.show_id JOIN followed_shows f ON f.show_id=s.id WHERE e.airdate>=? ORDER BY e.airdate,e.airstamp LIMIT 16`,[today]),
    all<MovieRow>(env.DB,`SELECT * FROM movies WHERE COALESCE(local_release_date,release_date)>=? AND COALESCE(local_release_date,release_date)<=? ORDER BY COALESCE(popularity,0) DESC LIMIT 12`,[today,month]),
    all<{key:string;value:string;updated_at:string}>(env.DB,"SELECT * FROM sync_state ORDER BY key")
  ]);
  const warnings=[!env.TMDB_BEARER_TOKEN?"TMDB_BEARER_TOKEN missing: movie sync paused.":"",!env.ADMIN_TOKEN?"ADMIN_TOKEN missing: follow/unfollow disabled.":"",!env.CALENDAR_TOKEN?"CALENDAR_TOKEN missing: iCalendar feed disabled.":""].filter(Boolean);
  const body=`<section class="hero"><div><p class="eyebrow">Release Radar</p><h1>Series and movie releases, without the noise.</h1><p class="lede">Browse everything, follow series you care about, and subscribe once to a clean calendar feed.</p></div><div class="stats">${stat(shows,"series")}${stat(movies,"movies")}${stat(followed,"followed")}</div></section>
  ${warnings.length?`<section class="notice"><strong>Setup still needed</strong><ul>${warnings.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></section>`:""}
  ${section("Next 7 days","Brand-new series","/new-series")}${showGrid(newShows)}
  ${section("Your calendar","Upcoming followed episodes","/series")}${episodes.length?`<div class="timeline">${episodes.map(episodeRow).join("")}</div>`:empty("Follow a series and future episodes will appear here.")}
  ${section("Next 30 days","Movie releases","/movies")}${movieGrid(soonMovies)}
  <section class="panel"><h3>Sync status</h3><div class="status-grid">${states.map(s=>`<div><strong>${esc(s.key)}</strong><span>${esc(s.value)}</span><small>${esc(s.updated_at)}</small></div>`).join("")||"Cron has not completed yet."}</div></section>`;
  return htmlResponse(layout("Home",body,request,env));
}

async function seriesBrowse(url:URL,request:Request,env:Env):Promise<Response>{
  const q=clean(url.searchParams.get("q")),genre=clean(url.searchParams.get("genre")),status=clean(url.searchParams.get("status")),min=numParam(url.searchParams.get("min_rating")),sort=url.searchParams.get("sort")||"rating",page=Math.max(1,Math.floor(numParam(url.searchParams.get("page"))||1));
  const where:string[]=[],p:unknown[]=[];if(q){where.push("s.name LIKE ?");p.push(`%${q}%`);}if(genre){where.push("s.genres LIKE ?");p.push(`%\"${genre}\"%`);}if(status){where.push("s.status=?");p.push(status);}if(min!==null){where.push("COALESCE(s.rating,0)>=?");p.push(min);}
  const orders:Record<string,string>={rating:"COALESCE(s.rating,0) DESC NULLS LAST,COALESCE(s.weight,0) DESC NULLS LAST,s.name ASC",weight:"COALESCE(s.weight,0) DESC NULLS LAST,COALESCE(s.rating,0) DESC NULLS LAST",newest:"s.premiered DESC NULLS LAST,s.name ASC",name:"s.name ASC"};
  const rows=await all<ShowRow>(env.DB,`SELECT s.*,EXISTS(SELECT 1 FROM followed_shows f WHERE f.show_id=s.id) AS followed FROM shows s ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY ${orders[sort]||orders.rating} LIMIT ? OFFSET ?`,[...p,PAGE_SIZE,(page-1)*PAGE_SIZE]);
  const form=`<form class="filters" method="get"><input name="q" value="${attr(q)}" placeholder="Search series"><select name="genre"><option value="">All genres</option>${TV_GENRES.map(g=>`<option ${selected(g,genre)}>${g}</option>`).join("")}</select><select name="status"><option value="">Any status</option>${["Running","Ended","To Be Determined","In Development"].map(s=>`<option ${selected(s,status)}>${s}</option>`).join("")}</select><input name="min_rating" type="number" min="0" max="10" step="0.1" value="${attr(min===null?"":min)}" placeholder="Min rating"><select name="sort">${[["rating","Best rated"],["weight","Most relevant"],["newest","Newest"],["name","Name"]].map(([v,l])=>`<option value="${v}" ${selected(v,sort)}>${l}</option>`).join("")}</select><button>Filter</button></form>`;
  return htmlResponse(layout("Series",`${pageHead("TV catalogue","Series","TVmaze catalogue cached in Neon and refreshed incrementally.")}${form}${showGrid(rows)}${pager(url,page,rows.length===PAGE_SIZE)}`,request,env));
}

async function showDetail(id:number,request:Request,env:Env):Promise<Response>{
  const s=await env.DB.prepare(`SELECT s.*,EXISTS(SELECT 1 FROM followed_shows f WHERE f.show_id=s.id) AS followed FROM shows s WHERE s.id=?`).bind(id).first<ShowRow>();if(!s)return htmlResponse(layout("Series not found",empty("Series not found in the local catalogue yet."),request,env),404);
  const eps=await all<EpisodeRow>(env.DB,"SELECT * FROM episodes WHERE show_id=? AND airdate>=? ORDER BY airdate,airstamp LIMIT 100",[id,dateOnly(new Date())]);
  const poster=s.image_original?`<img class="poster large" src="${attr(s.image_original)}" alt="">`:`<div class="poster-placeholder">${esc(s.name)}</div>`;
  const body=`<section class="detail">${poster}<div><p class="eyebrow">${esc(s.status||"Series")}</p><h1>${esc(s.name)}</h1><div class="chips">${parseGenres(s.genres).map(chip).join("")}${s.rating!==null?chip(`★ ${s.rating.toFixed(1)}`):""}${s.premiered?chip(s.premiered):""}</div><p class="lede">${esc(s.summary||"No summary available.")}</p><dl class="facts"><dt>Network</dt><dd>${esc(s.web_channel||s.network||"Unknown")}</dd><dt>Language</dt><dd>${esc(s.language||"Unknown")}</dd><dt>Type</dt><dd>${esc(s.type||"Unknown")}</dd></dl>${isAdmin(request,env)?`<form method="post" action="/series/${s.id}/${s.followed?"unfollow":"follow"}"><button class="${s.followed?"secondary":""}">${s.followed?"Remove from calendar":"Follow series"}</button></form>`:`<p class="small">Log in as admin to change followed series.</p>`}</div></section>${section("Future schedule","Upcoming episodes","")}${eps.length?`<div class="timeline">${eps.map(e=>episodeRow({...e,show_name:s.name})).join("")}</div>`:empty("No future episodes are currently known to TVmaze.")}`;
  return htmlResponse(layout(s.name,body,request,env));
}

async function newSeries(url:URL,request:Request,env:Env):Promise<Response>{
  const days=Math.min(90,Math.max(1,Math.floor(numParam(url.searchParams.get("days"))||7))),min=numParam(url.searchParams.get("min_rating")),p:unknown[]=[dateOnly(new Date()),dateOnly(addDays(new Date(),days))];let extra="";if(min!==null){extra=" AND COALESCE(s.rating,0)>=?";p.push(min);}
  const rows=await all<ShowRow>(env.DB,`SELECT s.*,EXISTS(SELECT 1 FROM followed_shows f WHERE f.show_id=s.id) AS followed FROM shows s WHERE s.premiered>=? AND s.premiered<=?${extra} ORDER BY s.premiered,COALESCE(s.rating,0) DESC LIMIT 200`,p);
  const form=`<form class="filters" method="get"><input type="number" name="days" min="1" max="90" value="${days}"><input name="min_rating" type="number" min="0" max="10" step="0.1" value="${attr(min===null?"":min)}" placeholder="Min rating"><button>Apply</button></form>`;
  return htmlResponse(layout("Brand-new series",`${pageHead("Premieres only","Brand-new series","First-ever series premieres in the selected window.")}${form}${showGrid(rows)}`,request,env));
}

async function movieBrowse(url:URL,request:Request,env:Env):Promise<Response>{
  const q=clean(url.searchParams.get("q")),genre=clean(url.searchParams.get("genre")),min=numParam(url.searchParams.get("min_rating")),votes=numParam(url.searchParams.get("min_votes")),from=clean(url.searchParams.get("from")),to=clean(url.searchParams.get("to")),sort=url.searchParams.get("sort")||"release",page=Math.max(1,Math.floor(numParam(url.searchParams.get("page"))||1));
  const where:string[]=[],p:unknown[]=[];if(q){where.push("m.title LIKE ?");p.push(`%${q}%`);}if(genre){where.push("m.genres LIKE ?");p.push(`%\"${genre}\"%`);}if(min!==null){where.push("COALESCE(m.rating,0)>=?");p.push(min);}if(votes!==null){where.push("COALESCE(m.vote_count,0)>=?");p.push(votes);}if(from){where.push("COALESCE(m.local_release_date,m.release_date)>=?");p.push(from);}if(to){where.push("COALESCE(m.local_release_date,m.release_date)<=?");p.push(to);}
  const orders:Record<string,string>={release:"COALESCE(m.local_release_date,m.release_date) ASC,COALESCE(m.popularity,0) DESC",popularity:"COALESCE(m.popularity,0) DESC",rating:"COALESCE(m.rating,0) DESC,COALESCE(m.vote_count,0) DESC",votes:"COALESCE(m.vote_count,0) DESC"};
  const rows=await all<MovieRow>(env.DB,`SELECT m.* FROM movies m ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY ${orders[sort]||orders.release} LIMIT ? OFFSET ?`,[...p,PAGE_SIZE,(page-1)*PAGE_SIZE]);
  const form=`<form class="filters movie-filters" method="get"><input name="q" value="${attr(q)}" placeholder="Search movies"><select name="genre"><option value="">All genres</option>${MOVIE_GENRES.map(g=>`<option ${selected(g,genre)}>${g}</option>`).join("")}</select><input name="min_rating" type="number" min="0" max="10" step="0.1" value="${attr(min===null?"":min)}" placeholder="Min rating"><input name="min_votes" type="number" min="0" step="50" value="${attr(votes===null?"":votes)}" placeholder="Min votes"><input name="from" type="date" value="${attr(from)}"><input name="to" type="date" value="${attr(to)}"><select name="sort">${[["release","Release date"],["popularity","Popularity"],["rating","Rating"],["votes","Vote count"]].map(([v,l])=>`<option value="${v}" ${selected(v,sort)}>${l}</option>`).join("")}</select><button>Filter</button></form>`;
  return htmlResponse(layout("Movies",`${pageHead("Movie catalogue","Upcoming movies",`Region-aware TMDB release data for ${env.MOVIE_REGION||"CZ"}. Movie calendar rules come later.`)}${form}${movieGrid(rows)}${pager(url,page,rows.length===PAGE_SIZE)}`,request,env));
}

async function movieDetail(id:number,request:Request,env:Env):Promise<Response>{
  const m=await env.DB.prepare("SELECT * FROM movies WHERE id=?").bind(id).first<MovieRow>();if(!m)return htmlResponse(layout("Movie not found",empty("Movie not found in the local catalogue yet."),request,env),404);
  const poster=m.poster_path?`<img class="poster large" src="https://image.tmdb.org/t/p/w500${attr(m.poster_path)}" alt="">`:`<div class="poster-placeholder">${esc(m.title)}</div>`;
  const body=`<section class="detail">${poster}<div><p class="eyebrow">${esc(m.local_release_type||"Movie")}</p><h1>${esc(m.title)}</h1><div class="chips">${parseGenres(m.genres).map(chip).join("")}${m.rating!==null?chip(`★ ${m.rating.toFixed(1)}`):""}${m.vote_count!==null?chip(`${m.vote_count} votes`):""}${chip(m.local_release_date||m.release_date||"TBA")}</div><p class="lede">${esc(m.overview||"No synopsis available.")}</p><dl class="facts"><dt>Local release</dt><dd>${esc(m.local_release_date||"Unknown")}</dd><dt>Release type</dt><dd>${esc(m.local_release_type||"Unknown")}</dd><dt>TMDB</dt><dd><a href="https://www.themoviedb.org/movie/${m.id}">Open source record</a></dd></dl><p class="small">Movies are browse-only for now. The second calendar will be added after selection rules are decided.</p></div></section>`;
  return htmlResponse(layout(m.title,body,request,env));
}

function loginPage(request:Request,env:Env):Response{const body=`<section class="panel narrow"><p class="eyebrow">Admin</p><h1>Sign in</h1>${env.ADMIN_TOKEN?`<form method="post" class="stack"><input type="password" name="token" placeholder="Admin token" required><input type="hidden" name="next" value="${attr(new URL(request.url).searchParams.get("next")||"/")}"><button>Sign in</button></form>`:`<div class="notice">ADMIN_TOKEN is not configured yet.</div>`}</section>`;return htmlResponse(layout("Admin login",body,request,env));}
async function login(request:Request,env:Env):Promise<Response>{if(!env.ADMIN_TOKEN)return new Response("ADMIN_TOKEN not configured",{status:503});const f=await request.formData(),token=String(f.get("token")||""),next=safeNext(String(f.get("next")||"/"));if(token!==env.ADMIN_TOKEN)return new Response("Wrong token",{status:401});return new Response(null,{status:303,headers:{Location:next,"Set-Cookie":`rr_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`}});}

async function adminPage(request:Request,env:Env):Promise<Response>{const states=await all<{key:string;value:string;updated_at:string}>(env.DB,"SELECT * FROM sync_state ORDER BY key");const body=`${pageHead("Admin","Sync and configuration","Scheduled sync runs every 15 minutes.")}${new URL(request.url).searchParams.get("sync")?`<div class="notice">Sync started.</div>`:""}<section class="panel"><h2>Manual sync</h2><div class="actions">${["shows","movies","episodes","all"].map(k=>`<form method="post" action="/admin/sync"><input type="hidden" name="kind" value="${k}"><button class="secondary">Sync ${k}</button></form>`).join("")}</div></section><section class="panel"><h2>Configuration</h2><dl class="facts"><dt>TMDB</dt><dd>${env.TMDB_BEARER_TOKEN?"Configured":"Missing"}</dd><dt>Calendar</dt><dd>${env.CALENDAR_TOKEN?"Configured":"Missing"}</dd><dt>Region</dt><dd>${esc(env.MOVIE_REGION||"CZ")}</dd></dl></section><section class="panel"><div class="status-grid">${states.map(s=>`<div><strong>${esc(s.key)}</strong><span>${esc(s.value)}</span><small>${esc(s.updated_at)}</small></div>`).join("")}</div></section>`;return htmlResponse(layout("Admin",body,request,env));}

async function seriesCalendar(url:URL,env:Env):Promise<Response>{if(!env.CALENDAR_TOKEN)return new Response("Calendar token is not configured",{status:503});if(url.searchParams.get("token")!==env.CALENDAR_TOKEN)return new Response("Forbidden",{status:403});const eps=await all<EpisodeRow>(env.DB,`SELECT e.*,s.name AS show_name FROM episodes e JOIN shows s ON s.id=e.show_id JOIN followed_shows f ON f.show_id=s.id WHERE e.airdate>=? ORDER BY e.airdate,e.airstamp`,[dateOnly(new Date())]);const stamp=icsDateTime(new Date());const events=eps.map(e=>{const se=e.season!==null&&e.number!==null?`S${String(e.season).padStart(2,"0")}E${String(e.number).padStart(2,"0")}`:"Episode",summary=`${e.show_name||"Series"} ${se}${e.name?` · ${e.name}`:""}`,start=e.airstamp?`DTSTART:${icsDateTime(new Date(e.airstamp))}`:`DTSTART;VALUE=DATE:${(e.airdate||"").replaceAll("-","")}`;return ["BEGIN:VEVENT",`UID:tvmaze-episode-${e.id}@radar.pkubelka.cz`,`DTSTAMP:${stamp}`,start,`SUMMARY:${icsEscape(summary)}`,`URL:${BASE_URL}/series/${e.show_id}`,"END:VEVENT"].join("\r\n");});return new Response(["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Release Radar//Series//EN","CALSCALE:GREGORIAN","X-WR-CALNAME:Release Radar · Series",...events,"END:VCALENDAR",""].join("\r\n"),{headers:{"Content-Type":"text/calendar; charset=utf-8","Cache-Control":"private, max-age=900"}});}

function stat(n:number,label:string):string{return `<div class="stat"><b>${n.toLocaleString()}</b><span>${label}</span></div>`;}
function section(kicker:string,title:string,href:string):string{return `<section class="section-head"><div><p class="eyebrow">${esc(kicker)}</p><h2>${esc(title)}</h2></div>${href?`<a href="${href}">See all</a>`:""}</section>`;}
function pageHead(kicker:string,title:string,desc:string):string{return `<section class="page-head"><div><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1><p>${esc(desc)}</p></div></section>`;}
