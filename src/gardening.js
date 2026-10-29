/** Maintains group membership and reversible memory through reviewed plans.
 * Contract: inspect → prepare → confirm exact plan → apply; never rewrite sources.
 * Account revision guards reject concurrent changes. See docs/specs/gardening.md.
 */
import {assert,now,uid} from './lib.js';
import {TABLES} from './db.js';
import {groupStructure,structureStatements} from './collection.js';
const historyTypes=['observation','issue','hypothesis','experiment','followup','journal','photo','input'];
const clean=v=>typeof v==='string'&&v.trim().length>0;
export async function revision(s){return (await s.first('SELECT revision FROM gardening_revisions WHERE user_id=?',s.user.id)).revision;}
export async function memory(s,plantId,versionId=null,includeSources=false){
 const row=versionId?await s.first('SELECT * FROM card_memory_versions WHERE id=? AND plant_id=? AND user_id=?',versionId,plantId,s.user.id):await s.first('SELECT v.* FROM card_memory_versions v JOIN card_memory_heads h ON h.memory_id=v.id AND h.user_id=v.user_id WHERE h.plant_id=? AND h.user_id=?',plantId,s.user.id);
 if(!row)return null;const snapshot=JSON.parse(row.source_snapshot),current=await revision(s);delete row.source_snapshot;
 return {...row,content:JSON.parse(row.content),source_refs:snapshot.map(x=>({type:x.type,id:x.record.id})),...(includeSources?{source_snapshot:snapshot}:{}),derived:true,current_revision:current,stale:!!row.restored_from||current!==row.committed_revision,staleness_scope:'account-wide conservative revision',warning:row.restored_from?'Restored older representation: does not cover later events. Always read recent records.':'Derived memory is not proof of current state; read newer observations and active cases.'};
}
export const structure=groupStructure;
export function missingNames(data){return data.plants.filter(x=>!clean(x.display_name)).map(({id})=>({id,type:'plant'}));}
function guard(s,expected,id){return s.stmt('INSERT INTO gardening_assertions(id,valid) VALUES(?,(SELECT revision=? FROM gardening_revisions WHERE user_id=?))',id,expected,s.user.id);}
async function batch(s,statements){try{return await s.db.batch(statements);}catch(e){if(/gardening_assertions|valid=1/.test(String(e.message)))assert(false,'GARDENING_CONFLICT','History or structure changed. Inspect and prepare a new plan.',409);throw e;}}
async function storedPlan(s,id,kind){assert(id,'PLAN_REQUIRED','Supply a saved plan ID.');const p=await s.first('SELECT * FROM gardening_plans WHERE id=? AND user_id=? AND kind=?',id,s.user.id,kind);assert(p,'NOT_FOUND','Gardening plan not found.',404);if(p.status==='PREPARED')assert(JSON.parse(p.payload).model_version===2,'MODEL_CHANGED','Collection model changed; inspect and prepare a new plan.',409);return p;}
function planView(p){const payload=typeof p.payload==='string'?JSON.parse(p.payload):structuredClone(p.payload);delete payload.source_snapshot;delete payload.before_structure;return {id:p.id,kind:p.kind,plant_id:p.plant_id,base_revision:p.base_revision,status:p.status,created_at:p.created_at,applied_at:p.applied_at,payload};}
async function replayPlan(s,a,kind){if(!a.plan_id)return null;const old=await s.first('SELECT * FROM gardening_plans WHERE id=? AND user_id=?',a.plan_id,s.user.id);if(!old)return null;assert(JSON.parse(old.payload).model_version===2,'MODEL_CHANGED','Inspect and prepare a new plan.',409);assert(old.request_payload===JSON.stringify(a)&&old.kind===kind,'IDEMPOTENCY_CONFLICT','Plan ID already used for different content.',409);return {plan:planView(old),already_prepared:true};}
async function savePlan(s,a,kind,payload,plantId=null){
 payload={...payload,model_version:2};
 const request=JSON.stringify(a),old=await s.first('SELECT * FROM gardening_plans WHERE id=? AND user_id=?',a.plan_id,s.user.id);
 if(old){assert(old.request_payload===request&&old.kind===kind,'IDEMPOTENCY_CONFLICT','Plan ID already used for different content.',409);return {plan:planView(old),already_prepared:true};}
 assert(a.expected_revision===await revision(s),'GARDENING_CONFLICT','Inspect again: data changed.',409);
 await s.run('INSERT INTO gardening_plans(id,user_id,kind,plant_id,base_revision,payload,request_payload,created_at) VALUES(?,?,?,?,?,?,?,?)',a.plan_id,s.user.id,kind,plantId,a.expected_revision,JSON.stringify(payload),request,now());
 return {plan:planView({id:a.plan_id,kind,plant_id:plantId,base_revision:a.expected_revision,payload,status:'PREPARED'}),next:'Show the exact proposal; apply only after user agreement.'};
}
async function nameStatements(s,names,data){
 const seen=new Set(),ops=[];
 for(const n of names||[]){assert(clean(n.display_name),'NAME_REQUIRED','Names cannot be blank.');const key=n.type+':'+n.id;assert(!seen.has(key),'DUPLICATE_NAME','Name target repeated.');seen.add(key);
 assert(n.type==='plant','MODEL_CHANGED','Only card names remain; reread the collection.');const row=data.plants.find(x=>x.id===n.id);assert(row,'NOT_FOUND','Name target not found.',404);
 ops.push(s.stmt('UPDATE plants SET display_name=?,updated_at=?,version=version+1,name_confirmed=1 WHERE id=? AND user_id=? AND deleting=0',n.display_name.trim(),now(),n.id,s.user.id));}
 return ops;
}
async function inspectCard(s,plantId){
 const start=await revision(s),plant=await s.get('plant',plantId),counts={};for(const type of historyTypes)counts[type]=(await s.first(`SELECT count(*) AS n FROM ${TABLES[type]} WHERE user_id=? AND plant_id=?`,s.user.id,plantId)).n;
 const data=await structure(s),link=data.memberships.find(x=>x.plant_id===plantId),scope={plants:data.plants.filter(x=>x.id===plantId||x.id===link?.group_id)},current=await memory(s,plantId);
 assert(start===await revision(s),'GARDENING_CONFLICT','Data changed during inspection. Retry.',409);return {revision:start,plant,counts,current_memory:current,naming_scope:scope,missing_names:missingNames(scope),history_instruction:'Read relevant history through list_records pagination, including older pages. Sources remain intact. Never claim a partial read is a complete review.'};
}
async function validateMemory(s,plantId,content){
 assert(content.length>0,'EMPTY_MEMORY','Provide concise sourced memory.');const sources=new Map();
 for(const statement of content){assert(clean(statement.text)&&statement.sources.length>0,'SOURCE_REQUIRED','Every statement needs sources.');for(const ref of statement.sources){const key=ref.type+':'+ref.id;if(sources.has(key))continue;const row=await s.get(ref.type,ref.id);assert((ref.type==='plant'?row.id:row.plant_id)===plantId,'WRONG_PLANT','Memory sources must belong to this card.',409);sources.set(key,{type:ref.type,record:row});}}
 const snapshot=Array.from(sources.values());assert(snapshot.length<=100&&JSON.stringify(snapshot).length<=200000,'MEMORY_TOO_LARGE','Split memory work into a smaller sourced summary.');return snapshot;
}
export async function gardeningCard(s,a){
 if(a.action==='plan'){const p=await storedPlan(s,a.plan_id,'card');assert(p.plant_id===a.plant_id,'WRONG_PLANT','Plan belongs to another card.');return {plan:planView(p)};}
 if(a.action==='version'){await s.get('plant',a.plant_id);assert(a.memory_id,'MEMORY_REQUIRED','Supply a memory version ID.');const m=await memory(s,a.plant_id,a.memory_id,true);assert(m,'NOT_FOUND','Memory version not found.',404);return {memory:m};}
 if(a.action==='inspect')return inspectCard(s,a.plant_id);
 if(a.action==='versions'){await s.get('plant',a.plant_id);const limit=a.limit||20,offset=a.offset||0,rows=await s.all('SELECT id,source_revision,created_at,restored_from FROM card_memory_versions WHERE plant_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',a.plant_id,s.user.id,limit+1,offset);return {versions:rows.slice(0,limit),next_offset:rows.length>limit?offset+limit:null};}
 if(['prepare','prepare_restore'].includes(a.action)){
 const replay=await replayPlan(s,a,'card');if(replay)return replay;
 assert(a.plan_id&&Number.isInteger(a.expected_revision),'PLAN_REQUIRED','Supply plan ID and inspected revision.');
 const inspected=await inspectCard(s,a.plant_id);await nameStatements(s,a.names||[],inspected.naming_scope);
 let content=a.content,restored_from,source_snapshot,original_source_revision=a.expected_revision;
 if(a.action==='prepare_restore'){assert(a.memory_id,'MEMORY_REQUIRED','Supply a saved memory version ID.');const old=await s.first('SELECT * FROM card_memory_versions WHERE id=? AND plant_id=? AND user_id=?',a.memory_id,a.plant_id,s.user.id);assert(old,'NOT_FOUND','Memory version not found.',404);content=JSON.parse(old.content);restored_from=old.id;source_snapshot=JSON.parse(old.source_snapshot);original_source_revision=old.original_source_revision;}
 assert(content,'PLAN_REQUIRED','Supply sourced content.');const sources=await validateMemory(s,a.plant_id,content);return savePlan(s,a,'card',{content,names:a.names||[],source_snapshot:source_snapshot||sources,original_source_revision,...(restored_from?{restored_from}:{})},a.plant_id);
 }
 assert(a.action==='apply','BAD_ACTION','Unknown gardening action.');assert(a.user_confirmed===true,'CONSENT_REQUIRED','Apply only the exact user-approved proposal.');const plan=await storedPlan(s,a.plan_id,'card');assert(plan.plant_id===a.plant_id,'WRONG_PLANT','Plan belongs to another card.');
 if(plan.status==='APPLIED')return {already_applied:true,memory:await memory(s,a.plant_id,plan.id)};
 assert(Date.now()-Date.parse(plan.created_at)<86400000,'PLAN_EXPIRED','Inspect and prepare again; proposal expired.');const payload=JSON.parse(plan.payload),inspection=await inspectCard(s,a.plant_id),stamp=now();
 await batch(s,[guard(s,plan.base_revision,plan.id),...await nameStatements(s,payload.names,inspection.naming_scope),s.stmt('INSERT INTO card_memory_versions(id,user_id,plant_id,content,source_revision,created_at,restored_from,source_snapshot,original_source_revision) VALUES(?,?,?,?,?,?,?,?,?)',plan.id,s.user.id,a.plant_id,JSON.stringify(payload.content),plan.base_revision,stamp,payload.restored_from||null,JSON.stringify(payload.source_snapshot),payload.original_source_revision),s.stmt('INSERT INTO card_memory_heads(plant_id,user_id,memory_id) VALUES(?,?,?) ON CONFLICT(plant_id) DO UPDATE SET memory_id=excluded.memory_id WHERE card_memory_heads.user_id=excluded.user_id',a.plant_id,s.user.id,plan.id),s.stmt('UPDATE card_memory_versions SET committed_revision=(SELECT revision FROM gardening_revisions WHERE user_id=?) WHERE id=? AND user_id=?',s.user.id,plan.id,s.user.id),s.stmt("UPDATE gardening_plans SET status='APPLIED',applied_at=? WHERE id=? AND user_id=?",stamp,plan.id,s.user.id),s.stmt('DELETE FROM gardening_assertions WHERE id=?',plan.id)]);
 return {applied:true,memory:await memory(s,a.plant_id),source_history_preserved:true};
}
export async function gardeningStructure(s,a){
 if(a.action==='plan')return {plan:planView(await storedPlan(s,a.plan_id,'structure'))};
 if(a.action==='inspect'){const rev=await revision(s),data=await structure(s);assert(rev===await revision(s),'GARDENING_CONFLICT','Retry inspection.',409);return {revision:rev,structure:data,missing_names:missingNames(data)};}
 if(a.action==='prepare'){
 const replay=await replayPlan(s,a,'structure');if(replay)return replay;
 assert(a.plan_id&&Number.isInteger(a.expected_revision),'PLAN_REQUIRED','Supply plan ID and inspected revision.');
 const data=await structure(s);await nameStatements(s,a.names||[],data);structureStatements(s,data,a.assignments||[],a.type_changes||[]);
 return savePlan(s,a,'structure',{assignments:a.assignments||[],type_changes:a.type_changes||[],names:a.names||[],agreed_understanding:a.agreed_understanding||''});
 }
 assert(a.action==='apply','BAD_ACTION','Unknown gardening action.');assert(a.user_confirmed===true,'CONSENT_REQUIRED','Apply the exact agreed proposal.');const plan=await storedPlan(s,a.plan_id,'structure');if(plan.status==='APPLIED')return {already_applied:true,structure:await structure(s)};
 assert(Date.now()-Date.parse(plan.created_at)<86400000,'PLAN_EXPIRED','Inspect and prepare again; proposal expired.');const payload=JSON.parse(plan.payload),data=await structure(s),ops=[guard(s,plan.base_revision,plan.id),...await nameStatements(s,payload.names,data),...structureStatements(s,data,payload.assignments,payload.type_changes)];
 ops.push(s.stmt("UPDATE gardening_plans SET status='APPLIED',applied_at=? WHERE id=? AND user_id=?",now(),plan.id,s.user.id),s.stmt('DELETE FROM gardening_assertions WHERE id=?',plan.id));await batch(s,ops);return {applied:true,structure:await structure(s),source_history_preserved:true};
}
