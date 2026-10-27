import {assert,AppError,after,hash,randomToken,uid,now,origin,sha256url,same,boundedBody,encode,unbase64} from './lib.js';

// Fixed official endpoints; never follow redirects with authorization codes or secrets.
// https://developers.google.com/identity/openid-connect/openid-connect
const AUTHORIZE='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN='https://oauth2.googleapis.com/token';
const JWKS='https://www.googleapis.com/oauth2/v3/certs';
export const googleEnabled=env=>Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET);
const cookieName=env=>env.LOCAL_DEV===true?'gk_google':'__Host-gk_google';
const transactionCookie=(env,value,age=600)=>`${cookieName(env)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${env.LOCAL_DEV===true?'':'; Secure'}`;
export const clearGoogleCookie=env=>transactionCookie(env,'',0);
const readCookie=(request,name)=>(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);
const fail=()=>new AppError('GOOGLE_AUTH','Google sign-in could not be verified. Please try again.',400);
async function fetchJSON(url,options={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(url,{...options,redirect:'manual',signal:controller.signal});
    if(!response.ok) throw fail();
    return JSON.parse(new TextDecoder().decode(await boundedBody(response,65536)));
  } catch {throw fail();} finally {clearTimeout(timer);}
}
function decode(value) {return unbase64(value.replaceAll('-','+').replaceAll('_','/'));}
export async function verifyGoogleToken(token,env,nonce) {
  try {
    assert(typeof token==='string'&&token.length<=16384,'GOOGLE_AUTH','Invalid token.');
    const parts=token.split('.');
    if(parts.length!==3||parts.some(p=>! /^[A-Za-z0-9_-]+$/.test(p))) throw fail();
    const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if(header.alg!=='RS256'||typeof header.kid!=='string'||header.crit) throw fail();
    const keys=await fetchJSON(JWKS);
    const matches=keys.keys?.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
    if(matches?.length!==1) throw fail();
    const key=await crypto.subtle.importKey('jwk',matches[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),encode(parts[0]+'.'+parts[1]))) throw fail();
    const seconds=Date.now()/1000;
    if(!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||claims.aud!==env.GOOGLE_CLIENT_ID||
      (claims.azp!==undefined&&claims.azp!==env.GOOGLE_CLIENT_ID)||!Number.isFinite(claims.exp)||claims.exp<=seconds||
      !Number.isFinite(claims.iat)||claims.iat>seconds+60||claims.iat>claims.exp||
      (claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>seconds))||!same(claims.nonce,nonce)||
      typeof claims.sub!=='string'||!claims.sub.length||claims.sub.length>255) throw fail();
    return {sub:claims.sub}; // Do not persist email, profile data, or Google access/refresh tokens.
  } catch {throw fail();}
}
export async function googleRoutes(request,env,auth) {
  const url=new URL(request.url),path=url.pathname;
  if(!['/auth/google/start','/auth/google/link','/auth/google/callback'].includes(path)) return null;
  assert(googleEnabled(env),'NOT_FOUND','Google sign-in is not configured.',404);
  if(path!=='/auth/google/callback') {
    assert(request.method==='POST','METHOD','Use POST.',405);auth.checkOrigin(request,env,true);
    const params=await auth.form(request);
    let user=null;
    try {user=await auth.authenticate(request,env,true);} catch(e) {if(e.status!==401) throw e;}
    const linking=path==='/auth/google/link';
    assert(!linking||user,'UNAUTHORIZED','Sign in with your account key before linking Google.',401);
    assert(linking||!user,'GOOGLE_LINK_REQUIRED','Use Link Google to keep your current journal.',409);
    const previous=readCookie(request,cookieName(env));
    if(/^[A-Za-z0-9_-]{43}$/.test(previous||'')) await env.DB.prepare('DELETE FROM google_auth_transactions WHERE browser_hash=?').bind(await hash(previous)).run();
    const state=randomToken(),browser=randomToken(),nonce=randomToken(),verifier=randomToken();
    await env.DB.prepare('DELETE FROM google_auth_transactions WHERE expires_at<=?').bind(now()).run();
    await env.DB.prepare('INSERT INTO google_auth_transactions(state_hash,browser_hash,nonce,verifier,return_to,link_user_id,link_session_id,expires_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(await hash(state),await hash(browser),nonce,verifier,auth.returnPath(params.get('return_to')),user?.id||null,user?.session_id||null,after(600000)).run();
    const destination=new URL(AUTHORIZE);
    destination.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:origin(env)+'/auth/google/callback',response_type:'code',scope:'openid',state,nonce,code_challenge:await sha256url(verifier),code_challenge_method:'S256',prompt:'select_account'}).toString();
    return new Response(null,{status:303,headers:{location:destination.href,'set-cookie':transactionCookie(env,browser),'cache-control':'no-store','referrer-policy':'no-referrer'}});
  }
  assert(request.method==='GET','METHOD','Use GET.',405);
  const state=url.searchParams.get('state'),browser=readCookie(request,cookieName(env));
  if(!/^[A-Za-z0-9_-]{43}$/.test(state||'')||!/^[A-Za-z0-9_-]{43}$/.test(browser||'')||url.searchParams.getAll('state').length!==1) throw fail();
  // Conditional DELETE RETURNING is the atomic one-use boundary, including denial/failure callbacks.
  const tx=await env.DB.prepare('DELETE FROM google_auth_transactions WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *').bind(await hash(state),await hash(browser),now()).first();
  if(!tx) throw fail();
  if(url.searchParams.has('error')) return new Response(null,{status:303,headers:{location:'/login?google=cancelled','set-cookie':transactionCookie(env,'',0),'cache-control':'no-store'}});
  const code=url.searchParams.get('code');
  if(!code||code.length>4096||url.searchParams.getAll('code').length!==1) throw fail();
  async function checkLinkSession() {
    const current=await auth.authenticate(request,env,true);
    if(current.id!==tx.link_user_id||current.session_id!==tx.link_session_id) throw fail();
  }
  async function checkSignedOut() {
    let current=null;
    try {current=await auth.authenticate(request,env,true);} catch(e) {if(e.status!==401) throw e;}
    assert(!current,'GOOGLE_LINK_REQUIRED','Your browser session changed. Use Link Google to keep your current journal.',409);
  }
  if(tx.link_user_id) await checkLinkSession();else await checkSignedOut();
  const tokens=await fetchJSON(TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,code_verifier:tx.verifier,grant_type:'authorization_code',redirect_uri:origin(env)+'/auth/google/callback'})});
  const identity=await verifyGoogleToken(tokens.id_token,env,tx.nonce);
  let userId;
  if(tx.link_user_id) {
    await checkLinkSession();
    // Existing subject or existing user's Google identity must agree; no reassignment/merge.
    const existing=await env.DB.prepare('SELECT * FROM google_identities WHERE subject=? OR user_id=?').bind(identity.sub,tx.link_user_id).all();
    assert(existing.results.every(row=>row.subject===identity.sub&&row.user_id===tx.link_user_id),'GOOGLE_CONFLICT','This Google account or journal is already linked. Nothing was changed.',409);
    if(!existing.results.length) {
      try {const linked=await env.DB.prepare('INSERT INTO google_identities(subject,user_id,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.kind=\'browser\' AND s.expires_at>? AND u.active=1)').bind(identity.sub,tx.link_user_id,now(),tx.link_session_id,tx.link_user_id,now()).run();if(linked.meta.changes!==1) throw fail();} catch {throw fail();}
    }
    await checkLinkSession();userId=tx.link_user_id;
  } else {
    await checkSignedOut();
    const existing=await env.DB.prepare('SELECT u.id,u.active FROM google_identities g JOIN users u ON u.id=g.user_id WHERE g.subject=?').bind(identity.sub).first();
    if(existing) {assert(existing.active===1,'UNAUTHORIZED','Account is disabled.',401);userId=existing.id;}
    else {
      userId=uid();
      // A random digest with no issued key keeps the legacy NOT NULL constraint without a usable password.
      try {await env.DB.batch([
        env.DB.prepare('INSERT INTO users(id,display_name,login_key_hash,created_at) VALUES(?,?,?,?)').bind(userId,'Мой дневник',await hash(randomToken()),now()),
        env.DB.prepare('INSERT INTO google_identities(subject,user_id,created_at) VALUES(?,?,?)').bind(identity.sub,userId,now())
      ]);} catch {throw fail();}
    }
  }
  const token=await auth.createBrowserSession(env,userId);
  const headers=new Headers({location:auth.returnPath(tx.return_to),'cache-control':'no-store','referrer-policy':'no-referrer'});
  headers.append('set-cookie',auth.setCookie(env,token));headers.append('set-cookie',transactionCookie(env,'',0));
  return new Response(null,{status:303,headers});
}
