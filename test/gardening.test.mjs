/** Contract checks for consent, source preservation and transactional gardening. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,plant,tool} from './helpers.mjs';
import {uid,after} from '../src/lib.js';
import {toolDefinitions} from '../src/tools.js';
import {mcpResponse} from '../src/mcp.js';

const fact=(p,text='Листья скручиваются')=>({kind:'current_fact',text,sources:[{type:'plant',id:p.id}]});
async function count(s,table){return (await s.first(`SELECT count(*) AS n FROM ${table} WHERE user_id=?`,s.user.id)).n;}
async function prepareCard(s,p,extra={}){const inspect=await tool(s,'gardening_card',{action:'inspect',plant_id:p.id});const args={action:'prepare',plant_id:p.id,plan_id:uid(),expected_revision:inspect.revision,content:[fact(p)],...extra};return {args,result:await tool(s,'gardening_card',args)};}
async function prepareStructure(s,extra={}){const inspect=await tool(s,'gardening_structure',{action:'inspect'});const args={action:'prepare',plan_id:uid(),expected_revision:inspect.revision,agreed_understanding:'Лимон находится на полке.',type_changes:[],assignments:[],...extra};return {args,result:await tool(s,'gardening_structure',args)};}
const applyCard=(s,args,extra={})=>tool(s,'gardening_card',{action:'apply',plant_id:args.plant_id,plan_id:args.plan_id,user_confirmed:true,...extra});
const applyStructure=(s,args,extra={})=>tool(s,'gardening_structure',{action:'apply',plan_id:args.plan_id,user_confirmed:true,...extra});

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
 const inspected=await tool(f.store,'gardening_card',{action:'inspect',plant_id:p.id});const restore={action:'prepare_restore',plant_id:p.id,plan_id:uid(),memory_id:first.args.plan_id,expected_revision:inspected.revision,};
 await tool(f.store,'gardening_card',restore);const result=await applyCard(f.store,restore);assert.equal(result.memory.restored_from,first.args.plan_id);assert.deepEqual(result.memory.content,first.args.content);
 assert.equal(await count(f.store,'card_memory_versions'),3);assert.equal(await count(f.store,'observations'),1);
 const page=await tool(f.store,'gardening_card',{action:'versions',plant_id:p.id,limit:2});assert.equal(page.versions.length,2);assert.equal(page.next_offset,2);
 const last=await tool(f.store,'gardening_card',{action:'versions',plant_id:p.id,limit:2,offset:2});assert.equal(last.versions.length,1);assert.equal(last.next_offset,null);
}finally{f.close();}});

test('expired plans do not mutate',async()=>{const f=await fixture();try{
 const p=await plant(f.store),card=await prepareCard(f.store,p),structure=await prepareStructure(f.store);
 await f.store.run('UPDATE gardening_plans SET created_at=? WHERE user_id=?',after(-2*86400000),f.owner.id);
 await assert.rejects(applyCard(f.store,card.args),{code:'PLAN_EXPIRED'});await assert.rejects(applyStructure(f.store,structure.args),{code:'PLAN_EXPIRED'});
 assert.equal(await count(f.store,'card_memory_versions'),0);
}finally{f.close();}});

test('memory staleness and restore provenance preserve the originally reviewed source snapshot',async()=>{const f=await fixture();try{
 const p=await plant(f.store),first=await prepareCard(f.store,p),applied=await applyCard(f.store,first.args);
 assert.equal(applied.memory.stale,false);assert.equal(applied.memory.derived,true);assert.equal(applied.memory.original_source_revision,first.args.expected_revision);
 assert.equal(applied.memory.source_snapshot,undefined);const audited=await tool(f.store,'gardening_card',{action:'version',plant_id:p.id,memory_id:first.args.plan_id});const original=structuredClone(audited.memory.source_snapshot);assert.ok(original.length>0);
 await tool(f.store,'update_plant',{id:p.id,expected_version:p.version,display_name:p.display_name,profile:'Переехал на балкон'});
 assert.equal((await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.current_memory.stale,true);
 const inspected=await tool(f.store,'gardening_card',{action:'inspect',plant_id:p.id}),restore={action:'prepare_restore',plant_id:p.id,plan_id:uid(),memory_id:first.args.plan_id,expected_revision:inspected.revision,};
 await tool(f.store,'gardening_card',restore);const restored=await applyCard(f.store,restore);
 const restoredAudit=await tool(f.store,'gardening_card',{action:'version',plant_id:p.id,memory_id:restore.plan_id});assert.deepEqual(restoredAudit.memory.source_snapshot,original);assert.equal(restored.memory.stale,true);assert.equal(restored.memory.original_source_revision,first.args.expected_revision);assert.match(restored.memory.warning,/Restored/);
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
 const s=await tool(f.store,'gardening_structure',{action:'plan',plan_id:structure.args.plan_id});assert.deepEqual(s.plan.payload.assignments,structure.args.assignments);assert.equal(s.plan.payload.before_structure,undefined);assert.equal(s.plan.request_payload,undefined);
 await assert.rejects(tool(f.otherStore,'gardening_structure',{action:'plan',plan_id:structure.args.plan_id}),{code:'NOT_FOUND'});
 await assert.rejects(tool(f.otherStore,'gardening_card',{action:'plan',plant_id:p.id,plan_id:card.args.plan_id}),{code:'NOT_FOUND'});
}finally{f.close();}});

test('action-specific missing IDs fail with useful errors, not binding errors',async()=>{const f=await fixture();try{
 const p=await plant(f.store);
 await assert.rejects(tool(f.store,'gardening_card',{action:'plan',plant_id:p.id}),{code:'PLAN_REQUIRED'});
 await assert.rejects(tool(f.store,'gardening_card',{action:'apply',plant_id:p.id,user_confirmed:true}),{code:'PLAN_REQUIRED'});
 await assert.rejects(tool(f.store,'gardening_structure',{action:'plan'}),{code:'PLAN_REQUIRED'});
 const inspected=await tool(f.store,'gardening_card',{action:'inspect',plant_id:p.id});
 await assert.rejects(tool(f.store,'gardening_card',{action:'prepare_restore',plant_id:p.id,plan_id:uid(),expected_revision:inspected.revision,}),{code:'MEMORY_REQUIRED'});
}finally{f.close();}});

const group=async(s,name='Полка')=>(await tool(s,'create_plant',{id:uid(),display_name:name,kind:'group',name_source:'user',name_confirmed:true,profile:'Общие условия: кокос.'})).plant;
const rev=async s=>(await tool(s,'gardening_structure',{action:'inspect'})).revision;
const assign=async(s,p,g)=>tool(s,'assign_plant_group',{plant_id:p.id,...(g?{group_id:g.id}:{clear:true}),expected_revision:await rev(s)});

test('structure preparation has no mandatory question or naming gates, but apply needs exact consent',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store),{args}=await prepareStructure(f.store,{assignments:[{plant_id:p.id,group_id:g.id}]});
 assert.equal((await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.group_context,null);
 await assert.rejects(applyStructure(f.store,args,{user_confirmed:false}),{code:'CONSENT_REQUIRED'});
 await applyStructure(f.store,args);assert.equal((await applyStructure(f.store,args)).already_applied,true);
 assert.ok((await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.group_context);
}finally{f.close();}});

test('structure plan is immutable and rejects concurrent data without partial application',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store),{args}=await prepareStructure(f.store,{assignments:[{plant_id:p.id,group_id:g.id}]});
 assert.equal((await tool(f.store,'gardening_structure',args)).already_prepared,true);
 await assert.rejects(tool(f.store,'gardening_structure',{...args,assignments:[{plant_id:p.id,clear:true}]}),{code:'IDEMPOTENCY_CONFLICT'});
 await plant(f.store,'Новый лимон');await assert.rejects(applyStructure(f.store,args),{code:'GARDENING_CONFLICT'});
 assert.equal((await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.group_context,null);
 await assert.rejects(applyStructure(f.otherStore,args),{code:'NOT_FOUND'});
}finally{f.close();}});

test('structure rejects duplicate assignments, nesting and foreign targets',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store),foreign=await group(f.otherStore);
 await assert.rejects(prepareStructure(f.store,{assignments:[{plant_id:p.id,group_id:g.id},{plant_id:p.id,clear:true}]}),{code:'DUPLICATE_ASSIGNMENT'});
 await assert.rejects(prepareStructure(f.store,{assignments:[{plant_id:g.id,group_id:g.id}]}));
 await assert.rejects(prepareStructure(f.store,{assignments:[{plant_id:p.id,group_id:foreign.id}]}));
 assert.equal((await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.group_context,null);
}finally{f.close();}});

test('structure transaction failure rolls back all changes and leaves prepared plan retryable',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store),{args}=await prepareStructure(f.store,{assignments:[{plant_id:p.id,group_id:g.id}],names:[{type:'plant',id:p.id,display_name:'Новое имя'}]});
 await f.env.DB.exec("CREATE TRIGGER fail_structural_name BEFORE UPDATE OF display_name ON plants BEGIN SELECT RAISE(ABORT,'SIMULATED_WRITE_FAILURE'); END;");
 await assert.rejects(applyStructure(f.store,args));
 assert.equal((await f.store.get('plant',p.id)).display_name,p.display_name);assert.equal((await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.group_context,null);
 assert.equal((await f.store.first('SELECT status FROM gardening_plans WHERE id=?',args.plan_id)).status,'PREPARED');assert.equal(await f.store.first('SELECT * FROM gardening_assertions'),null);
}finally{f.close();}});

test('missing names are suggestions rather than mandatory gates in either gardening flow',async()=>{const f=await fixture();try{
 const p=await plant(f.store,' '),g=await group(f.store,'  ');await assign(f.store,p,g);
 const inspected=await tool(f.store,'gardening_card',{action:'inspect',plant_id:p.id});assert.equal(inspected.missing_names.length,2);
 const noNames=await prepareCard(f.store,p);await applyCard(f.store,noNames.args);assert.equal((await f.store.get('plant',p.id)).display_name,' ');
 const names=[{type:'plant',id:p.id,display_name:'Лимонный барон'},{type:'plant',id:g.id,display_name:'Зелёная команда'}];
 const named=await prepareStructure(f.store,{names});await applyStructure(f.store,named.args);
 assert.equal((await f.store.get('plant',p.id)).display_name,'Лимонный барон');assert.equal((await tool(f.store,'gardening_structure',{action:'inspect'})).missing_names.length,0);
 const namedAgain=await prepareStructure(f.store,{names:[{type:'plant',id:p.id,display_name:'Новое согласованное имя'}]});await applyStructure(f.store,namedAgain.args);assert.equal((await f.store.get('plant',p.id)).display_name,'Новое согласованное имя');
}finally{f.close();}});

test('record edits and membership changes invalidate memory and blank proposed names fail',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store),{args}=await prepareCard(f.store,p);
 await tool(f.store,'update_plant',{id:p.id,expected_version:p.version,display_name:p.display_name,profile:'Новые условия'});await assert.rejects(applyCard(f.store,args),{code:'GARDENING_CONFLICT'});
 const next=await prepareCard(f.store,p);await assign(f.store,p,g);await assert.rejects(applyCard(f.store,next.args),{code:'GARDENING_CONFLICT'});
 await assert.rejects(prepareCard(f.store,p,{names:[{type:'plant',id:p.id,display_name:'  '}]}),{code:'NAME_REQUIRED'});
}finally{f.close();}});

test('catalog exposes group and card operations but rejects old zone commands clearly',async()=>{const f=await fixture();try{
 const expected=['assign_plant_group','change_plant_type','preview_delete_plant','delete_plant','gardening_card','gardening_structure','get_capabilities'];
 const removed=['create_collection','create_zone','update_zone','assign_plant_zone'];const definitions=toolDefinitions();
 for(const name of expected){const def=definitions.find(x=>x.name===name);assert.ok(def,name);assert.ok(def._meta.ui.visibility.includes('model'),name);}
 for(const name of removed){assert.ok(!definitions.some(x=>x.name===name),name);await assert.rejects(tool(f.store,name,{}),{code:'TOOL_NOT_FOUND'});}
 const request=new Request('http://127.0.0.1:8787/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
 const reply=await (await mcpResponse(request,f.store,uid())).json();for(const name of expected)assert.ok(reply.result.tools.some(t=>t.name===name),name);
 assert.deepEqual(definitions.find(x=>x.name==='create_plant').inputSchema.properties.kind.enum,['plant','group']);
}finally{f.close();}});

test('prepared plans from the old zone model cannot apply as current plans',async()=>{const f=await fixture();try{
 const p=await plant(f.store),card=await prepareCard(f.store,p),structure=await prepareStructure(f.store);
 await f.store.run('UPDATE gardening_plans SET payload=? WHERE id=?',JSON.stringify({content:[fact(p)],names:[],source_snapshot:[]}),card.args.plan_id);
 await f.store.run('UPDATE gardening_plans SET payload=? WHERE id=?',JSON.stringify({pairs:[],assignments:[],names:[]}),structure.args.plan_id);
 await assert.rejects(applyCard(f.store,card.args),{code:'MODEL_CHANGED'});await assert.rejects(applyStructure(f.store,structure.args),{code:'MODEL_CHANGED'});
 assert.equal(await count(f.store,'card_memory_versions'),0);
}finally{f.close();}});

test('one structure plan can reassign members and change former group into a plant without replacing history',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store),target=await group(f.store,'Другая группа');await assign(f.store,p,g);
 const o=(await tool(f.store,'add_observation',{id:uid(),plant_id:g.id,source:'user',text:'История общего горшка.'})).observation;
 const {args}=await prepareStructure(f.store,{type_changes:[{plant_id:g.id,kind:'plant'}],assignments:[{plant_id:p.id,group_id:target.id},{plant_id:g.id,group_id:target.id}]});
 await applyStructure(f.store,args);assert.equal((await f.store.get('plant',g.id)).kind,'plant');assert.equal((await f.store.get('observation',o.id)).plant_id,g.id);
 const plants=(await tool(f.store,'get_plants')).plants;assert.equal(plants.length,3);assert.equal(plants.find(x=>x.id===g.id).group.id,target.id);assert.equal(plants.find(x=>x.id===p.id).group.id,target.id);
}finally{f.close();}});

test('group current memory is read live and remains distinct from individual exceptions',async()=>{const f=await fixture();try{
 const p=await plant(f.store),g=await group(f.store);await assign(f.store,p,g);
 const mem=await prepareCard(f.store,g,{content:[fact(g,'Общие условия: кокос, полив пока только запланирован.')]});await applyCard(f.store,mem.args);
 const own=await f.store.get('plant',p.id);await tool(f.store,'update_plant',{id:p.id,expected_version:own.version,display_name:p.display_name,profile:'Исключение: этот горшок в грунте.'});
 const c=(await tool(f.store,'get_case_file',{plant_id:p.id})).case_file;assert.equal(c.plant.profile,'Исключение: этот горшок в грунте.');assert.equal(c.current_memory,null);assert.equal(c.group_context.current_memory.id,mem.args.plan_id);assert.equal(c.group_context.current_memory.content[0].text,mem.args.content[0].text);assert.equal(c.group_context.current_memory.stale,true);
 assert.equal((await tool(f.store,'gardening_card',{action:'versions',plant_id:p.id})).versions.length,0);
}finally{f.close();}});
