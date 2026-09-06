import type { Env, ExecutionContextLike } from "./types";
import { handleRequest } from "./app";
import { handleCalendarFeed } from "./calendar";
import { errorMessage, neonDatabase } from "./db";
import { runScheduledSync } from "./sync";
import { esc, htmlResponse, layout } from "./ui";

const globalSearchMarkup=`<div class="nav-search" data-global-search><input type="search" autocomplete="off" spellcheck="false" aria-label="Search series" placeholder="Search…"><div class="nav-search-results" hidden></div></div>`;

const globalSearchStyles=`<style>
header{gap:18px}.nav-search{position:relative;width:min(320px,28vw);margin-left:2px}.nav-search input{width:100%;height:36px;padding:8px 36px 8px 12px;border:1px solid #444;border-radius:5px;background:rgba(30,30,30,.96);color:#fff;font:inherit;outline:none}.nav-search input:focus{border-color:#888;background:#222}.nav-search:after{content:'⌕';position:absolute;right:11px;top:7px;color:#aaa;font-size:18px;pointer-events:none}.nav-search-results{position:absolute;top:43px;right:0;width:min(430px,92vw);max-height:min(620px,75vh);overflow:auto;background:#181818;border:1px solid #3a3a3a;border-radius:7px;box-shadow:0 18px 55px rgba(0,0,0,.75);z-index:200;padding:6px}.nav-search-result{display:grid;grid-template-columns:42px 1fr;gap:10px;align-items:center;padding:8px;border-radius:5px}.nav-search-result:hover,.nav-search-result.active{background:#2a2a2a}.nav-search-result img{width:42px;height:58px;object-fit:cover;border-radius:3px;background:#252525}.nav-search-result strong{display:block;font-size:13px;line-height:1.25}.nav-search-result span{display:block;margin-top:3px;color:#999;font-size:11px}.nav-search-all{display:block;margin:4px 0 0;padding:10px;border-top:1px solid #333;color:#ddd;font-size:12px}.nav-search-empty{padding:14px;color:#999;font-size:12px}.home-feed{padding-top:8px}
@media(max-width:900px){header{flex-wrap:wrap}.nav-search{order:3;width:100%;margin:0}.nav-search-results{left:0;right:auto;width:100%}}
</style>`;

const globalSearchScript=`<script>(()=>{
  const root=document.querySelector('[data-global-search]');
  if(!root)return;
  const input=root.querySelector('input');
  const box=root.querySelector('.nav-search-results');
  if(!input||!box)return;
  let timer=0,seq=0,active=-1;
  const close=()=>{box.hidden=true;active=-1;};
  const items=()=>Array.from(box.querySelectorAll('.nav-search-result'));
  const setActive=(next)=>{const list=items();list.forEach(x=>x.classList.remove('active'));if(!list.length){active=-1;return;}active=Math.max(0,Math.min(next,list.length-1));list[active].classList.add('active');list[active].scrollIntoView({block:'nearest'});};
  const render=(doc,q)=>{
    box.replaceChildren();
    const cards=Array.from(doc.querySelectorAll('main .grid .card-link')).slice(0,7);
    for(const link of cards){
      const a=document.createElement('a');a.className='nav-search-result';a.href=link.getAttribute('href')||'#';
      const poster=link.querySelector('img.poster');
      if(poster){const img=document.createElement('img');img.src=poster.getAttribute('src')||'';img.alt='';a.appendChild(img);}else{const ph=document.createElement('div');ph.style.cssText='width:42px;height:58px;background:#292929;border-radius:3px';a.appendChild(ph);}
      const text=document.createElement('div');const strong=document.createElement('strong');strong.textContent=link.querySelector('h3')?.textContent||'Series';const meta=document.createElement('span');meta.textContent=link.querySelector('.meta')?.textContent||'';text.append(strong,meta);a.appendChild(text);box.appendChild(a);
    }
    if(!cards.length){const empty=document.createElement('div');empty.className='nav-search-empty';empty.textContent='No series found';box.appendChild(empty);}
    const all=document.createElement('a');all.className='nav-search-all';all.href='/series?q='+encodeURIComponent(q);all.textContent='See all results for “'+q+'”';box.appendChild(all);box.hidden=false;active=-1;
  };
  const search=async()=>{
    const q=input.value.trim();
    if(q.length<2){close();return;}
    const current=++seq;
    try{const r=await fetch('/series?q='+encodeURIComponent(q),{credentials:'same-origin'});if(!r.ok)return;const doc=new DOMParser().parseFromString(await r.text(),'text/html');if(current!==seq)return;render(doc,q);}catch{}
  };
  input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(search,220);});
  input.addEventListener('keydown',e=>{
    const list=items();
    if(e.key==='ArrowDown'&&list.length){e.preventDefault();setActive(active+1);}
    else if(e.key==='ArrowUp'&&list.length){e.preventDefault();setActive(active<=0?list.length-1:active-1);}
    else if(e.key==='Enter'){e.preventDefault();const q=input.value.trim();if(active>=0&&list[active])location.href=list[active].href;else if(q)location.href='/series?q='+encodeURIComponent(q);}
    else if(e.key==='Escape'){close();input.blur();}
  });
  document.addEventListener('click',e=>{if(!root.contains(e.target))close();});
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();input.focus();input.select();}});
})();</script>`;

function cleanRenderedHtml(response:Response):Promise<Response>|Response{
  if(!(response.headers.get("Content-Type")||"").startsWith("text/html"))return response;
  return response.text().then(html=>{
    let cleaned=html
      .replaceAll('<a class="button secondary" href="/calendar">Calendar setup</a>',"")
      .replaceAll('<div class="actions"><a class="button secondary" href="/admin/calendar">← Calendar setup</a></div>',"")
      .replace(/<section class="notice"><strong>Setup<\/strong><ul>.*?<\/ul><\/section>/s,"")
      .replace(/<section class="hero">.*?<\/section>/s,"");
    if(!cleaned.includes('data-global-search'))cleaned=cleaned.replace('</nav>',`${globalSearchMarkup}</nav>`);
    cleaned=cleaned.replace('</head>',`${globalSearchStyles}</head>`).replace('</body>',`${globalSearchScript}</body>`);
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
