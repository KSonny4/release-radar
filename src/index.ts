import type { Env, ExecutionContextLike, ScheduledControllerLike } from "./types";
import { handleRequest } from "./app";
import { runScheduledSync } from "./sync";
import { errorMessage, neonDatabase } from "./db";
import { esc, htmlResponse, layout } from "./ui";

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContextLike):Promise<Response>{
    try{return await handleRequest(request,{...env,DB:env.DATABASE_URL?neonDatabase(env.DATABASE_URL):env.DB},ctx);}catch(error){console.error("request failed",error);return htmlResponse(layout("Error",`<section class="panel"><h1>Something failed</h1><p>${esc(errorMessage(error))}</p></section>`,request,env),500);}
  },
  async scheduled(controller:ScheduledControllerLike,env:Env,ctx:ExecutionContextLike):Promise<void>{ctx.waitUntil(runScheduledSync({...env,DB:env.DATABASE_URL?neonDatabase(env.DATABASE_URL):env.DB},new Date(controller.scheduledTime)));}
};
