/** Configure local files only. Does not create cloud resources or transmit credentials. */
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url),[value,databaseId]=process.argv.slice(2);
function usage(){console.error('Usage: npm run plugin:configure -- https://growkeeper.YOUR_SUBDOMAIN.workers.dev D1_DATABASE_UUID');process.exit(1);}
if(!value)usage();
let u;try{u=new URL(value);}catch{usage();}
if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname)||u.port)usage();
if(databaseId&&!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(databaseId))usage();
const cfgPath=new URL('wrangler.jsonc',root),cfg=JSON.parse(await fs.readFile(cfgPath,'utf8'));
cfg.vars.PUBLIC_ORIGIN=u.origin;if(databaseId)cfg.d1_databases[0].database_id=databaseId;
await fs.writeFile(cfgPath,JSON.stringify(cfg,null,2)+'\n');
const mcpPath=new URL('plugin/mcp.json',root),mcp=JSON.parse(await fs.readFile(mcpPath,'utf8'));
mcp.mcpServers.growkeeper.url=u.origin+'/mcp';await fs.writeFile(mcpPath,JSON.stringify(mcp,null,2)+'\n');
console.log(`Configured ${u.origin}/mcp${databaseId?' and D1 database ID':''}. No resources created. Follow RUNBOOK.md for secrets, migrations, OAuth and deployment.`);
