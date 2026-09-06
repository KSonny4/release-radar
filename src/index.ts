import type { Env, ExecutionContextLike } from "./types";
import { handleRequest } from "./app";
import { handleCalendarFeed } from "./calendar";
import { errorMessage, neonDatabase } from "./db";
import { runScheduledSync } from "./sync";
import { esc, htmlResponse, layout } from "./ui";

function cleanRenderedHtml(response:Response):Promise<Response>|Response{
  if(!(response.headers.get("Content-Type")||"").startsWith("text/html"))return response;
  return response.text().then(html=>{
    const cleaned=html
      .replaceAll('<a class="button secondary" href="/calendar">Calendar setup</a>',"")
      .replaceAll('<div class="actions"><a class="button secondary" href="/admin/calendar">← Calendar setup</a></div>',"")
      .replace(/<section class="notice"><strong>Setup<\/strong><ul>.*?<\/ul><\/section>/s,"");
    return new Response(cleaned,{status:response.status,statusText:response.statusText,headers:response.headers});
  });
}

function appRequest(request:Request):Request{
  const url=new URL(request.url);
  if(url.pathname!=="/calendar")return request;
  const internal=new URL(request.url);
  internal.pathname="/admin/calendar";
  return new Request(internal,request);
}

function runtimeEnv(env:Env):Env{
  if(!env.DATABASE_URL)throw new Error("DATABASE_URL is not configured");
  return {...env,DB:neonDatabase(env.DATABASE_URL)};
}

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContextLike):Promise<Response>{
    try{
      const runtime=runtimeEnv(env);
      const calendar=await handleCalendarFeed(request,runtime);
      if(calendar)return calendar;
      return await cleanRenderedHtml(await handleRequest(appRequest(request),runtime,ctx));
    }catch(error){
      console.error("request failed",error);
      return htmlResponse(layout("Error",`<section class="panel"><h1>Something failed</h1><p>${esc(errorMessage(error))}</p></section>`,request,env),500);
    }
  },
  async scheduled(controller:{scheduledTime:number},env:Env,ctx:ExecutionContextLike):Promise<void>{
    const runtime=runtimeEnv(env);
    ctx.waitUntil(runScheduledSync(runtime,new Date(controller.scheduledTime)));
  }
};
