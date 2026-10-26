import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {eventCall, EVENT_NAME} from '../src/events.js';
import {base64, after} from '../src/lib.js';
import {mcpResponse} from '../src/mcp.js';

test('expired subscription with a new callback must verify the new destination', async () => {
  const f = await fixture();
  try {
    f.env.EVENTS_ENABLED = 'true';
    const calls = [];
    f.env.OUTBOUND_FETCH = async (url, opts) => {
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
