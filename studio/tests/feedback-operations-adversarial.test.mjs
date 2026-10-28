import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,appendFile,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import {openDatabase} from '../server/db.mjs';
import {createFeedbackService} from '../server/feedback.mjs';
import {createFeedbackDispatcher} from '../server/feedback-notifications.mjs';
import {createMailer} from '../server/mailer.mjs';
import {initializeDeletionLedger,purgeHandover,reconcileFeedbackDeletions,readDeletionLedger} from '../server/handover-privacy.mjs';
import {databaseSnapshot,jsonBytes,sha256,putBlob,mappingHash,atomicFile,restoreBackup} from '../tools/media-backup.mjs';

const execFileAsync=promisify(execFile);
async function fixture(t) {
 const dir=await mkdtemp(path.join(tmpdir(),'feedback-ops-adversarial-'));
 let db,pool,schema;
 t.after(async()=>{await db?.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dir,{recursive:true,force:true});});
 let url=null;
 if(process.env.STUDIO_TEST_POSTGRES_URL){pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});schema='feedback_adv_'+randomBytes(12).toString('hex');await pool.query('CREATE SCHEMA '+schema);const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema+' -c statement_timeout=10000');url=target.href;}
 db=await openDatabase(path.join(dir,'data'),{url});
 const env={SITE_URL:'https://studio.example.invalid',FEEDBACK_LINK_SECRET:randomBytes(32).toString('base64url'),NOTIFICATION_EMAIL:'studio@example.invalid'};
 const mails=[],mailer={enabled:true,sendEmail:async mail=>{mails.push(mail);return {success:true,id:'synthetic'};}};
 const service=createFeedbackService({db,env,mailer});
 let h=(await service.create({clientName:'Synthetic customer',title:'Synthetic shoot',requestKey:randomUUID()})).handover;
 h=(await service.command(h.id,{command:'complete',expectedVersion:h.version,requestKey:randomUUID()})).handover;
 const token=(await service.link(h.id)).url.split('#')[1];
 const save=version=>service.putPublic(h.id,token,{name:'Synthetic sender',message:'Synthetic revision '+(version+1),improvement:'',ratings:{overall:5,shoot:null,product:null,delivery:null},formVersion:1,expectedVersion:version,expectedContextVersion:h.contextVersion,requestKey:randomUUID()});
 const notification=()=>db.get('SELECT * FROM feedback_notifications ORDER BY version LIMIT 1');
 return {dir,db,env,mailer,mails,service,h,save,notification};
}

test('an expired exhausted lease does not postpone the following deliverable notification',async t=>{
 const f=await fixture(t);await f.save(0);await f.save(1);
 const n=await f.notification();await f.db.run("UPDATE feedback_notifications SET state='processing',attempts=6,lease_until=1,claim_id='dead-worker',created_at='2000-01-01' WHERE id=?",[n.id]);
 const dispatcher=createFeedbackDispatcher(f);await dispatcher.runOnce();await dispatcher.stop();
 assert.equal((await f.notification()).state,'failed');assert.equal(f.mails.length,1);assert.match(f.mails[0].text,/Synthetic revision 2/);
});

for(const [label,error,expected] of [
 ['HTTP rate limit',{status:429},'retry_wait'],['HTTP request timeout',{status:408},'retry_wait'],
 ['HTTP provider unavailable',{status:503},'retry_wait'],['HTTP invalid recipient',{status:422},'failed'],
 ['SMTP temporary failure',{responseCode:451},'retry_wait'],['SMTP permanent rejection',{responseCode:550},'failed']
])test(label+' uses the correct durable notification state',async t=>{
 const f=await fixture(t);await f.save(0);let now=Date.now(),calls=0;f.mailer.sendEmail=async()=>{calls++;throw Object.assign(Error('synthetic transport response'),error);};
 const dispatcher=createFeedbackDispatcher({...f,clock:()=>now});await dispatcher.runOnce();const n=await f.notification();
 assert.equal(n.state,expected);assert.equal(n.attempts,1);assert.equal(n.claim_id,null);assert.equal(Number(n.lease_until),0);
 now+=59000;await dispatcher.runOnce();assert.equal(calls,1);await dispatcher.stop();
});

test('retry budget lasts six real attempts and uses each configured delay',async t=>{
 const f=await fixture(t);await f.save(0);let now=Date.now(),calls=0;f.mailer.sendEmail=async()=>{calls++;throw Error('synthetic outage');};
 const dispatcher=createFeedbackDispatcher({...f,clock:()=>now});
 for(const [index,delay] of [60000,300000,1800000,7200000,21600000].entries()){
  await dispatcher.runOnce();const n=await f.notification();assert.equal(n.state,'retry_wait');assert.equal(n.attempts,index+1);assert.equal(Number(n.next_attempt_at),now+delay);
  now+=delay-1;await dispatcher.runOnce();assert.equal(calls,index+1);now++;
 }
 await dispatcher.runOnce();assert.equal((await f.notification()).state,'failed');assert.equal(calls,6);now+=86400000;await dispatcher.runOnce();assert.equal(calls,6);await dispatcher.stop();
});

test('stopping during a send drains it and prevents claiming the next revision',async t=>{
 const f=await fixture(t);await f.save(0);await f.save(1);
 let entered,release;const started=new Promise(r=>entered=r),held=new Promise(r=>release=r);let calls=0;
 f.mailer.sendEmail=async()=>{calls++;entered();await held;return {success:true,id:'completed-before-shutdown'};};
 const dispatcher=createFeedbackDispatcher(f),running=dispatcher.runOnce();await started;let stopped=false;const stopping=dispatcher.stop().then(()=>stopped=true);
 await Promise.resolve();assert.equal(stopped,false);release();await Promise.all([running,stopping]);assert.equal(calls,1);
 const rows=await f.db.all('SELECT state FROM feedback_notifications ORDER BY version');assert.deepEqual(rows.map(n=>n.state),['accepted_by_provider','pending']);await dispatcher.runOnce();assert.equal(calls,1);
});

test('deletion intent survives a database failure and reconcile retries it before releasing the gate',async t=>{
 const f=await fixture(t);await f.save(0);const ledger=path.join(f.dir,'independent.jsonl');await initializeDeletionLedger(ledger);
 const failed={...f.db,transaction:async()=>{throw Error('synthetic database outage');}};
 await assert.rejects(purgeHandover({db:failed,ledgerFile:ledger,handoverId:f.h.id}),/synthetic database outage/);
 assert.equal((await readDeletionLedger(ledger)).length,1);assert.doesNotMatch(await readFile(ledger,'utf8'),/"applied"/);
 await f.db.run("INSERT INTO settings(key,value) VALUES('feedback_restore_pending','true')");
 await assert.rejects(reconcileFeedbackDeletions({db:failed,ledgerFile:ledger,release:true}),/outage/);
 assert.equal((await f.db.get("SELECT value FROM settings WHERE key='feedback_restore_pending'")).value,'true');
 await reconcileFeedbackDeletions({db:f.db,ledgerFile:ledger,release:true});assert.equal(await f.db.get('SELECT id FROM handovers WHERE id=?',[f.h.id]),undefined);assert.equal(await f.db.get("SELECT value FROM settings WHERE key='feedback_restore_pending'"),undefined);
});

test('conflicting ledger acknowledgements cannot clear the restore gate',async t=>{
 const f=await fixture(t),ledger=path.join(f.dir,'independent.jsonl');await initializeDeletionLedger(ledger);await f.db.run("INSERT INTO settings(key,value) VALUES('feedback_restore_pending','true')");
 await appendFile(ledger,JSON.stringify({type:'applied',requestId:randomUUID(),handoverId:f.h.id,at:new Date().toISOString()})+'\n');
 await assert.rejects(reconcileFeedbackDeletions({db:f.db,ledgerFile:ledger,release:true}),/without intent/);assert.equal((await f.db.get("SELECT value FROM settings WHERE key='feedback_restore_pending'")).value,'true');
});

test('offline purge rejects an apparently external ledger symlinked into the data directory',async t=>{
 const f=await fixture(t),dataDir=path.join(f.dir,'data'),realLedger=path.join(dataDir,'deletions.jsonl'),outside=path.join(f.dir,'outside');await mkdir(outside);await initializeDeletionLedger(realLedger);const ledger=path.join(outside,'ledger.jsonl');await symlink(realLedger,ledger);
 const env={PATH:process.env.PATH,FEEDBACK_API_PAUSED:'true',FEEDBACK_NOTIFICATIONS_PAUSED:'true'};
 await assert.rejects(execFileAsync(process.execPath,['studio/tools/feedback-ops.mjs','purge','--ledger',ledger,'--data-dir',dataDir,'--handover',f.h.id,'--processes-stopped','yes'],{cwd:path.resolve(import.meta.dirname,'../..'),env}),error=>{assert.match(error.stderr,/outside the data directory/);return true;});
 assert.equal((await readDeletionLedger(ledger)).length,0);
});

test('restore suppresses every unconfirmed queue state and preserves history without retaining an active claim',async t=>{
 const f=await fixture(t),states=['pending','processing','retry_wait','blocked_config','failed','suppressed','accepted_by_provider'];
 for(let i=0;i<states.length;i++)await f.save(i);
 const rows=await f.db.all('SELECT * FROM feedback_notifications ORDER BY version');
 for(const [index,row] of rows.entries())await f.db.run('UPDATE feedback_notifications SET state=?,recipient=?,claim_id=?,lease_until=?,provider_reference=? WHERE id=?',[states[index],states[index]==='blocked_config'?null:row.recipient,states[index]==='processing'?'stale-worker':null,states[index]==='processing'?Date.now()+120000:0,states[index]==='accepted_by_provider'?'accepted-before-backup':null,row.id]);
 const snapshot=await databaseSnapshot(f.db),root=path.join(f.dir,'repository'),bytes=jsonBytes(snapshot),hash=sha256(bytes);await putBlob(root,hash,bytes);
 await atomicFile(path.join(root,'snapshots','fixture.json'),jsonBytes({version:1,state:'complete',runId:'fixture',capturedAt:snapshot.capturedAt,appRevision:'test',storage:'fixture',databaseSha256:hash,mappingHash:mappingHash(snapshot),objects:[]}));
 const destination=path.join(f.dir,'restored');await restoreBackup(root,destination);const db=await openDatabase(destination,{url:null});
 try{
  const restored=await db.all('SELECT * FROM feedback_notifications ORDER BY version');assert.deepEqual(restored.map(n=>n.state),states.map(s=>s==='accepted_by_provider'?s:'suppressed'));
  for(const n of restored){assert.equal(n.claim_id,null);assert.equal(Number(n.lease_until),0);}
  assert.equal(restored.at(-1).provider_reference,'accepted-before-backup');assert.equal(restored[3].recipient,null);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM feedback_revisions')).n),7);assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM feedback_request_receipts')).n),7);
  assert.equal((await db.get("SELECT value FROM settings WHERE key='feedback_restore_pending'")).value,'true');
 }finally{await db.close();}
});

test('Resend malformed success cannot be recorded as provider acceptance',async t=>{
 const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
 const mailer=createMailer({RESEND_API_KEY:'synthetic-invalid-key',EMAIL_FROM:'sender@example.invalid'});
 for(const body of [{},{id:''},{id:123},{id:'\r\nreceipt'},{id:'a'.repeat(301)}]){
  globalThis.fetch=async()=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
  await assert.rejects(mailer.sendEmail({to:'studio@example.invalid',subject:'Synthetic test',text:'Synthetic only'}),/acceptance|identifier/i);
 }
 globalThis.fetch=async()=>new Response('{"id":"synthetic-receipt"}',{status:200,headers:{'Content-Type':'application/json'}});
 assert.equal((await mailer.sendEmail({to:'studio@example.invalid',subject:'Synthetic test',text:'Synthetic only'})).id,'synthetic-receipt');
});
