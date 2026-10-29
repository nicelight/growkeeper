import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {assetResponse} from '../src/assets.js';
import {PUBLIC_ASSETS} from '../src/generated-assets.js';
import worker from '../src/worker.js';
import {mcpResponse} from '../src/mcp.js';
import {fixture,req} from './helpers.mjs';
const noAssets={fetch(){throw new Error('Legacy assets must not serve bundled UI.');}};
test('bundle is exact public allowlist and matches built files',async()=>{
 assert.deepEqual(Object.keys(PUBLIC_ASSETS).sort(),['/app.js','/index.html','/style.css','/widget.html']);
 for(const path of Object.keys(PUBLIC_ASSETS)){
  const r=await assetResponse(req(path),{ASSETS:noAssets});assert.equal(r.status,200);
  assert.equal(await r.text(),await fs.readFile(new URL('../public'+path,import.meta.url),'utf8'));
  const head=await assetResponse(req(path,{method:'HEAD'}),{ASSETS:noAssets});assert.equal(await head.text(),'');assert.equal(head.headers.get('content-type'),r.headers.get('content-type'));
  assert.equal((await assetResponse(req(path,{method:'POST'}),{ASSETS:noAssets})).status,405);
 }
 let seen;const r=await assetResponse(req('/favicon.svg'),{ASSETS:{fetch(request){seen=new URL(request.url).pathname;return new Response('fallback');}}});assert.equal(await r.text(),'fallback');assert.equal(seen,'/favicon.svg');
});
test('bundled UI keeps routing authorization and security headers with stale ASSETS',async()=>{
 const f=await fixture();try{
  f.env.ASSETS=noAssets;
  for(const path of ['/app.js','/style.css','/widget.html']){
   const r=await worker.fetch(req(path),f.env,{});assert.equal(r.status,200,path);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('cache-control'),'no-store');
   assert.equal(await(await worker.fetch(req(path,{method:'HEAD'}),f.env,{})).text(),'');
  }
  assert.equal((await worker.fetch(req('/settings'),f.env,{})).status,303);
  assert.equal((await worker.fetch(req('/index.html'),f.env,{})).status,404);
  assert.equal((await worker.fetch(req('/generated-assets.js'),f.env,{})).status,404);
  assert.match(await(await worker.fetch(req('/'),f.env,{})).text(),/Ваши растения/);
  const login=await worker.fetch(req('/login',{method:'POST',headers:{origin:f.env.PUBLIC_ORIGIN,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({key:f.owner.key})}),f.env,{});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const r=await worker.fetch(req('/',{headers:{cookie}}),f.env,{});assert.equal(r.status,200);assert.match(await r.text(),/src="\/app.js"/);
 }finally{f.close();}
});
test('MCP widget reads the same bundled bytes without ASSETS',async()=>{
 const f=await fixture();try{
  f.env.ASSETS=noAssets;
  const request=req('/mcp',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'resources/read',params:{uri:'ui://growkeeper/journal.html'}})});
  const r=await mcpResponse(request,f.store,'test-request');const data=await r.json();assert.equal(r.status,200);assert.equal(data.result.contents[0].text,PUBLIC_ASSETS['/widget.html'].body);assert.ok(data.result.contents[0]._meta.ui.csp.connectDomains.includes(f.env.PUBLIC_ORIGIN));
 }finally{f.close();}
});
