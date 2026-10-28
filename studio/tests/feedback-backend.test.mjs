import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import express from 'express';
import pg from 'pg';
import {openDatabase} from '../server/db.mjs';
import {createFeedbackService,registerFeedbackRoutes,feedbackConfig} from '../server/feedback.mjs';
import {createFeedbackDispatcher,suppressFeedbackNotifications} from '../server/feedback-notifications.mjs';

async function fixture(t,{enabled=true,send}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-feedback-'));
 let db,pool,schema,url=null;
 t.after(async()=>{try{await db?.close();}finally{try{if(pool&&schema)await pool.query('DROP SCHEMA '+schema+' CASCADE');}finally{await pool?.end();await rm(dir,{recursive:true,force:true});}}});
 if(process.env.STUDIO_TEST_POSTGRES_URL){
  pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL,max:2,connectionTimeoutMillis:5000});
  schema='feedback_test_'+randomBytes(12).toString('hex');await pool.query('CREATE SCHEMA '+schema);
  const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema+' -c statement_timeout=10000');url=target.href;
 }
 db=await openDatabase(dir,{url});
 const env={SITE_URL:'https://studio.example',FEEDBACK_LINK_SECRET:randomBytes(32).toString('base64url'),NOTIFICATION_EMAIL:'studio@example.com'};
 const mails=[],mailer={enabled,sendEmail:send|| (async message=>{mails.push(message);return {success:true,id:'fake-provider-id'};})};
 const service=createFeedbackService({db,env,mailer});
 const create=async(extra={})=>(await service.create({clientName:'An & Bình',title:'Ngày cưới',shootDate:'2020-02-29',deliveredOn:'2020-03-01',requestKey:randomBytes(12).toString('hex'),...extra})).handover;
 const command=async(h,command,extra={})=>(await service.command(h.id,{command,requestKey:randomBytes(12).toString('hex'),expectedVersion:h.version,...extra})).handover;
 const h=await command(await create(),'complete');
 const token=(await service.link(h.id)).url.split('#')[1];
 const payload=(extra={})=>({name:'An',message:'Cảm ơn\r\nChí Công',improvement:'',ratings:{overall:null,shoot:5,product:null,delivery:4},formVersion:1,requestKey:randomBytes(12).toString('hex'),expectedVersion:0,expectedContextVersion:h.contextVersion,...extra});
 return {db,dir,pool,schema,env,mailer,mails,service,h,token,payload,create,command};
}
const hasCode=code=>error=>error.code===code;

test('feedback save, no-op, immutable revisions, late replay, observed version and snapshot context',async t=>{
 const {db,service,h,token,payload}=await fixture(t);
 const first=payload(),v1=await service.putPublic(h.id,token,first);assert.equal(v1.latestVersion,1);assert.equal(v1.latestFeedback.message,'Cảm ơn\nChí Công');
 await service.read(h.id,1);
 const beforeNoop=await db.get('SELECT * FROM feedback WHERE handover_id=?',[h.id]);
 const noop=await service.putPublic(h.id,token,payload({expectedVersion:1}));assert.equal(noop.changed,false);assert.deepEqual(await db.get('SELECT * FROM feedback WHERE handover_id=?',[h.id]),beforeNoop);assert.equal((await service.detail(h.id)).handover.unread,false);
 const v2=await service.putPublic(h.id,token,payload({expectedVersion:1,message:'Bản mới'}));assert.equal(v2.latestVersion,2);
 const replay=await service.putPublic(h.id,token,first);assert.equal(replay.acknowledgedVersion,1);assert.equal(replay.latestFeedback.message,'Bản mới');assert.equal(replay.replayed,true);
 await assert.rejects(service.putPublic(h.id,token,{...first,message:'Changed key body'}),hasCode('REQUEST_KEY_CONFLICT'));
 await assert.rejects(service.putPublic(h.id,token,payload({expectedVersion:1})),hasCode('VERSION_CONFLICT'));
 assert.equal((await service.read(h.id,1)).handover.unread,true);
 const revised=await service.patch(h.id,{requestKey:'context-patch-1',expectedVersion:h.version,title:'Tên hiện tại',notes:'Private notes'});assert.equal(revised.handover.title,'Tên hiện tại');assert.equal((await service.getPublic(h.id,token)).handover.title,'Ngày cưới');
 assert.equal((await service.revisions(h.id)).revisions.length,2);
 assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM feedback_notifications')).n),2);
 assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM feedback_request_receipts')).n),3);
});

test('context changes block initial save, notes do not; concurrent first saves serialize',async t=>{
 const {db,service,h,token,payload}=await fixture(t);
 let changed=(await service.patch(h.id,{requestKey:'notes-only-change',expectedVersion:h.version,notes:'Internal'})).handover;assert.equal(changed.contextVersion,h.contextVersion);
 changed=(await service.patch(h.id,{requestKey:'title-only-change',expectedVersion:changed.version,title:'Thông tin mới'})).handover;
 await assert.rejects(service.putPublic(h.id,token,payload()),hasCode('CONTEXT_CHANGED'));
 assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM feedback_request_receipts')).n),0);
 const requests=await Promise.allSettled([service.putPublic(h.id,token,payload({expectedContextVersion:changed.contextVersion})),service.putPublic(h.id,token,payload({expectedContextVersion:changed.contextVersion}))]);
 assert.equal(requests.filter(r=>r.status==='fulfilled').length,1);assert.equal(requests.find(r=>r.status==='rejected').reason.code,'VERSION_CONFLICT');
});

test('commands enforce complete/pause/archive/revoke and idempotent rotation without restoring old URLs',async t=>{
 const {service,h,token,command,payload}=await fixture(t);
 const first=payload();await service.putPublic(h.id,token,first);
 await assert.rejects(command(h,'complete'),hasCode('INVALID_STATE'));
 let row=await command(h,'pause');await assert.rejects(service.getPublic(h.id,token),hasCode('LINK_UNAVAILABLE'));await assert.rejects(service.link(h.id),hasCode('LINK_UNAVAILABLE'));
 row=await command(row,'resume');assert.equal((await service.link(h.id)).url.split('#')[1],token);
 row=await command(row,'archive');row=await command(row,'unarchive');assert.equal(row.invitationState,'paused');
 row=await command(row,'revoke');await assert.rejects(command(row,'resume'),hasCode('INVALID_STATE'));
 const operation={command:'issue',requestKey:'rotate-one-request',expectedVersion:row.version};const issued=await service.command(row.id,operation),link=await service.link(row.id);assert.equal((await service.command(row.id,operation)).replayed,true);assert.deepEqual(await service.link(row.id),link);
 await assert.rejects(service.command(row.id,{...operation,command:'revoke'}),hasCode('REQUEST_KEY_CONFLICT'));
 await assert.rejects(service.putPublic(h.id,token,first),hasCode('LINK_UNAVAILABLE'));
 assert.equal(issued.handover.latestVersion,1);
});

test('creation and album links are idempotent, unique through archive and survive source deletion',async t=>{
 const {db,service,create,command}=await fixture(t);await db.run("INSERT INTO albums(id,title,category) VALUES('album-feedback','Album','wedding')");
 const data={clientName:'B',title:'Portrait',albumIds:['album-feedback'],requestKey:'create-persistent-key'};
 const created=await service.create(data),replay=await service.create(data);assert.equal(created.handover.id,replay.handover.id);assert.equal(replay.replayed,true);
 await assert.rejects(service.create({...data,title:'Different'}),hasCode('REQUEST_KEY_CONFLICT'));
 await command(created.handover,'archive');await assert.rejects(create({albumIds:['album-feedback']}),hasCode('ALBUM_ASSIGNED'));
 await db.run("DELETE FROM albums WHERE id='album-feedback'");assert.deepEqual((await service.detail(created.handover.id)).handover.albumIds,[]);
});

test('form retirement permits accepted receipt replay while rejecting new writes and untrusted fields',async t=>{
 const {db,env,mailer,service,h,token,payload}=await fixture(t);const first=payload();await service.putPublic(h.id,token,first);
 const retired=createFeedbackService({db,env,mailer,acceptedFormVersions:[]});assert.equal((await retired.putPublic(h.id,token,first)).replayed,true);
 await assert.rejects(retired.putPublic(h.id,token,payload({expectedVersion:1})),hasCode('FORM_VERSION_UNSUPPORTED'));
 await assert.rejects(service.putPublic(h.id,token,payload({expectedVersion:1,readVersion:1})),hasCode('VALIDATION_ERROR'));
 await assert.rejects(service.putPublic(h.id,token,payload({expectedVersion:1,ratings:{overall:3.5,shoot:null,product:null,delivery:null}})),hasCode('VALIDATION_ERROR'));
 assert.equal(feedbackConfig({...env,FEEDBACK_LINK_SECRET:'a'.repeat(32)}).ready,false);
});

test('notifications render full exact revision, escape HTML, claim once and never mark feedback read',async t=>{
 const f=await fixture(t),{db,env,mailer,service,h,token,payload,mails}=f;
 await service.putPublic(h.id,token,payload({message:'<script>one</script>\nFull text',name:'An\nBình',improvement:'Góp ý đầy đủ'}));
 await service.putPublic(h.id,token,payload({expectedVersion:1,message:'Version two'}));
 await service.patch(h.id,{requestKey:'rename-for-email',expectedVersion:h.version,title:'Do not render this title'});
 const a=createFeedbackDispatcher({db,env,mailer}),b=createFeedbackDispatcher({db,env,mailer});await Promise.all([a.runOnce(),b.runOnce()]);
 assert.equal(mails.length,2);const first=mails.find(m=>m.subject.includes('v1'));assert.match(first.text,/<script>one<\/script>\nFull text/);assert.match(first.text,/Góp ý đầy đủ/);assert.match(first.text,/Ngày cưới/);assert.doesNotMatch(first.text,/Do not render this title/);assert.match(first.html,/&lt;script&gt;/);assert.doesNotMatch(first.text,/Version two/);assert.match(first.text,new RegExp('/admin#feedback/'+h.id));assert.doesNotMatch(first.subject,/[\r\n]/);
 assert.equal((await service.detail(h.id)).handover.readVersion,0);assert.equal((await db.all("SELECT * FROM feedback_notifications WHERE state='accepted_by_provider'")).length,2);await a.stop();await b.stop();
});

test('notification gate, retry backoff, suppression and recipient confirmation',async t=>{
 let attempts=0;const f=await fixture(t,{send:async()=>{attempts++;throw Error('secret transport body');}});const {db,env,mailer,service,h,token,payload}=f;
 await service.putPublic(h.id,token,payload());env.FEEDBACK_NOTIFICATIONS_PAUSED='true';const d=createFeedbackDispatcher({db,env,mailer});await d.runOnce();assert.equal(attempts,0);
 delete env.FEEDBACK_NOTIFICATIONS_PAUSED;await d.runOnce();assert.equal(attempts,1);let n=(await service.detail(h.id)).handover.notifications[0];assert.equal(n.state,'retry_wait');assert.equal(n.errorCode,'TRANSPORT_FAILURE');await d.runOnce();assert.equal(attempts,1);
 await suppressFeedbackNotifications(db);await d.runOnce();assert.equal(attempts,1);assert.equal((await service.detail(h.id)).handover.notifications[0].state,'suppressed');
 await db.run("UPDATE feedback_notifications SET recipient=NULL WHERE id=?",[n.id]);await assert.rejects(service.retryNotification(h.id,n.id,{}),hasCode('VALIDATION_ERROR'));
 await service.retryNotification(h.id,n.id,{recipient:'new@example.com'});assert.equal((await service.detail(h.id)).handover.notifications[0].recipient,'new@example.com');await d.stop();
});

test('stale worker ACK cannot overwrite suppression and valid processing lease cannot be manually retried',async t=>{
 let entered,release;const enteredPromise=new Promise(r=>entered=r),sendPromise=new Promise(r=>release=r);
 const {db,env,mailer,service,h,token,payload}=await fixture(t,{send:async()=>{entered();await sendPromise;return {success:true,id:'late'};}});
 await service.putPublic(h.id,token,payload());const d=createFeedbackDispatcher({db,env,mailer});const run=d.runOnce();await enteredPromise;
 const n=(await service.detail(h.id)).handover.notifications[0];await assert.rejects(service.retryNotification(h.id,n.id),hasCode('INVALID_STATE'));await suppressFeedbackNotifications(db);release();await run;assert.equal((await service.detail(h.id)).handover.notifications[0].state,'suppressed');await d.stop();
});

test('HTTP serializer preserves codes and fields, public DTO is private and origin is required',async t=>{
 const {db,env,mailer,h,token}=await fixture(t);const app=express();app.use(express.json());app.use('/api/admin',(req,res,next)=>req.get('x-test-admin')==='yes'?next():res.sendStatus(401));registerFeedbackRoutes(app,{db,env,mailer});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 const get=await fetch(base+'/api/feedback/'+h.id,{headers:{Authorization:'Bearer '+token}});assert.equal(get.status,200);assert.equal(get.headers.get('cache-control'),'no-store');assert.equal(get.headers.get('referrer-policy'),'no-referrer');const data=await get.json();assert.equal(data.handover.notes,undefined);assert.equal(data.handover.albumIds,undefined);
 const response=await fetch(base+'/api/feedback/'+h.id,{method:'PUT',headers:{Authorization:'Bearer '+token,Origin:env.SITE_URL,'Content-Type':'application/json'},body:JSON.stringify({requestKey:'valid-key-123',formVersion:999})});assert.equal(response.status,409);assert.equal((await response.json()).code,'FORM_VERSION_UNSUPPORTED');
 const denied=await fetch(base+'/api/feedback/'+h.id,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
 assert.equal((await fetch(base+'/api/admin/handovers')).status,401);
});

test('missing link configuration is atomic and restore gate blocks admin/public reads',async t=>{
 const {env,service,create,command,h,token}=await fixture(t);const draft=await create();delete env.FEEDBACK_LINK_SECRET;
 await assert.rejects(command(draft,'complete'),hasCode('CONFIG_UNAVAILABLE'));const after=(await service.detail(draft.id)).handover;assert.equal(after.version,draft.version);assert.equal(after.deliveryState,'draft');assert.equal(after.invitationState,'unissued');
 env.FEEDBACK_API_PAUSED='true';await assert.rejects(service.detail(h.id),hasCode('FEEDBACK_PAUSED'));await assert.rejects(service.list(),hasCode('FEEDBACK_PAUSED'));await assert.rejects(service.getPublic(h.id,token),hasCode('FEEDBACK_PAUSED'));
});

test('missing provider preserves recipient and event while retry needs explicit missing recipient',async t=>{
 const {db,env,mailer,service,h,token,payload,mails}=await fixture(t,{enabled:false});
 await service.putPublic(h.id,token,payload());let n=(await service.detail(h.id)).handover.notifications[0];assert.equal(n.state,'blocked_config');assert.equal(n.attempts,0);
 env.NOTIFICATION_EMAIL='changed@example.com';mailer.enabled=true;const d=createFeedbackDispatcher({db,env,mailer});await d.runOnce();assert.equal(mails[0].to,'studio@example.com');
 await service.putPublic(h.id,token,payload({expectedVersion:1,message:'Second'}));n=(await service.detail(h.id)).handover.notifications[0];await db.run("UPDATE feedback_notifications SET state='blocked_config',recipient=NULL WHERE id=?",[n.id]);await d.runOnce();assert.equal(mails.length,1);assert.equal((await service.detail(h.id)).handover.notifications[0].attempts,0);await d.stop();
});

test('database constraints reject fractional ratings and preserve exactly six feedback tables across migration',async t=>{
 const {db,service,h,token,payload,dir}=await fixture(t);await service.putPublic(h.id,token,payload());await assert.rejects(db.run('UPDATE feedback_revisions SET rating_overall=?',[1.5]));
 await assert.rejects(db.run('UPDATE feedback_revisions SET rating_overall=3.5'));
 const {migrateFeedbackSchema,FEEDBACK_TABLES}=await import('../server/feedback-schema.mjs');await migrateFeedbackSchema(db);assert.equal(FEEDBACK_TABLES.length,6);for(const table of FEEDBACK_TABLES)assert.ok(await db.get(db.cloud?'SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?':'SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?',[table]));assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM feedback')).n),1);
});

test('album correction transfers atomically with both versions and stable operation replay',async t=>{
 const {db,service,create,command}=await fixture(t);
 await db.run("INSERT INTO albums(id,title,category) VALUES('transfer-gallery','Gallery','portrait')");
 let from=await create({albumIds:['transfer-gallery']}),to=await create();
 const body={albumId:'transfer-gallery',toHandoverId:to.id,expectedVersion:from.version,expectedTargetVersion:to.version,requestKey:'transfer-gallery-key'};
 const transferred=await service.transferAlbum(from.id,body);assert.deepEqual(transferred.handover.albumIds,[]);assert.deepEqual(transferred.targetHandover.albumIds,['transfer-gallery']);
 assert.equal((await service.transferAlbum(from.id,body)).replayed,true);assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM handover_albums WHERE album_id='transfer-gallery'")).n),1);
 await assert.rejects(service.transferAlbum(from.id,{...body,requestKey:'stale-transfer-new-key'}),hasCode('VERSION_CONFLICT'));
 await assert.rejects(service.transferAlbum(from.id,{...body,albumId:'different'}),hasCode('REQUEST_KEY_CONFLICT'));
 from=transferred.targetHandover;to=transferred.handover;
 const outdated={albumId:'transfer-gallery',toHandoverId:to.id,expectedVersion:from.version,expectedTargetVersion:to.version,requestKey:'reverse-gallery-key'};
 await command(to,'archive');await assert.rejects(service.transferAlbum(from.id,outdated),hasCode('VERSION_CONFLICT'));
 assert.equal((await db.get("SELECT handover_id FROM handover_albums WHERE album_id='transfer-gallery'")).handover_id,from.id);
});

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const count=async(db,table)=>Number((await db.get('SELECT COUNT(*) AS n FROM '+table)).n);
function interceptTransactions(db,intercept){return {...db,transaction:fn=>db.transaction(tx=>fn({...tx,...Object.fromEntries(['get','all','run'].map(method=>[method,async(sql,params)=>{await intercept(method,sql,params);return tx[method](sql,params);}]))}))};}

test('concurrent creation replays one identity and gallery assignment has one owner',async t=>{
 const {db,service,create}=await fixture(t);
 const body={clientName:'A',title:'One session',requestKey:'concurrent-create-key'};
 const same=await Promise.all([service.create(body),service.create(body),service.create(body)]);
 assert.equal(new Set(same.map(r=>r.handover.id)).size,1);assert.equal(same.filter(r=>r.replayed).length,2);
 await db.run("INSERT INTO albums(id,title,category) VALUES('race-gallery','Gallery','wedding')");
 const raced=await Promise.allSettled([create({albumIds:['race-gallery']}),create({albumIds:['race-gallery']})]);
 assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.ok(['ALBUM_ASSIGNED','23505','ERR_SQLITE_ERROR'].includes(raced.find(r=>r.status==='rejected').reason.code));
 assert.equal(await count(db,'handover_albums'),1);assert.equal(await count(db,'handovers'),3);
 const other=await create(),owner=raced.find(r=>r.status==='fulfilled').value;
 await db.run("INSERT INTO albums(id,title,category) VALUES('patch-gallery','Gallery','wedding')");
 const assigned=await Promise.allSettled([owner,other].map(h=>service.patch(h.id,{albumIds:['patch-gallery'],requestKey:randomBytes(10).toString('hex'),expectedVersion:h.version})));
 assert.equal(assigned.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM handover_albums WHERE album_id='patch-gallery'")).n),1);
});

for(const action of ['pause','revoke'])for(const first of ['submit','command'])test(`${first} versus ${action} serializes under the handover lock`,{timeout:15000},async t=>{
 const {db,service,env,mailer,h,token,payload}=await fixture(t),locked=deferred(),release=deferred();let intercept=true;
 const held={...db,transaction:fn=>db.transaction(tx=>fn({...tx,get:async(sql,params)=>{const result=await tx.get(sql,params);if(intercept&&sql.startsWith('SELECT * FROM handovers WHERE id=')){intercept=false;locked.resolve();await release.promise;}return result;}}))};
 const blocking=createFeedbackService({db:held,env,mailer});
 const submit=s=>s.putPublic(h.id,token,payload());
 const command=s=>s.command(h.id,{command:action,expectedVersion:h.version,requestKey:'locked-command-key'});
 const one=(first==='submit'?submit:command)(blocking);await locked.promise;
 const two=(first==='submit'?command:submit)(service);const settled=Promise.allSettled([one,two]);release.resolve();const results=await settled;
 assert.equal(results[0].status,'fulfilled');
 if(first==='submit'){assert.equal(results[1].status,'fulfilled');assert.equal(await count(db,'feedback_revisions'),1);}
 else{assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.code,'LINK_UNAVAILABLE');assert.equal(await count(db,'feedback_revisions'),0);}
 assert.equal((await service.detail(h.id)).handover.invitationState,action==='pause'?'paused':'revoked');
});

for(const table of ['feedback_revisions','feedback_notifications','feedback_request_receipts'])test(`failure inserting ${table} rolls back feedback, revisions, receipt and outbox`,async t=>{
 const {db,service,env,mailer,h,token,payload}=await fixture(t);
 const fault=Error('injected write failure'),broken=interceptTransactions(db,(method,sql)=>{if(method==='run'&&sql.startsWith('INSERT INTO '+table+'('))throw fault;});
 const failing=createFeedbackService({db:broken,env,mailer}),first=payload();
 await assert.rejects(failing.putPublic(h.id,token,first),error=>error===fault);
 for(const name of ['feedback','feedback_revisions','feedback_notifications','feedback_request_receipts'])assert.equal(await count(db,name),0,name);
 await service.putPublic(h.id,token,first);await service.read(h.id,1);const before=await db.get('SELECT * FROM feedback WHERE handover_id=?',[h.id]);
 const next=payload({expectedVersion:1,message:'Must not partially save'});await assert.rejects(failing.putPublic(h.id,token,next),error=>error===fault);
 assert.deepEqual(await db.get('SELECT * FROM feedback WHERE handover_id=?',[h.id]),before);
 for(const name of ['feedback_revisions','feedback_notifications','feedback_request_receipts'])assert.equal(await count(db,name),1,name);
 const retry=await service.putPublic(h.id,token,next);assert.equal(retry.latestVersion,2);assert.equal(retry.replayed,false);
});

test('expired claim is recovered and an old worker ACK cannot replace the new claim result',{timeout:15000},async t=>{
 const entered=deferred(),release=deferred();let calls=0;
 const {db,env,mailer,service,h,token,payload}=await fixture(t,{send:async()=>{calls++;if(calls===1){entered.resolve();await release.promise;return {success:true,id:'stale-provider'};}return {success:true,id:'current-provider'};}});
 await service.putPublic(h.id,token,payload());const now=Date.now();
 const old=createFeedbackDispatcher({db,env,mailer,clock:()=>now,batchSize:1}),fresh=createFeedbackDispatcher({db,env,mailer,clock:()=>now+120001,batchSize:1});
 const pending=old.runOnce();await entered.promise;await fresh.runOnce();release.resolve();await pending;
 const n=(await service.detail(h.id)).handover.notifications[0];assert.equal(calls,2);assert.equal(n.state,'accepted_by_provider');assert.equal(n.providerReference,'current-provider');assert.equal(n.attempts,2);await old.stop();await fresh.stop();
});

test('settings email is snapshotted per event and retained after configuration changes',async t=>{
 const {db,env,mailer,service,h,token,payload,mails}=await fixture(t);delete env.NOTIFICATION_EMAIL;
 await db.run("UPDATE settings SET value='first@example.com' WHERE key='email'");await service.putPublic(h.id,token,payload());
 await db.run("UPDATE settings SET value='second@example.com' WHERE key='email'");await service.putPublic(h.id,token,payload({expectedVersion:1,message:'Another version'}));
 await db.run("UPDATE settings SET value='third@example.com' WHERE key='email'");
 const dispatcher=createFeedbackDispatcher({db,env,mailer});await dispatcher.runOnce();await dispatcher.stop();
 assert.equal(mails.find(m=>m.subject.includes('v1')).to,'first@example.com');assert.equal(mails.find(m=>m.subject.includes('v2')).to,'second@example.com');
});

test('PostgreSQL RLS denies an unprivileged role access to all six private tables',{skip:!process.env.STUDIO_TEST_POSTGRES_URL},async t=>{
 const {db,pool,schema,service,h,token,payload}=await fixture(t);await service.putPublic(h.id,token,payload());
 const privilege=await pool.query('SELECT rolcreaterole,rolsuper FROM pg_roles WHERE rolname=current_user');
 if(!privilege.rows[0].rolcreaterole&&!privilege.rows[0].rolsuper){t.skip('Dedicated test role cannot create an anonymous role');return;}
 const role='feedback_anon_'+randomBytes(12).toString('hex'),{FEEDBACK_TABLES}=await import('../server/feedback-schema.mjs');
 await pool.query('CREATE ROLE '+role+' NOLOGIN NOSUPERUSER NOBYPASSRLS');
 try{
  await pool.query('GRANT USAGE ON SCHEMA '+schema+' TO '+role);await pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA '+schema+' TO '+role);
  await db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE '+role);for(const table of FEEDBACK_TABLES)assert.equal(await count(tx,table),0,table);assert.equal((await tx.run('UPDATE handovers SET notes=? WHERE id=?',['attempted anonymous update',h.id])).changes,0);});
  await assert.rejects(db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE '+role);await tx.run("INSERT INTO handover_albums(handover_id,album_id) VALUES(?,?)",[h.id,'forbidden']);}),error=>error.code==='42501');
  assert.equal(await count(db,'feedback'),1);
 }finally{await pool.query('REVOKE ALL ON ALL TABLES IN SCHEMA '+schema+' FROM '+role);await pool.query('REVOKE ALL ON SCHEMA '+schema+' FROM '+role);await pool.query('DROP ROLE '+role);}
});

test('published feedback field limits reject overflow and accept exact normalized boundaries',async t=>{
 const {service,h,token,payload}=await fixture(t);
 for(const [field,max] of [['name',150],['message',3000],['improvement',1500]])await assert.rejects(service.putPublic(h.id,token,payload({[field]:'a'.repeat(max+1)})),error=>error.code==='VALIDATION_ERROR'&&!!error.fields[field]);
 const result=await service.putPublic(h.id,token,payload({name:'a'.repeat(150),message:'b'.repeat(3000),improvement:'c'.repeat(1500)}));assert.equal(result.latestVersion,1);
 assert.deepEqual(result.schema.limits,{name:150,message:3000,improvement:1500});
});

test('public contact only exposes approved settings and read filter excludes drafts and unread feedback',async t=>{
 const {db,service,h,token,payload,create}=await fixture(t);await create();
 for(const [key,value] of [['phone','0900000000'],['email','public@example.com'],['zalo','https://zalo.me/0900000000'],['facebook','https://facebook.com/test'],['private_key','private-test-value']])await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,value]);
 const result=await service.getPublic(h.id,token);assert.deepEqual(result.contact,{phone:'0900000000',email:'public@example.com',zalo:'https://zalo.me/0900000000',facebook:'https://facebook.com/test'});
 await service.putPublic(h.id,token,payload());assert.equal((await service.list({unread:'true'})).total,1);assert.equal((await service.list({unread:'false'})).total,0);
 await service.read(h.id,1);assert.equal((await service.list({unread:'true'})).total,0);const read=await service.list({unread:'false'});assert.deepEqual(read.handovers.map(row=>row.id),[h.id]);
});
