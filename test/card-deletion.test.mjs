import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tool,plant,issue,PNG} from './helpers.mjs';
import {savePhoto} from '../src/media.js';
import {uid} from '../src/lib.js';
const scenario=(name,fn)=>test(name,async()=>{const f=await fixture();try{await fn(f);}finally{f.close();}});
const preview=(f,p)=>tool(f.store,'preview_delete_plant',{plant_id:p.id});
const args=(p,r)=>({plant_id:p.id,confirm_name:p.display_name,expected_revision:r.expected_revision,user_confirmed:true});
scenario('deletion preview is isolated read-only and counts own records',async f=>{
 const p=await plant(f.store),other=await plant(f.store,'Другой');await photo(f.store,p);await issue(f.store,p);await photo(f.store,other);
 const r=await preview(f,p);assert.equal(r.counts.photo,1);assert.equal(r.counts.issue,1);assert.equal((await preview(f,p)).expected_revision,r.expected_revision);
 await assert.rejects(tool(f.otherStore,'preview_delete_plant',{plant_id:p.id}),{code:'NOT_FOUND'});
 await assert.rejects(tool(f.store,'delete_plant',{...args(p,r),user_confirmed:false}),{code:'CONFIRMATION_REQUIRED'});
 assert.equal((await f.store.get('plant',p.id)).deleting,0);
 await tool(f.store,'delete_plant',args(p,r));assert.ok(await f.store.get('plant',other.id));assert.equal(f.env.PHOTOS.objects.size,1);
});
scenario('new history invalidates deletion consent scope before any R2 deletion',async f=>{
 const p=await plant(f.store);await photo(f.store,p);const r=await preview(f,p);
 await tool(f.store,'add_journal_note',{id:uid(),plant_id:p.id,entry_type:'NOTE',title:'Новое',summary:'Сохранить'});
 await assert.rejects(tool(f.store,'delete_plant',args(p,r)),{code:'CONFLICT'});
 assert.equal((await f.store.get('plant',p.id)).deleting,0);assert.equal(f.env.PHOTOS.objects.size,1);
});

async function photo(s,p){const row=await savePhoto(s,{},PNG);await tool(s,'resolve_input',{input_id:row.input_id,plant_id:p.id,method:'explicit',reason:'User specified',user_confirmed:true});return row;}
scenario('confirmed group deletion detaches members and resumes same consent after R2 failure',async f=>{
 const g=(await tool(f.store,'create_plant',{id:uid(),display_name:'Общая полка',name_source:'user',name_confirmed:true,kind:'group'})).plant;
 const p=await plant(f.store);await photo(f.store,g);await photo(f.store,p);
 await tool(f.store,'assign_plant_group',{plant_id:p.id,group_id:g.id,expected_revision:(await tool(f.store,'get_plants')).revision});
 const r=await preview(f,g);assert.equal(r.counts.members,1);const input=args(g,r),remove=f.env.PHOTOS.delete.bind(f.env.PHOTOS);
 f.env.PHOTOS.delete=async()=>{throw Error('temporary R2 failure');};await assert.rejects(tool(f.store,'delete_plant',input));
 f.env.PHOTOS.delete=remove;await tool(f.store,'delete_plant',input);assert.ok(await f.store.get('plant',p.id));
 assert.equal((await tool(f.store,'get_case_file',{plant_id:p.id})).case_file.group_context,null);assert.equal(f.env.PHOTOS.objects.size,1);
});
