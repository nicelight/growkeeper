import {assert,AppError,now,uid} from './lib.js';
export const TABLES = Object.freeze({plant:'plants',input:'inputs',photo:'photos',observation:'observations',issue:'issues',hypothesis:'hypotheses',experiment:'experiments',followup:'followups',journal:'journal_entries'});
const PREFIX={observation:'O',issue:'I',hypothesis:'H',experiment:'E',followup:'F',journal:'J'};
export class Store {
  constructor(env, user) {this.env=env;this.db=env.DB;this.user=user;}
  stmt(sql,...args) {return this.db.prepare(sql).bind(...args);}
  async all(sql,...args) {return (await this.stmt(sql,...args).all()).results;}
  async first(sql,...args) {return this.stmt(sql,...args).first();}
  async run(sql,...args) {return this.stmt(sql,...args).run();}
  async get(type,id) {
    assert(Object.hasOwn(TABLES,type),'BAD_TYPE','Unknown entity type.');
    const row=await this.first(`SELECT * FROM ${TABLES[type]} WHERE id=? AND user_id=?`,id,this.user.id);
    assert(row,'NOT_FOUND','Entity not found.',404);
    if(type==='plant') assert(!row.deleting,'PLANT_DELETING','Plant deletion is in progress.',409);
    else if(row.plant_id) {
      const p=await this.first('SELECT deleting FROM plants WHERE id=? AND user_id=?',row.plant_id,this.user.id);
      assert(p&&!p.deleting,'PLANT_DELETING','Plant unavailable or deletion in progress.',409);
    }
    return this.decorate(type,row);
  }
  decorate(type,row) {
    const copy={...row}; delete copy.r2_key; delete copy.sha256;
    if(PREFIX[type]) copy.short_code=PREFIX[type]+row.seq;
    copy.entity_type=type;
    copy.url=`${this.env.PUBLIC_ORIGIN}/entity/${type}/${encodeURIComponent(row.id)}`;
    return copy;
  }
  async insert(type,fields,id=uid()) {
    const existing=await this.first(`SELECT * FROM ${TABLES[type]} WHERE id=? AND user_id=?`,id,this.user.id);
    const checkReplay=(row)=>{
      const generatedTimes=new Set(['created_at','updated_at','received_at','observed_at','opened_at','occurred_at']);
      for(const [key,value] of Object.entries(fields))if(!generatedTimes.has(key))assert(row[key]===value,'IDEMPOTENCY_CONFLICT','ID already exists with different content. Use update or a fresh ID.',409);
    };
    if(existing) {checkReplay(existing);return this.get(type,id);}
    const data={id,user_id:this.user.id,...fields};
    const keys=Object.keys(data);
    try {await this.run(`INSERT INTO ${TABLES[type]} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,...Object.values(data));}
    catch(e) {const again=await this.first(`SELECT * FROM ${TABLES[type]} WHERE id=? AND user_id=?`,id,this.user.id); if(!again) throw e;checkReplay(again);}
    return this.get(type,id);
  }
  async change(type,id,expected,fields,where='',args=[]) {
    const old=await this.get(type,id);
    assert(old.version===expected,'CONFLICT','State changed. Reload the entity and retry.',409,{current_version:old.version});
    const set={...fields,updated_at:now()};
    const result=await this.run(`UPDATE ${TABLES[type]} SET ${Object.keys(set).map(k=>k+'=?').join(',')},version=version+1 WHERE id=? AND user_id=? AND version=? ${where}`, ...Object.values(set),id,this.user.id,expected,...args);
    assert(result.meta.changes===1,'CONFLICT','State changed. Reload before retrying.',409);
    return this.get(type,id);
  }
  async openIssue(id) {const issue=await this.get('issue',id);assert(issue.status==='OPEN','ISSUE_CLOSED','Issue is closed.',409);return issue;}
  async refs(type,ids,plantId) {
    const rows=[]; for(const id of new Set(ids||[])) {
      const row=await this.get(type,id);assert(row.plant_id===plantId,'WRONG_PLANT','Reference belongs to another plant.',409);rows.push(row);
    }return rows;
  }
}
export function publicError(e) {
  if(e instanceof AppError) return e;
  const msg=String(e?.message||'');
  if(msg.includes('one_active_experiment')||msg.includes('experiments.user_id, experiments.plant_id')) return new AppError('ACTIVE_EXPERIMENT','Finish the current experiment before starting another for this plant.',409);
  if(msg.includes('DERIVED_DATA_EXISTS')) return new AppError('DERIVED_DATA_EXISTS','Referenced photo assignment cannot be changed silently.',409);
  if(msg.includes('PLANT_DELETING')) return new AppError('PLANT_DELETING','Plant deletion is in progress.',409);
  if(msg.includes('WRONG_PHOTO_PLANT')) return new AppError('WRONG_PLANT','Photo references do not belong to this plant.',409);
  if(msg.includes('ISSUE_CLOSED')) return new AppError('ISSUE_CLOSED','Issue is already closed.',409);
  if(msg.includes('FOREIGN KEY')||msg.includes('CHECK constraint')) return new AppError('INVARIANT','Relationship or state constraint failed.',409);
  if(msg.includes('UNIQUE constraint')) return new AppError('CONFLICT','Duplicate identifier or name.',409);
  return new AppError('INTERNAL','Unexpected error; use the request ID in server logs.',500);
}
