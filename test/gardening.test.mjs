/** Contract checks for consent, source preservation and transactional gardening. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,plant,tool} from './helpers.mjs';
import {uid,after} from '../src/lib.js';
import {toolDefinitions} from '../src/tools.js';
import {mcpResponse} from '../src/mcp.js';

const pair=(name='Полка')=>({zone_id:uid(),group_id:uid(),display_name:name,user_confirmed:true});
const fact=(p,text='Листья скручиваются')=>({kind:'current_fact',text,sources:[{type:'plant',id:p.id}]});
async function count(s,table){return (await s.first(`SELECT count(*) AS n FROM ${table} WHERE user_id=?`,s.user.id)).n;}
async function prepareCard(s,p,extra={}){const inspect=await tool(s,'gardening_card',{action:'inspect',plant_id:p.id});const args={action:'prepare',plant_id:p.id,plan_id:uid(),expected_revision:inspect.revision,user_consented:true,names_reviewed:true,content:[fact(p)],...extra};return {args,result:await tool(s,'gardening_card',args)};}
async function prepareStructure(s,extra={}){const inspect=await tool(s,'gardening_structure',{action:'inspect'});const args={action:'prepare',plan_id:uid(),expected_revision:inspect.revision,user_consented:true,names_reviewed:true,assumptions_confirmed:true,answers:[{question:'Что находится на полке?',answer:'Лимон.'}],agreed_understanding:'Лимон находится на полке.',pairs:[],assignments:[],...extra};return {args,result:await tool(s,'gardening_structure',args)};}
const applyCard=(s,args,extra={})=>tool(s,'gardening_card',{action:'apply',plant_id:args.plant_id,plan_id:args.plan_id,user_confirmed:true,...extra});
const applyStructure=(s,args,extra={})=>tool(s,'gardening_structure',{action:'apply',plan_id:args.plan_id,user_confirmed:true,...extra});

test('paired collection creates zone and group together, replays, scopes accounts',async()=>{const f=await fixture();try{
 const a=pair();const r=await tool(f.store,'create_collection',a);assert.deepEqual(r.pair,{zone_id:a.zone_id,group_id:a.group_id});
 assert.equal(await count(f.store,'zones'),1);assert.equal(await count(f.store,'plants'),1);assert.equal(await count(f.store,'collection_pairs'),1);
 assert.equal((await f.store.get('plant',a.group_id)).kind,'group');
 assert.equal((await tool(f.store,'create_collection',a)).already_created,true);
 assert.equal(await count(f.store,'plants'),1);assert.equal((await tool(f.otherStore,'gardening_structure',{action:'inspect'})).structure.plants.length,0);
 await assert.rejects(tool(f.store,'create_collection',{...pair('Другое'),user_confirmed:false}),{code:'CONSENT_REQUIRED'});
}finally{f.close();}});

test('paired collection idempotency rejects changed content',async()=>{const f=await fixture();try{
 const a={...pair(),description:'Верхняя полка'};await tool(f.store,'create_collection',a);
 await assert.rejects(tool(f.store,'create_collection',{...a,description:'Нижняя полка'}),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(tool(f.store,'create_collection',{...a,display_name:'Другие растения'}),{code:'IDEMPOTENCY_CONFLICT'});
}finally{f.close();}});

test('name conflicts and foreign pair IDs never leave partial collection records',async()=>{const f=await fixture();try{
 const first=pair();await tool(f.store,'create_collection',first);
 await assert.rejects(tool(f.store,'create_collection',pair()),{code:'NAME_CONFLICT'});
 const own=pair('Чужая полка');await tool(f.otherStore,'create_collection',own);
 const attempt={...pair('Новая полка'),group_id:own.group_id};
 await assert.rejects(tool(f.store,'create_collection',attempt));
 assert.equal(await count(f.store,'zones'),1);assert.equal(await count(f.store,'collection_pairs'),1);
 assert.equal(await f.store.first('SELECT * FROM zones WHERE id=?',attempt.zone_id),null);
 assert.equal(await f.store.first('SELECT * FROM gardening_assertions'),null);
}finally{f.close();}});

test('pair cannot use plant as group or move its group to another zone',async()=>{const f=await fixture();try{
 const p=await plant(f.store);await assert.rejects(tool(f.store,'create_collection',{...pair(),group_id:p.id}),{code:'STRUCTURE_REVIEW_REQUIRED'});
 const a=pair('Верхняя'),b=pair('Нижняя');await tool(f.store,'create_collection',a);await tool(f.store,'create_collection',b);
 await assert.rejects(tool(f.store,'assign_plant_zone',{plant_id:a.group_id,zone_id:b.zone_id}),{code:'PAIR_CONFLICT'});
 await assert.rejects(tool(f.store,'assign_plant_zone',{plant_id:a.group_id,clear:true}),{code:'PAIR_CONFLICT'});
}finally{f.close();}});

test('structure optimization requires consent, reviewed names, assumptions and 1–2 answers',async()=>{const f=await fixture();try{
 const inspect=await tool(f.store,'gardening_structure',{action:'inspect'}),base={action:'prepare',plan_id:uid(),expected_revision:inspect.revision,pairs:[],assignments:[],agreed_understanding:'Пустая коллекция',answers:[{question:'Что есть?',answer:'Ничего'}],user_consented:true,names_reviewed:true,assumptions_confirmed:true};
 for(const key of ['user_consented','names_reviewed','assumptions_confirmed'])await assert.rejects(tool(f.store,'gardening_structure',{...base,[key]:false}),{code:'CONSENT_REQUIRED'});
 await assert.rejects(tool(f.store,'gardening_structure',{...base,answers:[]}),{code:'QUESTIONS_REQUIRED'});
 await assert.rejects(tool(f.store,'gardening_structure',{...base,answers:Array(3).fill(base.answers[0])}),{code:'VALIDATION'});
 assert.equal(await count(f.store,'gardening_plans'),0);
}finally{f.close();}});

test('structure preview does not mutate; apply reuses legacy group and keeps observations',async()=>{const f=await fixture();try{
 const legacy=(await tool(f.store,'create_plant',{id:uid(),display_name:'Полка',kind:'group',name_source:'user',name_confirmed:true})).plant,p=await plant(f.store,'Лимон');
 const observation=(await tool(f.store,'add_observation',{id:uid(),plant_id:legacy.id,source:'user',text:'На полке три растения.'})).observation;
 const a={zone_id:uid(),group_id:legacy.id,display_name:'Полка'};
 const {args,result}=await prepareStructure(f.store,{pairs:[a],assignments:[{plant_id:p.id,zone_id:a.zone_id}]});
 assert.equal(result.plan.status,'PREPARED');assert.equal(await count(f.store,'zones'),0);
 await assert.rejects(applyStructure(f.store,args,{user_confirmed:false}),{code:'CONSENT_REQUIRED'});
 const applied=await applyStructure(f.store,args);assert.equal(applied.applied,true);assert.equal(applied.source_history_preserved,true);
 assert.equal(await count(f.store,'plants'),2);assert.equal((await f.store.get('observation',observation.id)).plant_id,legacy.id);
 assert.ok(applied.structure.locations.some(x=>x.plant_id===p.id&&x.zone_id===a.zone_id));
 assert.equal((await applyStructure(f.store,args)).already_applied,true);assert.equal(await count(f.store,'collection_pairs'),1);
}finally{f.close();}});

test('structure plan is immutable and only stored operations apply',async()=>{const f=await fixture();try{
 const a={zone_id:uid(),group_id:uid(),display_name:'Полка'},b={zone_id:uid(),group_id:uid(),display_name:'Балкон'};
 const {args}=await prepareStructure(f.store,{pairs:[a]});
 assert.equal((await tool(f.store,'gardening_structure',args)).already_prepared,true);
 await assert.rejects(tool(f.store,'gardening_structure',{...args,pairs:[b]}),{code:'IDEMPOTENCY_CONFLICT'});
 await applyStructure(f.store,args,{pairs:[b]});
 assert.equal((await f.store.get('zone',a.zone_id)).display_name,'Полка');await assert.rejects(f.store.get('zone',b.zone_id),{code:'NOT_FOUND'});
}finally{f.close();}});

test('structure changed after review rejects entire plan; foreign plans stay private',async()=>{const f=await fixture();try{
 const a={zone_id:uid(),group_id:uid(),display_name:'Полка'},{args}=await prepareStructure(f.store,{pairs:[a]});
 await plant(f.store,'Новый лимон');
 await assert.rejects(applyStructure(f.store,args),{code:'GARDENING_CONFLICT'});assert.equal(await count(f.store,'zones'),0);
 assert.equal((await f.store.first('SELECT status FROM gardening_plans WHERE id=?',args.plan_id)).status,'PREPARED');
 await assert.rejects(applyStructure(f.otherStore,args),{code:'NOT_FOUND'});
}finally{f.close();}});

test('structure prevents duplicate or cross-zone group assignments',async()=>{const f=await fixture();try{
 const a=pair('Верхняя'),b=pair('Нижняя');await tool(f.store,'create_collection',a);await tool(f.store,'create_collection',b);const p=await plant(f.store);
 await assert.rejects(prepareStructure(f.store,{assignments:[{plant_id:p.id,zone_id:a.zone_id},{plant_id:p.id,zone_id:b.zone_id}]}),{code:'DUPLICATE_ASSIGNMENT'});
 await assert.rejects(prepareStructure(f.store,{assignments:[{plant_id:a.group_id,zone_id:b.zone_id}]}),{code:'PAIR_CONFLICT'});
 const foreign=await plant(f.otherStore);
 await assert.rejects(prepareStructure(f.store,{assignments:[{plant_id:foreign.id,zone_id:a.zone_id}]}),{code:'NOT_FOUND'});
}finally{f.close();}});

test('transaction failure during structure apply rolls back newly created zone and status',async()=>{const f=await fixture();try{
 const foreign=await plant(f.otherStore,'Чужой');const a={zone_id:uid(),group_id:foreign.id,display_name:'Полка'};
 const {args}=await prepareStructure(f.store,{pairs:[a]});
 await assert.rejects(applyStructure(f.store,args));
 assert.equal(await count(f.store,'zones'),0);assert.equal(await count(f.store,'collection_pairs'),0);assert.equal(await count(f.store,'plants'),0);
 assert.equal((await f.store.first('SELECT status FROM gardening_plans WHERE id=?',args.plan_id)).status,'PREPARED');assert.equal(await f.store.first('SELECT * FROM gardening_assertions'),null);
}finally{f.close();}});

test('card memory preserves source history, labels and exposes current memory',async()=>{const f=await fixture();try{
 const p=await plant(f.store),o=(await tool(f.store,'add_observation',{id:uid(),plant_id:p.id,source:'user',text:'Листья скручиваются, полив не менял.'})).observation;
 const content=[{kind:'current_fact',text:'Скручивание листьев.',sources:[{type:'observation',id:o.id}]},{kind:'planned_action',text:'Проверить полив; выполнение не подтверждено.',sources:[{type:'observation',id:o.id}]}];
 const {args}=await prepareCard(f.store,p,{content});assert.equal(await count(f.store,'card_memory_versions'),0);
 await assert.rejects(applyCard(f.store,args,{user_confirmed:false}),{code:'CONSENT_REQUIRED'});
 const result=await applyCard(f.store,args);assert.deepEqual(result.memory.content,content);assert.equal(result.source_history_preserved,true);
 assert.equal((await f.store.get('observation',o.id)).text,o.text);assert.equal(await count(f.store,'observations'),1);
 assert.equal((await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.current_memory.id,args.plan_id);
 assert.equal((await applyCard(f.store,args)).already_applied,true);assert.equal(await count(f.store,'card_memory_versions'),1);
}finally{f.close();}});

test('card sources require evidence and reject wrong plant or owner',async()=>{const f=await fixture();try{
 const p=await plant(f.store,'Лимон'),other=await plant(f.store,'Манго'),foreign=await plant(f.otherStore);
 await assert.rejects(prepareCard(f.store,p,{content:[]}),{code:'EMPTY_MEMORY'});
 await assert.rejects(prepareCard(f.store,p,{content:[{kind:'current_fact',text:'Факт',sources:[]}]}),{code:'SOURCE_REQUIRED'});
 await assert.rejects(prepareCard(f.store,p,{content:[fact(other)]}),{code:'WRONG_PLANT'});
 await assert.rejects(prepareCard(f.store,p,{content:[fact(foreign)]}),{code:'NOT_FOUND'});
 await assert.rejects(tool(f.otherStore,'gardening_card',{action:'inspect',plant_id:p.id}),{code:'NOT_FOUND'});
}finally{f.close();}});

test('new observations invalidate prepared memory and keep source plus old memory intact',async()=>{const f=await fixture();try{
 const p=await plant(f.store),{args}=await prepareCard(f.store,p);
 await tool(f.store,'add_observation',{id:uid(),plant_id:p.id,source:'user',text:'Новые пузырьки'});
 await assert.rejects(applyCard(f.store,args),{code:'GARDENING_CONFLICT'});assert.equal(await count(f.store,'card_memory_versions'),0);assert.equal(await count(f.store,'observations'),1);
 assert.equal((await f.store.first('SELECT status FROM gardening_plans WHERE id=?',args.plan_id)).status,'PREPARED');
}finally{f.close();}});

test('parallel memory plans do not overwrite and other users do not invalidate revisions',async()=>{const f=await fixture();try{
 const p=await plant(f.store),first=await prepareCard(f.store,p),second=await prepareCard(f.store,p,{content:[fact(p,'Другой текст')]});
 await plant(f.otherStore);await applyCard(f.store,first.args);
 await assert.rejects(applyCard(f.store,second.args),{code:'GARDENING_CONFLICT'});assert.equal(await count(f.store,'card_memory_versions'),1);
 await assert.rejects(applyCard(f.otherStore,first.args),{code:'NOT_FOUND'});
}finally{f.close();}});

test('restore makes another version, paginates versions, and preserves later observations',async()=>{const f=await fixture();try{
 const p=await plant(f.store),first=await prepareCard(f.store,p);await applyCard(f.store,first.args);
 const second=await prepareCard(f.store,p,{content:[fact(p,'Новые сведения')]});await applyCard(f.store,second.args);
 await tool(f.store,'add_observation',{id:uid(),plant_id:p.id,source:'user',text:'Новая запись после сводки'});
 const inspected=await tool(f.store,'gardening_card',{action:'inspect',plant_id:p.id});const restore={action:'prepare_restore',plant_id:p.id,plan_id:uid(),memory_id:first.args.plan_id,expected_revision:inspected.revision,user_consented:true,names_reviewed:true};
 await tool(f.store,'gardening_card',restore);const result=await applyCard(f.store,restore);assert.equal(result.memory.restored_from,first.args.plan_id);assert.deepEqual(result.memory.content,first.args.content);
 assert.equal(await count(f.store,'card_memory_versions'),3);assert.equal(await count(f.store,'observations'),1);
 const page=await tool(f.store,'gardening_card',{action:'versions',plant_id:p.id,limit:2});assert.equal(page.versions.length,2);assert.equal(page.next_offset,2);
 const last=await tool(f.store,'gardening_card',{action:'versions',plant_id:p.id,limit:2,offset:2});assert.equal(last.versions.length,1);assert.equal(last.next_offset,null);
}finally{f.close();}});

test('both gardening flows review missing names without overwriting existing names',async()=>{const f=await fixture();try{
 const p=await plant(f.store,'   '),collection=pair();await tool(f.store,'create_collection',collection);await tool(f.store,'assign_plant_zone',{plant_id:p.id,zone_id:collection.zone_id});
 await f.store.run('UPDATE zones SET display_name=? WHERE id=?',' ',collection.zone_id);await f.store.run('UPDATE plants SET display_name=? WHERE id=?','  ',collection.group_id);
 const inspected=await tool(f.store,'gardening_card',{action:'inspect',plant_id:p.id});assert.equal(inspected.missing_names.length,3);
 await assert.rejects(prepareCard(f.store,p),{code:'NAME_REQUIRED'});
 const names=[{type:'plant',id:p.id,display_name:'Лимонный барон'},{type:'plant',id:collection.group_id,display_name:'Зелёная команда'},{type:'zone',id:collection.zone_id,display_name:'Солнечная полка'}];
 const {args}=await prepareCard(f.store,p,{names});await applyCard(f.store,args);assert.equal((await f.store.get('plant',p.id)).display_name,'Лимонный барон');
 await assert.rejects(prepareCard(f.store,p,{names:[{type:'plant',id:p.id,display_name:'Не менять'}]}),{code:'NAME_EXISTS'});
 assert.equal((await tool(f.store,'gardening_structure',{action:'inspect'})).missing_names.length,0);
 const unnamed=await plant(f.store,' ');await assert.rejects(prepareStructure(f.store),{code:'NAME_REQUIRED'});
 const structural=await prepareStructure(f.store,{names:[{type:'plant',id:unnamed.id,display_name:'Укропный спецназ'}]});await applyStructure(f.store,structural.args);assert.equal((await f.store.get('plant',unnamed.id)).display_name,'Укропный спецназ');
}finally{f.close();}});

test('expired plans do not mutate',async()=>{const f=await fixture();try{
 const p=await plant(f.store),card=await prepareCard(f.store,p),structure=await prepareStructure(f.store);
 await f.store.run('UPDATE gardening_plans SET created_at=? WHERE user_id=?',after(-2*86400000),f.owner.id);
 await assert.rejects(applyCard(f.store,card.args),{code:'PLAN_EXPIRED'});await assert.rejects(applyStructure(f.store,structure.args),{code:'PLAN_EXPIRED'});
 assert.equal(await count(f.store,'card_memory_versions'),0);
}finally{f.close();}});

test('MCP catalog advertises zones and gardening with model visibility',async()=>{const f=await fixture();try{
 const expected=['create_collection','create_zone','update_zone','assign_plant_zone','gardening_card','gardening_structure','get_capabilities'];
 const definitions=toolDefinitions();for(const name of expected){const def=definitions.find(x=>x.name===name);assert.ok(def,name);assert.ok(def._meta.ui.visibility.includes('model'),name);}
 const request=new Request('http://127.0.0.1:8787/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
 const reply=await (await mcpResponse(request,f.store,uid())).json();for(const name of expected)assert.ok(reply.result.tools.some(t=>t.name===name),name);
}finally{f.close();}});

test('a failed missing-name assignment rolls back all renames and memory writes',async()=>{const f=await fixture();try{
 const p=await plant(f.store,' ');await plant(f.store,'Занято');
 const {args}=await prepareCard(f.store,p,{names:[{type:'plant',id:p.id,display_name:'Занято'}]});
 await assert.rejects(applyCard(f.store,args));assert.equal((await f.store.get('plant',p.id)).display_name,' ');
 assert.equal(await count(f.store,'card_memory_versions'),0);assert.equal((await f.store.first('SELECT status FROM gardening_plans WHERE id=?',args.plan_id)).status,'PREPARED');
}finally{f.close();}});

test('record edits and relocation invalidate prepared memory; empty-name proposals are rejected',async()=>{const f=await fixture();try{
 const p=await plant(f.store),{args}=await prepareCard(f.store,p);
 await tool(f.store,'update_plant',{id:p.id,expected_version:p.version,display_name:p.display_name,profile:'Новые условия'});
 await assert.rejects(applyCard(f.store,args),{code:'GARDENING_CONFLICT'});
 const next=await prepareCard(f.store,p),z=(await tool(f.store,'create_zone',{id:uid(),display_name:'Балкон'})).zone;
 await tool(f.store,'assign_plant_zone',{plant_id:p.id,zone_id:z.id});await assert.rejects(applyCard(f.store,next.args),{code:'GARDENING_CONFLICT'});
 const unnamed=await plant(f.store,' ');await assert.rejects(prepareCard(f.store,unnamed,{names:[{type:'plant',id:unnamed.id,display_name:'  '}]}),{code:'NAME_REQUIRED'});
}finally{f.close();}});

test('memory staleness and restore provenance preserve the originally reviewed source snapshot',async()=>{const f=await fixture();try{
 const p=await plant(f.store),first=await prepareCard(f.store,p),applied=await applyCard(f.store,first.args);
 assert.equal(applied.memory.stale,false);assert.equal(applied.memory.derived,true);assert.equal(applied.memory.original_source_revision,first.args.expected_revision);
 assert.equal(applied.memory.source_snapshot,undefined);const audited=await tool(f.store,'gardening_card',{action:'version',plant_id:p.id,memory_id:first.args.plan_id});const original=structuredClone(audited.memory.source_snapshot);assert.ok(original.length>0);
 await tool(f.store,'update_plant',{id:p.id,expected_version:p.version,display_name:p.display_name,profile:'Переехал на балкон'});
 assert.equal((await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.current_memory.stale,true);
 const inspected=await tool(f.store,'gardening_card',{action:'inspect',plant_id:p.id}),restore={action:'prepare_restore',plant_id:p.id,plan_id:uid(),memory_id:first.args.plan_id,expected_revision:inspected.revision,user_consented:true,names_reviewed:true};
 await tool(f.store,'gardening_card',restore);const restored=await applyCard(f.store,restore);
 const restoredAudit=await tool(f.store,'gardening_card',{action:'version',plant_id:p.id,memory_id:restore.plan_id});assert.deepEqual(restoredAudit.memory.source_snapshot,original);assert.equal(restored.memory.stale,true);assert.equal(restored.memory.original_source_revision,first.args.expected_revision);assert.match(restored.memory.warning,/Restored/);
}finally{f.close();}});

test('pairing existing unpaired entities uses reviewed structure flow only',async()=>{const f=await fixture();try{
 const group=(await tool(f.store,'create_plant',{id:uid(),display_name:'Полка',kind:'group',name_source:'user',name_confirmed:true})).plant;
 const a={...pair(),group_id:group.id};await assert.rejects(tool(f.store,'create_collection',a),{code:'STRUCTURE_REVIEW_REQUIRED'});
 assert.equal(await count(f.store,'zones'),0);
 const {user_confirmed,...planned}=a;const {args}=await prepareStructure(f.store,{pairs:[planned]});await applyStructure(f.store,args);
 assert.equal(await count(f.store,'plants'),1);assert.equal(await count(f.store,'zones'),1);
}finally{f.close();}});

test('cannot assign a second group inside an already paired zone',async()=>{const f=await fixture();try{
 const a=pair();await tool(f.store,'create_collection',a);const second=(await tool(f.store,'create_plant',{id:uid(),display_name:'Другая группа',kind:'group',name_source:'user',name_confirmed:true})).plant;
 await assert.rejects(tool(f.store,'assign_plant_zone',{plant_id:second.id,zone_id:a.zone_id}));
 assert.equal(await f.store.first('SELECT * FROM plant_zones WHERE plant_id=?',second.id),null);
}finally{f.close();}});

test('replaying applied prepare with accepted missing names remains idempotent',async()=>{const f=await fixture();try{
 const p=await plant(f.store,' '),card=await prepareCard(f.store,p,{names:[{type:'plant',id:p.id,display_name:'Лимонный барон'}]});await applyCard(f.store,card.args);
 assert.equal((await tool(f.store,'gardening_card',card.args)).already_prepared,true);
 const q=await plant(f.store,'  '),struct=await prepareStructure(f.store,{names:[{type:'plant',id:q.id,display_name:'Манговый герцог'}]});await applyStructure(f.store,struct.args);
 assert.equal((await tool(f.store,'gardening_structure',struct.args)).already_prepared,true);
 assert.equal(await count(f.store,'card_memory_versions'),1);
}finally{f.close();}});

test('transaction guard catches a change after apply preflight but before batch begins',async()=>{const f=await fixture();try{
 const p=await plant(f.store),{args}=await prepareCard(f.store,p),runBatch=f.env.DB.batch.bind(f.env.DB);let once=true;
 f.env.DB.batch=async statements=>{if(once){once=false;await f.store.run('UPDATE plants SET profile=?,version=version+1 WHERE id=? AND user_id=?','Changed concurrently',p.id,f.owner.id);}return runBatch(statements);};
 await assert.rejects(applyCard(f.store,args),{code:'GARDENING_CONFLICT'});assert.equal(await count(f.store,'card_memory_versions'),0);assert.equal((await f.store.get('plant',p.id)).profile,'Changed concurrently');
 assert.equal(await f.store.first('SELECT * FROM gardening_assertions'),null);
}finally{f.close();}});

test('raw resolved inputs are paginated without leaking another card or account',async()=>{const f=await fixture();try{
 const p=await plant(f.store),q=await plant(f.store,'Манго');
 for(const [target,text] of [[p,'Первое'],[p,'Второе'],[q,'Другое растение']]){const id=uid();await tool(f.store,'record_input',{id,text});await tool(f.store,'resolve_input',{input_id:id,plant_id:target.id,method:'explicit',reason:'Названо пользователем.',user_confirmed:true});}
 const first=await tool(f.store,'list_records',{plant_id:p.id,type:'input',limit:1});assert.equal(first.items.length,1);assert.equal(first.next_offset,1);assert.equal(first.items[0].plant_id,p.id);
 const second=await tool(f.store,'list_records',{plant_id:p.id,type:'input',limit:1,offset:first.next_offset});assert.equal(second.items.length,1);assert.equal(second.next_offset,null);assert.notEqual(first.items[0].id,second.items[0].id);
 await assert.rejects(tool(f.otherStore,'list_records',{plant_id:p.id,type:'input'}),{code:'NOT_FOUND'});
}finally{f.close();}});

test('read-back exposes exact saved proposal but no full source snapshots or raw request payload',async()=>{const f=await fixture();try{
 const p=await plant(f.store),card=await prepareCard(f.store,p),structure=await prepareStructure(f.store);
 const c=await tool(f.store,'gardening_card',{action:'plan',plant_id:p.id,plan_id:card.args.plan_id});assert.deepEqual(c.plan.payload.content,card.args.content);assert.equal(c.plan.payload.source_snapshot,undefined);assert.equal(c.plan.request_payload,undefined);
 const s=await tool(f.store,'gardening_structure',{action:'plan',plan_id:structure.args.plan_id});assert.deepEqual(s.plan.payload.answers,structure.args.answers);assert.equal(s.plan.payload.before_structure,undefined);assert.equal(s.plan.request_payload,undefined);
 await assert.rejects(tool(f.otherStore,'gardening_structure',{action:'plan',plan_id:structure.args.plan_id}),{code:'NOT_FOUND'});
 await assert.rejects(tool(f.otherStore,'gardening_card',{action:'plan',plant_id:p.id,plan_id:card.args.plan_id}),{code:'NOT_FOUND'});
}finally{f.close();}});

test('action-specific missing IDs fail with useful errors, not binding errors',async()=>{const f=await fixture();try{
 const p=await plant(f.store);
 await assert.rejects(tool(f.store,'gardening_card',{action:'plan',plant_id:p.id}),{code:'PLAN_REQUIRED'});
 await assert.rejects(tool(f.store,'gardening_card',{action:'apply',plant_id:p.id,user_confirmed:true}),{code:'PLAN_REQUIRED'});
 await assert.rejects(tool(f.store,'gardening_structure',{action:'plan'}),{code:'PLAN_REQUIRED'});
 const inspected=await tool(f.store,'gardening_card',{action:'inspect',plant_id:p.id});
 await assert.rejects(tool(f.store,'gardening_card',{action:'prepare_restore',plant_id:p.id,plan_id:uid(),expected_revision:inspected.revision,user_consented:true,names_reviewed:true}),{code:'MEMORY_REQUIRED'});
}finally{f.close();}});
