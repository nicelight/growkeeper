/** Optional native MCP Events delivery. Disabled until explicitly enabled and subscribed by the host. */
import {assert,AppError,allowedURL,fetchWith,seal,unseal,unbase64,hash,mac,uid,now,after,same,origin,boundedBody} from './lib.js';
import {Store} from './db.js';
import {claimFollowup,ackFollowup} from './domain.js';
export const EVENT_NAME='growkeeper.followup_due';
export const eventsEnabled=env=>env.EVENTS_ENABLED==='true';
export const EVENT={name:EVENT_NAME,description:'A requested observation/check for one of the user’s plants is due. Use one GrowKeeper monitor; do not duplicate it with polling.',delivery:['webhook'],inputSchema:{type:'object',properties:{},required:[],additionalProperties:false},payloadSchema:{type:'object',properties:{followup_id:{type:'string'},plant_id:{type:'string'},plant_name:{type:'string'},context:{type:'string'},url:{type:'string'}},required:['followup_id','plant_id','plant_name','context','url'],additionalProperties:false}};
function secretBytes(value){assert(typeof value==='string'&&value.startsWith('whsec_'),'WEBHOOK_SECRET','Expected whsec_ base64 secret.');let bytes;try{bytes=unbase64(value.slice(6));}catch{throw new AppError('WEBHOOK_SECRET','Invalid webhook secret.');}assert(bytes.length>=24&&bytes.length<=64,'WEBHOOK_SECRET','Webhook secret must be 24–64 bytes.');return bytes;}
export async function signedHeaders(secret,body,eventId,subscriptionId){const ts=String(Math.floor(Date.now()/1000));return {'content-type':'application/json','webhook-id':eventId,'webhook-timestamp':ts,'webhook-signature':'v1,'+await mac(secretBytes(secret),`${eventId}.${ts}.${body}`),'X-MCP-Subscription-Id':subscriptionId};}
export async function eventCall(store,method,p){
 assert(eventsEnabled(store.env),'EVENTS_DISABLED','Native events are disabled; configure and smoke-test before enabling.',404);
 if(method==='events/list')return {events:[EVENT]};
 if(method==='events/unsubscribe') {
  assert(p.name===EVENT_NAME&&p.arguments&&Object.keys(p.arguments).length===0&&p.delivery?.mode==='webhook','SUBSCRIPTION_IDENTITY','Supply original name, empty arguments and webhook delivery URL.');
  const callback=allowedURL(p.delivery.url,store.env.EVENT_WEBHOOK_HOSTS,'WEBHOOK_HOST_NOT_ALLOWED');
  await store.run('DELETE FROM subscriptions WHERE callback_url=? AND user_id=?',callback,store.user.id);return {};
 }
 assert(method==='events/subscribe','METHOD_NOT_FOUND','Unknown events method.',404);
 assert(p.name===EVENT_NAME,'EVENT_UNKNOWN','Unknown event.');
 assert(p.arguments&&typeof p.arguments==='object'&&!Array.isArray(p.arguments)&&Object.keys(p.arguments).length===0,'EVENT_ARGUMENTS','This event has empty arguments.');
 assert(p.delivery?.mode==='webhook','DELIVERY','Only webhook delivery is supported.');secretBytes(p.delivery.secret);
 const callback=allowedURL(p.delivery.url,store.env.EVENT_WEBHOOK_HOSTS,'WEBHOOK_HOST_NOT_ALLOWED');
 assert(p.cursor===undefined||p.cursor===null,'CURSOR_UNSUPPORTED','Historical event replay is not supported.');
 const requested=p.ttlMs??7*86400000;assert(Number.isSafeInteger(requested)&&requested>=60000,'TTL','ttlMs must be at least one minute.');const ttl=Math.min(requested,7*86400000);
 const existing=await store.first('SELECT * FROM subscriptions WHERE user_id=?',store.user.id);
 assert(!existing||existing.expires_at<now()||existing.callback_url===callback,'ALREADY_SUBSCRIBED','Only one active monitor per user. Unsubscribe before replacing its callback.',409);
 const id='gks_'+(await hash(`${store.user.id}\n${EVENT_NAME}\n${callback}\n{}`)).slice(0,40),challenge=uid();
 const oldSecret=existing?await unseal(store.env,existing.secret_cipher):null;
 const rotated=!!existing&&!same(oldSecret,p.delivery.secret);
 let verifiedAt=existing?.verified_at;
 // Verification belongs to a principal AND callback, never just the signing key.
 if(!existing||existing.callback_url!==callback||rotated||!Number.isFinite(Date.parse(verifiedAt))||Date.parse(verifiedAt)<Date.now()-300000){
  const body=JSON.stringify({type:'verification',challenge});
  let r;try{r=await fetchWith(store.env,callback,{method:'POST',redirect:'manual',headers:await signedHeaders(p.delivery.secret,body,uid(),id),body,signal:AbortSignal.timeout(10000)});}catch(e){throw new AppError('WEBHOOK_VERIFICATION','Callback verification could not complete.',502,{reason:e.name==='TimeoutError'?'timeout':'connection_failed'});}
  assert(r.ok,'WEBHOOK_VERIFICATION','Callback rejected verification.',502,{reason:'challenge_failed'});
  let echo;try{echo=JSON.parse(new TextDecoder().decode(await boundedBody(r,4096)));}catch{throw new AppError('WEBHOOK_VERIFICATION','Callback did not echo challenge.',502,{reason:'challenge_failed'});}
  assert(same(echo.challenge,challenge),'WEBHOOK_VERIFICATION','Callback challenge did not match.',502,{reason:'challenge_failed'});verifiedAt=now();
 }
 const expires=after(ttl),cipher=await seal(store.env,p.delivery.secret);
 const previous=rotated?existing.secret_cipher:existing?.previous_secret_cipher||null;
 const previousUntil=rotated?after(120000):existing?.previous_secret_until||null;
 await store.run(`INSERT INTO subscriptions(id,user_id,callback_url,secret_cipher,previous_secret_cipher,previous_secret_until,expires_at,verified_at,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,callback_url=excluded.callback_url,secret_cipher=excluded.secret_cipher,previous_secret_cipher=excluded.previous_secret_cipher,previous_secret_until=excluded.previous_secret_until,expires_at=excluded.expires_at,verified_at=excluded.verified_at,last_error=NULL`,id,store.user.id,callback,cipher,previous,previousUntil,expires,verifiedAt,now());
 return {id,refreshBefore:expires,cursor:null,truncated:false};
}
export async function dispatchDue(env){
 if(!eventsEnabled(env))return {disabled:true};
 const due=(await env.DB.prepare(`SELECT f.id,f.user_id FROM followups f JOIN subscriptions s ON s.user_id=f.user_id JOIN users u ON u.id=f.user_id JOIN plants p ON p.id=f.plant_id WHERE f.status='PENDING' AND f.due_at<=? AND (f.next_attempt_at IS NULL OR f.next_attempt_at<=?) AND (f.lease_until IS NULL OR f.lease_until<=?) AND s.expires_at>? AND u.active=1 AND p.deleting=0 ORDER BY f.due_at LIMIT 20`).bind(now(),now(),now(),now()).all()).results;
 let delivered=0,failed=0;
 for(const item of due){
  const store=new Store(env,{id:item.user_id});let claimed;
  try{claimed=await claimFollowup(store,item.id);}catch(e){if(e.code==='LEASE_UNAVAILABLE')continue;throw e;}
  const {followup:f,lease_token}=claimed;
  try{
   const sub=await store.first('SELECT s.* FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE s.user_id=? AND s.expires_at>? AND u.active=1',store.user.id,now());
   assert(sub,'SUBSCRIPTION_GONE','Subscription expired or revoked.');
   const plant=await store.get('plant',f.plant_id);
   const callback=allowedURL(sub.callback_url,env.EVENT_WEBHOOK_HOSTS,'WEBHOOK_HOST_NOT_ALLOWED');
   const eventId=`${f.id}:${(await hash(f.due_at)).slice(0,12)}`;
   const body=JSON.stringify({eventId,name:EVENT_NAME,timestamp:f.due_at,data:{followup_id:f.id,plant_id:f.plant_id,plant_name:plant.display_name,context:f.context,url:`${origin(env)}/entity/followup/${f.id}`},cursor:null});
   const secret=await unseal(env,sub.secret_cipher);
   const headers=await signedHeaders(secret,body,eventId,sub.id);
   if(sub.previous_secret_cipher&&sub.previous_secret_until>now()){
    const old=await unseal(env,sub.previous_secret_cipher);
    headers['webhook-signature']+=' v1,'+await mac(secretBytes(old),`${eventId}.${headers['webhook-timestamp']}.${body}`);
   }
   const response=await fetchWith(env,callback,{method:'POST',redirect:'manual',headers,body,signal:AbortSignal.timeout(10000)});
   if(response.body)await response.body.cancel();
   if([410,413].includes(response.status)){
    await store.run('DELETE FROM subscriptions WHERE id=? AND user_id=?',sub.id,store.user.id);
    throw new AppError('DELIVERY_STOPPED',`HTTP ${response.status}; subscription removed. Reconfigure before retrying.`,502);
   }
   assert(response.ok,'WEBHOOK_DELIVERY',`Callback HTTP ${response.status}.`,502);
   await ackFollowup(store,{id:f.id,lease_token});delivered++;
  }catch(e){
   failed++;const attempts=f.attempts+1;
   const error=e instanceof AppError?`${e.code}: ${e.message}`:'DELIVERY_FAILED: outbound failure; no response body logged';
   await store.run(`UPDATE followups SET lease_token=NULL,lease_until=NULL,attempts=?,next_attempt_at=?,last_error=? WHERE id=? AND user_id=? AND lease_token=? AND status='PENDING'`,attempts,attempts>=8?'2999-01-01T00:00:00.000Z':after(Math.min(86400000,900000*2**(attempts-1))),error,f.id,store.user.id,lease_token);
   console.warn(JSON.stringify({component:'events',followup_id:f.id,code:e.code||'OUTBOUND',attempts}));
  }
 }
 return {considered:due.length,delivered,failed};
}
