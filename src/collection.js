/** Groups provide shared context through one explicit membership per plant.
 * Preserve IDs/history; guard ownership, types and revision. See docs/specs/collections.md. */
import {assert,now,uid,instant} from './lib.js';
import {saveFollowup,settings} from './domain.js';
import {monitoringStatus} from './monitoring.js';
export async function collectionStatus(s){
 const row=await s.first('SELECT stage,last_user_at,checkin_id,checkin_sent_at FROM collection_onboarding WHERE user_id=?',s.user.id);
 return row||{stage:'new',last_user_at:null,checkin_id:null,checkin_sent_at:null};
}
export async function groupFor(s,id){return await s.first('SELECT g.* FROM plants g JOIN plant_groups pg ON pg.group_id=g.id AND pg.user_id=g.user_id WHERE pg.plant_id=? AND pg.user_id=? AND g.deleting=0',id,s.user.id);}
export async function groupStructure(s){
 const plants=await s.all('SELECT id,display_name,kind,version FROM plants WHERE user_id=? AND deleting=0 ORDER BY id LIMIT 501',s.user.id);
 assert(plants.length<=500,'COLLECTION_TOO_LARGE','Read a complete collection before changing structure.');
 return {plants,memberships:await s.all('SELECT plant_id,group_id FROM plant_groups WHERE user_id=? ORDER BY plant_id',s.user.id)};
}
export function structureStatements(s,data,assignments=[],typeChanges=[]){
 const cards=new Map(data.plants.map(p=>[p.id,{...p}])),links=new Map(data.memberships.map(x=>[x.plant_id,x.group_id])),seen=new Set(),ops=[];
 for(const a of assignments){assert(!seen.has(a.plant_id),'DUPLICATE_ASSIGNMENT','Card assigned twice.');seen.add(a.plant_id);assert(cards.has(a.plant_id),'NOT_FOUND','Card not found.',404);assert(a.clear?!a.group_id:!!a.group_id,'GROUP_INPUT','Supply group_id or clear=true, not both.');if(a.clear)links.delete(a.plant_id);else links.set(a.plant_id,a.group_id);ops.push(s.stmt('DELETE FROM plant_groups WHERE plant_id=? AND user_id=?',a.plant_id,s.user.id));}
 seen.clear();for(const t of typeChanges){assert(!seen.has(t.plant_id),'DUPLICATE_TYPE','Card type changed twice.');seen.add(t.plant_id);assert(cards.has(t.plant_id),'NOT_FOUND','Card not found.',404);assert(['plant','group'].includes(t.kind),'BAD_TYPE','Only plant or group.');cards.get(t.plant_id).kind=t.kind;}
 for(const [plantId,groupId] of links){assert(cards.get(plantId)?.kind==='plant'&&cards.get(groupId)?.kind==='group'&&plantId!==groupId,'GROUP_INTEGRITY','Resulting membership must link a plant to a group. Explicitly clear or reassign affected members before changing type.',409);}
 for(const t of typeChanges)ops.push(s.stmt('UPDATE plants SET kind=?,version=version+1,updated_at=? WHERE id=? AND user_id=? AND deleting=0',t.kind,now(),t.plant_id,s.user.id));
 for(const a of assignments)if(!a.clear)ops.push(s.stmt('INSERT INTO plant_groups(plant_id,user_id,group_id) VALUES(?,?,?)',a.plant_id,s.user.id,a.group_id));
 return ops;
}
async function changeStructure(s,a,assignments,typeChanges){
 const data=await groupStructure(s),ops=structureStatements(s,data,assignments,typeChanges),id=uid();
 try{await s.db.batch([s.stmt('INSERT INTO gardening_assertions(id,valid) VALUES(?,(SELECT revision=? FROM gardening_revisions WHERE user_id=?))',id,a.expected_revision,s.user.id),...ops,s.stmt('DELETE FROM gardening_assertions WHERE id=?',id)]);}catch(e){if(/gardening_assertions|valid=1/.test(e.message))assert(false,'CONFLICT','Collection changed; reload its revision.',409);throw e;}
 return {plant:await s.get('plant',a.plant_id),group:await groupFor(s,a.plant_id),revision:(await s.first('SELECT revision FROM gardening_revisions WHERE user_id=?',s.user.id)).revision};
}
export async function assignGroup(s,a){return changeStructure(s,a,[a],[]);}
export async function changeType(s,a){return changeStructure(s,a,a.clear_membership?[{plant_id:a.plant_id,clear:true}]:[],[{plant_id:a.plant_id,kind:a.kind}]);}
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
 const result=await saveFollowup(s,{id,plant_id:a.plant_id,type:'ASK_STATUS',context:'Однократно вернись к последнему вопросу об уходе. Если вопрос уже решён, мягко предложи рассказать о растениях и их группах и расположении. Не повторяй при молчании; сначала проверь свежие сообщения и ночное время.',due_at:due});
 // Race-safe single winner; cancel the redundant check if another invocation won.
 const r=await s.run('UPDATE collection_onboarding SET checkin_id=?,updated_at=? WHERE user_id=? AND checkin_id IS NULL',id,now(),s.user.id);
 if(!r.meta?.changes)await s.run("UPDATE followups SET status='CANCELLED' WHERE id=? AND user_id=?",id,s.user.id);
 return {collection:await collectionStatus(s),...(r.meta?.changes?result:{already_scheduled:true})};
}
