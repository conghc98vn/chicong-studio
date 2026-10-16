import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
const context=new AsyncLocalStorage();
const blocked=()=>Object.assign(Error('Ảnh đang tạm khóa để bảo trì hoặc sao lưu. Vui lòng thử lại sau.'),{status:503,code:'MEDIA_LOCKED'});
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
// Match Express's default case-insensitive routing so alternate casing cannot
// bypass the writer registration and maintenance/storage-binding gates.
export const mediaMutation=req=>!['GET','HEAD','OPTIONS'].includes(req.method)&&/^\/api\/admin\/(albums|photos|sections|portrait|settings)(\/|$)/i.test(req.originalUrl.split('?')[0]);

export async function createMediaControl(db,identity){
 const processId=randomUUID(),active=new Set();let closing=false;
 await db.run("INSERT INTO media_control(id,storage,owner,deadline,generation) VALUES(1,?,NULL,0,0) ON CONFLICT(id) DO NOTHING",[identity]);
 const row=tx=>tx.get('SELECT * FROM media_control WHERE id=1'+(tx.cloud?' FOR UPDATE':''));
 const assertIdentity=r=>{if(r.storage!==identity)throw Object.assign(Error('Media provider differs from the bound database. Complete the locked storage cutover first.'),{code:'STORAGE_BINDING_MISMATCH'});};
 const assertWritePermit=(r,owner)=>{assertIdentity(r);if(r.owner&&!(owner===r.owner&&Number(r.deadline)>Date.now()))throw blocked();};
 const initialize=async()=>assertIdentity(await db.get('SELECT * FROM media_control WHERE id=1'));
 await initialize();
 const status=async()=>({control:await db.get('SELECT * FROM media_control WHERE id=1'),writers:await db.all('SELECT * FROM media_writers ORDER BY started'),unknown:await db.all("SELECT * FROM media_writes WHERE state<>'stored' ORDER BY created"),cleanup:await db.get('SELECT COUNT(*) AS count FROM photo_cleanup')});
 const execute=async(kind,fn,{owner,independent=false}={})=>{
  if(!independent&&context.getStore()?.control===api&&context.getStore().active)return fn();
  if(closing)throw blocked();
  // Publication holds the control row locked across remote I/O. Reject normal
  // writers from the committed lease first, keeping the web pool free for reads.
  // Recheck under the row lock below so acquiring a lease cannot race admission.
  if(db.cloud)assertWritePermit(await db.get('SELECT * FROM media_control WHERE id=1'),owner);
  const token=randomUUID();
  try{await db.transaction(async tx=>{
   // A lease can start after the nonlocking read. Bound that race's row-lock
   // wait as well, without making normal brief concurrent admissions fail.
   if(tx.cloud)await tx.exec("SET LOCAL lock_timeout = '1s'");
   assertWritePermit(await row(tx),owner);
   await tx.run('INSERT INTO media_writers(id,process_id,kind,started) VALUES(?,?,?,?)',[token,processId,kind,Date.now()]);
  });}catch(error){if(error.code==='55P03')throw blocked();throw error;}
  const scope={control:api,token,active:true};
  try{return await context.run(scope,fn);}
  finally{scope.active=false;await db.run('DELETE FROM media_writers WHERE id=?',[token]);}
 };
 const run=(...args)=>{const promise=execute(...args);active.add(promise);promise.then(()=>active.delete(promise),()=>active.delete(promise));return promise;};
 const close=async()=>{closing=true;while(active.size)await Promise.allSettled([...active]);};
 const acquire=async(owner,ttlMs=600000)=>{
  if(!owner||ttlMs<1000||ttlMs>86400000)throw Error('Invalid maintenance lease');
  return db.transaction(async tx=>{
   const r=await row(tx);assertIdentity(r);
   // Expired runs remain fenced. Explicit recovery is required; no silent unlock.
   if(r.owner)throw blocked();
   await tx.run('UPDATE media_control SET owner=?,deadline=?,generation=generation+1 WHERE id=1',[owner,Date.now()+ttlMs]);
   return {owner,generation:Number(r.generation)+1};
  });
 };
 const checkLease=(r,lease)=>{if(r.owner!==lease.owner||Number(r.generation)!==lease.generation||Number(r.deadline)<=Date.now())throw Error('Maintenance lease lost or expired');};
 const assertLease=async lease=>checkLease(await db.get('SELECT * FROM media_control WHERE id=1'),lease);
 const renew=async(lease,ttlMs=600000)=>db.transaction(async tx=>{const r=await row(tx);checkLease(r,lease);await tx.run('UPDATE media_control SET deadline=? WHERE id=1',[Date.now()+ttlMs]);});
 const drained=async tx=>{
  if(await tx.get('SELECT id FROM media_writers LIMIT 1'))throw Error('Media writers have not drained');
  if(await tx.get("SELECT key FROM media_writes WHERE state<>'stored' LIMIT 1"))throw Error('Unresolved storage writes require reconciliation');
 };
 const assertDrained=async(lease,{queue=false}={})=>db.transaction(async tx=>{checkLease(await row(tx),lease);await drained(tx);if(queue&&await tx.get('SELECT photo_id FROM photo_cleanup LIMIT 1'))throw Error('Source cleanup queue is not empty');});
 const release=async lease=>db.transaction(async tx=>{checkLease(await row(tx),lease);await drained(tx);await tx.run('UPDATE media_control SET owner=NULL,deadline=0 WHERE id=1');});
 const switchStorage=async(lease,target)=>db.transaction(async tx=>{checkLease(await row(tx),lease);await drained(tx);if(await tx.get('SELECT photo_id FROM photo_cleanup LIMIT 1'))throw Error('Source cleanup queue is not empty');await tx.run('UPDATE media_control SET storage=? WHERE id=1',[target]);});
 const recover=async({writersStopped=false,owner=randomUUID(),ttlMs=3600000}={})=>db.transaction(async tx=>{
  const r=await row(tx);if(!r.owner||Number(r.deadline)>Date.now())throw Error('Only an expired maintenance run can be recovered');
  if(writersStopped)await tx.run('DELETE FROM media_writers');
  await tx.run('UPDATE media_control SET owner=?,deadline=?,generation=generation+1 WHERE id=1',[owner,Date.now()+ttlMs]);
  return {owner,generation:Number(r.generation)+1};
 });
 const fenced=async(lease,fn)=>db.transaction(async tx=>{const r=await row(tx);checkLease(r,lease);await drained(tx);const result=await fn(tx,async()=>checkLease(await row(tx),lease));checkLease(await row(tx),lease);return result;});
 const api={close,fenced,identity,processId,initialize,status,run,acquire,assertLease,assertDrained,renew,release,switchStorage,recover};return api;
}

// A pending row is committed before sending PUT. A crash or an ambiguous response
// cannot erase evidence; a single HEAD 404 never clears this journal.
export function trackedStorage(db,raw,control){
 const uncertainPrefix=async prefix=>db.get("SELECT key FROM media_writes WHERE key LIKE ? AND state<>'stored' LIMIT 1",[prefix+'%']);
 return {...raw,
  async put(key,bytes,options){return control.run('storage-put',async()=>{
   await db.run('INSERT INTO media_writes(key,storage,sha256,bytes,state,created) VALUES(?,?,?,?,?,?)',[key,control.identity,hash(bytes),bytes.length,'pending',Date.now()]);
   try{await raw.put(key,bytes,options);await db.run("UPDATE media_writes SET state='stored' WHERE key=?",[key]);}
   catch(error){if(error.uncertain===false)await db.run('DELETE FROM media_writes WHERE key=?',[key]);else await db.run("UPDATE media_writes SET state='unknown' WHERE key=?",[key]).catch(()=>{});throw error;}
  });},
  async remove(key,options){return control.run('storage-delete',async()=>{
   const prefix=key.slice(0,32);
   if(await uncertainPrefix(prefix))throw Error('Unresolved write protects these objects');
   if(await db.get('SELECT id FROM photos WHERE filename=?',[prefix])||await db.get("SELECT key FROM settings WHERE key='portrait' AND value=?",[prefix]))throw Error('Referenced media cannot be removed');
   await raw.remove(key,options);await db.run('DELETE FROM media_writes WHERE key=?',[key]);
  });},
  async markUncertainPrefix(prefix){await db.run("UPDATE media_writes SET state='commit_unknown' WHERE key LIKE ?",[prefix+'%']);},
  hasUncertainPrefix:uncertainPrefix
 };
}
