/** Maintains paired collections and reversible memory through reviewed plans.
 * Contract: inspect → prepare → confirm exact plan → apply; never rewrite sources.
 * Account revision guards reject concurrent changes. See docs/specs/gardening.md.
 */
import {assert,now,uid} from './lib.js';
import {TABLES} from './db.js';
const historyTypes=['observation','issue','hypothesis','experiment','followup','journal','photo','input'];
const clean=v=>typeof v==='string'&&v.trim().length>0;
export async function revision(s){return (await s.first('SELECT revision FROM gardening_revisions WHERE user_id=?',s.user.id)).revision;}
export async function memory(s,plantId,versionId=null,includeSources=false){
 const row=versionId?await s.first('SELECT * FROM card_memory_versions WHERE id=? AND plant_id=? AND user_id=?',versionId,plantId,s.user.id):await s.first('SELECT v.* FROM card_memory_versions v JOIN card_memory_heads h ON h.memory_id=v.id AND h.user_id=v.user_id WHERE h.plant_id=? AND h.user_id=?',plantId,s.user.id);
 if(!row)return null;const snapshot=JSON.parse(row.source_snapshot),current=await revision(s);delete row.source_snapshot;
 return {...row,content:JSON.parse(row.content),source_refs:snapshot.map(x=>({type:x.type,id:x.record.id})),...(includeSources?{source_snapshot:snapshot}:{}),derived:true,current_revision:current,stale:!!row.restored_from||current!==row.committed_revision,staleness_scope:'account-wide conservative revision',warning:row.restored_from?'Restored older representation: does not cover later events. Always read recent records.':'Derived memory is not proof of current state; read newer observations and active cases.'};
}
export async function structure(s){
 const plants=await s.all('SELECT id,display_name,kind,version FROM plants WHERE user_id=? AND deleting=0 ORDER BY id LIMIT 501',s.user.id),zones=await s.all('SELECT * FROM zones WHERE user_id=? ORDER BY id LIMIT 501',s.user.id);
 assert(plants.length<=500&&zones.length<=500,'COLLECTION_TOO_LARGE','Never optimize a truncated structure.');
 return {plants,zones,pairs:await s.all('SELECT zone_id,group_id FROM collection_pairs WHERE user_id=? ORDER BY zone_id',s.user.id),locations:await s.all('SELECT plant_id,zone_id FROM plant_zones WHERE user_id=? ORDER BY plant_id',s.user.id)};
}
export function missingNames(data){return [...data.plants.map(p=>({...p,type:'plant'})),...data.zones.map(z=>({...z,type:'zone'}))].filter(x=>!clean(x.display_name)).map(({id,type})=>({id,type}));}
function guard(s,expected,id){return s.stmt('INSERT INTO gardening_assertions(id,valid) VALUES(?,(SELECT revision=? FROM gardening_revisions WHERE user_id=?))',id,expected,s.user.id);}
async function batch(s,statements){try{return await s.db.batch(statements);}catch(e){if(/gardening_assertions|valid=1/.test(String(e.message)))assert(false,'GARDENING_CONFLICT','History or structure changed. Inspect and prepare a new plan.',409);throw e;}}
async function storedPlan(s,id,kind){assert(id,'PLAN_REQUIRED','Supply a saved plan ID.');const p=await s.first('SELECT * FROM gardening_plans WHERE id=? AND user_id=? AND kind=?',id,s.user.id,kind);assert(p,'NOT_FOUND','Gardening plan not found.',404);return p;}
function planView(p){const payload=typeof p.payload==='string'?JSON.parse(p.payload):structuredClone(p.payload);delete payload.source_snapshot;delete payload.before_structure;return {id:p.id,kind:p.kind,plant_id:p.plant_id,base_revision:p.base_revision,status:p.status,created_at:p.created_at,applied_at:p.applied_at,payload};}
async function replayPlan(s,a,kind){if(!a.plan_id)return null;const old=await s.first('SELECT * FROM gardening_plans WHERE id=? AND user_id=?',a.plan_id,s.user.id);if(!old)return null;assert(old.request_payload===JSON.stringify(a)&&old.kind===kind,'IDEMPOTENCY_CONFLICT','Plan ID already used for different content.',409);return {plan:planView(old),already_prepared:true};}
async function savePlan(s,a,kind,payload,plantId=null){
 const request=JSON.stringify(a),old=await s.first('SELECT * FROM gardening_plans WHERE id=? AND user_id=?',a.plan_id,s.user.id);
 if(old){assert(old.request_payload===request&&old.kind===kind,'IDEMPOTENCY_CONFLICT','Plan ID already used for different content.',409);return {plan:planView(old),already_prepared:true};}
 assert(a.expected_revision===await revision(s),'GARDENING_CONFLICT','Inspect again: data changed.',409);
 await s.run('INSERT INTO gardening_plans(id,user_id,kind,plant_id,base_revision,payload,request_payload,created_at) VALUES(?,?,?,?,?,?,?,?)',a.plan_id,s.user.id,kind,plantId,a.expected_revision,JSON.stringify(payload),request,now());
 return {plan:planView({id:a.plan_id,kind,plant_id:plantId,base_revision:a.expected_revision,payload,status:'PREPARED'}),next:'Show the exact proposal; apply only after user agreement.'};
}
async function nameStatements(s,names,data){
 const seen=new Set(),ops=[];
 for(const n of names||[]){assert(clean(n.display_name),'NAME_REQUIRED','Names cannot be blank.');const key=n.type+':'+n.id;assert(!seen.has(key),'DUPLICATE_NAME','Name target repeated.');seen.add(key);
 const row=(n.type==='plant'?data.plants:data.zones).find(x=>x.id===n.id);assert(row,'NOT_FOUND','Name target not found.',404);assert(!clean(row.display_name),'NAME_EXISTS','Preserve existing names; explicit renaming uses the naming tool.');
 ops.push(s.stmt(`UPDATE ${TABLES[n.type]} SET display_name=?,updated_at=?,version=version+1${n.type==='plant'?',name_confirmed=1':''} WHERE id=? AND user_id=?`,n.display_name.trim(),now(),n.id,s.user.id));}
 for(const n of missingNames(data))assert(seen.has(n.type+':'+n.id),'NAME_REQUIRED','Propose names for unnamed entities and obtain agreement.');return ops;
}
function validatePair(data,a){
 assert(clean(a.display_name),'NAME_REQUIRED','A collection needs a user-supplied or accepted name.');
 const zone=data.zones.find(x=>x.id===a.zone_id),group=data.plants.find(x=>x.id===a.group_id);if(group)assert(group.kind==='group','NOT_GROUP','Only a group card can pair with a zone.');
 assert(!data.locations.some(l=>l.zone_id===a.zone_id&&l.plant_id!==a.group_id&&data.plants.some(p=>p.id===l.plant_id&&p.kind==='group')),'PAIR_CONFLICT','This zone already contains another group; resolve the ambiguity before pairing.');
 assert(!data.pairs.some(p=>(p.zone_id===a.zone_id&&p.group_id!==a.group_id)||(p.group_id===a.group_id&&p.zone_id!==a.zone_id)),'PAIR_CONFLICT','One zone pairs with one group in this release.');
 assert(!data.zones.some(z=>z.id!==a.zone_id&&z.display_name===a.display_name),'NAME_CONFLICT','Reuse the existing zone instead of duplicating it.');
 assert(!data.plants.some(p=>p.id!==a.group_id&&p.display_name===a.display_name),'NAME_CONFLICT','Reuse the existing group instead of duplicating it.');return {zone,group};
}
function locationStatement(s,plantId,zoneId){return s.stmt('INSERT INTO plant_zones(plant_id,user_id,zone_id) VALUES(?,?,?) ON CONFLICT(plant_id) DO UPDATE SET zone_id=excluded.zone_id WHERE plant_zones.user_id=excluded.user_id',plantId,s.user.id,zoneId);}
function pairStatements(s,a,data){
 const {zone,group}=validatePair(data,a),stamp=now(),ops=[];
 if(!zone)ops.push(s.stmt('INSERT INTO zones(id,user_id,display_name,description,created_at,updated_at) VALUES(?,?,?,?,?,?)',a.zone_id,s.user.id,a.display_name,a.description||'',stamp,stamp));
 if(!group)ops.push(s.stmt("INSERT INTO plants(id,user_id,display_name,name_source,name_confirmed,kind,profile,created_at,updated_at) VALUES(?,?,?,'user',1,'group',?,?,?)",a.group_id,s.user.id,a.display_name,a.description||'',stamp,stamp));
 ops.push(s.stmt('INSERT INTO collection_pairs(user_id,zone_id,group_id) VALUES(?,?,?) ON CONFLICT(zone_id) DO NOTHING',s.user.id,a.zone_id,a.group_id),locationStatement(s,a.group_id,a.zone_id));return ops;
}
function addPreview(data,p){if(!data.zones.some(x=>x.id===p.zone_id))data.zones.push({id:p.zone_id,display_name:p.display_name});if(!data.plants.some(x=>x.id===p.group_id))data.plants.push({id:p.group_id,display_name:p.display_name,kind:'group'});if(!data.pairs.some(x=>x.zone_id===p.zone_id))data.pairs.push({zone_id:p.zone_id,group_id:p.group_id});}
export async function createCollection(s,a){
 assert(a.user_confirmed===true,'CONSENT_REQUIRED','Use a user-described collection or explicitly accepted name.');const rev=await revision(s),data=await structure(s),existing=data.pairs.find(p=>p.zone_id===a.zone_id&&p.group_id===a.group_id);
 if(existing){const request=await s.first('SELECT request_payload FROM collection_create_requests WHERE zone_id=? AND user_id=?',a.zone_id,s.user.id);assert(request&&request.request_payload===JSON.stringify(a),'IDEMPOTENCY_CONFLICT','Existing pair was created with different input; read it instead.',409);return {pair:existing,already_created:true};}
 assert(!data.zones.some(x=>x.id===a.zone_id)&&!data.plants.some(x=>x.id===a.group_id),'STRUCTURE_REVIEW_REQUIRED','Pair existing entities through gardening_structure after questions and agreement.');
 const id=uid();await batch(s,[guard(s,rev,id),...pairStatements(s,a,data),s.stmt('INSERT INTO collection_create_requests(zone_id,user_id,request_payload) VALUES(?,?,?)',a.zone_id,s.user.id,JSON.stringify(a)),s.stmt('DELETE FROM gardening_assertions WHERE id=?',id)]);return {pair:{zone_id:a.zone_id,group_id:a.group_id},structure:await structure(s)};
}
async function inspectCard(s,plantId){
 const start=await revision(s),plant=await s.get('plant',plantId),counts={};for(const type of historyTypes)counts[type]=(await s.first(`SELECT count(*) AS n FROM ${TABLES[type]} WHERE user_id=? AND plant_id=?`,s.user.id,plantId)).n;
 const data=await structure(s),loc=data.locations.find(x=>x.plant_id===plantId),pair=loc&&data.pairs.find(x=>x.zone_id===loc.zone_id),scope={plants:data.plants.filter(x=>x.id===plantId||x.id===pair?.group_id),zones:data.zones.filter(x=>x.id===loc?.zone_id)},current=await memory(s,plantId);
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
 assert(a.user_consented===true&&a.names_reviewed===true,'CONSENT_REQUIRED','Obtain gardening consent and review names first.');assert(a.plan_id&&Number.isInteger(a.expected_revision),'PLAN_REQUIRED','Supply plan ID and inspected revision.');
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
 if(a.action==='inspect'){const rev=await revision(s),data=await structure(s);assert(rev===await revision(s),'GARDENING_CONFLICT','Retry inspection.',409);return {revision:rev,structure:data,missing_names:missingNames(data),workflow:'Offer optimization; after consent ask 1–2 main questions, confirm assumptions and names, prepare exact proposal, then apply after agreement.'};}
 if(a.action==='prepare'){
 const replay=await replayPlan(s,a,'structure');if(replay)return replay;
 assert(a.user_consented===true&&a.names_reviewed===true&&a.assumptions_confirmed===true,'CONSENT_REQUIRED','Ask 1–2 questions, resolve assumptions, and review names first.');assert(a.answers?.length>=1&&a.answers.length<=2,'QUESTIONS_REQUIRED','Record answers to 1–2 main questions.');assert(a.plan_id&&Number.isInteger(a.expected_revision)&&a.pairs&&a.assignments&&clean(a.agreed_understanding),'PLAN_REQUIRED','Supply ID, revision, pairs, assignments and agreed understanding.');
 const data=await structure(s),preview=structuredClone(data);await nameStatements(s,a.names||[],data);for(const p of a.pairs){validatePair(preview,p);addPreview(preview,p);}
 const seen=new Set();for(const p of a.assignments){assert(!seen.has(p.plant_id),'DUPLICATE_ASSIGNMENT','Assign each card once.');seen.add(p.plant_id);assert(preview.plants.some(x=>x.id===p.plant_id),'NOT_FOUND','Assigned card not found.',404);assert(preview.pairs.some(x=>x.zone_id===p.zone_id),'PAIR_REQUIRED','Assign to a paired collection.');const targetPair=preview.pairs.find(x=>x.zone_id===p.zone_id),card=preview.plants.find(x=>x.id===p.plant_id);assert(card.kind!=='group'||targetPair.group_id===card.id,'PAIR_CONFLICT','Only the paired group can occupy this zone.');const ownPair=preview.pairs.find(x=>x.group_id===p.plant_id);assert(!ownPair||ownPair.zone_id===p.zone_id,'PAIR_CONFLICT','Paired group stays in its own zone.');}
 return savePlan(s,a,'structure',{before_structure:data,pairs:a.pairs,assignments:a.assignments,names:a.names||[],answers:a.answers,agreed_understanding:a.agreed_understanding});
 }
 assert(a.action==='apply','BAD_ACTION','Unknown gardening action.');assert(a.user_confirmed===true,'CONSENT_REQUIRED','Apply only after user accepts this exact proposal.');const plan=await storedPlan(s,a.plan_id,'structure');if(plan.status==='APPLIED')return {already_applied:true,structure:await structure(s)};
 assert(Date.now()-Date.parse(plan.created_at)<86400000,'PLAN_EXPIRED','Inspect and prepare again; proposal expired.');const payload=JSON.parse(plan.payload),data=await structure(s),ops=[guard(s,plan.base_revision,plan.id),...await nameStatements(s,payload.names,data)];
 for(const p of payload.pairs){ops.push(...pairStatements(s,p,data));addPreview(data,p);}for(const p of payload.assignments)ops.push(locationStatement(s,p.plant_id,p.zone_id));
 ops.push(s.stmt("UPDATE gardening_plans SET status='APPLIED',applied_at=? WHERE id=? AND user_id=?",now(),plan.id,s.user.id),s.stmt('DELETE FROM gardening_assertions WHERE id=?',plan.id));await batch(s,ops);return {applied:true,structure:await structure(s),source_history_preserved:true};
}
