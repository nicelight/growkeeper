import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tool} from './helpers.mjs';
import {TOOLS,toolDefinitions} from '../src/tools.js';
import {VERSION} from '../src/version.js';
import worker from '../src/worker.js';
test('capability catalog is read-only, references real tools and matches release identity',async()=>{const f=await fixture();try{
 const a=await tool(f.store,'get_capabilities');assert.equal(a.version,VERSION);
 const names=new Set(TOOLS.map(t=>t.name));for(const feature of a.features)for(const name of feature.tools)assert.ok(names.has(name),name);
 assert.deepEqual(a.tool_catalog.map(t=>t.name),TOOLS.map(t=>t.name));
 assert.equal(toolDefinitions().find(t=>t.name==='get_capabilities').annotations.readOnlyHint,true);
 assert.equal(a.tool_catalog.find(t=>t.name==='delete_plant').surface,'app_only');
 for(const table of ['plants','zones','followups','collection_onboarding','monitoring_preferences'])assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM '+table)).n,0);
 const r=await worker.fetch(new Request(f.env.PUBLIC_ORIGIN+'/healthz'),f.env,{});assert.equal((await r.json()).version,VERSION);
 assert.equal(a.runtime.monitoring.state,'disabled');
 f.env.EVENTS_ENABLED='true';assert.equal((await tool(f.store,'get_capabilities')).runtime.monitoring.state,'missing');
 assert.equal(JSON.stringify(a).includes(f.env.APP_SECRET),false);
}finally{f.close();}});
