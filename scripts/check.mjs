/** Offline static checks, not a full MCP/JSON-Schema/Mermaid conformance validator. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {toolDefinitions} from '../src/tools.js';
const root=fileURLToPath(new URL('../',import.meta.url));
async function walk(dir){const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.name.startsWith('.')||['node_modules','reports'].includes(e.name))continue;const p=path.join(dir,e.name);out.push(...(e.isDirectory()?await walk(p):[p]));}return out;}
const files=await walk(root),js=files.filter(f=>/\.(m?js)$/.test(f));
for(const file of js)execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
for(const p of ['README.md','RUNBOOK.md','PRD.md','docs/DIAGRAMS.md','docs/ARCHITECTURE.md','docs/SECURITY.md','docs/TESTING.md','docs/SOURCES.md'])await fs.access(path.join(root,p));
const cfg=JSON.parse(await fs.readFile(path.join(root,'wrangler.jsonc'),'utf8'));
if(cfg.kv_namespaces)throw Error('KV is intentionally not part of GrowKeeper.');
for(const key of ['PUBLIC_ORIGIN','FILE_DOWNLOAD_HOSTS','EVENT_WEBHOOK_HOSTS','EVENTS_ENABLED','OAUTH_REDIRECT_URIS'])if(!Object.hasOwn(cfg.vars,key))throw Error('Missing config variable '+key);
if(cfg.assets.run_worker_first!==true||cfg.d1_databases[0].binding!=='DB'||cfg.r2_buckets[0].binding!=='PHOTOS')throw Error('Bindings/auth routing changed.');
if(cfg.vars.LOCAL_DEV)throw Error('Production config must not enable LOCAL_DEV.');
const manifest=JSON.parse(await fs.readFile(path.join(root,'plugin/plugin.json'),'utf8'));
const mcp=JSON.parse(await fs.readFile(path.join(root,'plugin/mcp.json'),'utf8'));
if(manifest.name!=='growkeeper'||mcp.mcpServers.growkeeper.type!=='streamable-http'||mcp.mcpServers.growkeeper.url!==cfg.vars.PUBLIC_ORIGIN+'/mcp')throw Error('Plugin/backend configuration drift.');
const tools=toolDefinitions();if(new Set(tools.map(t=>t.name)).size!==tools.length)throw Error('Duplicate tool');
for(const tool of tools){if(tool.inputSchema.type!=='object'||tool.inputSchema.additionalProperties!==false)throw Error('Non-strict schema: '+tool.name);}
const mermaids=files.filter(f=>f.endsWith('.mmd'));
for(const file of mermaids){const text=await fs.readFile(file,'utf8');if(!/^(flowchart|sequenceDiagram|erDiagram|stateDiagram-v2)\b/.test(text))throw Error('Unrecognized Mermaid diagram: '+file);if(text.includes('```'))throw Error('Fenced source: '+file);}
console.log(`PASS: syntax ${js.length} JS files; ${tools.length} unique strict tool schemas; ${mermaids.length} diagram source structures; manifest, bindings and required documentation.`);
console.log('Not checked here: workerd, remote Cloudflare, live ChatGPT or complete Mermaid/MCP specification conformance.');
