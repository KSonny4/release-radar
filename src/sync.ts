import type { D1Database, D1PreparedStatement, Env } from "./types";
import { addDays, batchChunks, dateOnly, errorMessage, getState, intEnv, nowIso, nullable, nullableNumber, setState, stripHtml } from "./db";
import { applySubscribedSeriesGroups } from "./series-groups";

const TVMAZE_API="https://api.tvmaze.com";
const TMDB_API="https://api.themoviedb.org/3";
const MOVIE_GENRES:Record<number,string>={28:"Action",12:"Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",18:"Drama",10751:"Family",14:"Fantasy",36:"History",27:"Horror",10402:"Music",9648:"Mystery",10749:"Romance",878:"Science Fiction",10770:"TV Movie",53:"Thriller",10752:"War",37:"Western"};
const RELEASE_TYPES:Record<number,string>={1:"Premiere",2:"Theatrical (limited)",3:"Theatrical",4:"Digital",5:"Physical",6:"TV"};

export async function runScheduledSync(env:Env,scheduledAt:Date):Promise<void>{
  await setState(env.DB,"cron_last_started",scheduledAt.toISOString());
  try{
    await syncShows(env,intEnv(env.TVMAZE_PAGES_PER_SYNC,5));
    await syncMovies(env,intEnv(env.TMDB_PAGES_PER_SYNC,2));
    const last=await getState(env.DB,"episodes_last_sync");
    if(!last||Date.now()-Date.parse(last)>20*60*60*1000) await syncEpisodes(env);
    await setState(env.DB,"cron_last_success",nowIso());
    await env.DB.prepare("DELETE FROM sync_state WHERE key=?").bind("cron_last_error").run();
  }catch(e){await setState(env.DB,"cron_last_error",errorMessage(e));throw e;}
}

export async function runManualSync(env:Env,kind:string):Promise<void>{
  try{
    if(kind==="shows"||kind==="all") await syncShows(env,intEnv(env.TVMAZE_PAGES_PER_SYNC,5));
    if(kind==="movies"||kind==="all") await syncMovies(env,intEnv(env.TMDB_PAGES_PER_SYNC,2));
    if(kind==="episodes"||kind==="all") await syncEpisodes(env);
    await setState(env.DB,"manual_sync_last_success",`${kind} · ${nowIso()}`);
  }catch(e){await setState(env.DB,"manual_sync_last_error",`${kind} · ${errorMessage(e)}`);throw e;}
}

export async function syncShows(env:Env,pagesPerRun:number):Promise<void>{
  let page=Number(await getState(env.DB,"tvmaze_page")||"0"); let imported=0;
  for(let i=0;i<pagesPerRun;i++){
    const r=await fetch(`${TVMAZE_API}/shows?page=${page}`,{headers:{Accept:"application/json","User-Agent":"ReleaseRadar/0.2"}});
    if(r.status===404){page=0;break;} if(!r.ok) throw new Error(`TVmaze show page ${page}: ${r.status}`);
    const shows=await r.json() as any[]; const marker=nowIso();
    await batchChunks(env.DB,shows.map(s=>upsertShowStatement(env.DB,s,marker))); imported+=shows.length; page++;
  }
  await applySubscribedSeriesGroups(env);
  await setState(env.DB,"tvmaze_page",String(page)); await setState(env.DB,"shows_last_sync",`${nowIso()} · imported ${imported}`);
}

export async function syncShowSearch(env:Env,query:string):Promise<number>{
  const q=query.trim();
  if(!q)return 0;
  const r=await fetch(`${TVMAZE_API}/search/shows?q=${encodeURIComponent(q)}`,{headers:{Accept:"application/json","User-Agent":"ReleaseRadar/0.2"}});
  if(!r.ok)throw new Error(`TVmaze show search: ${r.status}`);
  const matches=await r.json() as any[];
  const shows=matches.map(match=>match?.show).filter(show=>show?.id);
  if(!shows.length)return 0;
  const marker=nowIso();
  await batchChunks(env.DB,shows.map(show=>upsertShowStatement(env.DB,show,marker)));
  await applySubscribedSeriesGroups(env);
  await setState(env.DB,"shows_search_last_sync",`${marker} · imported ${shows.length}`);
  return shows.length;
}

export async function syncEpisodes(env:Env):Promise<void>{
  const r=await fetch(`${TVMAZE_API}/schedule/full`,{headers:{Accept:"application/json","User-Agent":"ReleaseRadar/0.2"}});
  if(!r.ok) throw new Error(`TVmaze full schedule: ${r.status}`);
  const episodes=await r.json() as any[]; const marker=nowIso(); const showMap=new Map<number,any>();
  for(const ep of episodes){const s=ep?._embedded?.show;if(s?.id)showMap.set(Number(s.id),s);}
  await batchChunks(env.DB,[...showMap.values()].map(s=>upsertShowStatement(env.DB,s,marker)));
  const stmts:D1PreparedStatement[]=[];
  for(const ep of episodes){const showId=Number(ep?._embedded?.show?.id||0);if(!showId||!ep?.id)continue;
    stmts.push(env.DB.prepare(`INSERT INTO episodes (id,show_id,name,season,number,airdate,airtime,airstamp,runtime,rating,summary,image_medium,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET show_id=excluded.show_id,name=excluded.name,season=excluded.season,number=excluded.number,airdate=excluded.airdate,airtime=excluded.airtime,airstamp=excluded.airstamp,runtime=excluded.runtime,rating=excluded.rating,summary=excluded.summary,image_medium=excluded.image_medium,updated_at=excluded.updated_at`).bind(Number(ep.id),showId,nullable(ep.name),nullableNumber(ep.season),nullableNumber(ep.number),nullable(ep.airdate),nullable(ep.airtime),nullable(ep.airstamp),nullableNumber(ep.runtime),nullableNumber(ep.rating?.average),stripHtml(nullable(ep.summary)),nullable(ep.image?.medium),marker));
  }
  await batchChunks(env.DB,stmts);
  await env.DB.prepare("DELETE FROM episodes WHERE airdate >= ? AND updated_at <> ?").bind(dateOnly(new Date()),marker).run();
  await applySubscribedSeriesGroups(env);
  await setState(env.DB,"episodes_last_sync",marker); await setState(env.DB,"episodes_known_future",String(stmts.length));
}

export async function syncMovies(env:Env,pagesPerRun:number):Promise<void>{
  if(!env.TMDB_BEARER_TOKEN){await setState(env.DB,"movies_sync","paused: TMDB_BEARER_TOKEN missing");return;}
  const region=env.MOVIE_REGION||"CZ", language=env.TMDB_LANGUAGE||"en-US", from=dateOnly(addDays(new Date(),-14)), to=dateOnly(addDays(new Date(),intEnv(env.MOVIE_WINDOW_DAYS,365)));
  let page=Number(await getState(env.DB,"tmdb_page")||"1"), imported=0;
  for(let i=0;i<pagesPerRun;i++){
    const qs=new URLSearchParams({include_adult:"false",include_video:"false",language,page:String(page),region,sort_by:"primary_release_date.asc","primary_release_date.gte":from,"primary_release_date.lte":to});
    const discover=await tmdbJson(`${TMDB_API}/discover/movie?${qs}`,env.TMDB_BEARER_TOKEN) as any; const results=Array.isArray(discover.results)?discover.results:[];
    if(!results.length){page=1;break;}
    const detailed=await Promise.all(results.map(async(movie:any)=>{try{return{discover:movie,detail:await tmdbJson(`${TMDB_API}/movie/${movie.id}?language=${encodeURIComponent(language)}&append_to_response=release_dates`,env.TMDB_BEARER_TOKEN!)};}catch(e){console.warn("TMDB detail failed",movie.id,e);return{discover:movie,detail:null};}}));
    const marker=nowIso();
    const stmts=detailed.map(({discover:movie,detail}:any)=>{const local=chooseRelease(detail?.release_dates?.results,region,movie.release_date);const genres=detail?.genres?.length?detail.genres.map((g:any)=>String(g.name)):(movie.genre_ids||[]).map((id:number)=>MOVIE_GENRES[id]).filter(Boolean);
      return env.DB.prepare(`INSERT INTO movies (id,title,original_title,overview,genres,release_date,local_release_date,local_release_type,rating,vote_count,popularity,original_language,poster_path,backdrop_path,region,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,original_title=excluded.original_title,overview=excluded.overview,genres=excluded.genres,release_date=excluded.release_date,local_release_date=excluded.local_release_date,local_release_type=excluded.local_release_type,rating=excluded.rating,vote_count=excluded.vote_count,popularity=excluded.popularity,original_language=excluded.original_language,poster_path=excluded.poster_path,backdrop_path=excluded.backdrop_path,region=excluded.region,updated_at=excluded.updated_at`).bind(Number(movie.id),String(detail?.title||movie.title||"Untitled"),nullable(detail?.original_title||movie.original_title),nullable(detail?.overview||movie.overview),JSON.stringify(genres),nullable(movie.release_date),local.date,local.type,nullableNumber(detail?.vote_average??movie.vote_average),nullableNumber(detail?.vote_count??movie.vote_count),nullableNumber(detail?.popularity??movie.popularity),nullable(detail?.original_language||movie.original_language),nullable(detail?.poster_path||movie.poster_path),nullable(detail?.backdrop_path||movie.backdrop_path),region,marker);
    });
    await batchChunks(env.DB,stmts); imported+=stmts.length; const total=Math.min(Number(discover.total_pages||1),100); page=page>=total?1:page+1;
  }
  await setState(env.DB,"tmdb_page",String(page)); await setState(env.DB,"movies_last_sync",`${nowIso()} · imported ${imported} · region ${region}`);
}

function upsertShowStatement(db:D1Database,s:any,marker:string):D1PreparedStatement{return db.prepare(`INSERT INTO shows (id,name,type,language,genres,status,premiered,ended,official_site,rating,weight,network,web_channel,image_medium,image_original,summary,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,language=excluded.language,genres=excluded.genres,status=excluded.status,premiered=excluded.premiered,ended=excluded.ended,official_site=excluded.official_site,rating=excluded.rating,weight=excluded.weight,network=excluded.network,web_channel=excluded.web_channel,image_medium=excluded.image_medium,image_original=excluded.image_original,summary=excluded.summary,updated_at=excluded.updated_at`).bind(Number(s.id),String(s.name||"Untitled"),nullable(s.type),nullable(s.language),JSON.stringify(Array.isArray(s.genres)?s.genres:[]),nullable(s.status),nullable(s.premiered),nullable(s.ended),nullable(s.officialSite),nullableNumber(s.rating?.average),nullableNumber(s.weight),nullable(s.network?.name),nullable(s.webChannel?.name),nullable(s.image?.medium),nullable(s.image?.original),stripHtml(nullable(s.summary)),marker);}

function chooseRelease(results:any,region:string,fallback:string|null):{date:string|null;type:string}{const country=Array.isArray(results)?results.find((r:any)=>r?.iso_3166_1===region):null;const releases=Array.isArray(country?.release_dates)?country.release_dates:[];for(const type of [3,2,4,1,5,6]){const c=releases.filter((r:any)=>Number(r.type)===type&&r.release_date).sort((a:any,b:any)=>String(a.release_date).localeCompare(String(b.release_date)));if(c.length)return{date:String(c[0].release_date).slice(0,10),type:RELEASE_TYPES[type]||`Type ${type}`};}return{date:fallback||null,type:fallback?"Primary release":"Unknown"};}
async function tmdbJson(url:string,token:string):Promise<unknown>{const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json","User-Agent":"ReleaseRadar/0.2"}});if(!r.ok)throw new Error(`TMDB ${r.status} for ${new URL(url).pathname}`);return r.json();}
