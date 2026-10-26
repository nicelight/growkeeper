import {assert,AppError,after,hash,randomToken,uid,now,json,origin,sha256url,same,htmlEscape,boundedBody} from './lib.js';
const SCOPE='growkeeper';
const CLIENT='growkeeper-chatgpt';
export const resource = env => origin(env)+'/mcp';
export function challenge(env) {return `Bearer resource_metadata="${origin(env)}/.well-known/oauth-protected-resource", scope="${SCOPE}"`;}
export function checkOrigin(request,env,required=false) {
  const o=request.headers.get('origin');
  assert(!required || o,'CSRF','A same-origin browser request is required.',403);
  if(o) assert(o===origin(env),'ORIGIN','Origin not allowed.',403);
}
function cookie(request,name) {return (request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);}
const cookieName = env => env.LOCAL_DEV === true ? 'gk_session' : '__Host-gk_session';
function setCookie(env,token,seconds=604800) {
  return `${cookieName(env)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${env.LOCAL_DEV === true ? '' : '; Secure'}`;
}
export async function authenticate(request,env,browserOnly=false) {
  const auth=request.headers.get('authorization');
  let token,kind;
  if(auth&&!browserOnly) {
    assert(/^Bearer [A-Za-z0-9_-]{43}$/.test(auth),'UNAUTHORIZED','Invalid bearer token.',401);
    token=auth.slice(7);kind='oauth';
  } else {token=cookie(request,cookieName(env));kind='browser';}
  assert(token,'UNAUTHORIZED','Sign in to GrowKeeper.',401);
  const row=await env.DB.prepare(`SELECT s.*,u.display_name,u.active FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND kind=? AND expires_at>? AND u.active=1`).bind(await hash(token),kind,now()).first();
  assert(row && row.resource===resource(env) && row.scope===SCOPE,'UNAUTHORIZED','Session expired or invalid.',401);
  return {id:row.user_id,display_name:row.display_name,session_id:row.id,auth_kind:kind};
}
export async function loginSession(env,key) {
  assert(typeof key==='string'&&/^gk_[A-Za-z0-9_-]{43}$/.test(key),'UNAUTHORIZED','Invalid account key.',401);
  const user=await env.DB.prepare('SELECT id,display_name FROM users WHERE login_key_hash=? AND active=1').bind(await hash(key)).first();
  assert(user,'UNAUTHORIZED','Invalid account key.',401);
  const token=randomToken();
  await env.DB.prepare(`INSERT INTO auth_sessions(id,user_id,kind,token_hash,resource,scope,expires_at,created_at) VALUES(?,?,'browser',?,?,?,?,?)`)
    .bind(uid(),user.id,await hash(token),resource(env),SCOPE,after(7*86400000),now()).run();
  return {token,user};
}
function authParams(env,p) {
  assert(p.get('client_id')===CLIENT,'INVALID_CLIENT','Unknown OAuth client.');
  const redirect=p.get('redirect_uri');
  const allowed=String(env.OAUTH_REDIRECT_URIS||'').split(',').map(x=>x.trim());
  assert(allowed.includes(redirect),'INVALID_REDIRECT','Redirect URI is not allowlisted.');
  const url=new URL(redirect);
  assert(url.protocol==='https:'||(env.LOCAL_DEV===true&&['localhost','127.0.0.1'].includes(url.hostname)),'INVALID_REDIRECT','HTTPS callback required.');
  assert(p.get('response_type')==='code','UNSUPPORTED_RESPONSE_TYPE','Only authorization code flow is supported.');
  assert(p.get('resource')===resource(env),'INVALID_TARGET','OAuth resource does not match this MCP server.');
  assert((p.get('scope')||SCOPE)===SCOPE,'INVALID_SCOPE','Unsupported scope.');
  assert(p.get('code_challenge_method')==='S256'&&/^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge')||''),'INVALID_PKCE','S256 PKCE is required.');
  assert((p.get('state')||'').length<=2000,'INVALID_STATE','State too large.');
  return {client_id:CLIENT,redirect_uri:redirect,resource:resource(env),scope:SCOPE,challenge:p.get('code_challenge'),state:p.get('state')};
}
const page=(title,body)=>new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title><link rel="stylesheet" href="/style.css"><body class="auth"><main class="auth-card"><div class="brand">GrowKeeper</div><h1>${htmlEscape(title)}</h1>${body}</main></body></html>`,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
async function form(request) {
  assert((request.headers.get('content-type')||'').startsWith('application/x-www-form-urlencoded'),'CONTENT_TYPE','Use form encoding.',415);
  return new URLSearchParams(new TextDecoder().decode(await boundedBody(request,16384)));
}
function returnPath(value) {return typeof value==='string'&&(/^\/oauth\/authorize\?/.test(value)||/^\/(?:entity|plant)\/[a-z0-9/-]+$/.test(value)||value==='/')?value:'/';}
export async function authRoutes(request,env) {
  const url=new URL(request.url), path=url.pathname, base=origin(env);
  if(path==='/.well-known/oauth-protected-resource'||path==='/.well-known/oauth-protected-resource/mcp') return json({resource:resource(env),authorization_servers:[base],scopes_supported:[SCOPE],bearer_methods_supported:['header']});
  if(path==='/.well-known/oauth-authorization-server') return json({issuer:base,authorization_endpoint:base+'/oauth/authorize',token_endpoint:base+'/oauth/token',revocation_endpoint:base+'/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:[SCOPE],authorization_response_iss_parameter_supported:true});
  if(path==='/login') {
    if(request.method==='GET') return page('Вход в дневник',`<p>Введите личный ключ GrowKeeper, созданный владельцем сервера. Не отправляйте ключ в чат.</p><form method="post"><label>Ключ аккаунта<input name="key" type="password" autocomplete="current-password" required></label><input type="hidden" name="return_to" value="${htmlEscape(returnPath(url.searchParams.get('return_to')))}"><button type="submit">Войти</button></form>`);
    assert(request.method==='POST','METHOD','Method not allowed.',405);checkOrigin(request,env,true);
    const p=await form(request),{token}=await loginSession(env,p.get('key'));
    return new Response(null,{status:303,headers:{location:returnPath(p.get('return_to')),'set-cookie':setCookie(env,token),'cache-control':'no-store'}});
  }
  if(path==='/logout') {
    assert(request.method==='POST','METHOD','Use POST.',405);checkOrigin(request,env,true);
    const user=await authenticate(request,env,true);
    await env.DB.prepare('DELETE FROM auth_sessions WHERE id=? AND user_id=?').bind(user.session_id,user.id).run();
    return new Response(null,{status:303,headers:{location:'/login','set-cookie':setCookie(env,'',0)}});
  }
  if(path==='/oauth/authorize') {
    assert(['GET','POST'].includes(request.method),'METHOD','Use GET or POST.',405);
    const p=request.method==='GET'?url.searchParams:await form(request),data=authParams(env,p);
    let user;try {user=await authenticate(request,env,true);} catch(e) {
      if(e.status!==401) throw e;
      return new Response(null,{status:303,headers:{location:'/login?return_to='+encodeURIComponent('/oauth/authorize?'+p.toString())}});
    }
    if(request.method==='GET') {
      const fields=[...p.entries()].map(([k,v])=>`<input type="hidden" name="${htmlEscape(k)}" value="${htmlEscape(v)}">`).join('');
      return page('Подключить ChatGPT',`<p>Аккаунт: <strong>${htmlEscape(user.display_name)}</strong>.</p><p>Разрешить ChatGPT читать и изменять ваши растения, фото и дневник. Управления оборудованием нет.</p><p class="muted">Клиент: ${CLIENT}<br>Адрес возврата: ${htmlEscape(data.redirect_uri)}</p><form method="post">${fields}<button name="decision" value="allow">Разрешить</button><button class="secondary" name="decision" value="deny">Отказать</button></form>`);
    }
    checkOrigin(request,env,true); const dest=new URL(data.redirect_uri);dest.searchParams.set('iss',base);if(data.state)dest.searchParams.set('state',data.state);
    if(p.get('decision')!=='allow') dest.searchParams.set('error','access_denied');
    else {
      const code=randomToken();
      await env.DB.prepare('INSERT INTO oauth_codes(hash,user_id,client_id,redirect_uri,challenge,resource,scope,expires_at) VALUES(?,?,?,?,?,?,?,?)')
        .bind(await hash(code),user.id,CLIENT,data.redirect_uri,data.challenge,data.resource,data.scope,after(300000)).run();
      dest.searchParams.set('code',code);
    }
    return new Response(null,{status:303,headers:{location:dest.href,'cache-control':'no-store'}});
  }
  if(path==='/oauth/token') {
    assert(request.method==='POST','METHOD','Use POST.',405);
    const p=await form(request);assert(p.get('client_id')===CLIENT,'INVALID_CLIENT','Unknown client.');
    assert(p.get('resource')===resource(env),'INVALID_TARGET','Wrong resource.');
    if(p.has('scope')) assert(p.get('scope')===SCOPE,'INVALID_SCOPE','Wrong scope.');
    const access=randomToken(),refresh=randomToken(),stamp=now();
    if(p.get('grant_type')==='authorization_code') {
      const verifier=p.get('code_verifier');assert(/^[A-Za-z0-9._~-]{43,128}$/.test(verifier||''),'INVALID_GRANT','Invalid verifier.');
      const row=await env.DB.prepare('SELECT c.* FROM oauth_codes c JOIN users u ON u.id=c.user_id WHERE c.hash=? AND c.expires_at>? AND u.active=1')
        .bind(await hash(p.get('code')||''),stamp).first();
      assert(row&&row.client_id===CLIENT&&row.resource===resource(env)&&row.redirect_uri===p.get('redirect_uri')&&same(row.challenge,await sha256url(verifier)),'INVALID_GRANT','Invalid or expired authorization code.');
      // Consume exactly once; a storage failure after consumption requires a new authorization, never replay.
      const consumed=await env.DB.prepare('DELETE FROM oauth_codes WHERE hash=? AND expires_at>? RETURNING user_id').bind(row.hash,stamp).first();
      assert(consumed,'INVALID_GRANT','Authorization code was already used.');
      await env.DB.prepare(`INSERT INTO auth_sessions(id,user_id,kind,token_hash,refresh_hash,client_id,resource,scope,expires_at,refresh_expires_at,created_at) VALUES(?,?,'oauth',?,?,?,?,?,?,?,?)`)
        .bind(uid(),row.user_id,await hash(access),await hash(refresh),CLIENT,resource(env),SCOPE,after(3600000),after(30*86400000),stamp).run();
    } else if(p.get('grant_type')==='refresh_token') {
      const updated=await env.DB.prepare(`UPDATE auth_sessions SET token_hash=?,refresh_hash=?,expires_at=?,refresh_expires_at=? WHERE refresh_hash=? AND refresh_expires_at>? AND client_id=? AND resource=? AND kind='oauth' AND user_id IN(SELECT id FROM users WHERE active=1) RETURNING id`)
        .bind(await hash(access),await hash(refresh),after(3600000),after(30*86400000),await hash(p.get('refresh_token')||''),stamp,CLIENT,resource(env)).first();
      assert(updated,'INVALID_GRANT','Refresh token expired or already rotated.');
    } else throw new AppError('UNSUPPORTED_GRANT_TYPE','Unsupported grant type.');
    return json({access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:SCOPE});
  }
  if(path==='/oauth/revoke') {
    assert(request.method==='POST','METHOD','Use POST.',405);
    const p=await form(request);assert(p.get('client_id')===CLIENT,'INVALID_CLIENT','Unknown client.');
    const h=await hash(p.get('token')||'');
    await env.DB.batch([
      env.DB.prepare("DELETE FROM subscriptions WHERE user_id IN(SELECT user_id FROM auth_sessions WHERE kind='oauth' AND client_id=? AND (token_hash=? OR refresh_hash=?))").bind(CLIENT,h,h),
      env.DB.prepare("DELETE FROM auth_sessions WHERE kind='oauth' AND client_id=? AND (token_hash=? OR refresh_hash=?)").bind(CLIENT,h,h)
    ]);return json({});
  }
  return null;
}
