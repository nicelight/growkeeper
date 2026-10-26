/** Local adapter only. Tests use real SQLite constraints/transactions, not mocked SQL strings.
 * This is not workerd: production compatibility must still be checked with wrangler dev/deploy.
 */
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
export class LocalD1 {
 constructor(filename=':memory:'){this.sqlite=new DatabaseSync(filename);this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');}
 prepare(sql){return new Statement(this,sql,[]);}
 async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.syncRun());this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
 async exec(sql){this.sqlite.exec(sql);return {count:1,duration:0};}
 close(){this.sqlite.close();}
}
class Statement {
 constructor(db,sql,args){this.db=db;this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.db,this.sql,args);}
 syncRun(){const r=this.db.sqlite.prepare(this.sql).run(...this.args);return {success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}
 async run(){return this.syncRun();}
 async first(column){const row=this.db.sqlite.prepare(this.sql).get(...this.args);if(!row)return null;return column?row[column]:{...row};}
 async all(){return {success:true,results:this.db.sqlite.prepare(this.sql).all(...this.args).map(x=>({...x})),meta:{changes:0}};}
}
export class MemoryR2 {
 constructor(){this.objects=new Map();}
 async put(key,data,options){const bytes=data instanceof Uint8Array?data:new Uint8Array(await new Response(data).arrayBuffer());this.objects.set(key,{bytes:bytes.slice(),options});}
 async get(key){const o=this.objects.get(key);if(!o)return null;return {body:new Blob([o.bytes]).stream(),arrayBuffer:async()=>o.bytes.slice().buffer};}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.objects.delete(key);}
}
export class FileR2 {
 constructor(root){this.root=root;}
 filename(key){if(!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(key))throw new Error('Unsafe R2 key');return path.join(this.root,key);}
 async put(key,data){const f=this.filename(key);await fs.mkdir(path.dirname(f),{recursive:true});const bytes=data instanceof Uint8Array?data:new Uint8Array(await new Response(data).arrayBuffer());await fs.writeFile(f,bytes);}
 async get(key){try{const bytes=await fs.readFile(this.filename(key));return {body:new Blob([bytes]).stream(),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])await fs.rm(this.filename(key),{force:true});}
}
export function assetBinding(root){return {async fetch(request){const p=new URL(request.url).pathname;const allowed=new Set(['/index.html','/app.js','/style.css','/widget.html','/favicon.svg']);if(!allowed.has(p))return new Response('Not found',{status:404});try{const bytes=await fs.readFile(path.join(root,p));const ext=path.extname(p);return new Response(request.method==='HEAD'?null:bytes,{headers:{'content-type':{'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.svg':'image/svg+xml'}[ext]||'application/octet-stream'}});}catch(e){if(e.code==='ENOENT')return new Response('Not built',{status:404});throw e;}}};}
