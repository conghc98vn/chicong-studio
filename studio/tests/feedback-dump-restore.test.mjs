// Opt in with STUDIO_FEEDBACK_DUMP_RESTORE=1. Own disposable loopback PG16;
// never reads .env, uses existing database credentials, or sends real email.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,rm,appendFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {createApp} from '../server/app.mjs';
import {createFeedbackService} from '../server/feedback.mjs';
import {initializeDeletionLedger} from '../server/handover-privacy.mjs';
import {FEEDBACK_TABLES} from '../server/feedback-schema.mjs';
const execute=promisify(execFile);
const cli=path.resolve('studio/tools/feedback-ops.mjs');
const inputCommand=(command,args,input)=>new Promise((resolve,reject)=>{
 const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 child.on('error',reject);child.stdin.on('error',reject);
 child.on('close',code=>code===0?resolve({stdout,stderr}):reject(Error(stderr||'Command failed: '+code)));
 child.stdin.end(input);
});

test('actual pg_dump to second database remains gated through offline preparation and deletion reconciliation',{
 skip:process.env.STUDIO_FEEDBACK_DUMP_RESTORE!=='1',timeout:120000,
},async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'feedback-dump-roundtrip-'));
 const container='feedback-dump-'+randomUUID().slice(0,8),dataDir=path.join(root,'data'),ledger=path.join(root,'independent.jsonl');
 let source,restored,instance,server,created=false;
 t.after(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(instance){await instance.feedbackDispatcher.stop();await instance.photoCleanup.close();await instance.mediaControl.close();instance.storage.close?.();}
  await source?.close();await restored?.close();
  if(created)await execute('docker',['rm','-f',container]);
  await rm(root,{recursive:true,force:true});
 });
 const report={scope:'Local disposable PostgreSQL 16 application-schema pg_dump/psql roundtrip; not full Supabase or PITR',startedAt:new Date().toISOString(),checks:[],realEmailCalls:0};
 const check=async(name,fn)=>{let passed=false;await t.test(name,async()=>{await fn();report.checks.push({name,result:'pass'});passed=true;});assert.ok(passed,name);};
 await mkdir(dataDir);await initializeDeletionLedger(ledger);
 await execute('docker',['run','-d','--name',container,'-e','POSTGRES_PASSWORD=synthetic-local-only','-p','127.0.0.1::5432','postgres:16-alpine']);created=true;
 // TCP readiness excludes the temporary socket-only server used by initdb.
 for(let n=0;;n++){try{await execute('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch(error){if(n>=30)throw error;await new Promise(resolve=>setTimeout(resolve,500));}}
 const port=Number((await execute('docker',['port',container,'5432/tcp'])).stdout.trim().split(':').at(-1));assert.ok(port>0);
 for(const database of ['feedback_source','feedback_restored'])await execute('docker',['exec',container,'createdb','-U','postgres',database]);
 const url=database=>'postgresql://postgres:synthetic-local-only@127.0.0.1:'+port+'/'+database;
 const env={SITE_URL:'http://127.0.0.1',FEEDBACK_LINK_SECRET:randomBytes(32).toString('base64url'),NOTIFICATION_EMAIL:'synthetic@example.invalid',MEDIA_CLEANUP_ENABLED:'false'};
 source=await openDatabase(dataDir,{url:url('feedback_source')});
 const service=createFeedbackService({db:source,env,mailer:{enabled:true}}),seeded=[];
 const states=['pending','processing','retry_wait','blocked_config','failed','suppressed','accepted_by_provider'];
 for(const label of ['retained','deleted-after-backup']){
  let h=(await service.create({clientName:'Synthetic '+label,title:'Dump restore fixture',requestKey:randomUUID()})).handover;
  h=(await service.command(h.id,{command:'complete',expectedVersion:h.version,requestKey:randomUUID()})).handover;
  const token=(await service.link(h.id)).url.split('#')[1];
  for(let n=0;n<states.length;n++){
   await service.putPublic(h.id,token,{name:'Synthetic',message:label+' revision '+n,ratings:{overall:5,shoot:null,product:null,delivery:null},formVersion:1,expectedVersion:n,...(n===0?{expectedContextVersion:h.contextVersion}:{}),requestKey:randomUUID()});
   await source.run('UPDATE feedback_notifications SET state=?,claim_id=?,lease_until=?,next_attempt_at=?,provider_reference=? WHERE feedback_id=(SELECT id FROM feedback WHERE handover_id=?) AND version=?',[states[n],'stale-claim',Date.now()+100000,Date.now()+100000,'synthetic-reference-'+n,h.id,n+1]);
  }
  seeded.push({h,token});
 }
 const snapshot=async db=>({revisions:await db.all('SELECT * FROM feedback_revisions ORDER BY id'),receipts:await db.all('SELECT * FROM feedback_request_receipts ORDER BY request_key'),accepted:await db.all("SELECT * FROM feedback_notifications WHERE state='accepted_by_provider' ORDER BY id")});
 const before=await snapshot(source),originalHandovers=await source.all('SELECT * FROM handovers ORDER BY id');
 await check('real pg_dump restores every feedback table unchanged into a second database',async()=>{
  const dump=(await execute('docker',['exec',container,'pg_dump','-U','postgres','--no-owner','--no-privileges','feedback_source'],{maxBuffer:16*1024*1024})).stdout;
  report.dumpBytes=Buffer.byteLength(dump);report.dumpSha256=createHash('sha256').update(dump).digest('hex');
  await inputCommand('docker',['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-d','feedback_restored'],dump);
  restored=await openDatabase(dataDir,{url:url('feedback_restored'),initialize:false});
  for(const table of FEEDBACK_TABLES)assert.deepEqual(await restored.all('SELECT * FROM '+table+' ORDER BY 1'),await source.all('SELECT * FROM '+table+' ORDER BY 1'));
  assert.deepEqual(await snapshot(restored),before);
 });
 // This deletion intent happens after the backup and lives outside its DB.
 await appendFile(ledger,JSON.stringify({type:'intent',requestId:randomUUID(),handoverId:seeded[1].h.id,at:new Date().toISOString()})+'\n');
 const runCli=command=>execute(process.execPath,[cli,command,'--ledger',ledger,'--data-dir',dataDir,'--processes-stopped','yes',...(command==='reconcile'?['--ledger-reviewed','yes','--secret-rotated','yes']:[])],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,DATABASE_URL:url('feedback_restored'),FEEDBACK_API_PAUSED:'true',FEEDBACK_NOTIFICATIONS_PAUSED:'true'}});
 await check('actual prepare-restored CLI persists gate and revokes every restored token generation',async()=>{
  report.preparation=JSON.parse((await runCli('prepare-restored')).stdout);assert.equal(report.preparation.handovers,2);assert.equal(report.preparation.suppressed,12);
  assert.equal((await restored.get("SELECT value FROM settings WHERE key='feedback_restore_pending'")).value,'true');
  const rows=await restored.all('SELECT * FROM handovers ORDER BY id');
  for(let n=0;n<rows.length;n++){assert.equal(rows[n].invitation_state,'revoked');assert.notEqual(rows[n].invitation_nonce,originalHandovers[n].invitation_nonce);for(const field of ['operation_key','operation_hash','operation_result'])assert.equal(rows[n][field],null);}
  const offlineService=createFeedbackService({db:restored,env,mailer:{enabled:true}});
  for(const {h,token} of seeded)await assert.rejects(offlineService.getPublic(h.id,token));
 });
 await check('accepted events and immutable revisions/receipts survive byte-for-byte while all other claims are suppressed',async()=>{
  assert.deepEqual(await snapshot(restored),before);
  const rows=await restored.all("SELECT * FROM feedback_notifications WHERE state<>'accepted_by_provider'");assert.equal(rows.length,12);
  for(const row of rows){assert.equal(row.state,'suppressed');assert.equal(row.claim_id,null);assert.equal(Number(row.lease_until),0);assert.equal(Number(row.next_attempt_at),0);assert.equal(row.suppressed_reason,'restored_requires_review');}
 });
 await check('app startup without runtime pauses blocks HTTP read/write and sends zero email',async()=>{
  const runtimeEnv={...env,FEEDBACK_LINK_SECRET:randomBytes(32).toString('base64url')};
  instance=await createApp({db:restored,dataDir,env:runtimeEnv,mailer:{enabled:true,sendEmail:async()=>{report.realEmailCalls++;throw Error('Unexpected mail invocation');}}});
  assert.equal(instance.feedback.readiness().apiPaused,true);assert.equal(instance.feedback.readiness().notificationsPaused,true);
  server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const endpoint='http://127.0.0.1:'+server.address().port+'/api/feedback/'+seeded[0].h.id;
  for(const method of ['GET','PUT']){const response=await fetch(endpoint,{method,headers:{Authorization:'Bearer '+seeded[0].token,Origin:env.SITE_URL,...(method==='PUT'?{'Content-Type':'application/json'}:{})},...(method==='PUT'?{body:'{}'}:{})});assert.equal(response.status,503);assert.equal((await response.json()).code,'FEEDBACK_PAUSED');}
  await instance.feedbackDispatcher.runOnce();assert.equal(report.realEmailCalls,0);
  await new Promise(resolve=>server.close(resolve));server=null;await instance.feedbackDispatcher.stop();await instance.photoCleanup.close();await instance.mediaControl.close();instance.storage.close?.();instance=null;
 });
 await check('separate CLI reconciliation applies post-backup deletion ledger without altering retained history',async()=>{
  assert.ok(await restored.get('SELECT id FROM handovers WHERE id=?',[seeded[1].h.id]));
  report.reconciliation=JSON.parse((await runCli('reconcile')).stdout);assert.equal(report.reconciliation.reconciled,1);assert.equal(report.reconciliation.released,true);
  assert.equal(await restored.get("SELECT value FROM settings WHERE key='feedback_restore_pending'"),undefined);
  assert.equal(await restored.get('SELECT id FROM handovers WHERE id=?',[seeded[1].h.id]),undefined);
  assert.equal(Number((await restored.get('SELECT COUNT(*) AS n FROM handovers')).n),1);
  const retainedFeedback=await restored.get('SELECT id FROM feedback WHERE handover_id=?',[seeded[0].h.id]);
  const after=await snapshot(restored);
  assert.deepEqual(after.revisions,before.revisions.filter(row=>row.feedback_id===retainedFeedback.id));
  assert.deepEqual(after.receipts,before.receipts.filter(row=>row.handover_id===seeded[0].h.id));
  assert.deepEqual(after.accepted,before.accepted.filter(row=>row.feedback_id===retainedFeedback.id));
  assert.equal(Number((await restored.get('SELECT COUNT(*) AS n FROM feedback_notifications')).n),7);
  const ungated=createFeedbackService({db:restored,env,mailer:{enabled:true}});await assert.rejects(ungated.getPublic(seeded[0].h.id,seeded[0].token));
  // Source database is untouched by the preparation/reconciliation of target.
  assert.deepEqual(await source.all('SELECT * FROM handovers ORDER BY id'),originalHandovers);assert.deepEqual(await snapshot(source),before);
 });
 report.completedAt=new Date().toISOString();report.passed=report.checks.length;
 if(process.env.STUDIO_FEEDBACK_DUMP_EVIDENCE_DIR){await mkdir(process.env.STUDIO_FEEDBACK_DUMP_EVIDENCE_DIR,{recursive:true});await writeFile(path.join(process.env.STUDIO_FEEDBACK_DUMP_EVIDENCE_DIR,'pg-dump-roundtrip-evidence.json'),JSON.stringify(report,null,2)+'\n');}
});
