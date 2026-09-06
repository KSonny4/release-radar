import type { D1Database, D1PreparedStatement } from "./types";
export const BATCH_SIZE = 50;
export async function all<T>(db:D1Database, sql:string, params:unknown[]=[]):Promise<T[]>{ const r=await db.prepare(sql).bind(...params).all<T>(); return r.results||[]; }
export async function scalar(db:D1Database, sql:string, params:unknown[]=[]):Promise<number>{ const r=await db.prepare(sql).bind(...params).first<{n:number}>(); return Number(r?.n||0); }
export async function batchChunks(db:D1Database, statements:D1PreparedStatement[]):Promise<void>{ for(let i=0;i<statements.length;i+=BATCH_SIZE) await db.batch(statements.slice(i,i+BATCH_SIZE)); }
export async function getState(db:D1Database,key:string):Promise<string|null>{ const r=await db.prepare("SELECT value FROM sync_state WHERE key=?").bind(key).first<{value:string}>(); return r?.value??null; }
export async function setState(db:D1Database,key:string,value:string):Promise<void>{ await db.prepare(`INSERT INTO sync_state(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(key,value.slice(0,1000),nowIso()).run(); }
export function nowIso():string{return new Date().toISOString();}
export function dateOnly(d:Date):string{return d.toISOString().slice(0,10);}
export function addDays(d:Date,n:number):Date{const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;}
export function nullable(v:unknown):string|null{return v===null||v===undefined||v===""?null:String(v);}
export function nullableNumber(v:unknown):number|null{const n=Number(v);return v===null||v===undefined||v===""||!Number.isFinite(n)?null:n;}
export function stripHtml(v:string|null):string|null{return v?v.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim():null;}
export function intEnv(v:string|undefined,fallback:number):number{const n=Number(v);return Number.isFinite(n)&&n>0?Math.floor(n):fallback;}
export function errorMessage(e:unknown):string{return e instanceof Error?e.message:String(e);}
