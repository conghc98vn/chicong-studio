import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,appendFile,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import {openDatabase} from '../server/db.mjs';
import {createApp} from '../server/app.mjs';
import {createFeedbackService} from '../server/feedback.mjs';
import {FEEDBACK_TABLES} from '../server/feedback-schema.mjs';
import {initializeDeletionLedger,prepareRestoredFeedback,reconcileFeedbackDeletions} from '../server/handover-privacy.mjs';
const execute=promisify(execFile);
const cli=path.resolve('studio/tools/feedback-ops.mjs');
async function fixture(t,{sqlite=false}={}) {
 const root=await mkdtemp(path.join(tmpdir(),'feedback-raw-restore-')),dataDir=path.join(root,'data'),ledgerFile=path.join(root,'independent.jsonl');
 let pool,schema,url=null,db;
 t.after(async()=>{await db?.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(root,{recursive:true,force:true});});
 if(!sqlite&&process.env.STUDIO_TEST_POSTGRES_URL){pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});schema='raw_feedback_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema);url=target.href;}
 await mkdir(dataDir);db=await openDatabase(dataDir,{url});await initializeDeletionLedger(ledgerFile);
 const env={SITE_URL:'http://127.0.0.1',FEEDBACK_LINK_SECRET:randomBytes(32).toString('base64url'),NOTIFICATION_EMAIL:'synthetic@example.invalid'};
 const service=createFeedbackService({db,env,mailer:{enabled:true}});
 return {root,dataDir,ledgerFile,db,url,env,service};
}
async function seed(f){
 let h=(await f.service.create({clientName:'Synthetic',title:'Raw restore fixture',requestKey:randomUUID()})).handover;
 h=(await f.service.command(h.id,{command:'complete',expectedVersion:h.version,requestKey:randomUUID()})).handover;
 const token=(await f.service.link(h.id)).url.split('#')[1];
 const states=['pending','processing','retry_wait','blocked_config','failed','suppressed','accepted_by_provider'];
 for(let n=0;n<states.length;n++){
  await f.service.putPublic(h.id,token,{name:'Synthetic',message:'Version '+n,ratings:{overall:5,shoot:null,product:null,delivery:null},formVersion:1,expectedVersion:n,...(n===0?{expectedContextVersion:h.contextVersion}:{}),requestKey:randomUUID()});
  await f.db.run('UPDATE feedback_notifications SET state=?,claim_id=?,lease_until=?,next_attempt_at=?,provider_reference=? WHERE version=?',[states[n],'old-claim',Date.now()+100000,Date.now()+100000,'reference-'+n,n+1]);
 }
 return {h,token};
}
function runCli(f,args=[],overrides={}) {
 const env={...process.env,DATABASE_URL:f.url||'',FEEDBACK_API_PAUSED:'true',FEEDBACK_NOTIFICATIONS_PAUSED:'true',...overrides};
 return execute(process.execPath,[cli,'prepare-restored','--ledger',f.ledgerFile,'--data-dir',f.dataDir,'--processes-stopped','yes',...args],{env});
}
async function pending(db){return (await db.get("SELECT value FROM settings WHERE key='feedback_restore_pending'"))?.value;}

test('raw restore preparation revokes every issued state, suppresses unfinished mail, preserves immutable history and stays gated across reruns',async t=>{
 const f=await fixture(t),{h,token}=await seed(f);
 for(const state of ['unissued','paused','revoked']){const other=(await f.service.create({clientName:'Synthetic '+state,title:'Fixture',requestKey:randomUUID()})).handover;await f.db.run('UPDATE handovers SET invitation_state=? WHERE id=?',[state,other.id]);}
 const before=await f.db.all('SELECT * FROM handovers ORDER BY id'),revisions=await f.db.all('SELECT * FROM feedback_revisions ORDER BY version'),receipts=await f.db.all('SELECT * FROM feedback_request_receipts ORDER BY request_key');
 const accepted=await f.db.get("SELECT * FROM feedback_notifications WHERE state='accepted_by_provider'");
 const result=await prepareRestoredFeedback(f);assert.equal(result.handovers,4);assert.equal(result.suppressed,6);assert.equal(result.released,false);assert.equal(await pending(f.db),'true');
 const after=await f.db.all('SELECT * FROM handovers ORDER BY id');
 for(let i=0;i<after.length;i++){assert.equal(after[i].invitation_state,before[i].invitation_state==='unissued'?'unissued':'revoked');assert.notEqual(after[i].invitation_nonce,before[i].invitation_nonce);assert.equal(after[i].handover_version,before[i].handover_version+1);for(const key of ['operation_key','operation_hash','operation_result'])assert.equal(after[i][key],null);}
 for(const row of await f.db.all("SELECT * FROM feedback_notifications WHERE state<>'accepted_by_provider'")){assert.equal(row.state,'suppressed');assert.equal(row.claim_id,null);assert.equal(Number(row.lease_until),0);assert.equal(Number(row.next_attempt_at),0);assert.equal(row.suppressed_reason,'restored_requires_review');}
 await prepareRestoredFeedback(f);assert.equal(await pending(f.db),'true');
 assert.deepEqual(await f.db.all('SELECT * FROM feedback_revisions ORDER BY version'),revisions);assert.deepEqual(await f.db.all('SELECT * FROM feedback_request_receipts ORDER BY request_key'),receipts);assert.deepEqual(await f.db.get("SELECT * FROM feedback_notifications WHERE state='accepted_by_provider'"),accepted);
 await assert.rejects(f.service.getPublic(h.id,token));
});

test('prepared raw restore blocks createApp API and dispatcher even when runtime pause variables are absent',async t=>{
 const f=await fixture(t),{h}=await seed(f);await prepareRestoredFeedback(f);let calls=0;
 const instance=await createApp({db:f.db,dataDir:f.dataDir,env:f.env,mailer:{enabled:true,sendEmail:async()=>{calls++;return {success:true};}}});
 try{assert.equal(instance.feedback.readiness().apiPaused,true);assert.equal(instance.feedback.readiness().notificationsPaused,true);await assert.rejects(instance.feedback.detail(h.id),error=>error.code==='FEEDBACK_PAUSED');await instance.feedbackDispatcher.runOnce();assert.equal(calls,0);}
 finally{await instance.feedbackDispatcher.stop();await instance.photoCleanup.close();await instance.mediaControl.close();instance.storage.close?.();}
});

test('pre-feedback raw database receives only feedback schema and remains gated until separate deletion reconciliation',async t=>{
 const f=await fixture(t);
 for(const table of [...FEEDBACK_TABLES].reverse())await f.db.exec('DROP TABLE '+table+(f.db.cloud?' CASCADE':''));
 const settings=await f.db.all('SELECT * FROM settings ORDER BY key');
 const result=JSON.parse((await runCli(f)).stdout);assert.equal(result.handovers,0);assert.equal(result.released,false);
 for(const table of FEEDBACK_TABLES)assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM '+table)).n),0);
 assert.deepEqual(await f.db.all("SELECT * FROM settings WHERE key<>'feedback_restore_pending' ORDER BY key"),settings);assert.equal(await pending(f.db),'true');
 await assert.rejects(execute(process.execPath,[cli,'reconcile','--ledger',f.ledgerFile,'--data-dir',f.dataDir,'--processes-stopped','yes'],{env:{...process.env,DATABASE_URL:f.url||'',FEEDBACK_API_PAUSED:'true',FEEDBACK_NOTIFICATIONS_PAUSED:'true'}}),/Confirm the independently/);assert.equal(await pending(f.db),'true');
 await execute(process.execPath,[cli,'reconcile','--ledger',f.ledgerFile,'--data-dir',f.dataDir,'--processes-stopped','yes','--ledger-reviewed','yes','--secret-rotated','yes'],{env:{...process.env,DATABASE_URL:f.url||'',FEEDBACK_API_PAUSED:'true',FEEDBACK_NOTIFICATIONS_PAUSED:'true'}});assert.equal(await pending(f.db),undefined);
});

test('failed transaction leaves original rows intact with durable startup gate, and retry completes',async t=>{
 const f=await fixture(t);await seed(f);const before=await f.db.all('SELECT * FROM handovers ORDER BY id'),notifications=await f.db.all('SELECT * FROM feedback_notifications ORDER BY version');
 const faulty={transaction:callback=>f.db.transaction(tx=>callback({...tx,run:(sql,args)=>{if(sql.startsWith('UPDATE feedback_notifications'))throw Error('synthetic write failure');return tx.run(sql,args);}}))};
 await assert.rejects(prepareRestoredFeedback({...f,db:faulty}),/synthetic write failure/);assert.equal(await pending(f.db),'true');assert.deepEqual(await f.db.all('SELECT * FROM handovers ORDER BY id'),before);assert.deepEqual(await f.db.all('SELECT * FROM feedback_notifications ORDER BY version'),notifications);
 await assert.rejects(reconcileFeedbackDeletions({...f,release:true}),/preparation is incomplete/);assert.equal(await pending(f.db),'true');
 await prepareRestoredFeedback(f);assert.equal((await f.db.get('SELECT invitation_state FROM handovers')).invitation_state,'revoked');
});

test('malformed independent ledger leaves persistent gate and cannot release restored records',async t=>{
 const f=await fixture(t),{h}=await seed(f);await appendFile(f.ledgerFile,'{"partial":');await assert.rejects(prepareRestoredFeedback(f),/incomplete/);assert.equal(await pending(f.db),'true');assert.equal((await f.db.get('SELECT invitation_state FROM handovers WHERE id=?',[h.id])).invitation_state,'active');await assert.rejects(reconcileFeedbackDeletions({...f,release:true}),/incomplete/);assert.equal(await pending(f.db),'true');
});

test('actual CLI requires both pauses, explicit data directory, stopped processes and a real external ledger before database writes',async t=>{
 const f=await fixture(t,{sqlite:true});await seed(f);
 for(const overrides of [{FEEDBACK_API_PAUSED:''},{FEEDBACK_NOTIFICATIONS_PAUSED:''}])await assert.rejects(runCli(f,[],overrides),/Stop\/drain every app/);
 await assert.rejects(runCli(f,['--processes-stopped','no']),/Stop\/drain every app/);
 await assert.rejects(execute(process.execPath,[cli,'prepare-restored','--ledger',f.ledgerFile],{env:{...process.env,DATABASE_URL:''}}),/Select --data-dir explicitly/);
 const inside=path.join(f.dataDir,'ledger.jsonl'),alias=path.join(f.root,'external-alias.jsonl');await initializeDeletionLedger(inside);await symlink(inside,alias);await assert.rejects(runCli(f,['--ledger',alias]),/outside the data directory/);
 assert.equal(await pending(f.db),undefined);assert.equal((await f.db.get('SELECT invitation_state FROM handovers')).invitation_state,'active');
 assert.equal(JSON.parse((await runCli(f)).stdout).prepared,true);assert.equal(await pending(f.db),'true');
});

test('independent deletion intents are replayed only by separate reconciliation after raw preparation',async t=>{
 const f=await fixture(t),{h}=await seed(f);await appendFile(f.ledgerFile,JSON.stringify({type:'intent',requestId:randomUUID(),handoverId:h.id,at:new Date().toISOString()})+'\n');await prepareRestoredFeedback(f);assert.ok(await f.db.get('SELECT id FROM handovers'));assert.equal(await pending(f.db),'true');
 assert.equal((await reconcileFeedbackDeletions({...f,release:true})).reconciled,1);for(const table of FEEDBACK_TABLES)assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM '+table)).n),0);assert.equal(await pending(f.db),undefined);
});
