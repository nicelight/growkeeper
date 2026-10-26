/** Deliberately small synchronous JSON Streamable HTTP adapter; no sessions, SSE, sampling or tasks. */
import {VERSION} from './version.js';
import {assert,AppError,json,readJSON,origin} from './lib.js';
import {toolDefinitions,callTool,toolError} from './tools.js';
import {eventsEnabled,eventCall} from './events.js';
import {SKILL_TEXT,SKILL_DIGEST,SKILL_FRONTMATTER} from './generated.js';
export const MODERN='2026-07-28',VERSIONS=[MODERN,'2025-11-25','2025-06-18'];
const INFO={name:'growkeeper',version:VERSION},SKILL_URI='skill://growkeeper/growkeeper/SKILL.md',UI_URI='ui://growkeeper/journal.html';
const INSTRUCTIONS='Use the growkeeper skill. Call get_capabilities whenever explaining capabilities, checking whether an action is supported, planning a workflow with uncertain support, or unsure about plugin limits; never infer support from the plugin name. Answer urgent questions before collection onboarding; read collection state and record real user activity. Resolve each input to its plant before diagnosis; retrieve actual image pixels for comparisons. Read existing cases/journal, distinguish observations from hypotheses, and never fabricate outcomes. No autonomous hardware actions. Web/skill setup and native events require user authorization. When a useful followup returns monitoring.should_offer=true, offer one GrowKeeper event subscription in natural language; do not wait for a special subscribe command. Respect declined/active status and record offers or refusals with record_monitoring_choice. After activation on Android, inspect monitoring.should_offer_shortcut and follow the skill for a one-time native home-screen shortcut suggestion.';
const frontmatter=SKILL_FRONTMATTER;
const skill={uri:SKILL_URI,frontmatter,resources:[{uri:SKILL_URI,digest:SKILL_DIGEST}]};
function capabilities(env){return {tools:{},resources:{},extensions:{'io.modelcontextprotocol/skills':{}},...(eventsEnabled(env)?{events:{}}:{})};}
function rpcError(id,code,message,status=400,data){return json({jsonrpc:'2.0',id:id??null,error:{code,message,...(data?{data}:{})}},status);}
function decodeHeader(value){if(value?.startsWith('=?base64?')&&value.endsWith('?=')){try{return new TextDecoder().decode(Uint8Array.from(atob(value.slice(9,-2)),c=>c.charCodeAt(0)));}catch{return null;}}return value;}
// Only structural URL diagnostics. Never include credentials, path, query or fragment.
export function callbackDiagnostic(value, csv) {
 if(typeof value!=='string')return {url_valid:false};
 let u;try{u=new URL(value);}catch{return {url_valid:false};}
 const hosts=String(csv||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 return {url_valid:true,callback_host:u.hostname.slice(0,253),https:u.protocol==='https:',
  has_credentials:!!(u.username||u.password),has_fragment:!!u.hash,
  port_allowed:!u.port||u.port==='443',host_allowed:hosts.includes(u.hostname.toLowerCase())};
}
export async function mcpResponse(request,store,requestId){
 if(request.method!=='POST')return new Response(null,{status:405,headers:{allow:'POST'}});
 let input;try{input=await readJSON(request,512*1024);}catch(e){return rpcError(null,e.code==='BAD_JSON'?-32700:-32600,e.message,e.status||400);}
 if(!input||Array.isArray(input)||input.jsonrpc!=='2.0'||typeof input.method!=='string')return rpcError(input?.id,-32600,'Invalid JSON-RPC request.');
 const {method,id}=input,p=input.params||{};
 // Never log params: callback URLs and signing secrets are sensitive.
 const eventMethod=['events/list','events/subscribe','events/unsubscribe'].includes(method);
 if(eventMethod)console.info(JSON.stringify({component:'mcp-events',request_id:requestId,method,stage:'received'}));
 const reject=(id,code,message,status=400,data)=>{if(eventMethod)console.warn(JSON.stringify({component:'mcp-events',request_id:requestId,method,stage:'rejected',code,reason:message}));return rpcError(id,code,message,status,data);};
 if(typeof p!=='object'||Array.isArray(p))return reject(id,-32602,'params must be an object.');
 const version=request.headers.get('MCP-Protocol-Version')||p._meta?.['io.modelcontextprotocol/protocolVersion']||p.protocolVersion||'2025-11-25';
 if(!VERSIONS.includes(version))return reject(id,-32022,'Unsupported protocol version.',400,{supported:VERSIONS,requested:version});
 if(p._meta?.['io.modelcontextprotocol/protocolVersion']&&request.headers.get('MCP-Protocol-Version')&&p._meta['io.modelcontextprotocol/protocolVersion']!==request.headers.get('MCP-Protocol-Version'))return reject(id,-32020,'Protocol version/header mismatch.');
 const modern=version===MODERN;
 if(modern){
  if(p._meta?.['io.modelcontextprotocol/protocolVersion']!==MODERN||!p._meta?.['io.modelcontextprotocol/clientCapabilities']||typeof p._meta['io.modelcontextprotocol/clientCapabilities']!=='object')return reject(id,-32602,'Modern requests require protocolVersion and clientCapabilities in params._meta.');
  const target=method==='tools/call'?p.name:method==='resources/read'?p.uri:null;
  if(request.headers.get('MCP-Protocol-Version')!==MODERN||decodeHeader(request.headers.get('Mcp-Method'))!==method||(target&&decodeHeader(request.headers.get('Mcp-Name'))!==target))return reject(id,-32020,'Protocol metadata/header mismatch.');
 }
 if(id===undefined){
  if(method==='notifications/initialized'||method==='notifications/cancelled')return new Response(null,{status:202});
  return rpcError(null,-32600,'This method requires a request ID.');
 }
 let result;
 try{
  switch(method){
   case 'initialize':
    result={protocolVersion:version,capabilities:capabilities(store.env),serverInfo:INFO,instructions:INSTRUCTIONS};break;
   case 'ping':result={};break;
   case 'server/discover':result={supportedVersions:VERSIONS,capabilities:capabilities(store.env),instructions:INSTRUCTIONS};break;
   case 'tools/list':result={tools:toolDefinitions()};break;
   case 'tools/call':
    try{result=await callTool(store,p.name,p.arguments||{});}catch(e){result=toolError(e,requestId);if(result.structuredContent?.error?.code==='INTERNAL')console.error(JSON.stringify({request_id:requestId,component:'mcp-tool',tool:p.name,code:'INTERNAL'}));}break;
   case 'resources/list':result={resources:[{uri:UI_URI,name:'GrowKeeper Journal',mimeType:'text/html;profile=mcp-app'},{uri:SKILL_URI,name:'GrowKeeper Skill',mimeType:'text/markdown'}]};break;
   case 'resources/templates/list':result={resourceTemplates:[]};break;
   case 'resources/read':
    if(p.uri===SKILL_URI)result={contents:[{uri:SKILL_URI,mimeType:'text/markdown',text:SKILL_TEXT}]};
    else if(p.uri===UI_URI){
     const r=await store.env.ASSETS.fetch(new Request(origin(store.env)+'/widget.html'));assert(r.ok,'UI_NOT_BUILT','Run npm run build before deploy.',503);
     const base=origin(store.env);
     result={contents:[{uri:UI_URI,mimeType:'text/html;profile=mcp-app',text:await r.text(),_meta:{ui:{csp:{connectDomains:[base],resourceDomains:[base]},prefersBorder:true},'openai/widgetCSP':{connect_domains:[base],resource_domains:[base]},'openai/widgetDescription':'Private GrowKeeper plant journal, entity details, photo archive and settings.'}}]};
    }else return rpcError(id,-32002,'Unknown resource.',404);break;
   case 'skills/list':result={skills:[skill]};break;
   case 'skills/get':
    if(p.uri!==SKILL_URI)return rpcError(id,-32002,'Unknown skill.',404);result={skill};break;
   case 'events/list':case 'events/subscribe':case 'events/unsubscribe':
    result=await eventCall(store,method,p);
    console.info(JSON.stringify({component:'mcp-events',request_id:requestId,method,stage:'complete'}));break;
   default:return rpcError(id,-32601,'Method not found.',404);
  }
  if(modern)result={...result,resultType:'complete',_meta:{...(result._meta||{}),'io.modelcontextprotocol/serverInfo':INFO}};
  return json({jsonrpc:'2.0',id,result});
 }catch(e){
  if(eventMethod)console.warn(JSON.stringify({component:'mcp-events',request_id:requestId,method,stage:'failed',code:e instanceof AppError?e.code:'INTERNAL',...(e.code==='WEBHOOK_HOST_NOT_ALLOWED'?{callback:callbackDiagnostic(p.delivery?.url,store.env.EVENT_WEBHOOK_HOSTS)}:{})}));
  if(e.code==='WEBHOOK_VERIFICATION')return rpcError(id,-32015,e.message,400,e.details||{reason:'challenge_failed'});return rpcError(id,e.status===404?-32601:-32602,e instanceof AppError?e.message:'Internal MCP error.',e.status||500);
 }
}
