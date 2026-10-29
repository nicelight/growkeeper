import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,plant,tool} from './helpers.mjs';
import * as C from '../src/collection.js';
import {eventCall,dispatchDue,EVENT_NAME} from '../src/events.js';
import {uid,now,after,base64} from '../src/lib.js';
async function subscribe(f){f.env.EVENTS_ENABLED='true';f.env.OUTBOUND_FETCH=async(url,o)=>{const p=JSON.parse(o.body);return p.type==='verification'?Response.json({challenge:p.challenge}):new Response(null,{status:204});};return eventCall(f.store,'events/subscribe',{name:EVENT_NAME,arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/test',secret:'whsec_'+base64(new Uint8Array(32).fill(8))}});}
test('onboarding never asks before help and terminal refusal survives new activity',async()=>{const f=await fixture();try{
 await assert.rejects(C.recordCollection(f.store,{stage:'asked',user_message_at:now()}),{code:'HELP_FIRST'});
 await C.recordCollection(f.store,{stage:'help_answered',user_message_at:after(-1000)});
 await C.recordCollection(f.store,{stage:'asked',user_message_at:after(-1000)});
 await C.recordCollection(f.store,{stage:'help_answered',user_message_at:after(-1000)});
 assert.equal((await C.collectionStatus(f.store)).stage,'asked');
 await C.recordCollection(f.store,{stage:'declined',user_message_at:now()});
 await C.recordCollection(f.store,{stage:'activity',user_message_at:now()});
 assert.equal((await C.collectionStatus(f.store)).stage,'declined');
 assert.equal((await C.collectionStatus(f.otherStore)).stage,'new');
 assert.equal((await C.recordCollection(f.store,{stage:'help_answered',user_message_at:after(-10000)})).stale,true);
}finally{f.close();}});
test('one silence check requires consent/subscription/help; reply cancels only this check',async()=>{const f=await fixture();try{
 const p=await plant(f.store);
 await assert.rejects(C.scheduleCollectionCheckin(f.store,{plant_id:p.id,user_consented:false}),{code:'CONSENT_REQUIRED'});
 await assert.rejects(C.scheduleCollectionCheckin(f.store,{plant_id:p.id,user_consented:true}),{code:'SUBSCRIPTION_REQUIRED'});
 await subscribe(f);
 await assert.rejects(C.scheduleCollectionCheckin(f.store,{plant_id:p.id,user_consented:true}),{code:'HELP_FIRST'});
 await C.recordCollection(f.store,{stage:'help_answered',user_message_at:after(-1000)});
 const first=await C.scheduleCollectionCheckin(f.store,{plant_id:p.id,user_consented:true});
 assert.ok(Date.parse(first.followup.due_at)>Date.now()+23*3600000);
 assert.equal(C.daytime(new Date(first.followup.due_at),'Asia/Dushanbe'),true);
 assert.equal((await C.scheduleCollectionCheckin(f.store,{plant_id:p.id,user_consented:true})).already_scheduled,true);
 const care=(await tool(f.store,'create_followup',{id:uid(),plant_id:p.id,type:'ASK_STATUS',context:'Проверить листья',due_at:after(86400000)})).followup;
 await C.recordCollection(f.store,{stage:'activity',user_message_at:now()});
 assert.equal((await f.store.get('followup',first.followup.id)).status,'CANCELLED');
 assert.equal((await f.store.get('followup',care.id)).status,'PENDING');
}finally{f.close();}});
test('quiet hours defer onboarding dispatch; daytime delivery is not repeated',async t=>{t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-26T18:00:00Z')});const f=await fixture();try{
 const p=await plant(f.store);await subscribe(f);
 await C.recordCollection(f.store,{stage:'help_answered',user_message_at:now()});
 const r=await C.scheduleCollectionCheckin(f.store,{plant_id:p.id,user_consented:true});
 await f.store.run('UPDATE followups SET due_at=? WHERE id=?',after(-1000),r.followup.id);
 assert.equal((await dispatchDue(f.env)).delivered,0);
 assert.equal((await f.store.get('followup',r.followup.id)).status,'PENDING');
 t.mock.timers.setTime(new Date('2026-10-27T03:10:00Z').getTime());
 assert.equal((await dispatchDue(f.env)).delivered,1);
 assert.ok((await C.collectionStatus(f.store)).checkin_sent_at);
 assert.equal((await dispatchDue(f.env)).delivered,0);
 assert.equal((await f.store.get('followup',r.followup.id)).status,'NOTIFIED');
}finally{f.close();}});
test('daytime conversion preserves UTC and half-hour-offset quiet hours',()=>{
 assert.equal(C.nextDaytime('2026-10-26T18:00:00Z','Asia/Dushanbe'),'2026-10-27T03:00:00.000Z');
 assert.equal(C.nextDaytime('2026-10-26T18:00:00Z','Asia/Kolkata'),'2026-10-27T02:30:00.000Z');
});

const group=async(s,name='Общая полка')=>(await tool(s,'create_plant',{id:uid(),display_name:name,kind:'group',name_source:'user',name_confirmed:true,profile:'Свет 12 часов; кокос.'})).plant;
const revision=async s=>(await tool(s,'gardening_structure',{action:'inspect'})).revision;
const assign=async(s,p,g)=>tool(s,'assign_plant_group',{plant_id:p.id,...(g?{group_id:g.id}:{clear:true}),expected_revision:await revision(s)});

test('groups isolate owners, move membership and clear without losing history',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store),g2=await group(f.store,'Другая полка'),foreign=await group(f.otherStore);
 const note=(await tool(f.store,'add_journal_note',{id:uid(),plant_id:p.id,entry_type:'NOTE',title:'Листья',summary:'Своя история'})).journal_entry;
 await assign(f.store,p,g);assert.equal((await tool(f.store,'get_plants')).plants.find(x=>x.id===p.id).group.id,g.id);
 await assert.rejects(assign(f.otherStore,p,foreign),{code:'NOT_FOUND'});await assert.rejects(assign(f.store,p,foreign),e=>['NOT_FOUND','GROUP_INTEGRITY'].includes(e.code));
 await assign(f.store,p,g2);assert.equal((await tool(f.store,'get_plants')).plants.find(x=>x.id===p.id).group.id,g2.id);
 await assign(f.store,p,null);assert.equal((await tool(f.store,'get_plants')).plants.find(x=>x.id===p.id).group,null);
 assert.equal((await tool(f.store,'list_records',{plant_id:p.id,type:'journal'})).items[0].summary,'Своя история');
 const current=await f.store.get('plant',p.id);const renamed=(await C.namePlant(f.store,{id:p.id,expected_version:current.version,display_name:'Барон Лимон',source:'generated'})).plant;assert.equal(renamed.id,p.id);assert.equal(renamed.name_confirmed,0);
}finally{f.close();}});

test('group context includes shared records separately and never copies them to plant history',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store);await assign(f.store,p,g);
 await tool(f.store,'add_journal_note',{id:uid(),plant_id:g.id,entry_type:'NOTE',title:'План',summary:'План: проверить общий раствор, выполнение не подтверждено.'});
 const observation=(await tool(f.store,'add_observation',{id:uid(),plant_id:g.id,source:'user',text:'На полке прохладнее.'})).observation;
 const r=(await tool(f.store,'get_case_file',{plant_id:p.id})).case_file;
 assert.equal(r.group_context.plant.id,g.id);assert.equal(r.group_context.plant.profile,g.profile);assert.equal(r.group_context.journal.length,1);assert.equal(r.group_context.observations[0].id,observation.id);assert.equal(r.journal.length,0);assert.equal(r.observations.length,0);
 assert.equal((await tool(f.store,'list_records',{plant_id:p.id,type:'journal'})).items.length,0);
 assert.equal((await tool(f.store,'get_case_file',{plant_id:g.id})).case_file.group_context,null);
 await tool(f.store,'update_plant',{id:g.id,expected_version:g.version,display_name:g.display_name,profile:'Новое общее условие'});
 assert.equal((await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.group_context.plant.profile,'Новое общее условие');
}finally{f.close();}});

test('group history truncation is explicit and older pages remain available',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store);await assign(f.store,p,g);
 for(let n=0;n<14;n++)await tool(f.store,'add_journal_note',{id:uid(),plant_id:g.id,entry_type:'NOTE',title:'Запись '+n,summary:'Общее наблюдение'});
 const c=(await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.group_context;assert.equal(c.journal.length,12);assert.equal(c.truncated.journal,true);
 assert.equal((await tool(f.store,'list_records',{plant_id:g.id,type:'journal',offset:12})).items.length,2);
}finally{f.close();}});

test('card type changes preserve stable identity, source history and reject ambiguous members',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store);await tool(f.store,'add_journal_note',{id:uid(),plant_id:g.id,entry_type:'NOTE',title:'Горшок',summary:'Старая история'});
 await assign(f.store,p,g);await assert.rejects(tool(f.store,'change_plant_type',{plant_id:g.id,kind:'plant',expected_revision:await revision(f.store)}),{code:'GROUP_INTEGRITY'});
 await assign(f.store,p,null);await tool(f.store,'change_plant_type',{plant_id:g.id,kind:'plant',expected_revision:await revision(f.store)});
 assert.equal((await f.store.get('plant',g.id)).kind,'plant');assert.equal((await tool(f.store,'list_records',{plant_id:g.id,type:'journal'})).items[0].summary,'Старая история');
 await tool(f.store,'change_plant_type',{plant_id:g.id,kind:'group',expected_revision:await revision(f.store)});assert.equal((await f.store.get('plant',g.id)).id,g.id);
 await assign(f.store,p,g);await assert.rejects(tool(f.store,'change_plant_type',{plant_id:p.id,kind:'group',expected_revision:await revision(f.store)}),{code:'GROUP_INTEGRITY'});
 await tool(f.store,'change_plant_type',{plant_id:p.id,kind:'group',clear_membership:true,expected_revision:await revision(f.store)});assert.equal((await f.store.get('plant',p.id)).kind,'group');
}finally{f.close();}});

test('direct assignments and type changes reject stale revisions and cross-account IDs',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store),old=await revision(f.store);await plant(f.store,'Новое');
 await assert.rejects(tool(f.store,'assign_plant_group',{plant_id:p.id,group_id:g.id,expected_revision:old}),{code:'CONFLICT'});
 await assert.rejects(tool(f.store,'change_plant_type',{plant_id:p.id,kind:'group',expected_revision:old}),{code:'CONFLICT'});
 await assert.rejects(tool(f.otherStore,'change_plant_type',{plant_id:p.id,kind:'group',expected_revision:await revision(f.otherStore)}),{code:'NOT_FOUND'});
 await assert.rejects(assign(f.store,g,g),{code:'GROUP_INTEGRITY'});await assert.rejects(assign(f.store,p,p),{code:'GROUP_INTEGRITY'});
 assert.equal((await f.store.get('plant',p.id)).kind,'plant');
}finally{f.close();}});

test('database blocks a membership race after either card enters deletion',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store),other=await group(f.store,'Живая группа');
 await f.store.run('UPDATE plants SET deleting=1 WHERE id=? AND user_id=?',g.id,f.owner.id);
 await assert.rejects(f.store.run('INSERT INTO plant_groups(plant_id,user_id,group_id) VALUES(?,?,?)',p.id,f.owner.id,g.id),/GROUP_INTEGRITY/);
 await assign(f.store,p,other);
 await assert.rejects(f.store.run('UPDATE plant_groups SET group_id=? WHERE plant_id=? AND user_id=?',g.id,p.id,f.owner.id),/GROUP_INTEGRITY/);
 await f.store.run('DELETE FROM plant_groups WHERE plant_id=?',p.id);await f.store.run('UPDATE plants SET deleting=1 WHERE id=? AND user_id=?',p.id,f.owner.id);
 await assert.rejects(f.store.run('INSERT INTO plant_groups(plant_id,user_id,group_id) VALUES(?,?,?)',p.id,f.owner.id,other.id),/GROUP_INTEGRITY/);
 assert.equal((await f.store.all('SELECT * FROM plant_groups WHERE user_id=?',f.owner.id)).length,0);
}finally{f.close();}});
