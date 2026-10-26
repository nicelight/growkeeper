import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,plant,tool} from './helpers.mjs';
import * as C from '../src/collection.js';
import {eventCall,dispatchDue,EVENT_NAME} from '../src/events.js';
import {uid,now,after,base64} from '../src/lib.js';
async function subscribe(f){f.env.EVENTS_ENABLED='true';f.env.OUTBOUND_FETCH=async(url,o)=>{const p=JSON.parse(o.body);return p.type==='verification'?Response.json({challenge:p.challenge}):new Response(null,{status:204});};return eventCall(f.store,'events/subscribe',{name:EVENT_NAME,arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/test',secret:'whsec_'+base64(new Uint8Array(32).fill(8))}});}
test('zones isolate owners, attach to cards, move and clear without losing history',async()=>{const f=await fixture();try{
 const p=await plant(f.store),z=(await C.createZone(f.store,{id:uid(),display_name:'Верхняя полка',description:'Балкон'})).zone;
 await C.assignZone(f.store,{plant_id:p.id,zone_id:z.id});
 assert.equal((await tool(f.store,'get_plants')).plants[0].zone.id,z.id);
 assert.equal((await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.zone.id,z.id);
 await assert.rejects(C.assignZone(f.otherStore,{plant_id:p.id,zone_id:z.id}),{code:'NOT_FOUND'});
 const foreign=(await C.createZone(f.otherStore,{id:uid(),display_name:'Другая'})).zone;
 await assert.rejects(C.assignZone(f.store,{plant_id:p.id,zone_id:foreign.id}),{code:'NOT_FOUND'});
 await C.updateZone(f.store,{id:z.id,expected_version:z.version,display_name:'Полка справа'});
 assert.equal((await C.plantZone(f.store,p.id)).description,'Балкон');
 await C.assignZone(f.store,{plant_id:p.id,clear:true});assert.equal(await C.plantZone(f.store,p.id),null);
 const renamed=(await C.namePlant(f.store,{id:p.id,expected_version:p.version,display_name:'Барон Лимон',source:'generated'})).plant;
 assert.equal(renamed.id,p.id);assert.equal(renamed.name_source,'generated');assert.equal(renamed.name_confirmed,0);
}finally{f.close();}});
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
