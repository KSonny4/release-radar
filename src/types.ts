export type D1Result<T = Record<string, unknown>> = { results?: T[] };
export interface D1PreparedStatement { bind(...values: unknown[]): D1PreparedStatement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run(): Promise<unknown>; }
export interface D1Database { prepare(sql: string): D1PreparedStatement; batch(statements: D1PreparedStatement[]): Promise<unknown[]>; }
export interface ExecutionContextLike { waitUntil(promise: Promise<unknown>): void; }
export interface ScheduledControllerLike { scheduledTime: number; }
export interface Env { DB: D1Database; TMDB_BEARER_TOKEN?: string; ADMIN_TOKEN?: string; CALENDAR_TOKEN?: string; MOVIE_REGION?: string; TMDB_LANGUAGE?: string; MOVIE_WINDOW_DAYS?: string; TVMAZE_PAGES_PER_SYNC?: string; TMDB_PAGES_PER_SYNC?: string; }
export interface ShowRow { id:number; name:string; type:string|null; language:string|null; genres:string; status:string|null; premiered:string|null; ended:string|null; official_site:string|null; rating:number|null; weight:number|null; network:string|null; web_channel:string|null; image_medium:string|null; image_original:string|null; summary:string|null; followed?:number; }
export interface EpisodeRow { id:number; show_id:number; show_name?:string; name:string|null; season:number|null; number:number|null; airdate:string|null; airtime:string|null; airstamp:string|null; runtime:number|null; rating:number|null; summary:string|null; image_medium:string|null; }
export interface MovieRow { id:number; title:string; original_title:string|null; overview:string|null; genres:string; release_date:string|null; local_release_date:string|null; local_release_type:string|null; rating:number|null; vote_count:number|null; popularity:number|null; original_language:string|null; poster_path:string|null; backdrop_path:string|null; region:string|null; }
export const BASE_URL = "https://radar.pkubelka.cz";
