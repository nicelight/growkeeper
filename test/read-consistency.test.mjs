/** Composed card/group reads never publish a fresh revision with stale data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tool,plant} from './helpers.mjs';
for(const name of ['get_plants','get_case_file','get_entity'])test(name+' detects concurrent changes during composition',async()=>{
 const f=await fixture();try{
 const p=await plant(f.store),original=f.store.all.bind(f.store);let changed=false;
 f.store.all=async(...a)=>{const result=await original(...a);if(!changed){changed=true;await f.store.run('UPDATE plants SET profile=?,version=version+1 WHERE id=?','changed',p.id);}return result;};
 await assert.rejects(tool(f.store,name,name==='get_plants'?{}:name==='get_entity'?{type:'plant',id:p.id}:{plant_id:p.id}),{code:'CONFLICT'});
 }finally{f.close();}
});
