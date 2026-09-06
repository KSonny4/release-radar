import type { Env, ExecutionContextLike } from "./types";
import { handleRequest } from "./app";
import { handleCalendarFeed } from "./calendar";
import { errorMessage, neonDatabase } from "./db";
import { esc, htmlResponse, layout } from "./ui";

function removeRepeatedCalendarSetupLinks(response:Response):Promise<Response>|Response{
  if(!(response.headers.get("Content-Type")||"").startsWith("text/html"))return response;
  return response.text().then(html=>{
    const cleaned=html
      .replaceAll('<a class="button secondary" href="/calendar">Calendar setup</a>',"")
      .replaceAll('<div class="actions"><a class="button secondary" href="/admin/calendar">← Calendar setup</a></div>',"");
    return new Response(cleaned,{status:response.status,statusText:response.statusText,headers:response.headers});
  });
}

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContextLike):Promise<Response>{
    try{
      if(!env.DATABASE_URL)throw new Error("DATABASE_URL is not configured");
      const runtimeEnv={...env,DB:neonDatabase(env.DATABASE_URL)};
      const calendar=await handleCalendarFeed(request,runtimeEnv);
      if(calendar)return calendar;
      return await removeRepeatedCalendarSetupLinks(await handleRequest(request,runtimeEnv,ctx));
    }catch(error){
      console.error("request failed",error);
      return htmlResponse(layout("Error",`<section class="panel"><h1>Something failed</h1><p>${esc(errorMessage(error))}</p></section>`,request,env),500);
    }
  }
};
