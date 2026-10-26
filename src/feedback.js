import {assert,now,after,fetchWith,boundedBody} from './lib.js';
import {VERSION} from './version.js';
const CONTACT='https://t.me/dyingseed';
export function feedbackStatus(env){return {configured:!!(env.FEEDBACK_BOT_TOKEN&&/^[1-9][0-9]*$/.test(String(env.FEEDBACK_CHAT_ID||''))),developer_contact:CONTACT,requires_consent:true};}
const result=row=>({report_id:row.id,status:row.status,developer_contact:CONTACT,telegram_accepted:row.status==='sent',developer_read_confirmed:false});
export async function getFeedback(s,a){const r=await s.first('SELECT id,status FROM feedback_reports WHERE id=? AND user_id=?',a.id,s.user.id);assert(r,'NOT_FOUND','Report not found.',404);return {feedback:result(r)};}
export async function sendFeedback(s,a){
 assert(a.user_consented===true,'CONSENT_REQUIRED','Ask permission to send this summary to the developer @dyingseed via Telegram.');
 const old=await s.first('SELECT id,kind,summary,status FROM feedback_reports WHERE id=? AND user_id=?',a.id,s.user.id);
 if(old){assert(old.kind===a.kind&&old.summary===a.summary,'IDEMPOTENCY_CONFLICT','Report ID belongs to different content.',409);return {feedback:result(old)};}
 assert(feedbackStatus(s.env).configured,'FEEDBACK_NOT_CONFIGURED','Telegram delivery is not configured. Contact https://t.me/dyingseed directly.',503);
 const stamp=now();
 const inserted=await s.run(`INSERT OR IGNORE INTO feedback_reports(id,user_id,kind,summary,status,created_at,updated_at) SELECT ?,?,?,?,'pending',?,? WHERE (SELECT COUNT(*) FROM feedback_reports WHERE user_id=? AND created_at>?)<5`,a.id,s.user.id,a.kind,a.summary,stamp,stamp,s.user.id,after(-86400000));
 if(!inserted.meta.changes){const concurrent=await s.first('SELECT id,kind,summary,status FROM feedback_reports WHERE id=? AND user_id=?',a.id,s.user.id);if(concurrent){assert(concurrent.kind===a.kind&&concurrent.summary===a.summary,'IDEMPOTENCY_CONFLICT','Report ID belongs to different content.',409);return {feedback:result(concurrent)};}assert(false,'FEEDBACK_RATE_LIMIT','At most five reports per 24 hours; contact the developer directly.',429);}
 let status='unknown',messageId=null;
 try{
  // Never log request URL/token, response text, report contents or transport exception.
  const text=`GrowKeeper ${VERSION}\nReport: ${a.id}\nType: ${a.kind}\n\n${a.summary}`;
  const r=await fetchWith(s.env,`https://api.telegram.org/bot${s.env.FEEDBACK_BOT_TOKEN}/sendMessage`,{method:'POST',redirect:'manual',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:s.env.FEEDBACK_CHAT_ID,text,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(10000)});
  const data=JSON.parse(new TextDecoder().decode(await boundedBody(r,16384)));
  if(r.ok&&data.ok===true&&Number.isSafeInteger(data.result?.message_id)){status='sent';messageId=data.result.message_id;}
  else if(data.ok===false)status='failed';
 }catch{/* Outcome is uncertain; never automatically resend. */}
 await s.run('UPDATE feedback_reports SET status=?,telegram_message_id=?,updated_at=? WHERE id=? AND user_id=?',status,messageId,now(),a.id,s.user.id);
 return {feedback:result({id:a.id,status})};
}
