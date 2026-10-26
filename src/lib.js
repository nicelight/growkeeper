/** Shared Web-API utilities. No process state or Node-only imports in Worker code. */
export class AppError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}
export function assert(ok, code, message, status = 400, details) {
  if (!ok) throw new AppError(code, message, status, details);
}
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const after = (ms) => new Date(Date.now() + ms).toISOString();
export const encode = (s) => new TextEncoder().encode(s);
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers}
});
export function base64(bytes) {
  let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export const unbase64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const b64url = (bytes) => base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export async function hash(value) {
  const bytes = typeof value === 'string' ? encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function sha256url(value) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encode(value)))); }
export function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0;
}
export async function mac(key, text, url = false) {
  const bytes = typeof key === 'string' ? encode(key) : key;
  const k = await crypto.subtle.importKey('raw', bytes, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, encode(text)));
  return url ? b64url(sig) : base64(sig);
}
export function secret(env) {
  assert(/^[a-f0-9]{64}$/i.test(env.APP_SECRET || ''), 'CONFIG_ERROR', 'APP_SECRET must be 32 random bytes encoded as 64 hex characters.', 503);
  return env.APP_SECRET;
}
async function aesKey(env) {
  const bytes = Uint8Array.from(secret(env).match(/../g), s => parseInt(s,16));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function seal(env, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv}, await aesKey(env), encode(data));
  return base64(iv) + '.' + base64(new Uint8Array(encrypted));
}
export async function unseal(env, data) {
  const [iv, encrypted] = data.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv)}, await aesKey(env), unbase64(encrypted)));
}
export function origin(env) {
  const u = new URL(env.PUBLIC_ORIGIN);
  assert(!u.username && !u.password && u.pathname === '/' && !u.search && !u.hash, 'CONFIG_ERROR', 'PUBLIC_ORIGIN must contain only scheme and host.',503);
  assert(u.protocol === 'https:' || (env.LOCAL_DEV === true && ['127.0.0.1','localhost'].includes(u.hostname)), 'CONFIG_ERROR', 'HTTPS is required.',503);
  return u.origin;
}
export async function boundedBody(response, maxBytes) {
  const size = Number(response.headers.get('content-length') || 0);
  assert(size <= maxBytes, 'TOO_LARGE', `Payload exceeds ${maxBytes} bytes.`,413);
  assert(response.body, 'EMPTY_BODY', 'Empty request or response.');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new AppError('TOO_LARGE',`Payload exceeds ${maxBytes} bytes.`,413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(total); let offset=0;
  for (const c of chunks) {bytes.set(c,offset);offset+=c.byteLength;} return bytes;
}
export async function readJSON(request, max = 256*1024) {
  assert((request.headers.get('content-type') || '').split(';')[0] === 'application/json', 'CONTENT_TYPE', 'Use application/json.',415);
  try { return JSON.parse(new TextDecoder().decode(await boundedBody(request,max))); }
  catch (e) { if (e instanceof AppError) throw e; throw new AppError('BAD_JSON','Malformed JSON.'); }
}
export function allowedURL(value, csv, code='HOST_NOT_ALLOWED') {
  let u; try {u = new URL(value);} catch {throw new AppError(code,'Invalid URL.');}
  const allowed = String(csv||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  assert(u.protocol === 'https:' && !u.username && !u.password && !u.hash && (!u.port || u.port === '443') && allowed.includes(u.hostname.toLowerCase()),
    code, `Destination host is not allowlisted: ${u.hostname}`);
  return u.href;
}
export const fetchWith = (env, ...args) => (env.OUTBOUND_FETCH || fetch)(...args);
export function htmlEscape(s='') {return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function instant(s) {assert(typeof s==='string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s)), 'BAD_DATE','Supply an ISO timestamp with timezone.'); return new Date(s).toISOString();}
export const days = (start, end) => Math.round((Date.parse(end)-Date.parse(start))/86400000*10)/10;
export function asObject(s, fallback={}) {try {return JSON.parse(s);} catch {return fallback;}}

// Only structural URL diagnostics. Never include credentials, path, query or fragment.
export function urlDiagnostic(value, csv) {
 if(typeof value!=='string')return {url_valid:false};
 let u;try{u=new URL(value);}catch{return {url_valid:false};}
 const hosts=String(csv||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 return {url_valid:true,callback_host:u.hostname.slice(0,253),https:u.protocol==='https:',
  has_credentials:!!(u.username||u.password),has_fragment:!!u.hash,
  port_allowed:!u.port||u.port==='443',host_allowed:hosts.includes(u.hostname.toLowerCase())};
}
