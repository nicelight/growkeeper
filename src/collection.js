import {assert,now,uid,instant} from './lib.js';
import {saveFollowup,settings} from './domain.js';
import {monitoringStatus} from './monitoring.js';
export async function collectionStatus(s){
 const row=await s.first('SELECT stage,last_user_at,checkin_id,checkin_sent_at FROM collection_onboarding WHERE user_id=?',s.user.id);
 return row||{stage:'new',last_user_at:null,checkin_id:null,checkin_sent_at:null};
}
export async function zones(s){return {zones:(await s.all('SELECT * FROM zones WHERE user_id=? ORDER BY display_name LIMIT 101',s.user.id)).map(x=>s.decorate('zone',x))};}
export async function plantZone(s,id){return await s.first('SELECT z.* FROM zones z JOIN plant_zones pz ON pz.zone_id=z.id AND pz.user_id=z.user_id WHERE pz.plant_id=? AND pz.user_id=?',id,s.user.id);}
export async function createZone(s,a){return {zone:await s.insert('zone',{display_name:a.display_name,description:a.description||'',created_at:now(),updated_at:now()},a.id)};}
export async function updateZone(s,a){const old=await s.get('zone',a.id);return {zone:await s.change('zone',a.id,a.expected_version,{display_name:a.display_name,description:a.description??old.description})};}
export async function assignZone(s,a){
 await s.get('plant',a.plant_id);
 if(a.clear){assert(!a.zone_id,'ZONE_INPUT','Do not supply zone when clearing.');await s.run('DELETE FROM plant_zones WHERE plant_id=? AND user_id=?',a.plant_id,s.user.id);}
 else{assert(a.zone_id,'ZONE_INPUT','Supply zone_id.');await s.get('zone',a.zone_id);await s.run('INSERT INTO plant_zones(plant_id,user_id,zone_id) VALUES(?,?,?) ON CONFLICT(plant_id) DO UPDATE SET zone_id=excluded.zone_id WHERE plant_zones.user_id=excluded.user_id',a.plant_id,s.user.id,a.zone_id);}
 return {plant:await s.get('plant',a.plant_id),zone:await plantZone(s,a.plant_id)};
}
export async function namePlant(s,a){return {plant:await s.change('plant',a.id,a.expected_version,{display_name:a.display_name,name_source:a.source,name_confirmed:a.source==='user'?1:0})};}
export async function recordCollection(s,a){
 const old=await collectionStatus(s),stamp=now();
 const activity=instant(a.user_message_at);
 assert(Date.parse(activity)<=Date.now()+60000,'FUTURE_ACTIVITY','User activity cannot be in the future.');
 if(old.last_user_at&&activity<old.last_user_at)return {collection:old,stale:true};
 const terminal=['answered','declined'].includes(old.stage);
 let stage=a.stage==='activity'?old.stage:a.stage;
 if(terminal&&!['answered','declined'].includes(stage))stage=old.stage;
 if(old.stage==='asked'&&stage==='help_answered')stage='asked';
 if(a.stage==='asked')assert(['help_answered','asked','answered','declined'].includes(old.stage),'HELP_FIRST','Answer the immediate question before collection onboarding.');
 // A new user reply cancels the silence check, not ordinary care followups.
 if(old.checkin_id&&(activity>old.last_user_at||['answered','declined'].includes(stage)))await s.run("UPDATE followups SET status='CANCELLED',lease_token=NULL,lease_until=NULL,updated_at=?,version=version+1 WHERE id=? AND user_id=? AND status='PENDING'",stamp,old.checkin_id,s.user.id);
 await s.run(`INSERT INTO collection_onboarding(user_id,stage,last_user_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET stage=excluded.stage,last_user_at=excluded.last_user_at,updated_at=excluded.updated_at`,s.user.id,stage,activity,stamp);
 return {collection:await collectionStatus(s)};
}
export function daytime(date,timezone){const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'}).format(date));return hour>=8&&hour<22;}
export function nextDaytime(value,timezone){const d=new Date(value);for(let i=0;i<1440&&!daytime(d,timezone);i++)d.setTime(d.getTime()+60000);return d.toISOString();}
export async function scheduleCollectionCheckin(s,a){
 assert(a.user_consented===true,'CONSENT_REQUIRED','Only after explicit consent to proactive plant care messages.');
 assert((await monitoringStatus(s)).state==='active','SUBSCRIPTION_REQUIRED','An active host subscription is required.');
 const state=await collectionStatus(s);
 assert(['help_answered','asked'].includes(state.stage)&&state.last_user_at,'HELP_FIRST','Answer the immediate question first.');
 // Exactly one scheduled onboarding check per account, not recurring nagging.
 if(state.checkin_id)return {collection:state,already_scheduled:true};
 const zone=(await settings(s)).timezone;
 const due=nextDaytime(new Date(Math.max(Date.parse(state.last_user_at)+86400000,Date.now()+60000)).toISOString(),zone);
 const id=uid();
 const result=await saveFollowup(s,{id,plant_id:a.plant_id,type:'ASK_STATUS',context:'Однократно вернись к последнему вопросу об уходе. Если вопрос уже решён, мягко предложи рассказать о растениях и их расположении по зонам. Не повторяй при молчании; сначала проверь свежие сообщения и ночное время.',due_at:due});
 // Race-safe single winner; cancel the redundant check if another invocation won.
 const r=await s.run('UPDATE collection_onboarding SET checkin_id=?,updated_at=? WHERE user_id=? AND checkin_id IS NULL',id,now(),s.user.id);
 if(!r.meta?.changes)await s.run("UPDATE followups SET status='CANCELLED' WHERE id=? AND user_id=?",id,s.user.id);
 return {collection:await collectionStatus(s),...(r.meta?.changes?result:{already_scheduled:true})};
}
