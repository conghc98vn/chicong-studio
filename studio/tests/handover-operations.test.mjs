import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,appendFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import pg from 'pg';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';
import {createMailer} from '../server/mailer.mjs';
import {FEEDBACK_TABLES} from '../server/feedback-schema.mjs';
import {createFeedbackService} from '../server/feedback.mjs';
import {initializeDeletionLedger,purgeHandover,reconcileFeedbackDeletions,readDeletionLedger} from '../server/handover-privacy.mjs';
import {databaseSnapshot,validateDatabaseSnapshot,version2Tables,legacyTables,jsonBytes,sha256,putBlob,mappingHash,atomicFile,restoreBackup,verifyBackup} from '../tools/media-backup.mjs';

async function fixture(t) {
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-handover-ops-'));
 let pool,schema,url=null;
 if(process.env.STUDIO_TEST_POSTGRES_URL){
  pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});
  schema='feedback_ops_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);
  const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema);url=target.href;
 }
 const db=await openDatabase(path.join(dir,'source'),{url});
 const env={FEEDBACK_LINK_SECRET:randomBytes(32).toString('base64url'),FEEDBACK_NOTIFICATIONS_PAUSED:'true'};
 const instance=await createApp({db,dataDir:path.join(dir,'source'),env,mailer:{enabled:false}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;env.SITE_URL=base;
 const setup=await fetch(base+'/api/admin/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'operator@example.invalid',password:'synthetic-only-password'})});assert.equal(setup.status,201);
 const cookie=setup.headers.get('set-cookie').split(';')[0];
 const request=(url,options={})=>fetch(base+url,{...options,headers:{Origin:base,Cookie:cookie,...options.headers}});
 const service=instance.feedback;
 let h=(await service.create({clientName:'Synthetic private customer',title:'Synthetic portrait',requestKey:randomUUID()})).handover;
 h=(await service.command(h.id,{command:'complete',expectedVersion:h.version,requestKey:randomUUID()})).handover;
 const token=(await service.link(h.id)).url.split('#')[1];
 const payload={name:'Synthetic sender',message:'Private feedback text',improvement:'One suggestion',ratings:{overall:5,shoot:null,product:4,delivery:null},formVersion:1,expectedVersion:0,expectedContextVersion:h.contextVersion,requestKey:randomUUID()};
 t.after(async()=>{await instance.feedbackDispatcher.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await instance.photoCleanup.close();await instance.mediaControl.close();instance.storage.close?.();await db.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dir,{recursive:true,force:true});});
 return {dir,db,env,instance,base,request,service,h,token,payload};
}

async function saveSnapshot(root,snapshot,runId='fixture') {
 const bytes=jsonBytes(snapshot),databaseSha256=sha256(bytes);await putBlob(root,databaseSha256,bytes);
 const manifest={version:1,state:'complete',runId,capturedAt:snapshot.capturedAt,appRevision:'feedback-test',storage:'fixture',databaseSha256,mappingHash:mappingHash(snapshot),objects:[]};
 await atomicFile(path.join(root,'snapshots',runId+'.json'),jsonBytes(manifest));return manifest;
}

test('private shell, authorization errors and malformed paths remain isolated from the public bootstrap',async t=>{
 const f=await fixture(t);await f.service.putPublic(f.h.id,f.token,f.payload);
 for(const route of ['/feedback/'+f.h.id,'/FEEDBACK/no-such-record/','/feedback/','/feedback/invalid/extra','/feedback/%ZZ','/feedback%2Fbad']){
  const res=await fetch(f.base+route),html=await res.text();assert.equal(res.headers.get('referrer-policy'),'no-referrer');assert.match(res.headers.get('cache-control'),/no-store/);assert.match(res.headers.get('x-robots-tag'),/noindex/);assert.doesNotMatch(res.headers.get('content-security-policy'),/cloudflare|unsafe-inline/);
  assert.match(html,/feedback-page.mjs/);assert.doesNotMatch(html,/main\.js|bootstrap\.js|page-data|application\/ld\+json|cloudflareinsights|Synthetic private|Private feedback text/);assert.ok(!html.includes(f.token));
 }
 for(const route of ['/api/feedback/'+f.h.id,'/api/feedback/'+f.h.id+'/revisions']){
  const res=await f.request(route);assert.ok(res.status>=400);assert.match(res.headers.get('x-robots-tag'),/noindex/);assert.doesNotMatch(await res.text(),/Private feedback text/);
 }
 const csrf=await fetch(f.base+'/api/feedback/'+f.h.id,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+f.token},body:JSON.stringify(f.payload)});assert.equal(csrf.status,403);assert.match(csrf.headers.get('x-robots-tag'),/noindex/);
 const publicData=await fetch(f.base+'/api/feedback/'+f.h.id,{headers:{Authorization:'Bearer '+f.token}});const json=await publicData.json();assert.equal(json.latestFeedback.message,f.payload.message);assert.equal(json.schema.limits.message,3000);assert.ok(!('history' in json));
 const sitemap=await (await fetch(f.base+'/sitemap.xml')).text();assert.ok(!sitemap.includes('/feedback/'));
});

test('metadata export includes all revisions, receipts and notifications in v3 without signing secrets',async t=>{
 const f=await fixture(t);await f.service.putPublic(f.h.id,f.token,f.payload);
 await f.service.putPublic(f.h.id,f.token,{...f.payload,expectedVersion:1,message:'Second version',requestKey:randomUUID()});
 const res=await f.request('/api/admin/export');assert.equal(res.status,200);const output=await res.json();assert.equal(output.version,3);
 for(const table of FEEDBACK_TABLES)assert.ok(Array.isArray(output[table]));
 assert.equal(output.feedback_revisions.length,2);assert.equal(output.feedback_notifications.length,2);assert.equal(output.feedback_request_receipts.length,2);
 const raw=JSON.stringify(output);assert.ok(!raw.includes(f.token));assert.ok(!raw.includes(f.env.FEEDBACK_LINK_SECRET));
 f.env.FEEDBACK_API_PAUSED='true';assert.equal((await f.request('/api/admin/export')).status,503);
});

test('fixed backup registries read v1/v2 and reject incomplete or mislabeled v3 snapshots',async t=>{
 const f=await fixture(t),snapshot=await databaseSnapshot(f.db);assert.equal(snapshot.schemaVersion,3);validateDatabaseSnapshot(snapshot);
 for(const [schemaVersion,tables] of [[1,legacyTables],[2,version2Tables]])validateDatabaseSnapshot({...snapshot,schemaVersion,tables:Object.fromEntries(tables.map(table=>[table,snapshot.tables[table]]))});
 for(const table of FEEDBACK_TABLES){const incomplete=structuredClone(snapshot);delete incomplete.tables[table];assert.throws(()=>validateDatabaseSnapshot(incomplete),/Unsupported/);}
 assert.throws(()=>validateDatabaseSnapshot({...snapshot,schemaVersion:2}),/Unsupported/);
 const legacy={...snapshot,schemaVersion:2,tables:Object.fromEntries(version2Tables.map(table=>[table,snapshot.tables[table]]))};
 const repository=path.join(f.dir,'old-repository');await saveSnapshot(repository,legacy);const target=path.join(f.dir,'legacy-restored');await restoreBackup(repository,target);
 const restored=await openDatabase(target,{url:null});try{for(const table of FEEDBACK_TABLES)assert.equal(Number((await restored.get('SELECT COUNT(*) AS n FROM '+table)).n),0);}finally{await restored.close();}
});

test('restore revokes links, suppresses mail and blocks admin/export until independent deletion reconciliation',async t=>{
 const f=await fixture(t);await f.service.putPublic(f.h.id,f.token,f.payload);
 const repository=path.join(f.dir,'repository'),manifest=await saveSnapshot(repository,await databaseSnapshot(f.db));await verifyBackup(repository,manifest);
 const ledger=path.join(f.dir,'independent','deletions.jsonl');await initializeDeletionLedger(ledger);
 await purgeHandover({db:f.db,ledgerFile:ledger,handoverId:f.h.id});assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM feedback_revisions')).n),0);
 const target=path.join(f.dir,'restored');await restoreBackup(repository,target);
 const db=await openDatabase(target,{url:null});let restored;
 try{
  assert.equal((await db.get('SELECT invitation_state FROM handovers')).invitation_state,'revoked');assert.equal((await db.get('SELECT state FROM feedback_notifications')).state,'suppressed');
  let calls=0;restored=await createApp({db,dataDir:target,env:f.env,mailer:{enabled:true,sendEmail:async()=>{calls++;return {success:true};}}});
  await assert.rejects(restored.feedback.detail(f.h.id),error=>error.code==='FEEDBACK_PAUSED');await restored.feedbackDispatcher.runOnce();assert.equal(calls,0);
  assert.equal((await db.get("SELECT value FROM settings WHERE key='feedback_restore_pending'")).value,'true');
  await assert.rejects(reconcileFeedbackDeletions({db,ledgerFile:path.join(f.dir,'missing.jsonl'),release:true}));assert.equal((await db.get("SELECT value FROM settings WHERE key='feedback_restore_pending'")).value,'true');
  const result=await reconcileFeedbackDeletions({db,ledgerFile:ledger,release:true});assert.equal(result.reconciled,1);await reconcileFeedbackDeletions({db,ledgerFile:ledger,release:true});
  for(const table of FEEDBACK_TABLES)assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM '+table)).n),0);
  assert.equal(await db.get("SELECT value FROM settings WHERE key='feedback_restore_pending'"),undefined);
  const fresh=createFeedbackService({db,env:f.env});await assert.rejects(fresh.getPublic(f.h.id,f.token));
 }finally{await restored?.feedbackDispatcher.stop();await restored?.photoCleanup.close();await restored?.mediaControl.close();restored?.storage.close?.();await db.close();}
 assert.doesNotMatch(await readFile(ledger,'utf8'),/Synthetic|Private feedback|@/);
});

test('an intent persisted before a crash is reapplied idempotently; truncated ledger keeps the gate',async t=>{
 const f=await fixture(t),ledger=path.join(f.dir,'independent.jsonl');await initializeDeletionLedger(ledger);
 await appendFile(ledger,JSON.stringify({type:'intent',requestId:randomUUID(),handoverId:f.h.id,at:new Date().toISOString()})+'\n');
 await reconcileFeedbackDeletions({db:f.db,ledgerFile:ledger});await reconcileFeedbackDeletions({db:f.db,ledgerFile:ledger});assert.equal(await f.db.get('SELECT id FROM handovers WHERE id=?',[f.h.id]),undefined);
 await appendFile(ledger,'{"partial":');await assert.rejects(readDeletionLedger(ledger),/incomplete/);
});

test('SMTP total deadline destroys an active socket instead of leaving an old send alive',async()=>{
 // Measure the transport deadline after dependency loading. A cold import can
 // exceed the network budget while the full suite competes for CPU and I/O.
 await import('nodemailer');
 let peer,keepAlive;const server=createServer(socket=>{peer=socket;socket.on('error',()=>{});socket.write('220 fixture SMTP\r\n');socket.on('data',()=>{});keepAlive=setInterval(()=>socket.write('250-keepalive\r\n'),25);socket.once('close',()=>clearInterval(keepAlive));});
 server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const mailer=createMailer({SMTP_HOST:'127.0.0.1',SMTP_PORT:String(server.address().port),EMAIL_FROM:'fixture@example.invalid'},{timeoutMs:180});
 try{
  const start=Date.now();await assert.rejects(mailer.sendEmail({to:'recipient@example.invalid',subject:'fixture',text:'synthetic'}));assert.ok(Date.now()-start<2000);
  if(peer&&!peer.destroyed)await Promise.race([new Promise(resolve=>peer.once('close',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error('SMTP connection survived deadline')),500))]);
  assert.ok(!peer||peer.destroyed);
 }finally{clearInterval(keepAlive);peer?.destroy();await new Promise(resolve=>server.close(resolve));}
});
