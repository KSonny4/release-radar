import type { Env, ExecutionContextLike } from "./types";
import { handleRequest } from "./app";
import { errorMessage, neonDatabase } from "./db";
import { esc, htmlResponse, layout } from "./ui";

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContextLike):Promise<Response>{
    try{if(!env.DATABASE_URL)throw new Error("DATABASE_URL is not configured");return await handleRequest(request,{...env,DB:neonDatabase(env.DATABASE_URL)},ctx);}catch(error){console.error("request failed",error);return htmlResponse(layout("Error",`<section class="panel"><h1>Something failed</h1><p>${esc(errorMessage(error))}</p></section>`,request,env),500);}
  }
};
