import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {eventCall, EVENT_NAME} from '../src/events.js';
import {base64, after} from '../src/lib.js';
import {mcpResponse, callbackDiagnostic} from '../src/mcp.js';

test('expired subscription with a new callback must verify the new destination', async () => {
  const f = await fixture();
  try {
    f.env.EVENTS_ENABLED = 'true';
    const calls = [];
    f.env.OUTBOUND_FETCH = async (url, opts) => {
      assert.equal(opts.redirect, 'manual');
      calls.push(url);
      return Response.json({challenge: JSON.parse(opts.body).challenge});
    };
    const params = {name: EVENT_NAME, arguments: {}, delivery: {
      mode: 'webhook', url: 'https://chatgpt.com/old',
      secret: 'whsec_' + base64(new Uint8Array(32).fill(42))
    }};
    await eventCall(f.store, 'events/subscribe', params);
    await f.store.run('UPDATE subscriptions SET expires_at=?', after(-1000));
    await eventCall(f.store, 'events/subscribe', {...params,
      delivery: {...params.delivery, url: 'https://chatgpt.com/new'}});
    assert.deepEqual(calls, ['https://chatgpt.com/old', 'https://chatgpt.com/new']);
  } finally { f.close(); }
});

test('event failure logs stage and code without callback or secret', async t => {
  const f = await fixture();
  const logs = [];
  t.mock.method(console, 'info', value => logs.push(JSON.parse(value)));
  t.mock.method(console, 'warn', value => logs.push(JSON.parse(value)));
  try {
    f.env.EVENTS_ENABLED = 'true';
    const secret = 'whsec_' + base64(new Uint8Array(32).fill(9));
    const callback = 'https://not-allowed.example/private-callback';
    const response = await mcpResponse(new Request('http://localhost/mcp', {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({jsonrpc:'2.0',id:1,method:'events/subscribe',params:{
        name:EVENT_NAME,arguments:{},delivery:{mode:'webhook',url:callback,secret}
      }})
    }), f.store, 'test-request');
    assert.equal(response.status, 400);
    assert.deepEqual(logs.map(x=>x.stage), ['received','failed']);
    assert.equal(logs[1].code, 'WEBHOOK_HOST_NOT_ALLOWED');
    assert.equal(JSON.stringify(logs).includes(secret), false);
    assert.equal(JSON.stringify(logs).includes(callback), false);
  } finally { f.close(); }
});

test('modern event request rejected before dispatch has a safe diagnostic', async t => {
  const f = await fixture(), logs=[];
  t.mock.method(console,'info', x=>logs.push(JSON.parse(x)));
  t.mock.method(console,'warn', x=>logs.push(JSON.parse(x)));
  try {
    const response=await mcpResponse(new Request('http://localhost/mcp',{
      method:'POST',headers:{'content-type':'application/json','MCP-Protocol-Version':'2026-07-28'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'events/subscribe',params:{delivery:{secret:'never-log-this'}}})
    }),f.store,'protocol-test');
    assert.equal(response.status,400);
    assert.equal(logs.at(-1).stage,'rejected');
    assert.equal(logs.at(-1).code,-32602);
    assert.equal(JSON.stringify(logs).includes('never-log-this'),false);
  } finally {f.close();}
});


test('callback diagnostics omit sensitive URL components and distinguish rejection causes', () => {
 const d=callbackDiagnostic('http://user:password@callback.example:8080/private?token=secret#fragment','chatgpt.com');
 assert.deepEqual(d,{url_valid:true,callback_host:'callback.example',https:false,has_credentials:true,has_fragment:true,port_allowed:false,host_allowed:false});
 assert.deepEqual(callbackDiagnostic('not a URL with secret','chatgpt.com'),{url_valid:false});
 assert.deepEqual(callbackDiagnostic({},'chatgpt.com'),{url_valid:false});
 assert.equal(callbackDiagnostic('https://chatgpt.com:443/path','chatgpt.com').host_allowed,true);
 assert.equal(callbackDiagnostic('https://chatgpt.com.attacker.example/path','chatgpt.com').host_allowed,false);
});

test('verification rejects redirect without following it or persisting subscription', async () => {
 const f=await fixture();let calls=0;
 try {
  f.env.EVENTS_ENABLED='true';
  f.env.OUTBOUND_FETCH=async (url, opts)=>{calls++;assert.equal(opts.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://other.example/'}});};
  await assert.rejects(eventCall(f.store,'events/subscribe',{name:EVENT_NAME,arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/callback',secret:'whsec_'+base64(new Uint8Array(32).fill(9))}}),{code:'WEBHOOK_VERIFICATION'});
  assert.equal(calls,1);
  assert.equal(await f.store.first('SELECT * FROM subscriptions'),null);
 } finally {f.close();}
});

 test('approved connector host verifies while lookalike hosts remain blocked',async()=>{const f=await fixture();try{f.env.EVENTS_ENABLED='true';f.env.EVENT_WEBHOOK_HOSTS='chatgpt.com,connectors.api.openai.com';let calls=0;f.env.OUTBOUND_FETCH=async(url,opts)=>{calls++;return Response.json({challenge:JSON.parse(opts.body).challenge});};const p={name:EVENT_NAME,arguments:{},delivery:{mode:'webhook',url:'https://connectors.api.openai.com/callback',secret:'whsec_'+base64(new Uint8Array(32).fill(9))}};await eventCall(f.store,'events/subscribe',p);assert.equal(calls,1);await assert.rejects(eventCall(f.store,'events/subscribe',{...p,delivery:{...p.delivery,url:'https://connectors.api.openai.com.attacker.example/callback'}}),{code:'WEBHOOK_HOST_NOT_ALLOWED'});assert.equal(calls,1);}finally{f.close();}});
