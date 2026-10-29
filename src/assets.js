/** Fixed public asset allowlist; callers retain authorization and routing. See docs/specs/asset-packaging.md. */
import {PUBLIC_ASSETS} from './generated-assets.js';
export function assetResponse(request,env){
 const path=new URL(request.url).pathname;
 if(!Object.hasOwn(PUBLIC_ASSETS,path))return env.ASSETS.fetch(request);
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
 const asset=PUBLIC_ASSETS[path];
 return new Response(request.method==='HEAD'?null:asset.body,{headers:{'content-type':asset.type}});
}
