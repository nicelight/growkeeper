/** Zone retirement is guarded; card normalization preserves stable identities. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {LocalD1} from '../scripts/local-platform.mjs';
import {uid,now} from '../src/lib.js';
const read=n=>fs.readFile(new URL('../migrations/'+n,import.meta.url),'utf8');
async function legacy(){const db=new LocalD1();for(const n of ['0001_initial.sql','0002_monitoring_prompt.sql','0003_shortcut_offer.sql','0004_collection_onboarding.sql','0005_feedback.sql','0006_google_auth.sql','0007_gardening.sql'])await db.exec(await read(n));const user=uid(),stamp=now();await db.prepare('INSERT INTO users(id,display_name,login_key_hash,created_at) VALUES(?,?,?,?)').bind(user,'Owner','hash',stamp).run();return {db,user,stamp};}
async function migrate(db){await db.exec('BEGIN');try{await db.exec(await read('0008_groups.sql'));await db.exec('COMMIT');}catch(e){await db.exec('ROLLBACK');throw e;}}
test('empty-zone retirement removes obsolete tables and normalizes bed without replacing history',async()=>{
 const {db,user,stamp}=await legacy();try{
 const bed=uid(),group=uid();for(const [id,name,kind] of [[group,'Полка','group'],[bed,'Общий горшок','bed']])await db.prepare("INSERT INTO plants(id,user_id,display_name,name_source,name_confirmed,kind,profile,created_at,updated_at) VALUES(?,?,?,'user',1,?,'original',?,?)").bind(id,user,name,kind,stamp,stamp).run();
 const journal=uid();await db.prepare("INSERT INTO journal_entries(id,user_id,plant_id,entry_type,title,summary,occurred_at,created_at) VALUES(?,?,?,'NOTE','История','Сохранить',?,?)").bind(journal,user,bed,stamp,stamp).run();
 await migrate(db);
 const p=await db.prepare('SELECT * FROM plants WHERE id=?').bind(bed).first();assert.equal(p.kind,'plant');assert.equal(p.profile,'original');assert.equal(p.id,bed);assert.equal(p.version,2);
 assert.equal((await db.prepare('SELECT * FROM journal_entries WHERE id=?').bind(journal).first()).plant_id,bed);assert.equal((await db.prepare('SELECT kind FROM plants WHERE id=?').bind(group).first()).kind,'group');
 assert.equal((await db.prepare('SELECT * FROM plant_groups').all()).results.length,0);
 for(const table of ['zones','plant_zones','collection_pairs','collection_create_requests','zone_retirement_guard','legacy_structure_archive'])assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first(),null);
 }finally{db.close();}
});
test('unexpected legacy zone data aborts migration and preserves every table and row',async()=>{
 const {db,user,stamp}=await legacy();try{
 const id=uid();await db.prepare('INSERT INTO zones(id,user_id,display_name,description,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id,user,'Нельзя потерять','Исходное описание',stamp,stamp).run();
 await assert.rejects(migrate(db));assert.equal((await db.prepare('SELECT * FROM zones WHERE id=?').bind(id).first()).description,'Исходное описание');
 for(const table of ['zones','plant_zones','collection_pairs','collection_create_requests'])assert.ok(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first());
 assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plant_groups'").first(),null);
 }finally{db.close();}
});
