import {productPage,PRODUCT_CSS} from './pages.js';
import {VERSION} from './version.js';
import {AppError,assert,json,readJSON,boundedBody,origin,uid} from './lib.js';
import {Store,publicError} from './db.js';
import {authenticate,authRoutes,checkOrigin,challenge} from './auth.js';
import {mcpResponse} from './mcp.js';
import {callTool} from './tools.js';
import {savePhoto,mediaResponse,MAX_PHOTO_BYTES} from './media.js';
import {dispatchDue} from './events.js';
import {S,validate} from './schema.js';
export default {
 async fetch(request,env,ctx){
  const requestId=uid();let response;
  try{
   const base=origin(env),url=new URL(request.url);
   assert(url.origin===base,'HOST_MISMATCH','Request host does not match PUBLIC_ORIGIN.',421);
   const auth=await authRoutes(request,env);if(auth)response=auth;
   else if(['/about','/privacy','/terms','/support'].includes(url.pathname))response=productPage(url.pathname,request.method);
   else if(url.pathname==='/product.css'){assert(['GET','HEAD'].includes(request.method),'METHOD','Use GET or HEAD.',405);response=new Response(request.method==='HEAD'?null:PRODUCT_CSS,{headers:{'content-type':'text/css;charset=utf-8'}});}
   else if(url.pathname==='/healthz')response=json({ok:true,service:'growkeeper',version:VERSION});
   else if(url.pathname==='/robots.txt')response=new Response('User-agent: *\nDisallow: /\n');
   else if(url.pathname==='/mcp'){
    if(request.method!=='POST')response=new Response(null,{status:405,headers:{allow:'POST'}});
    else{
     // Backend requests normally have no Origin. If present, accept only explicitly configured origins.
     const o=request.headers.get('origin'),allowed=[base,...String(env.MCP_ALLOWED_ORIGINS||'').split(',').filter(Boolean)];
     assert(!o||allowed.includes(o),'ORIGIN','Untrusted request origin.',403);
     const user=await authenticate(request,env);assert(user.auth_kind==='oauth','UNAUTHORIZED','MCP requires a bearer token, not a browser session.',401);
     response=await mcpResponse(request,new Store(env,user),requestId);
    }
   }else if(url.pathname.startsWith('/api/')){
    const user=await authenticate(request,env,true),store=new Store(env,user);
    assert(request.method==='POST','METHOD','Use POST.',405);checkOrigin(request,env,true);
    if(url.pathname==='/api/upload'){
     const metadata={};for(const [k,v] of url.searchParams)metadata[k]=v;
     validate(S.object({id:S.uuid,input_id:S.uuid,caption:S.string(12000,{minLength:0}),captured_at:S.date},[]),metadata);
     response=json({ok:true,data:{photo:await savePhoto(store,metadata,await boundedBody(request,MAX_PHOTO_BYTES))}});
    }else if(/^\/api\/tools\/[a-z_]+$/.test(url.pathname)){
     const result=await callTool(store,url.pathname.split('/').at(-1),await readJSON(request));
     response=json(result.structuredContent);
    }else throw new AppError('NOT_FOUND','Unknown API route.',404);
   }else if(/^\/media\/[0-9a-f-]+$/.test(url.pathname)){
    assert(['GET','HEAD'].includes(request.method),'METHOD','Use GET or HEAD.',405);
    let user=null;try{user=await authenticate(request,env,true);}catch(e){if(e.status!==401)throw e;}
    response=await mediaResponse(request,env,url.pathname.split('/').at(-1),user);
   }else{
    assert(['GET','HEAD'].includes(request.method),'METHOD','Use GET or HEAD.',405);
    const isPage=url.pathname==='/'||url.pathname==='/settings'||/^\/(entity|plant)\/[a-z0-9/-]+$/.test(url.pathname);
    if(isPage){
     try{await authenticate(request,env,true);}catch(e){if(e.status!==401)throw e;response=url.pathname==='/'?productPage('/',request.method):new Response(null,{status:303,headers:{location:'/login?return_to='+encodeURIComponent(url.pathname)}});}
     if(!response)response=await env.ASSETS.fetch(new Request(base+'/index.html',{method:request.method}));
    }else if(['/style.css','/app.js','/widget.html','/favicon.svg'].includes(url.pathname))response=await env.ASSETS.fetch(request);
    else throw new AppError('NOT_FOUND','Not found.',404);
   }
  }catch(error){
   const e=publicError(error),path=new URL(request.url).pathname;
   if(e.status>=500)console.error(JSON.stringify({request_id:requestId,path,code:e.code}));
   const body=path.startsWith('/oauth/')?{error:e.code.toLowerCase(),error_description:e.message,request_id:requestId}:{ok:false,error:{code:e.code,message:e.message,request_id:requestId}};
   response=json(body,e.status,e.status===401?{'WWW-Authenticate':challenge(env)}:{});
  }
  // Always wrap: Cloudflare asset responses can have immutable headers.
  const h=new Headers(response.headers);h.set('x-request-id',requestId);h.set('x-content-type-options','nosniff');h.set('referrer-policy',new URL(request.url).pathname.startsWith('/auth/')?'no-referrer':'same-origin');h.set('permissions-policy','camera=(), microphone=(), geolocation=()');
  if(env.LOCAL_DEV!==true)h.set('strict-transport-security','max-age=31536000');
  if(!h.has('content-security-policy'))h.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  h.set('cache-control','no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
 },
 async scheduled(controller,env,ctx){ctx.waitUntil(dispatchDue(env));}
};
