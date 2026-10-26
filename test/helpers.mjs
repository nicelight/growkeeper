import fs from 'node:fs/promises';
import {LocalD1,MemoryR2,assetBinding} from '../scripts/local-platform.mjs';
import {hash,uid,now,randomToken,after} from '../src/lib.js';
import {Store} from '../src/db.js';
import {callTool} from '../src/tools.js';
export const PNG=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII=','base64'));
export async function fixture(){const DB=new LocalD1();await DB.exec(await fs.readFile(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));await DB.exec(await fs.readFile(new URL('../migrations/0002_monitoring_prompt.sql',import.meta.url),'utf8'));await DB.exec(await fs.readFile(new URL('../migrations/0003_shortcut_offer.sql',import.meta.url),'utf8'));await DB.exec(await fs.readFile(new URL('../migrations/0004_collection_onboarding.sql',import.meta.url),'utf8'));const env={LOCAL_DEV:true,PUBLIC_ORIGIN:'http://127.0.0.1:8787',APP_SECRET:'ab'.repeat(32),DB,PHOTOS:new MemoryR2(),ASSETS:assetBinding(new URL('../public',import.meta.url).pathname),FILE_DOWNLOAD_HOSTS:'files.oaiusercontent.com',EVENT_WEBHOOK_HOSTS:'chatgpt.com',EVENTS_ENABLED:'false',OAUTH_REDIRECT_URIS:'https://chatgpt.com/connector_platform_oauth_redirect'};
async function user(name){const id=uid(),key='gk_'+randomToken();await DB.prepare('INSERT INTO users(id,display_name,login_key_hash,created_at) VALUES(?,?,?,?)').bind(id,name,await hash(key),now()).run();return {id,display_name:name,key};}
const owner=await user('Owner'),other=await user('Other');return {env,owner,other,store:new Store(env,owner),otherStore:new Store(env,other),close:()=>DB.close()};}
export async function tool(store,name,args={}){return (await callTool(store,name,args)).structuredContent.data;}
export async function plant(store,name='Зелёный Борис'){return (await tool(store,'create_plant',{id:uid(),display_name:name,kind:'plant',name_source:'user',name_confirmed:true})).plant;}
export async function issue(store,p){return (await tool(store,'create_issue',{id:uid(),plant_id:p.id,title:'Пожелтение',opened_at:after(-7*86400000)})).issue;}
export async function bearer(f,user=f.owner){const access=randomToken(),refresh=randomToken();await f.env.DB.prepare("INSERT INTO auth_sessions(id,user_id,kind,token_hash,refresh_hash,client_id,resource,scope,expires_at,refresh_expires_at,created_at) VALUES(?,?,'oauth',?,?,?,?,?,?,?,?)").bind(uid(),user.id,await hash(access),await hash(refresh),'growkeeper-chatgpt',f.env.PUBLIC_ORIGIN+'/mcp','growkeeper',after(3600000),after(86400000),now()).run();return {access,refresh};}
export const req=(path,options={})=>new Request('http://127.0.0.1:8787'+path,options);
