/** Generate a workerd preview config. This is separate from the Node SQLite development store. */
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url),c=JSON.parse(await fs.readFile(new URL('wrangler.jsonc',root),'utf8'));
c.vars={...c.vars,LOCAL_DEV:true,PUBLIC_ORIGIN:'http://127.0.0.1:8787',EVENTS_ENABLED:'false'};
// Keep the file at project root so main/assets/migration paths remain identical.
await fs.writeFile(new URL('wrangler.local.jsonc',root),JSON.stringify(c,null,2)+'\n');
console.log('Created wrangler.local.jsonc. Use --config wrangler.local.jsonc; never deploy this LOCAL_DEV configuration.');
