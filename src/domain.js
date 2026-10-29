/** Plant history and care transitions; validate ownership and observed outcomes.
 * Derived gardening memory is separate from these source records. */
import {assert,AppError,uid,now,after,days,instant,asObject} from './lib.js';
import {TABLES} from './db.js';

export async function settings(store) {
  return await store.first('SELECT recognition_threshold,timezone,updated_at FROM user_settings WHERE user_id=?',store.user.id)
    || {recognition_threshold:.90,timezone:'Asia/Dushanbe',updated_at:null};
}
export async function setSettings(store,a) {
  try{new Intl.DateTimeFormat('ru',{timeZone:a.timezone});}catch{throw new AppError('TIMEZONE','Unknown IANA timezone.');}
  await store.run(`INSERT INTO user_settings(user_id,recognition_threshold,timezone,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET recognition_threshold=excluded.recognition_threshold,timezone=excluded.timezone,updated_at=excluded.updated_at`,store.user.id,a.recognition_threshold,a.timezone,now());
  return {settings:await settings(store)};
}
export async function listPlants(store) {
  const plants=await store.all('SELECT * FROM plants WHERE user_id=? AND deleting=0 ORDER BY created_at,id LIMIT 101',store.user.id);
  const shown=plants.slice(0,100).map(p=>store.decorate('plant',p));
  for(const plant of shown) plant.reference_photo_ids=(await store.all('SELECT id FROM photos WHERE user_id=? AND plant_id=? AND is_reference=1 ORDER BY received_at DESC LIMIT 2',store.user.id,plant.id)).map(p=>p.id);
  return {plants:shown,truncated:plants.length>100,settings:await settings(store)};
}
export async function createPlant(store,a) {
  const stamp=now(); const plant=await store.insert('plant',{display_name:a.display_name,name_source:a.name_source,name_confirmed:a.name_confirmed?1:0,kind:a.kind,profile:a.profile||'',created_at:stamp,updated_at:stamp},a.id);
  return {plant,announcement:a.name_source==='generated'?`Назову «${plant.display_name}»; если хочешь, переименуем.`:null};
}
export async function updatePlant(store,a) {
  return {plant:await store.change('plant',a.id,a.expected_version,{display_name:a.display_name,profile:a.profile,name_source:'user',name_confirmed:1})};
}
export async function recordInput(store,a) {return {input:await store.insert('input',{text:a.text,created_at:now()},a.id)};}
export async function listInputs(store,a={}) {
  const rows=await store.all("SELECT * FROM inputs WHERE user_id=? AND status='PENDING' ORDER BY created_at,id LIMIT ?",store.user.id,a.limit||30);
  for(const row of rows) row.photos=await store.all('SELECT id,view_tag,received_at,captured_at FROM photos WHERE input_id=? AND user_id=?',row.id,store.user.id);
  return {inputs:rows};
}
export async function resolveInput(store,a) {
  const input=await store.get('input',a.input_id),plant=await store.get('plant',a.plant_id);
  if(input.plant_id) {
    assert(input.plant_id===plant.id,'ALREADY_BOUND','Input is bound to a different plant. Do not silently reassign it.',409);
    const hasPhoto=await store.first('SELECT id FROM photos WHERE input_id=? AND user_id=?',input.id,store.user.id);
    return {input,plant,announcement:hasPhoto?`На фото вижу «${plant.display_name}».`:`Это «${plant.display_name}».`,already_resolved:true};
  }
  const photo=await store.first('SELECT * FROM photos WHERE input_id=? AND user_id=?',input.id,store.user.id);
  const policy=await settings(store);
  if(a.method==='visual') {
    assert(photo,'NO_PHOTO','Visual recognition requires an actual photo.');
    const refs=[];for(const id of a.compared_photo_ids||[])refs.push(await store.get('photo',id));
    const hasTrusted=refs.some(p=>p.plant_id===plant.id&&p.is_reference===1);
    if(!hasTrusted||a.conflicting_signals||typeof a.score!=='number'||a.score<policy.recognition_threshold) {
      return {needs_confirmation:true,input_id:input.id,candidate_plant:plant,threshold:policy.recognition_threshold,
        question:`Похоже на «${plant.display_name}», но не уверен. Это они?`,reason:!hasTrusted?'No confirmed reference photo':a.conflicting_signals?'Conflicting identity signals':'Score below threshold'};
    }
  } else if(a.method==='followup') {
    assert(a.followup_id,'FOLLOWUP_REQUIRED','Supply the actual followup ID the user answered.');
    const f=await store.get('followup',a.followup_id);assert(f.plant_id===plant.id&&['PENDING','NOTIFIED'].includes(f.status),'WRONG_FOLLOWUP','Followup is not active for this plant.',409);
    assert(a.user_confirmed,'CONFIRMATION_REQUIRED','Use followup context only when the message explicitly answers it.');
  } else assert(a.user_confirmed,'CONFIRMATION_REQUIRED','Explicit plant identity or user confirmation is required.');
  const stamp=now();
  const results=await store.db.batch([
    store.stmt(`UPDATE inputs SET plant_id=?,status='RESOLVED',resolution_method=?,recognition_score=?,resolution_note=?,resolved_at=? WHERE id=? AND user_id=? AND plant_id IS NULL`,plant.id,a.method,a.score??null,a.reason,stamp,input.id,store.user.id),
    store.stmt(`UPDATE photos SET plant_id=? WHERE input_id=? AND user_id=? AND EXISTS(SELECT 1 FROM inputs WHERE id=? AND plant_id=?)`,plant.id,input.id,store.user.id,input.id,plant.id)
  ]);
  const resolved=await store.get('input',input.id);assert(resolved.plant_id===plant.id,'CONFLICT','Another resolution won; reload the input.',409);
  if(photo&&a.method!=='visual'&&['WHOLE_PLANT','CANOPY'].includes(photo.view_tag)) {
    // Trusted references come only from explicit confirmation, never recursively from visual guesses.
    const count=await store.first('SELECT count(*) AS n FROM photos WHERE user_id=? AND plant_id=? AND is_reference=1',store.user.id,plant.id);
    if(count.n<3)await store.run('UPDATE photos SET is_reference=1 WHERE id=? AND user_id=?',photo.id,store.user.id);
  }
  return {input:resolved,plant,announcement:photo?`На фото вижу «${plant.display_name}».`:`Это «${plant.display_name}».`};
}
export async function correctInput(store,a) {
  assert(a.user_confirmed,'CONFIRMATION_REQUIRED','Ask the user before correcting plant identity.');
  const input=await store.get('input',a.input_id),target=await store.get('plant',a.plant_id);
  const photos=await store.all('SELECT id FROM photos WHERE input_id=? AND user_id=?',input.id,store.user.id);
  const references=await store.first(`SELECT count(*) AS n FROM observations WHERE user_id=? AND (input_id=? OR EXISTS(SELECT 1 FROM json_each(photo_ids_json) j WHERE j.value IN(SELECT id FROM photos WHERE input_id=? AND user_id=?)))`,store.user.id,input.id,input.id,store.user.id);
  assert(references.n===0,'DERIVED_DATA_EXISTS','Observations already depend on this input. Do not silently rewrite history. See RUNBOOK: correcting processed inputs.',409);
  await store.db.batch([
    store.stmt("UPDATE inputs SET plant_id=?,status='RESOLVED',resolution_method='confirmed',resolution_note=?,resolved_at=? WHERE id=? AND user_id=?",target.id,a.reason,now(),input.id,store.user.id),
    store.stmt('UPDATE photos SET plant_id=?,is_reference=0 WHERE input_id=? AND user_id=?',target.id,input.id,store.user.id)
  ]);
  return {input:await store.get('input',input.id),photo_ids:photos.map(p=>p.id),announcement:`Исправлено: на фото «${target.display_name}».`};
}
export async function labelPhoto(store,a) {
  const p=await store.get('photo',a.photo_id);
  const captured=a.captured_at?instant(a.captured_at):p.captured_at;
  assert(!captured||Date.parse(captured)<=Date.now()+300000,'FUTURE_PHOTO','Capture time is in the future.');
  if(a.is_reference)assert(p.plant_id&&a.user_confirmed,'CONFIRMATION_REQUIRED','Only explicitly confirmed identity may become a reference.');
  await store.run('UPDATE photos SET view_tag=?,area_tag=?,description=?,is_reference=?,captured_at=?,captured_at_source=? WHERE id=? AND user_id=?',a.view_tag,a.area_tag,a.description,a.is_reference?1:0,captured,captured?'user':'unknown',p.id,store.user.id);
  return {photo:await store.get('photo',p.id)};
}
export async function addObservation(store,a) {
  await store.get('plant',a.plant_id);
  if(a.issue_id) {const issue=await store.openIssue(a.issue_id);assert(issue.plant_id===a.plant_id,'WRONG_PLANT','Issue belongs to another plant.');}
  if(a.input_id) {const input=await store.get('input',a.input_id);assert(input.plant_id===a.plant_id&&input.status!=='PENDING','PLANT_UNRESOLVED','Resolve the input before recording observations.',409);}
  const photos=await store.refs('photo',a.photo_ids||[],a.plant_id);
  if(a.source==='comparison') assert(photos.length>=2,'COMPARISON_REFS','A comparison must cite at least two distinct photos.');
  if(a.source==='photo') assert(photos.length>=1,'PHOTO_REF','Photo observation requires its source image.');
  const stamp=now(),observed=a.observed_at?instant(a.observed_at):stamp;
  assert(Date.parse(observed)<=Date.now()+300000,'FUTURE_OBSERVATION','Observation cannot be in the future.');
  const observation=await store.insert('observation',{plant_id:a.plant_id,issue_id:a.issue_id||null,input_id:a.input_id||null,source:a.source,text:a.text,photo_ids_json:JSON.stringify(photos.map(p=>p.id)),caveats:a.caveats||'',observed_at:observed,created_at:stamp},a.id);
  if(a.input_id)await store.run("UPDATE inputs SET status='PROCESSED' WHERE id=? AND user_id=? AND plant_id=?",a.input_id,store.user.id,a.plant_id);
  return {observation};
}
export async function createIssue(store,a) {
  await store.get('plant',a.plant_id);const stamp=now(),opened=a.opened_at?instant(a.opened_at):stamp;
  assert(Date.parse(opened)<=Date.now()+300000,'FUTURE_ISSUE','Detection cannot be in the future.');
  return {issue:await store.insert('issue',{plant_id:a.plant_id,title:a.title,description:a.description||'',opened_at:opened,created_at:stamp,updated_at:stamp},a.id)};
}
export async function saveHypothesis(store,a) {
  const issue=await store.openIssue(a.issue_id);
  await store.refs('observation',a.observation_ids||[],issue.plant_id);
  const old=await store.first('SELECT * FROM hypotheses WHERE id=? AND user_id=?',a.id,store.user.id);
  if(a.status!=='ACTIVE')assert(a.conclusion?.trim(),'CONCLUSION_REQUIRED','Supported, rejected or inconclusive hypotheses need an explanation.');
  const fields={title:a.title,status:a.status,reasoning:a.reasoning,conclusion:a.conclusion||null,observation_ids_json:JSON.stringify(a.observation_ids||[])};
  let hypothesis;
  if(old) {
    assert(old.issue_id===issue.id,'WRONG_ISSUE','Hypothesis cannot move to a different issue.');
    assert(a.expected_version,'VERSION_REQUIRED','Supply current expected_version.');
    hypothesis=await store.change('hypothesis',a.id,a.expected_version,fields,"AND EXISTS(SELECT 1 FROM issues WHERE id=hypotheses.issue_id AND status='OPEN')");
  } else {
    assert(a.expected_version===undefined,'NOT_FOUND','Hypothesis not found.',404);
    const stamp=now();hypothesis=await store.insert('hypothesis',{...fields,issue_id:issue.id,plant_id:issue.plant_id,created_at:stamp,updated_at:stamp},a.id);
  }
  return {hypothesis};
}
export async function createExperiment(store,a) {
  const issue=await store.openIssue(a.issue_id);
  if(a.hypothesis_id) {const h=await store.get('hypothesis',a.hypothesis_id);assert(h.issue_id===issue.id,'WRONG_ISSUE','Hypothesis belongs to another issue.');}
  const stamp=now();return {experiment:await store.insert('experiment',{plant_id:issue.plant_id,issue_id:issue.id,hypothesis_id:a.hypothesis_id||null,title:a.title,change_text:a.change_text,success_criteria:a.success_criteria,evaluate_at:instant(a.evaluate_at),created_at:stamp,updated_at:stamp},a.id)};
}
export async function updateExperiment(store,a) {
  const e=await store.get('experiment',a.id);await store.openIssue(e.issue_id);
  const allowed={PLANNED:['ACTIVE','CANCELLED'],ACTIVE:['COMPLETED','CANCELLED'],COMPLETED:[],CANCELLED:[]};
  assert(allowed[e.status].includes(a.status),'INVALID_TRANSITION',`Cannot move ${e.status} to ${a.status}.`,409);
  let started=e.started_at;const evaluate=a.evaluate_at?instant(a.evaluate_at):e.evaluate_at;
  if(a.status==='ACTIVE') {
    assert(a.user_confirmed&&a.started_at,'CONFIRMATION_REQUIRED','Start only after the user actually performed or confirmed the change; supply started_at.');
    started=instant(a.started_at);assert(Date.parse(started)<=Date.now()+300000,'FUTURE_START','A future plan is not an active experiment.');
  }
  if(started)assert(evaluate>started,'EVALUATION_WINDOW','evaluate_at must be after started_at.');
  if(a.status==='COMPLETED')assert(a.result?.trim(),'RESULT_REQUIRED','Record what was observed, including inconclusive results.');
  return {experiment:await store.change('experiment',a.id,a.expected_version,{status:a.status,started_at:started,evaluate_at:evaluate,result:a.result||null},"AND EXISTS(SELECT 1 FROM issues WHERE id=experiments.issue_id AND status='OPEN')")};
}
export async function saveFollowup(store,a) {
  await store.get('plant',a.plant_id);
  if(a.issue_id) {const issue=await store.openIssue(a.issue_id);assert(issue.plant_id===a.plant_id,'WRONG_PLANT','Issue belongs to another plant.');}
  if(a.experiment_id) {const e=await store.get('experiment',a.experiment_id);assert(a.issue_id&&e.issue_id===a.issue_id&&e.plant_id===a.plant_id,'WRONG_EXPERIMENT','Supply the experiment’s own issue and plant.');}
  const stamp=now();return {followup:await store.insert('followup',{plant_id:a.plant_id,issue_id:a.issue_id||null,experiment_id:a.experiment_id||null,type:a.type,context:a.context,due_at:instant(a.due_at),created_at:stamp,updated_at:stamp},a.id)};
}
export async function updateFollowup(store,a) {
  const f=await store.get('followup',a.id);
  assert(['PENDING','NOTIFIED'].includes(f.status),'FOLLOWUP_CLOSED','Followup is already terminal.',409);
  const fields={status:a.status,lease_token:null,lease_until:null};
  if(a.status==='PENDING') {
    assert(a.due_at,'DATE_REQUIRED','Rescheduling requires due_at.');
    Object.assign(fields,{due_at:instant(a.due_at),notified_at:null,attempts:0,next_attempt_at:null,last_error:null});
  }
  if(f.issue_id)await store.openIssue(f.issue_id);
  return {followup:await store.change('followup',f.id,a.expected_version,fields)};
}
export async function getDue(store) {
  const rows=await store.all(`SELECT f.*,p.display_name AS plant_name FROM followups f JOIN plants p ON p.id=f.plant_id WHERE f.user_id=? AND p.deleting=0 AND f.status='PENDING' AND f.due_at<=? AND (f.next_attempt_at IS NULL OR f.next_attempt_at<=?) ORDER BY f.due_at LIMIT 30`,store.user.id,now(),now());
  return {followups:rows.map(r=>store.decorate('followup',r)),delivery_semantics:'Reading does not mean notified or completed.'};
}
// External scheduled hosts can claim a task; the same lease is used by the optional native-event dispatcher.
export async function claimFollowup(store,id) {
  await store.get('followup',id);const token=uid(),stamp=now();
  const row=await store.stmt(`UPDATE followups SET lease_token=?,lease_until=? WHERE id=? AND user_id=? AND status='PENDING' AND due_at<=? AND (lease_until IS NULL OR lease_until<=?) AND (next_attempt_at IS NULL OR next_attempt_at<=?) RETURNING *`,token,after(120000),id,store.user.id,stamp,stamp,stamp).first();
  assert(row,'LEASE_UNAVAILABLE','Not due, already notified, or leased by another delivery.',409);
  return {followup:store.decorate('followup',row),lease_token:token};
}
export async function ackFollowup(store,a) {
  const result=await store.run(`UPDATE followups SET status='NOTIFIED',notified_at=?,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND user_id=? AND lease_token=? AND lease_until>? AND status='PENDING'`,now(),now(),a.id,store.user.id,a.lease_token,now());
  assert(result.meta.changes===1,'LEASE_UNAVAILABLE','Lease expired or already acknowledged.',409);return {followup:await store.get('followup',a.id)};
}
export async function addJournal(store,a) {
  await store.get('plant',a.plant_id);
  return {entry:await store.insert('journal',{plant_id:a.plant_id,entry_type:a.entry_type,title:a.title,summary:a.summary,occurred_at:a.occurred_at?instant(a.occurred_at):now(),created_at:now()},a.id)};
}
export async function closeIssue(store,a) {
  const issue=await store.get('issue',a.issue_id);
  if(issue.status!=='OPEN') {
    assert(issue.closure_key===a.request_id,'ISSUE_CLOSED','Issue was already closed by another request.',409);
    return {issue,journal_entry:store.decorate('journal',await store.first('SELECT * FROM journal_entries WHERE issue_id=? AND user_id=?',issue.id,store.user.id)),replayed:true};
  }
  assert(a.user_confirmed,'CONFIRMATION_REQUIRED','Confirm closure with the user.');
  assert(issue.version===a.expected_version,'CONFLICT','Case changed; reload before writing its final summary.',409);
  const observations=await store.refs('observation',a.observation_ids||[],issue.plant_id);
  if(a.outcome!=='UNKNOWN')assert(observations.length>0,'OUTCOME_EVIDENCE_REQUIRED','Resolved/no-improvement needs recorded observations. Missing data means UNKNOWN.');
  const ended=now(),resultAt=a.result_observed_at?instant(a.result_observed_at):null;
  if(a.outcome==='RESOLVED')assert(resultAt,'RESULT_DATE_REQUIRED','Record when the result was observed, not just when the issue was closed.');
  else assert(!resultAt,'INVALID_RESULT_DATE','A result date is only valid for a resolved issue.');
  assert(!resultAt||(resultAt>=issue.opened_at&&resultAt<=ended),'BAD_RESULT_DATE','Result date must fall between detection and closure.');
  const experiments=await store.all('SELECT * FROM experiments WHERE issue_id=? AND user_id=? ORDER BY created_at',issue.id,store.user.id);
  const hypotheses=await store.all('SELECT * FROM hypotheses WHERE issue_id=? AND user_id=? ORDER BY created_at',issue.id,store.user.id);
  const elapsed=days(issue.opened_at,ended),untilResult=resultAt?days(issue.opened_at,resultAt):null;
  const attempts=experiments.filter(e=>e.started_at).map(e=>`E${e.seq}: ${e.change_text} (с ${e.started_at}; ${e.result||'итог эксперимента не зафиксирован'})`);
  const plans=experiments.filter(e=>!e.started_at).map(e=>`E${e.seq}: ${e.title} — не начинали`);
  const conclusion= a.outcome==='RESOLVED' ? `Результат наблюдался через ${untilResult} дн. после обнаружения; закрыто через ${elapsed} дн.` : a.outcome==='NO_IMPROVEMENT' ? `По указанным наблюдениям улучшения за ${elapsed} дн. не зафиксировано.` : `Закрыто через ${elapsed} дн. Данных для подтверждения результата недостаточно; это не доказывает неэффективность попыток.`;
  const summary=[`Проблема: ${issue.title}. ${issue.description}`,`Что делали: ${attempts.join('; ')||'Начатых экспериментов не записано.'}`,
    ...(plans.length?[`Что только планировали: ${plans.join('; ')}.`]:[]),
    `Гипотезы: ${hypotheses.map(h=>`H${h.seq} ${h.title}: ${h.status}; ${h.conclusion||'окончательный вывод отсутствует'}`).join('; ')||'не записаны'}.`,
    `Итог: ${a.result_text}. ${conclusion}`,`Причина закрытия: ${a.reason}.`,
    ...(a.lesson?[`Вывод на будущее: ${a.lesson}`]:[]),
    `Источники: ${observations.map(o=>`O${o.seq}`).join(', ')||'наблюдений результата нет'}. Поддержка гипотезы не равна доказанной причинности.`].join('\n');
  const status=a.outcome==='RESOLVED'?'RESOLVED':'CLOSED_NO_RESULT',journalId=uid();
  // Every downstream write is gated on the unique winning closure key. Losing concurrent requests do nothing.
  const gate='EXISTS(SELECT 1 FROM issues i WHERE i.id=? AND i.user_id=? AND i.closure_key=?)';
  const gateArgs=[issue.id,store.user.id,a.request_id];
  let result;
  try { result=await store.db.batch([
    store.stmt(`UPDATE issues SET status=?,outcome=?,closed_at=?,result_observed_at=?,closure_reason=?,closure_summary=?,closure_key=?,version=version+1,updated_at=? WHERE id=? AND user_id=? AND version=? AND status='OPEN'`,status,a.outcome,ended,resultAt,a.reason,summary,a.request_id,ended,issue.id,store.user.id,a.expected_version),
    store.stmt(`INSERT INTO journal_entries(id,user_id,plant_id,entry_type,issue_id,title,summary,outcome,duration_days,time_to_result_days,occurred_at,created_at) SELECT ?,?,?,'ISSUE_OUTCOME',?,?,?,?,?,?,?,? WHERE ${gate}`,journalId,store.user.id,issue.plant_id,issue.id,issue.title,summary,a.outcome,elapsed,untilResult,ended,ended,...gateArgs),
    store.stmt(`UPDATE hypotheses SET status='INCONCLUSIVE',conclusion=COALESCE(conclusion,'Расследование закрыто; окончательная проверка отсутствует.'),version=version+1,updated_at=? WHERE issue_id=? AND user_id=? AND status='ACTIVE' AND ${gate}`,ended,issue.id,store.user.id,...gateArgs),
    store.stmt(`UPDATE experiments SET status='CANCELLED',result=COALESCE(result,'Issue закрыт; результат эксперимента не установлен.'),version=version+1,updated_at=? WHERE issue_id=? AND user_id=? AND status IN('PLANNED','ACTIVE') AND ${gate}`,ended,issue.id,store.user.id,...gateArgs),
    store.stmt(`UPDATE followups SET status='CANCELLED',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE issue_id=? AND user_id=? AND status IN('PENDING','NOTIFIED') AND ${gate}`,ended,issue.id,store.user.id,...gateArgs)
  ]); } catch(error) {
    const latest=await store.get('issue',issue.id);
    if(latest.closure_key===a.request_id&&latest.status!=='OPEN')return {issue:latest,journal_entry:store.decorate('journal',await store.first('SELECT * FROM journal_entries WHERE issue_id=? AND user_id=?',issue.id,store.user.id)),replayed:true};
    throw error;
  }
  assert(result[0].meta.changes===1,'CONFLICT','Case changed before closure. No journal was added; reload.',409);
  return {issue:await store.get('issue',issue.id),journal_entry:await store.get('journal',journalId)};
}
export async function records(store,a) {
  assert(['photo','observation','issue','hypothesis','experiment','followup','journal','input'].includes(a.type),'BAD_TYPE','Unsupported record list.');
  await store.get('plant',a.plant_id);const limit=a.limit||30,offset=a.offset||0;
  const search=a.query?` AND ${a.type==='journal'?"(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')":a.type==='issue'?"title LIKE ? ESCAPE '\\'":"1=1"}`:'';
  const pattern=a.query?'%'+a.query.replace(/[\\%_]/g,'\\$&')+'%':null;
  const args=[a.plant_id,store.user.id,...(a.query&&a.type==='journal'?[pattern,pattern]:a.query&&a.type==='issue'?[pattern]:[]),limit+1,offset];
  const order=a.type==='photo'?'COALESCE(captured_at,received_at)':'created_at';
  const rows=await store.all(`SELECT * FROM ${TABLES[a.type]} WHERE plant_id=? AND user_id=? ${search} ORDER BY ${order} DESC,id DESC LIMIT ? OFFSET ?`,...args);
  return {items:rows.slice(0,limit).map(r=>store.decorate(a.type,r)),next_offset:rows.length>limit?offset+limit:null};
}
export async function caseFile(store,a) {
  const plant=await store.get('plant',a.plant_id),result={plant,settings:await settings(store),truncated:{}};
  for(const [type,name,condition] of [['issue','issues',"AND status='OPEN'"],['hypothesis','hypotheses',"AND issue_id IN(SELECT id FROM issues WHERE status='OPEN')"],['experiment','experiments',"AND status IN('ACTIVE','PLANNED')"],['followup','followups',"AND status IN('PENDING','NOTIFIED')"],['observation','observations',''],['journal','journal',''],['photo','photos','']]) {
    const limit=['observation','photo','journal'].includes(type)?12:40;
    const order=type==='photo'?'COALESCE(captured_at,received_at)':'created_at';
    const rows=await store.all(`SELECT * FROM ${TABLES[type]} WHERE user_id=? AND plant_id=? ${condition} ORDER BY ${order} DESC,id DESC LIMIT ?`,store.user.id,plant.id,limit+1);
    result[name]=rows.slice(0,limit).map(r=>store.decorate(type,r));result.truncated[name]=rows.length>limit;
  }
  return {case_file:result};
}
export async function deletePlant(store,a) {
  assert(a.confirm_name?.length,'CONFIRMATION_REQUIRED','Type the exact plant name to confirm deletion.');
  // Resume a partially completed deletion. SQL tombstone prevents new writes and media reads meanwhile.
  const plant=await store.first('SELECT * FROM plants WHERE id=? AND user_id=?',a.plant_id,store.user.id);
  if(!plant)return {deleted:true,already_absent:true};
  assert(a.confirm_name===plant.display_name,'CONFIRMATION_REQUIRED','Plant name does not match.');
  await store.run('UPDATE plants SET deleting=1 WHERE id=? AND user_id=?',plant.id,store.user.id);
  const photos=await store.all('SELECT r2_key FROM photos WHERE plant_id=? AND user_id=?',plant.id,store.user.id);
  // R2 delete is idempotent. Keep DB rows until every object deletion succeeds; retry after a failure.
  for(let i=0;i<photos.length;i+=100)await store.env.PHOTOS.delete(photos.slice(i,i+100).map(p=>p.r2_key));
  await store.run('DELETE FROM plants WHERE id=? AND user_id=?',plant.id,store.user.id);
  return {deleted:true,photo_count:photos.length};
}
