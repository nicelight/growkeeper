/** Generates an invite-only account; never connects to Cloudflare automatically. */
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {hash,uid,now} from '../src/lib.js';
const name=process.argv[2];if(!name||name.length>100){console.error('Usage: npm run user:create -- "Display name"');process.exit(1);}
const id=uid(),key='gk_'+randomBytes(32).toString('base64url');
const q=s=>"'"+s.replaceAll("'","''")+"'";
const sql=`-- Contains only a SHA-256 hash, not the plaintext login key.\nINSERT INTO users(id,display_name,login_key_hash,created_at) VALUES(${[id,name,await hash(key),now()].map(q).join(',')});\n`;
await fs.mkdir('.local',{recursive:true});const file=`.local/user-${id}.sql`;await fs.writeFile(file,sql,{mode:0o600});
console.log(`User: ${id}\nAccount key (shown once; send privately, never in a model prompt): ${key}\nSQL: ${file}\nApply yourself: npx wrangler@4 d1 execute growkeeper_26 --remote --file ${file}`);
