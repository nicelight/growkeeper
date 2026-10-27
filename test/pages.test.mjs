import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,req} from './helpers.mjs';
import worker from '../src/worker.js';
const send=(f,path,options={})=>worker.fetch(req(path,options),f.env,{});
test('public product pages and stylesheet work without a session; private routes stay private',async()=>{
 const f=await fixture();try{
  for(const path of ['/','/about','/privacy','/terms','/support']){
   const r=await send(f,path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/text\/html/);
   const text=await r.text();assert.match(text,/lang="ru"/);assert.match(text,/href="\/privacy"/);assert.match(text,/href="\/support"/);
   assert.doesNotMatch(text,/<script|google-analytics|gtag/);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
   assert.equal(await(await send(f,path,{method:'HEAD'})).text(),'');
   assert.equal((await send(f,path,{method:'POST'})).status,405);
  }
  const css=await send(f,'/product.css');assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/text\/css/);
  assert.equal((await send(f,'/settings')).status,303);
  assert.equal((await send(f,'/api/tools/get_plants',{method:'POST'})).status,401);
 }finally{f.close();}
});
test('authenticated root remains existing journal, public about remains public',async()=>{
 const f=await fixture();try{
  const r=await send(f,'/login',{method:'POST',headers:{origin:f.env.PUBLIC_ORIGIN,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({key:f.owner.key})});
  const cookie=r.headers.get('set-cookie').split(';')[0];
  const journal=await send(f,'/',{headers:{cookie}});assert.equal(journal.status,200);assert.match(await journal.text(),/src="\/app.js"/);
  assert.match(await(await send(f,'/about',{headers:{cookie}})).text(),/Ваши растения/);
 }finally{f.close();}
});
