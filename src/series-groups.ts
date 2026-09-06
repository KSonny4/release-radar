import type { Env, ShowRow } from "./types";
import { all, batchChunks, nowIso, scalar } from "./db";

export interface SeriesGroupDefinition {
  slug:string;
  title:string;
  rootName:string;
  description:string;
  searchTerms:string[];
}

export interface SeriesGroupCard {
  slug:string;
  title:string;
  description:string;
  subscribed:boolean;
  memberCount:number;
  images:string[];
}

export const SERIES_GROUPS:SeriesGroupDefinition[]=[
  {
    slug:"star-trek",
    title:"All Star Trek",
    rootName:"Star Trek",
    description:"Follow every Star Trek series we know now, plus new Star Trek series discovered later.",
    searchTerms:["star trek","startrek","trek"]
  },
  {
    slug:"dexter",
    title:"All Dexter",
    rootName:"Dexter",
    description:"Follow Dexter and every Dexter: … series, including future additions. Unrelated titles such as Dexter's Laboratory are excluded.",
    searchTerms:["dexter"]
  },
  {
    slug:"ncis",
    title:"All NCIS",
    rootName:"NCIS",
    description:"Follow NCIS and every NCIS: … series, including future spin-offs discovered later.",
    searchTerms:["ncis"]
  }
];

function normalise(value:string):string{return value.toLowerCase().replace(/[^a-z0-9]+/g,"");}

export function getSeriesGroup(slug:string):SeriesGroupDefinition|null{
  return SERIES_GROUPS.find(group=>group.slug===slug)||null;
}

export function matchesSeriesGroup(group:SeriesGroupDefinition,name:string):boolean{
  const candidate=name.trim().toLowerCase();
  const root=group.rootName.toLowerCase();
  return candidate===root||candidate.startsWith(`${root}:`);
}

function relevantToQuery(group:SeriesGroupDefinition,query:string):boolean{
  const q=normalise(query);
  if(!q)return true;
  return [group.title,group.rootName,...group.searchTerms].some(term=>{
    const n=normalise(term);
    return n.includes(q)||q.includes(n);
  });
}

function groupSql(group:SeriesGroupDefinition,alias="s"):{sql:string;params:unknown[]}{
  return {
    sql:`(lower(${alias}.name)=lower(?) OR lower(${alias}.name) LIKE lower(?))`,
    params:[group.rootName,`${group.rootName}:%`]
  };
}

export async function getSeriesGroupCards(env:Env,query="",subscribedOnly=false):Promise<SeriesGroupCard[]>{
  const subscribedRows=await all<{slug:string}>(env.DB,"SELECT slug FROM followed_groups ORDER BY slug");
  const subscribed=new Set(subscribedRows.map(row=>row.slug));
  const groups=SERIES_GROUPS.filter(group=>relevantToQuery(group,query)&&(!subscribedOnly||subscribed.has(group.slug)));
  return Promise.all(groups.map(async group=>{
    const where=groupSql(group);
    const [memberCount,images]=await Promise.all([
      scalar(env.DB,`SELECT COUNT(*) AS n FROM shows s WHERE ${where.sql}`,where.params),
      all<Pick<ShowRow,"image_medium">>(env.DB,`SELECT s.image_medium FROM shows s WHERE ${where.sql} AND s.image_medium IS NOT NULL ORDER BY COALESCE(s.weight,0) DESC,COALESCE(s.rating,0) DESC,s.premiered DESC NULLS LAST LIMIT 4`,where.params)
    ]);
    return {
      slug:group.slug,
      title:group.title,
      description:group.description,
      subscribed:subscribed.has(group.slug),
      memberCount,
      images:images.map(row=>row.image_medium).filter((value):value is string=>Boolean(value))
    };
  }));
}

export async function followShowManually(env:Env,showId:number):Promise<void>{
  const createdAt=nowIso();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO manual_followed_shows(show_id,created_at) VALUES (?,?) ON CONFLICT(show_id) DO NOTHING").bind(showId,createdAt),
    env.DB.prepare("INSERT INTO followed_shows(show_id,created_at) VALUES (?,?) ON CONFLICT(show_id) DO NOTHING").bind(showId,createdAt)
  ]);
}

export async function unfollowShowManually(env:Env,showId:number):Promise<void>{
  await env.DB.prepare("DELETE FROM manual_followed_shows WHERE show_id=?").bind(showId).run();
  const show=await env.DB.prepare("SELECT id,name FROM shows WHERE id=?").bind(showId).first<{id:number;name:string}>();
  if(!show){await env.DB.prepare("DELETE FROM followed_shows WHERE show_id=?").bind(showId).run();return;}
  const subscribedRows=await all<{slug:string}>(env.DB,"SELECT slug FROM followed_groups");
  const stillCovered=subscribedRows.some(row=>{
    const group=getSeriesGroup(row.slug);
    return group?matchesSeriesGroup(group,show.name):false;
  });
  if(!stillCovered)await env.DB.prepare("DELETE FROM followed_shows WHERE show_id=?").bind(showId).run();
}

async function materialiseGroup(env:Env,group:SeriesGroupDefinition):Promise<void>{
  const where=groupSql(group);
  await env.DB.prepare(`INSERT INTO followed_shows(show_id,created_at) SELECT s.id,? FROM shows s WHERE ${where.sql} ON CONFLICT(show_id) DO NOTHING`).bind(nowIso(),...where.params).run();
}

export async function subscribeSeriesGroup(env:Env,slug:string):Promise<boolean>{
  const group=getSeriesGroup(slug);
  if(!group)return false;
  await env.DB.prepare("INSERT INTO followed_groups(slug,created_at) VALUES (?,?) ON CONFLICT(slug) DO NOTHING").bind(slug,nowIso()).run();
  await materialiseGroup(env,group);
  return true;
}

export async function unsubscribeSeriesGroup(env:Env,slug:string):Promise<boolean>{
  const group=getSeriesGroup(slug);
  if(!group)return false;
  const where=groupSql(group);
  const members=await all<{id:number;name:string}>(env.DB,`SELECT s.id,s.name FROM shows s WHERE ${where.sql}`,where.params);
  await env.DB.prepare("DELETE FROM followed_groups WHERE slug=?").bind(slug).run();
  const [manualRows,remainingRows]=await Promise.all([
    all<{show_id:number}>(env.DB,"SELECT show_id FROM manual_followed_shows"),
    all<{slug:string}>(env.DB,"SELECT slug FROM followed_groups")
  ]);
  const manual=new Set(manualRows.map(row=>Number(row.show_id)));
  const remaining=remainingRows.map(row=>getSeriesGroup(row.slug)).filter((group):group is SeriesGroupDefinition=>Boolean(group));
  const removals=members.filter(show=>!manual.has(Number(show.id))&&!remaining.some(other=>matchesSeriesGroup(other,show.name)));
  await batchChunks(env.DB,removals.map(show=>env.DB.prepare("DELETE FROM followed_shows WHERE show_id=?").bind(show.id)));
  return true;
}

export async function applySubscribedSeriesGroups(env:Env):Promise<void>{
  const rows=await all<{slug:string}>(env.DB,"SELECT slug FROM followed_groups");
  for(const row of rows){
    const group=getSeriesGroup(row.slug);
    if(group)await materialiseGroup(env,group);
  }
}
