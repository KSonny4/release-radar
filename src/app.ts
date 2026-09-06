import type { Env, EpisodeRow, ExecutionContextLike, MovieRow, ShowRow } from "./types";
import { BASE_URL } from "./types";
import { addDays, all, dateOnly, nowIso, scalar } from "./db";
import { runManualSync } from "./sync";
import { MOVIE_GENRES, TV_GENRES, attr, chip, clean, empty, episodeRow, esc, forbidden, htmlResponse, isAdmin, jsonResponse, layout, manageMovieGrid, manageShowGrid, movieGrid, numParam, pager, parseGenres, redirect, selected, showGrid } from "./ui";

const PAGE_SIZE=48;

export async function handleRequest(request:Request,env:Env,ctx:ExecutionContextLike):Promise<Response>{
  const url=new URL(request.url);
  const path=url.pathname.length>1?url.pathname.replace(/\/+$/," ").trim():"/";

  if(path==="/healthz")return health(env,url);
  if(path==="/calendar"&&request.method==="GET")return calendarPage(request,env,false);
  if(path==="/login")return redirect("/admin");
  if(path==="/logout")return redirect("/cdn-cgi/access/logout");

  if(path==="/admin"&&request.method==="GET")return requireAdmin(request,env,()=>adminPage(request,env));
  if(path==="/admin/calendar"&&request.method==="GET")return requireAdmin(request,env,()=>calendarPage(request,env,true));
  if(path==="/admin/series"&&request.method==="GET")return requireAdmin(request,env,()=>adminSeries(url,request,env));
  if(path==="/admin/movies"&&request.method==="GET")return requireAdmin(request,env,()=>adminMovies(url,request,env));
  if(path==="/admin/sync"&&request.method==="POST")return requireAdmin(request,env,async()=>{const f=await request.formData();ctx.waitUntil(runManualSync(env,String(f.get("kind")||"shows")));return redirect("/admin?sync=started");});

  const seriesAction=path.match(/^\/admin\/series\/(\d+)\/(follow|unfollow)$/);
  if(seriesAction&&request.method==="POST")return requireAdmin(request,env,async()=>{
    const id=Number(seriesAction[1]);
    if(seriesAction[2]==="follow")await env.DB.prepare("INSERT INTO followed_shows(show_id,created_at) VALUES (?,?) ON CONFLICT(show_id) DO NOTHING").bind(id,nowIso()).run();
    else await env.DB.prepare("DELETE FROM followed_shows WHERE show_id=?").bind(id).run();
    return redirect(safeReturn(request,"/admin/series"));
  });

  const movieAction=path.match(/^\/admin\/movies\/(\d+)\/(select|unselect)$/);
  if(movieAction&&request.method==="POST")return requireAdmin(request,env,async()=>{
    const id=Number(movieAction[1]);
    if(movieAction[2]==="select")await env.DB.prepare("INSERT INTO selected_movies(movie_id,created_at) VALUES (?,?) ON CONFLICT(movie_id) DO NOTHING").bind(id,nowIso()).run();
    else await env.DB.prepare("DELETE FROM selected_movies WHERE movie_id=?").bind(id).run();
    return redirect(safeReturn(request,"/admin/movies"));
  });

  const show=path.match(/^\/series\/(\d+)$/);if(show&&request.method==="GET")return showDetail(Number(show[1]),request,env);
  const movie=path.match(/^\/movies\/(\d+)$/);if(movie&&request.method==="GET")return movieDetail(Number(movie[1]),request,env);
  if(path==="/series"&&request.method==="GET")return seriesBrowse(url,request,env);
  if(path==="/movies"&&request.method==="GET")return movieBrowse(url,request,env);
  if(path==="/new-series"&&request.method==="GET")return newSeries(url,request,env);
  if(path==="/"&&request.method==="GET")return dashboard(request,env);
  return htmlResponse(layout("Not found",`<section class="panel"><h1>404</h1><p>That page does not exist.</p></section>`,request,env),404);
}

function requireAdmin(request:Request,env:Env,fn:()=>Response|Promise<Response>):Response|Promise<Response>{
  if(!isAdmin(request,env))return htmlResponse(layout("Access required",`<section class="panel narrow"><p class="eyebrow">Private area</p><h1>Cloudflare Access required</h1><p class="lede">Calendar management is protected by Cloudflare Access. Configure an Access policy for <code>/admin*</code> and sign in with your allowed identity.</p></section>`,request,env),403);
  return fn();
}

function safeReturn(request:Request,fallback:string):string{
  const ref=request.headers.get("Referer");
  if(!ref)return fallback;
  try{const u=new URL(ref);return u.origin===new URL(request.url).origin&&u.pathname.startsWith("/admin/")?`${u.pathname}${u.search}`:fallback;}catch{return fallback;}
}

async function health(env:Env,url:URL):Promise<Response>{try{await env.DB.prepare("SELECT 1").first();return jsonResponse({ok:true,worker:"release-radar",hostname:url.hostname});}catch{return jsonResponse({ok:false,db:"error"},503);}}

async function dashboard(request:Request,env:Env):Promise<Response>{
  const today=dateOnly(new Date()),week=dateOnly(addDays(new Date(),7)),month=dateOnly(addDays(new Date(),30));
  const [shows,movies,followed,selectedMovies,newShows,episodes,soonMovies]=await Promise.all([
    scalar(env.DB,"SELECT COUNT(*) AS n FROM shows"),
    scalar(env.DB,"SELECT COUNT(*) AS n FROM movies"),
    scalar(env.DB,"SELECT COUNT(*) AS n FROM followed_shows"),
    scalar(env.DB,"SELECT COUNT(*) AS n FROM selected_movies"),
    all<ShowRow>(env.DB,`SELECT s.*,EXISTS(SELECT 1 FROM followed_shows f WHERE f.show_id=s.id) AS followed FROM shows s WHERE premiered>=? AND premiered<=? ORDER BY COALESCE(rating,0) DESC,COALESCE(weight,0) DESC LIMIT 12`,[today,week]),
    all<EpisodeRow>(env.DB,`SELECT e.*,s.name AS show_name FROM episodes e JOIN shows s ON s.id=e.show_id JOIN followed_shows f ON f.show_id=s.id WHERE e.airdate>=? ORDER BY e.airdate,e.airstamp LIMIT 16`,[today]),
    all<MovieRow>(env.DB,`SELECT m.*,EXISTS(SELECT 1 FROM selected_movies sm WHERE sm.movie_id=m.id) AS selected FROM movies m WHERE COALESCE(local_release_date,release_date)>=? AND COALESCE(local_release_date,release_date)<=? ORDER BY COALESCE(popularity,0) DESC LIMIT 12`,[today,month])
  ]);
  const warnings=[!env.TMDB_BEARER_TOKEN?"TMDB is not configured yet, so movie discovery is paused.":"",!env.CALENDAR_TOKEN?"Calendar subscription links are being provisioned.":""].filter(Boolean);
  const body=`<div class="stream-home"><section class="hero"><div><p class="eyebrow">Release Radar</p><h1>Know what drops next.</h1><p class="lede">Your personal release queue for series and movies. Pick what matters once, then let your calendar keep itself up to date.</p><div class="actions"><a class="button primary" href="/calendar">Set up calendars</a><a class="button secondary" href="/series">Browse series</a></div></div><div class="stats">${stat(followed,"series saved")}${stat(selectedMovies,"movies saved")}${stat(shows,"series indexed")}${stat(movies,"movies indexed")}</div></section>
  ${warnings.length?`<section class="notice"><strong>Setup</strong><ul>${warnings.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></section>`:""}
  ${section("Premieres","Brand-new series this week","/new-series")}${showGrid(newShows)}
  ${section("My Series","Upcoming episodes","/calendar")}${episodes.length?`<div class="timeline">${episodes.map(episodeRow).join("")}</div>`:empty("Add series to your calendar and their future episodes will appear here.")}
  ${section("Coming soon","Movies releasing in the next 30 days","/movies")}${movieGrid(soonMovies)}</div>`;
  return htmlResponse(layout("Home",body,request,env));
}

async function seriesBrowse(url:URL,request:Request,env:Env):Promise<Response>{
  const q=clean(url.searchParams.get("q")),genre=clean(url.searchParams.get("genre")),status=clean(url.searchParams.get("status")),min=numParam(url.searchParams.get("min_rating")),calendar=clean(url.searchParams.get("calendar")),sort=url.searchParams.get("sort")||"rating",page=Math.max(1,Math.floor(numParam(url.searchParams.get("page"))||1));
  const where:string[]=[],p:unknown[]=[];
  if(q){where.push("s.name ILIKE ?");p.push(`%${q}%`);}if(genre){where.push("s.genres ILIKE ?");p.push(`%\"${genre}\"%`);}if(status){where.push("s.status=?");p.push(status);}if(min!==null){where.push("COALESCE(s.rating,0)>=?");p.push(min);}if(calendar==="saved")where.push("EXISTS(SELECT 1 FROM followed_shows fs WHERE fs.show_id=s.id)");
  const orders:Record<string,string>={rating:"COALESCE(s.rating,0) DESC NULLS LAST,COALESCE(s.weight,0) DESC NULLS LAST,lower(s.name),s.name",weight:"COALESCE(s.weight,0) DESC NULLS LAST,COALESCE(s.rating,0) DESC NULLS LAST",newest:"s.premiered DESC NULLS LAST,lower(s.name),s.name",name:"lower(s.name),s.name"};
  const rows=await all<ShowRow>(env.DB,`SELECT s.*,EXISTS(SELECT 1 FROM followed_shows f WHERE f.show_id=s.id) AS followed FROM shows s ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY ${orders[sort]||orders.rating} LIMIT ? OFFSET ?`,[...p,PAGE_SIZE,(page-1)*PAGE_SIZE]);
  const form=`<form class="filters" method="get"><input name="q" value="${attr(q)}" placeholder="Search series"><select name="genre"><option value="">All genres</option>${TV_GENRES.map(g=>`<option ${selected(g,genre)}>${g}</option>`).join("")}</select><select name="status"><option value="">Any status</option>${["Running","Ended","To Be Determined","In Development"].map(s=>`<option ${selected(s,status)}>${s}</option>`).join("")}</select><input name="min_rating" type="number" min="0" max="10" step="0.1" value="${attr(min===null?"":min)}" placeholder="Min rating"><select name="calendar"><option value="">All series</option><option value="saved" ${selected("saved",calendar)}>In my calendar</option></select><select name="sort">${[["rating","Best rated"],["weight","Most relevant"],["newest","Newest"],["name","Name"]].map(([v,l])=>`<option value="${v}" ${selected(v,sort)}>${l}</option>`).join("")}</select><button>Filter</button></form>`;
  return htmlResponse(layout("Series",`${pageHead("Series","Find your next obsession","Browse the TVmaze catalogue, then use Manage to choose which shows feed your calendar.")}${form}${showGrid(rows)}${pager(url,page,rows.length===PAGE_SIZE)}`,request,env));
}

async function showDetail(id:number,request:Request,env:Env):Promise<Response>{
  const s=await env.DB.prepare(`SELECT s.*,EXISTS(SELECT 1 FROM followed_shows f WHERE f.show_id=s.id) AS followed FROM shows s WHERE s.id=?`).bind(id).first<ShowRow>();
  if(!s)return htmlResponse(layout("Series not found",empty("Series not found in the local catalogue yet."),request,env),404);
  const eps=await all<EpisodeRow>(env.DB,"SELECT * FROM episodes WHERE show_id=? AND airdate>=? ORDER BY airdate,airstamp LIMIT 100",[id,dateOnly(new Date())]);
  const poster=s.image_original?`<img class="poster large" src="${attr(s.image_original)}" alt="">`:`<div class="poster-placeholder">${esc(s.name)}</div>`;
  const body=`<section class="detail">${poster}<div><p class="eyebrow">${esc(s.status||"Series")}</p><h1>${esc(s.name)}</h1><div class="chips">${parseGenres(s.genres).map(chip).join("")}${s.rating!==null?chip(`★ ${s.rating.toFixed(1)}`):""}${s.premiered?chip(s.premiered):""}${s.followed?chip("In calendar"):""}</div><p class="lede">${esc(s.summary||"No summary available.")}</p><dl class="facts"><dt>Network</dt><dd>${esc(s.web_channel||s.network||"Unknown")}</dd><dt>Language</dt><dd>${esc(s.language||"Unknown")}</dd><dt>Type</dt><dd>${esc(s.type||"Unknown")}</dd></dl><div class="actions"><a class="button primary" href="/admin/series?q=${encodeURIComponent(s.name)}">${s.followed?"Manage calendar":"Add to calendar"}</a><a class="button secondary" href="/calendar">Calendar setup</a></div></div></section>${section("Future schedule","Upcoming episodes","")}${eps.length?`<div class="timeline">${eps.map(e=>episodeRow({...e,show_name:s.name})).join("")}</div>`:empty("No future episodes are currently known to TVmaze.")}`;
  return htmlResponse(layout(s.name,body,request,env));
}

async function newSeries(url:URL,request:Request,env:Env):Promise<Response>{
  const days=Math.min(90,Math.max(1,Math.floor(numParam(url.searchParams.get("days"))||7))),min=numParam(url.searchParams.get("min_rating")),p:unknown[]=[dateOnly(new Date()),dateOnly(addDays(new Date(),days))];let extra="";if(min!==null){extra=" AND COALESCE(s.rating,0)>=?";p.push(min);}
  const rows=await all<ShowRow>(env.DB,`SELECT s.*,EXISTS(SELECT 1 FROM followed_shows f WHERE f.show_id=s.id) AS followed FROM shows s WHERE s.premiered>=? AND s.premiered<=?${extra} ORDER BY s.premiered,COALESCE(s.rating,0) DESC LIMIT 200`,p);
  const form=`<form class="filters" method="get"><input type="number" name="days" min="1" max="90" value="${days}"><input name="min_rating" type="number" min="0" max="10" step="0.1" value="${attr(min===null?"":min)}" placeholder="Min rating"><button>Apply</button></form>`;
  return htmlResponse(layout("Brand-new series",`${pageHead("Premieres only","Brand-new series","First-ever series premieres in the selected window.")}${form}${showGrid(rows)}`,request,env));
}

async function movieBrowse(url:URL,request:Request,env:Env):Promise<Response>{
  const q=clean(url.searchParams.get("q")),genre=clean(url.searchParams.get("genre")),min=numParam(url.searchParams.get("min_rating")),votes=numParam(url.searchParams.get("min_votes")),from=clean(url.searchParams.get("from")),to=clean(url.searchParams.get("to")),calendar=clean(url.searchParams.get("calendar")),sort=url.searchParams.get("sort")||"release",page=Math.max(1,Math.floor(numParam(url.searchParams.get("page"))||1));
  const where:string[]=[],p:unknown[]=[];
  if(q){where.push("m.title ILIKE ?");p.push(`%${q}%`);}if(genre){where.push("m.genres ILIKE ?");p.push(`%\"${genre}\"%`);}if(min!==null){where.push("COALESCE(m.rating,0)>=?");p.push(min);}if(votes!==null){where.push("COALESCE(m.vote_count,0)>=?");p.push(votes);}if(from){where.push("COALESCE(m.local_release_date,m.release_date)>=?");p.push(from);}if(to){where.push("COALESCE(m.local_release_date,m.release_date)<=?");p.push(to);}if(calendar==="saved")where.push("EXISTS(SELECT 1 FROM selected_movies sm WHERE sm.movie_id=m.id)");
  const orders:Record<string,string>={release:"COALESCE(m.local_release_date,m.release_date) ASC,COALESCE(m.popularity,0) DESC",popularity:"COALESCE(m.popularity,0) DESC",rating:"COALESCE(m.rating,0) DESC,COALESCE(m.vote_count,0) DESC",votes:"COALESCE(m.vote_count,0) DESC"};
  const rows=await all<MovieRow>(env.DB,`SELECT m.*,EXISTS(SELECT 1 FROM selected_movies sm WHERE sm.movie_id=m.id) AS selected FROM movies m ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY ${orders[sort]||orders.release} LIMIT ? OFFSET ?`,[...p,PAGE_SIZE,(page-1)*PAGE_SIZE]);
  const form=`<form class="filters movie-filters" method="get"><input name="q" value="${attr(q)}" placeholder="Search movies"><select name="genre"><option value="">All genres</option>${MOVIE_GENRES.map(g=>`<option ${selected(g,genre)}>${g}</option>`).join("")}</select><input name="min_rating" type="number" min="0" max="10" step="0.1" value="${attr(min===null?"":min)}" placeholder="Min rating"><input name="min_votes" type="number" min="0" step="50" value="${attr(votes===null?"":votes)}" placeholder="Min votes"><input name="from" type="date" value="${attr(from)}"><input name="to" type="date" value="${attr(to)}"><select name="calendar"><option value="">All movies</option><option value="saved" ${selected("saved",calendar)}>In my calendar</option></select><select name="sort">${[["release","Release date"],["popularity","Popularity"],["rating","Rating"],["votes","Vote count"]].map(([v,l])=>`<option value="${v}" ${selected(v,sort)}>${l}</option>`).join("")}</select><button>Filter</button></form>`;
  return htmlResponse(layout("Movies",`${pageHead("Movies","Coming soon","Czech-region release dates from TMDB. Pick any movie you want and it will appear in the Movies calendar.")}${form}${movieGrid(rows)}${pager(url,page,rows.length===PAGE_SIZE)}`,request,env));
}

async function movieDetail(id:number,request:Request,env:Env):Promise<Response>{
  const m=await env.DB.prepare("SELECT m.*,EXISTS(SELECT 1 FROM selected_movies sm WHERE sm.movie_id=m.id) AS selected FROM movies m WHERE m.id=?").bind(id).first<MovieRow>();
  if(!m)return htmlResponse(layout("Movie not found",empty("Movie not found in the local catalogue yet."),request,env),404);
  const poster=m.poster_path?`<img class="poster large" src="https://image.tmdb.org/t/p/w500${attr(m.poster_path)}" alt="">`:`<div class="poster-placeholder">${esc(m.title)}</div>`;
  const body=`<section class="detail">${poster}<div><p class="eyebrow">${esc(m.local_release_type||"Movie")}</p><h1>${esc(m.title)}</h1><div class="chips">${parseGenres(m.genres).map(chip).join("")}${m.rating!==null?chip(`★ ${m.rating.toFixed(1)}`):""}${m.vote_count!==null?chip(`${m.vote_count} votes`):""}${chip(m.local_release_date||m.release_date||"TBA")}${m.selected?chip("In calendar"):""}</div><p class="lede">${esc(m.overview||"No synopsis available.")}</p><dl class="facts"><dt>Local release</dt><dd>${esc(m.local_release_date||"Unknown")}</dd><dt>Release type</dt><dd>${esc(m.local_release_type||"Unknown")}</dd><dt>TMDB</dt><dd><a href="https://www.themoviedb.org/movie/${m.id}">Open source record</a></dd></dl><div class="actions"><a class="button primary" href="/admin/movies?q=${encodeURIComponent(m.title)}">${m.selected?"Manage calendar":"Add to calendar"}</a><a class="button secondary" href="/calendar">Calendar setup</a></div></div></section>`;
  return htmlResponse(layout(m.title,body,request,env));
}

async function adminPage(request:Request,env:Env):Promise<Response>{
  const [series,movies]=await Promise.all([scalar(env.DB,"SELECT COUNT(*) AS n FROM followed_shows"),scalar(env.DB,"SELECT COUNT(*) AS n FROM selected_movies")]);
  const body=`${pageHead("Private","Manage Release Radar","Cloudflare Access protects these controls.")}<div class="calendar-cards"><a class="calendar-card" href="/admin/series"><div class="calendar-icon">▣</div><p class="eyebrow">Series</p><h2>${series} saved</h2><p>Choose which series automatically add every future episode to the Series calendar.</p></a><a class="calendar-card" href="/admin/movies"><div class="calendar-icon">▶</div><p class="eyebrow">Movies</p><h2>${movies} saved</h2><p>Choose individual movies whose Czech release dates should appear in the Movies calendar.</p></a></div><section class="panel"><div class="actions"><a class="button primary" href="/admin/calendar">Subscription links</a><form method="post" action="/admin/sync"><input type="hidden" name="kind" value="shows"><button class="secondary">Refresh series data</button></form><form method="post" action="/admin/sync"><input type="hidden" name="kind" value="movies"><button class="secondary">Refresh movie data</button></form></div>${new URL(request.url).searchParams.get("sync")?`<p class="small">Refresh started.</p>`:""}</section>`;
  return htmlResponse(layout("Manage",body,request,env));
}

async function adminSeries(url:URL,request:Request,env:Env):Promise<Response>{
  const q=clean(url.searchParams.get("q")),calendar=clean(url.searchParams.get("calendar"));const where:string[]=[],p:unknown[]=[];
  if(q){where.push("s.name ILIKE ?");p.push(`%${q}%`);}if(calendar==="saved")where.push("EXISTS(SELECT 1 FROM followed_shows f WHERE f.show_id=s.id)");
  const rows=await all<ShowRow>(env.DB,`SELECT s.*,EXISTS(SELECT 1 FROM followed_shows f WHERE f.show_id=s.id) AS followed FROM shows s ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY COALESCE(s.weight,0) DESC,COALESCE(s.rating,0) DESC LIMIT 60`,p);
  const form=`<form class="filters" method="get"><input name="q" value="${attr(q)}" placeholder="Search series"><select name="calendar"><option value="">All series</option><option value="saved" ${selected("saved",calendar)}>Already added</option></select><button>Find</button></form>`;
  return htmlResponse(layout("Manage series",`${pageHead("Series calendar","Pick your shows","Adding a series puts all known future episodes into the subscribed Series calendar.")}<div class="actions"><a class="button secondary" href="/admin/calendar">← Calendar setup</a></div>${form}${manageShowGrid(rows)}`,request,env));
}

async function adminMovies(url:URL,request:Request,env:Env):Promise<Response>{
  const q=clean(url.searchParams.get("q")),calendar=clean(url.searchParams.get("calendar"));const where:string[]=[],p:unknown[]=[];
  if(q){where.push("m.title ILIKE ?");p.push(`%${q}%`);}if(calendar==="saved")where.push("EXISTS(SELECT 1 FROM selected_movies sm WHERE sm.movie_id=m.id)");
  const rows=await all<MovieRow>(env.DB,`SELECT m.*,EXISTS(SELECT 1 FROM selected_movies sm WHERE sm.movie_id=m.id) AS selected FROM movies m ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY COALESCE(m.local_release_date,m.release_date) ASC NULLS LAST,COALESCE(m.popularity,0) DESC LIMIT 60`,p);
  const form=`<form class="filters" method="get"><input name="q" value="${attr(q)}" placeholder="Search movies"><select name="calendar"><option value="">All movies</option><option value="saved" ${selected("saved",calendar)}>Already added</option></select><button>Find</button></form>`;
  return htmlResponse(layout("Manage movies",`${pageHead("Movies calendar","Pick the releases you care about","Adding a movie puts its Czech release date into the subscribed Movies calendar.")}<div class="actions"><a class="button secondary" href="/admin/calendar">← Calendar setup</a></div>${form}${manageMovieGrid(rows)}`,request,env));
}

async function calendarPage(request:Request,env:Env,privateMode:boolean):Promise<Response>{
  const [seriesCount,movieCount,episodeCount,movieEventCount]=await Promise.all([
    scalar(env.DB,"SELECT COUNT(*) AS n FROM followed_shows"),scalar(env.DB,"SELECT COUNT(*) AS n FROM selected_movies"),
    scalar(env.DB,"SELECT COUNT(*) AS n FROM episodes e JOIN followed_shows f ON f.show_id=e.show_id WHERE e.airdate>=?",[dateOnly(new Date())]),
    scalar(env.DB,"SELECT COUNT(*) AS n FROM movies m JOIN selected_movies sm ON sm.movie_id=m.id WHERE COALESCE(m.local_release_date,m.release_date)>=?",[dateOnly(new Date())])
  ]);
  const token=privateMode?env.CALENDAR_TOKEN:undefined;
  const seriesUrl=token?`${BASE_URL}/calendar/series.ics?token=${encodeURIComponent(token)}`:"";
  const movieUrl=token?`${BASE_URL}/calendar/movies.ics?token=${encodeURIComponent(token)}`:"";
  const feed=(kind:string,title:string,url:string,count:number,items:number)=>`<section class="calendar-card"><div class="calendar-icon">${kind==="series"?"▣":"▶"}</div><p class="eyebrow">${esc(kind)}</p><h2>${esc(title)}</h2><p>${count} saved · ${items} upcoming calendar events.</p>${url?`<div class="feed-url"><code>${esc(url)}</code><button type="button" data-copy="${attr(url)}">Copy URL</button></div><div class="actions"><a class="button primary" href="${attr(url.replace("https://","webcal://"))}">Subscribe</a><a class="button secondary" href="/admin/${kind}">Choose ${kind}</a></div>`:`<div class="lock-card"><strong>Private link hidden</strong><p>Open the protected calendar manager through Cloudflare Access to reveal and copy this feed URL.</p><a class="button primary" href="/admin/calendar">Open calendar manager</a></div>`}</section>`;
  const body=`<section class="calendar-hero"><p class="eyebrow">My Calendar</p><h1>Subscribe once. Never hunt for release dates again.</h1><p class="lede">Release Radar publishes two live calendar feeds. Add them to Google Calendar, Apple Calendar or Outlook once. When you add or remove a series or movie here, the subscribed calendars update automatically.</p></section><div class="calendar-cards">${feed("series","Release Radar - Series",seriesUrl,seriesCount,episodeCount)}${feed("movies","Release Radar - Movies",movieUrl,movieCount,movieEventCount)}</div><div class="divider"></div><section><p class="eyebrow">How to import</p><h2>Use “subscribe from URL”, not file import</h2><p class="lede">A file import is a one-time snapshot. A URL subscription stays connected to Release Radar.</p><div class="provider-grid"><article class="provider"><h3>Google Calendar</h3><ol class="steps"><li>Open Google Calendar on desktop.</li><li>Next to <strong>Other calendars</strong>, click <strong>+</strong>.</li><li>Choose <strong>From URL</strong>.</li><li>Paste the HTTPS feed URL and choose <strong>Add calendar</strong>.</li><li>Repeat for Series and Movies.</li></ol></article><article class="provider"><h3>Apple Calendar</h3><ol class="steps"><li>Open Calendar on Mac.</li><li>Choose <strong>File → New Calendar Subscription</strong>.</li><li>Paste the feed URL.</li><li>Choose your refresh interval and save.</li></ol></article><article class="provider"><h3>Outlook</h3><ol class="steps"><li>Open Calendar.</li><li>Choose <strong>Add calendar</strong>.</li><li>Select <strong>Subscribe from web</strong>.</li><li>Paste the feed URL, name it and import.</li></ol></article></div></section>${privateMode?`<section class="panel"><p class="eyebrow">Manage content</p><h2>What goes into each calendar?</h2><div class="actions"><a class="button primary" href="/admin/series">Choose series</a><a class="button primary" href="/admin/movies">Choose movies</a></div></section>`:""}`;
  return htmlResponse(layout("Calendar",body,request,env));
}

function stat(n:number,label:string):string{return `<div class="stat"><b>${n.toLocaleString()}</b><span>${label}</span></div>`;}
function section(kicker:string,title:string,href:string):string{return `<section class="section-head"><div><p class="eyebrow">${esc(kicker)}</p><h2>${esc(title)}</h2></div>${href?`<a href="${href}">See all</a>`:""}</section>`;}
function pageHead(kicker:string,title:string,desc:string):string{return `<section class="page-head"><div><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1><p>${esc(desc)}</p></div></section>`;}
