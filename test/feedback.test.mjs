import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {sendFeedback,getFeedback,feedbackStatus} from '../src/feedback.js';
import {uid} from '../src/lib.js';
const report=()=>({id:uid(),kind:'bug',summary:'Photo import fails with FILE_HOST_NOT_ALLOWED.',user_consented:true});
const configure=f=>{f.env.FEEDBACK_BOT_TOKEN='test-only-not-a-real-token';f.env.FEEDBACK_CHAT_ID='123456789';};
test('feedback is disabled without configuration and never sends without consent',async()=>{const f=await fixture();try{
 assert.equal(feedbackStatus(f.env).configured,false);
 await assert.rejects(sendFeedback(f.store,report()),{code:'FEEDBACK_NOT_CONFIGURED'});
 configure(f);await assert.rejects(sendFeedback(f.store,{...report(),user_consented:false}),{code:'CONSENT_REQUIRED'});
 assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM feedback_reports')).n,0);
}finally{f.close();}});
test('feedback sends only approved summary and version, records acceptance and is idempotent',async()=>{const f=await fixture();try{
 configure(f);let calls=0;
 f.env.OUTBOUND_FETCH=async(url,o)=>{calls++;assert.equal(url,'https://api.telegram.org/bottest-only-not-a-real-token/sendMessage');assert.equal(o.redirect,'manual');const b=JSON.parse(o.body);assert.equal(b.chat_id,'123456789');assert.equal(b.text.includes(f.owner.id),false);assert.equal(b.parse_mode,undefined);return Response.json({ok:true,result:{message_id:42}});};
 const a=report(),r=await sendFeedback(f.store,a);assert.equal(r.feedback.status,'sent');assert.equal(r.feedback.developer_read_confirmed,false);
 assert.equal((await sendFeedback(f.store,a)).feedback.telegram_accepted,true);assert.equal(calls,1);
 await assert.rejects(sendFeedback(f.store,{...a,summary:'Different text'}),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(getFeedback(f.otherStore,{id:a.id}),{code:'NOT_FOUND'});
 assert.equal(JSON.stringify(r).includes('test-only-not-a-real-token'),false);
}finally{f.close();}});
test('uncertain feedback delivery is not retried and API rejection is distinct',async()=>{const f=await fixture();try{
 configure(f);let calls=0;f.env.OUTBOUND_FETCH=async()=>{calls++;throw Error('network');};const a=report();
 assert.equal((await sendFeedback(f.store,a)).feedback.status,'unknown');
 assert.equal((await sendFeedback(f.store,a)).feedback.status,'unknown');assert.equal(calls,1);
 f.env.OUTBOUND_FETCH=async()=>Response.json({ok:false,error_code:403},{status:403});
 assert.equal((await sendFeedback(f.store,report())).feedback.status,'failed');
}finally{f.close();}});
test('feedback quota bounds spam without disclosing other accounts',async()=>{const f=await fixture();try{
 configure(f);let calls=0;f.env.OUTBOUND_FETCH=async()=>{calls++;return Response.json({ok:true,result:{message_id:calls}});};
 for(let i=0;i<5;i++)await sendFeedback(f.store,report());
 await assert.rejects(sendFeedback(f.store,report()),{code:'FEEDBACK_RATE_LIMIT'});assert.equal(calls,5);
 await sendFeedback(f.otherStore,report());assert.equal(calls,6);
}finally{f.close();}});
