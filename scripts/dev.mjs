import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import worker from '../src/worker.js';
import {LocalD1,FileR2,assetBinding} from './local-platform.mjs';
import {hash,uid,now,randomToken} from '../src/lib.js';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=path.join(root,'.local');await fs.mkdir(dir,{recursive:true});
const DB=new LocalD1(path.join(dir,'growkeeper.sqlite'));
const migration=await fs.readFile(path.join(root,'migrations/0001_initial.sql'),'utf8');
const exists=await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").first();if(!exists)await DB.exec(migration);
await DB.exec(await fs.readFile(path.join(root,'migrations/0002_monitoring_prompt.sql'),'utf8'));
if(!(await DB.prepare('PRAGMA table_info(monitoring_preferences)').all()).results.some(c=>c.name==='shortcut_offered_at'))await DB.exec(await fs.readFile(path.join(root,'migrations/0003_shortcut_offer.sql'),'utf8'));
await DB.exec(await fs.readFile(path.join(root,'migrations/0004_collection_onboarding.sql'),'utf8'));
await DB.exec(await fs.readFile(path.join(root,'migrations/0005_feedback.sql'),'utf8'));
let config;try{config=JSON.parse(await fs.readFile(path.join(dir,'dev-secrets.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;config={APP_SECRET:randomBytes(32).toString('hex'),owner_key:'gk_'+randomToken()};await fs.writeFile(path.join(dir,'dev-secrets.json'),JSON.stringify(config),{mode:0o600});}
let owner=await DB.prepare('SELECT id FROM users LIMIT 1').first();if(!owner){owner={id:uid()};await DB.prepare('INSERT INTO users(id,display_name,login_key_hash,created_at) VALUES(?,?,?,?)').bind(owner.id,'Локальный владелец',await hash(config.owner_key),now()).run();}
const port=Number(process.env.PORT||8787),PUBLIC_ORIGIN=`http://127.0.0.1:${port}`;
const env={LOCAL_DEV:true,PUBLIC_ORIGIN,APP_SECRET:config.APP_SECRET,DB,PHOTOS:new FileR2(path.join(dir,'r2')),ASSETS:assetBinding(path.join(root,'public')),FILE_DOWNLOAD_HOSTS:'*.oaiusercontent.com',OAUTH_REDIRECT_URIS:'https://chatgpt.com/connector_platform_oauth_redirect',EVENTS_ENABLED:'false',EVENT_WEBHOOK_HOSTS:'chatgpt.com,connectors.api.openai.com'};
const server=http.createServer(async(req,res)=>{try{
 const request=new Request(PUBLIC_ORIGIN+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
 const response=await worker.fetch(request,env,{waitUntil:p=>p.catch(console.error)});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch(e){console.error(e);res.writeHead(500);res.end('Local adapter error');}});
server.listen(port,'127.0.0.1',()=>{console.log(`GrowKeeper: ${PUBLIC_ORIGIN}\nLocal account key (do not paste into ChatGPT): ${config.owner_key}\nData: .local/ — never commit or package this directory.\nNo background delivery is enabled in local mode.`);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{DB.close();process.exit(0);}));
