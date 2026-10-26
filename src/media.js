import {assert,AppError,uid,now,hash,instant,allowedURL,fetchWith,boundedBody,base64,mac,same,secret,origin,json} from './lib.js';
export const MAX_PHOTO_BYTES=10*1024*1024;
export function sniff(bytes) {
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x))return 'image/png';
  if(new TextDecoder().decode(bytes.subarray(0,4))==='RIFF'&&new TextDecoder().decode(bytes.subarray(8,12))==='WEBP')return 'image/webp';
  throw new AppError('IMAGE_FORMAT','Supported formats: JPEG, PNG, WebP. Convert HEIC/GIF/SVG before upload.',415);
}
export async function savePhoto(store,a,bytes,sourceFileId=null) {
  assert(bytes.length>0&&bytes.length<=MAX_PHOTO_BYTES,'TOO_LARGE','Photo must be 1 byte–10 MiB.',413);
  const type=sniff(bytes),stamp=now(),inputId=a.input_id||uid(),photoId=a.id||uid(),digest=await hash(bytes);
  const old=await store.first('SELECT id,sha256 FROM photos WHERE user_id=? AND (id=? OR source_file_id=?)',store.user.id,photoId,sourceFileId);
  if(old) {assert(old.sha256===digest,'IDEMPOTENCY_CONFLICT','Same photo key used for different bytes.',409);return store.get('photo',old.id);}
  let input=await store.first('SELECT * FROM inputs WHERE id=? AND user_id=?',inputId,store.user.id);
  if(input) {
    assert(input.status==='PENDING','INPUT_ALREADY_RESOLVED','Use a new input for a new photo.',409);
    const previous=await store.first('SELECT id FROM photos WHERE input_id=? AND user_id=?',inputId,store.user.id);
    assert(!previous,'ONE_PHOTO_PER_INPUT','Each photo gets its own input; resolve mixed batches separately.',409);
  } else input=await store.insert('input',{text:a.caption||'',created_at:stamp},inputId);
  const captured=a.captured_at?instant(a.captured_at):null;
  assert(!captured||Date.parse(captured)<=Date.now()+300000,'FUTURE_PHOTO','Capture time is in the future.');
  const key=`${store.user.id}/${photoId}-${digest}`;
  await store.env.PHOTOS.put(key,bytes,{httpMetadata:{contentType:type}});
  try {
    const row=await store.insert('photo',{input_id:inputId,plant_id:null,r2_key:key,source_file_id:sourceFileId,mime_type:type,bytes:bytes.length,sha256:digest,received_at:stamp,captured_at:captured,captured_at_source:captured?'user':'unknown',view_tag:a.view_tag||'OTHER',area_tag:a.area_tag||'unknown',description:a.description||''},photoId);
    // A retry racing another insert must not leak an unused object.
    const stored=await store.first('SELECT r2_key,sha256 FROM photos WHERE id=? AND user_id=?',row.id,store.user.id);
    if(stored.r2_key!==key) await store.env.PHOTOS.delete(key);
    assert(stored.sha256===digest,'IDEMPOTENCY_CONFLICT','Concurrent upload used this ID for different bytes.',409);
    return row;
  } catch(e) {
    const winner=await store.first('SELECT id,r2_key,sha256 FROM photos WHERE user_id=? AND (id=? OR source_file_id=?)',store.user.id,photoId,sourceFileId);
    if(!winner||winner.r2_key!==key)await store.env.PHOTOS.delete(key);
    if(winner){assert(winner.sha256===digest,'IDEMPOTENCY_CONFLICT','Concurrent upload reused a photo ID with different bytes.',409);return store.get('photo',winner.id);} throw e;
  }
}
export async function ingestPhoto(store,a) {
  const old=await store.first('SELECT id FROM photos WHERE source_file_id=? AND user_id=?',a.file.file_id,store.user.id);
  if(old)return store.get('photo',old.id);
  const url=allowedURL(a.file.download_url,store.env.FILE_DOWNLOAD_HOSTS,'FILE_HOST_NOT_ALLOWED');
  const response=await fetchWith(store.env,url,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  assert(response.ok,'PHOTO_DOWNLOAD_FAILED','Cannot download attachment. Get a fresh file URL and retry.',502);
  return savePhoto(store,a,await boundedBody(response,MAX_PHOTO_BYTES),a.file.file_id);
}
export async function mediaURL(env,userId,photoId) {
  const exp=Math.floor(Date.now()/1000)+300;
  const sig=await mac(secret(env),`photo\n${userId}\n${photoId}\n${exp}`,true);
  return `${origin(env)}/media/${photoId}?u=${encodeURIComponent(userId)}&exp=${exp}&sig=${encodeURIComponent(sig)}`;
}
export async function mediaResponse(request,env,id,authenticatedUser=null) {
  const u=new URL(request.url);let userId=authenticatedUser?.id;
  if(!userId) {
    const exp=Number(u.searchParams.get('exp')),who=u.searchParams.get('u'),sig=u.searchParams.get('sig');
    assert(Number.isSafeInteger(exp)&&exp>=Math.floor(Date.now()/1000)&&exp<=Math.floor(Date.now()/1000)+300,'URL_EXPIRED','Photo URL expired.',403);
    assert(who&&same(sig,await mac(secret(env),`photo\n${who}\n${id}\n${exp}`,true)),'FORBIDDEN','Invalid photo signature.',403);userId=who;
  }
  const photo=await env.DB.prepare(`SELECT ph.* FROM photos ph JOIN users u ON u.id=ph.user_id LEFT JOIN plants p ON p.id=ph.plant_id WHERE ph.id=? AND ph.user_id=? AND u.active=1 AND (p.id IS NULL OR p.deleting=0)`).bind(id,userId).first();
  assert(photo,'NOT_FOUND','Photo not found.',404);
  const object=await env.PHOTOS.get(photo.r2_key);assert(object,'OBJECT_MISSING','Photo bytes unavailable; check R2 recovery.',404);
  return new Response(request.method==='HEAD'?null:object.body,{headers:{'content-type':photo.mime_type,'content-length':String(photo.bytes),'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'",'referrer-policy':'no-referrer'}});
}
export async function photoImages(store,ids) {
  assert(new Set(ids).size===ids.length,'DUPLICATE_PHOTO','Supply unique photo IDs.');
  let total=0;const photos=[],images=[];
  for(const id of ids) {
    const p=await store.get('photo',id);total+=p.bytes;
    assert(total<=16*1024*1024,'IMAGE_BUDGET','Image batch exceeds 16 MiB. Request fewer images; never substitute descriptions for pixel comparison.',413);
    const internal=await store.first('SELECT r2_key FROM photos WHERE id=? AND user_id=?',id,store.user.id);
    const obj=await store.env.PHOTOS.get(internal.r2_key);assert(obj,'OBJECT_MISSING','Photo bytes are missing.',404);
    photos.push(p);images.push({type:'text',text:JSON.stringify({photo_id:id,captured_at:p.captured_at,received_at:p.received_at,captured_at_source:p.captured_at_source,plant_id:p.plant_id})});
    images.push({type:'image',mimeType:p.mime_type,data:base64(new Uint8Array(await obj.arrayBuffer()))});
  }
  return {data:{photos},content:images};
}
export async function comparisonSet(store,a) {
  const current=await store.get('photo',a.photo_id);assert(current.plant_id,'PLANT_UNRESOLVED','Resolve the photo first.',409);
  let issue,experiment;
  if(a.issue_id) {issue=await store.get('issue',a.issue_id);assert(issue.plant_id===current.plant_id,'WRONG_PLANT','Issue belongs to another plant.');}
  if(a.experiment_id) {experiment=await store.get('experiment',a.experiment_id);assert(experiment.plant_id===current.plant_id,'WRONG_PLANT','Experiment belongs to another plant.');if(issue)assert(experiment.issue_id===issue.id,'WRONG_ISSUE','Experiment belongs to another issue.');}
  const effective=current.captured_at||current.received_at;
  const picked=[];const exclude=new Set([current.id]);
  const select=async(reason,anchor=null,earliest=false)=>{
    const strict=current.view_tag!=='OTHER';
    const where=`user_id=? AND plant_id=? AND id<>? AND COALESCE(captured_at,received_at)<? ${strict?'AND view_tag=?':''} ${current.area_tag!=='unknown'?'AND area_tag=?':''} ${anchor?'AND COALESCE(captured_at,received_at)<=?':''}`;
    const args=[store.user.id,current.plant_id,current.id,effective,...(strict?[current.view_tag]:[]),...(current.area_tag!=='unknown'?[current.area_tag]:[]),...(anchor?[anchor]:[])];
    const rows=await store.all(`SELECT * FROM photos WHERE ${where} ORDER BY COALESCE(captured_at,received_at) ${earliest?'ASC':'DESC'},id LIMIT 5`,...args);
    const row=rows.find(r=>!exclude.has(r.id));
    if(row){exclude.add(row.id);picked.push({...store.decorate('photo',row),selection_reason:reason,timing_is_estimate:!row.captured_at});}
  };
  await select('latest comparable');
  if(experiment?.started_at)await select('before experiment (verify capture time)',experiment.started_at);
  if(issue)await select('at or before problem detection',issue.opened_at);
  if(picked.length<3)await select('earliest comparable baseline',null,true);
  return {current,references:picked.slice(0,3),warnings:[...(!current.captured_at?['Current capture time unknown; upload time is NOT proven capture time.']:[]),...(picked.length===0?['No comparable reference. Ask for a matching view, not a remembered description.']:[]),'Different light, viewpoint or leaves can invalidate comparisons. An absence outside the frame is not evidence of recovery.']};
}
