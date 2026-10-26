import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tool,plant} from './helpers.mjs';
import {uid,after,base64} from '../src/lib.js';
import {eventCall,EVENT_NAME} from '../src/events.js';
const check=async f=>{const p=await plant(f.store);return tool(f.store,'create_followup',{id:uid(),plant_id:p.id,type:'ASK_STATUS',context:'Check leaves',due_at:after(86400000)});};
test('offer requires enabled events and pending checks; offer and refusal persist per owner',async()=>{const f=await fixture();try{
 assert.equal((await tool(f.store,'get_monitoring_status')).monitoring.state,'disabled');
 f.env.EVENTS_ENABLED='true';assert.equal((await tool(f.store,'get_monitoring_status')).monitoring.should_offer,false);
 assert.equal((await check(f)).monitoring.should_offer,true);
 await tool(f.store,'record_monitoring_choice',{choice:'offered'});
 assert.equal((await tool(f.store,'get_plants')).monitoring.should_offer,false);
 await tool(f.store,'record_monitoring_choice',{choice:'declined'});
 assert.equal((await tool(f.store,'get_settings')).monitoring.offer_declined,true);
 assert.equal((await tool(f.otherStore,'get_monitoring_status')).monitoring.offer_declined,false);
 await tool(f.store,'record_monitoring_choice',{choice:'offered'});
 assert.equal((await tool(f.store,'get_monitoring_status')).monitoring.offer_declined,true);
 await tool(f.store,'record_monitoring_choice',{choice:'reset'});
 assert.equal((await tool(f.store,'get_monitoring_status')).monitoring.should_offer,true);
 assert.equal(await f.store.first('SELECT * FROM subscriptions'),null);
}finally{f.close();}});
test('active subscription suppresses offers and exposes no secret or callback; expiry permits renewal offer',async()=>{const f=await fixture();try{
 f.env.EVENTS_ENABLED='true';await check(f);
 await tool(f.store,'record_monitoring_choice',{choice:'offered'});
 f.env.OUTBOUND_FETCH=async(url,o)=>Response.json({challenge:JSON.parse(o.body).challenge});
 await eventCall(f.store,'events/subscribe',{name:EVENT_NAME,arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/private',secret:'whsec_'+base64(new Uint8Array(32).fill(9))}});
 let m=(await tool(f.store,'get_monitoring_status')).monitoring;
 assert.equal(m.state,'active');assert.equal(m.should_offer,false);
 assert.equal(JSON.stringify(m).includes('private'),false);assert.equal(JSON.stringify(m).includes('whsec'),false);
 await f.store.run('UPDATE monitoring_preferences SET last_offered_at=? WHERE user_id=?',after(-20000),f.owner.id);
 await f.store.run('UPDATE subscriptions SET expires_at=? WHERE user_id=?',after(-1000),f.owner.id);
 m=(await tool(f.store,'get_monitoring_status')).monitoring;assert.equal(m.state,'expired');assert.equal(m.should_offer,true);
 await tool(f.store,'record_monitoring_choice',{choice:'offered'});
 assert.equal((await tool(f.store,'get_monitoring_status')).monitoring.should_offer,false);
}finally{f.close();}});
test('cancelled checks do not generate offers and migration is repeatable',async()=>{const f=await fixture();try{
 f.env.EVENTS_ENABLED='true';const r=await check(f);
 const updated=await tool(f.store,'update_followup',{id:r.followup.id,expected_version:r.followup.version,status:'CANCELLED'});
 assert.equal(updated.monitoring.should_offer,false);assert.equal(updated.monitoring.pending_checks,0);
 const fs=await import('node:fs/promises');await f.env.DB.exec(await fs.readFile(new URL('../migrations/0002_monitoring_prompt.sql',import.meta.url),'utf8'));
 assert.equal((await tool(f.store,'get_monitoring_status')).monitoring.state,'missing');
}finally{f.close();}});

test('shortcut offer appears only with active monitoring and is suppressed durably without granting consent',async()=>{const f=await fixture();try{
 f.env.EVENTS_ENABLED='true';assert.equal((await tool(f.store,'get_monitoring_status')).monitoring.should_offer_shortcut,false);
 f.env.OUTBOUND_FETCH=async(url,o)=>Response.json({challenge:JSON.parse(o.body).challenge});
 await eventCall(f.store,'events/subscribe',{name:EVENT_NAME,arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/private',secret:'whsec_'+base64(new Uint8Array(32).fill(9))}});
 assert.equal((await tool(f.store,'get_monitoring_status')).monitoring.should_offer_shortcut,true);
 await tool(f.store,'record_monitoring_choice',{choice:'declined'});
 await tool(f.store,'record_monitoring_choice',{choice:'shortcut_offered'});
 let m=(await tool(f.store,'get_monitoring_status')).monitoring;assert.equal(m.should_offer_shortcut,false);assert.equal(m.offer_declined,true);assert.equal(m.state,'active');
 await tool(f.store,'record_monitoring_choice',{choice:'reset'});
 await tool(f.store,'record_monitoring_choice',{choice:'shortcut_offered'});
 assert.equal((await tool(f.store,'get_monitoring_status')).monitoring.should_offer_shortcut,false);
 assert.equal(await f.otherStore.first('SELECT shortcut_offered_at FROM monitoring_preferences WHERE user_id=?',f.other.id),null);
}finally{f.close();}});
