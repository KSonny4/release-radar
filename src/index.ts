import type { Env, ExecutionContextLike, ScheduledControllerLike } from "./types";
import { handleRequest } from "./app";
import { runScheduledSync } from "./sync";
import { errorMessage, neonDatabase } from "./db";
import { esc, htmlResponse, layout } from "./ui";

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContextLike):Promise<Response>{
    try{if(!env.DATABASE_URL)throw new Error("DATABASE_URL is not configured");return await handleRequest(request,{...env,DB:neonDatabase(env.DATABASE_URL)},ctx);}catch(error){console.error("request failed",error);return htmlResponse(layout("Error",`<section class="panel"><h1>Something failed</h1><p>${esc(errorMessage(error))}</p></section>`,request,env),500);}
  },
  async scheduled(controller:ScheduledControllerLike,env:Env,ctx:ExecutionContextLike):Promise<void>{if(!env.DATABASE_URL)throw new Error("DATABASE_URL is not configured");ctx.waitUntil(runScheduledSync({...env,DB:neonDatabase(env.DATABASE_URL)},new Date(controller.scheduledTime)));}
};
