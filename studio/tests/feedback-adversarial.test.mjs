import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {openDatabase} from '../server/db.mjs';
import {createFeedbackService} from '../server/feedback.mjs';

const key=()=>randomBytes(12).toString('hex');
const code=value=>error=>error.code===value;
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'feedback-adversarial-'));
 let db,pool,schema,url=null,wakes=0;
 t.after(async()=>{try{await db?.close();}finally{try{if(pool&&schema)await pool.query('DROP SCHEMA '+schema+' CASCADE');}finally{await pool?.end();await rm(dir,{recursive:true,force:true});}}});
 if(process.env.STUDIO_TEST_POSTGRES_URL){
  pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL,max:2,connectionTimeoutMillis:5000});
  schema='feedback_adversarial_'+key();await pool.query('CREATE SCHEMA '+schema);
  const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema+' -c statement_timeout=10000');url=target.href;
 }
 db=await openDatabase(dir,{url});
 const env={SITE_URL:'https://studio.example',FEEDBACK_LINK_SECRET:randomBytes(32).toString('base64url'),NOTIFICATION_EMAIL:'studio@example.com'};
 const service=createFeedbackService({db,env,mailer:{enabled:true},wake:()=>wakes++});
 const create=async(extra={})=>(await service.create({clientName:'An',title:'Buổi chụp',requestKey:key(),...extra})).handover;
 const command=async(h,command)=>(await service.command(h.id,{command,requestKey:key(),expectedVersion:h.version})).handover;
 const h=await command(await create(),'complete');
 const token=(await service.link(h.id)).url.split('#')[1];
 const payload=(extra={})=>({name:'An',message:'Cảm ơn Chí Công',improvement:'',ratings:{overall:null,shoot:5,product:null,delivery:4},formVersion:1,requestKey:key(),expectedVersion:0,expectedContextVersion:h.contextVersion,...extra});
 const count=async name=>Number((await db.get('SELECT COUNT(*) AS n FROM '+name)).n);
 return {db,service,h,token,payload,create,command,count,wakes:()=>wakes};
}

test('unknown admin filter values including inherited object keys never become SQL clauses',async t=>{
 const {service,h}=await fixture(t);
 for(const state of ['constructor','toString','__proto__','hasOwnProperty','unknown']){
  const list=await service.list({state});assert.deepEqual(list.handovers.map(row=>row.id),[h.id]);
 }
});

test('normalization replay accepts equivalent Unicode/newlines/key order without rewriting the revision',async t=>{
 const {service,h,token,payload,count,wakes}=await fixture(t);
 const original=payload({name:'  A\u0301nh  ',message:'  Ca\u0309m o\u031bn\r\nStudio  ',improvement:'  Go\u0301p y\u0301\rthêm  '});
 const saved=await service.putPublic(h.id,token,original);
 assert.equal(saved.latestFeedback.name,'Ánh');assert.equal(saved.latestFeedback.message,'Cảm ơn\nStudio');
 const equivalent={...original,name:'Ánh',message:'Cảm ơn\nStudio',improvement:'Góp ý\nthêm',ratings:{delivery:4,product:null,shoot:5,overall:null}};
 const replay=await service.putPublic(h.id,token,equivalent);
 assert.equal(replay.replayed,true);assert.equal(replay.latestFeedback.savedAt,saved.latestFeedback.savedAt);
 assert.equal(await count('feedback_revisions'),1);assert.equal(await count('feedback_notifications'),1);assert.equal(wakes(),1);
});

test('30 simultaneous retries commit one revision, receipt and notification and wake once',{timeout:20000},async t=>{
 const {service,h,token,payload,count,wakes}=await fixture(t),body=payload();
 const replies=await Promise.all(Array.from({length:30},()=>service.putPublic(h.id,token,body)));
 assert.equal(replies.filter(reply=>!reply.replayed).length,1);assert.ok(replies.every(reply=>reply.latestVersion===1&&reply.acknowledgedVersion===1));
 for(const table of ['feedback','feedback_revisions','feedback_request_receipts','feedback_notifications'])assert.equal(await count(table),1,table);
 assert.equal(wakes(),1);
});

test('invalid tokens and cross-handover signatures cannot read content or replay saved requests',async t=>{
 const {service,h,token,payload,count,create,command}=await fixture(t),body=payload();await service.putPublic(h.id,token,body);
 const other=await command(await create(),'complete'),otherToken=(await service.link(other.id)).url.split('#')[1];
 for(const invalid of ['',token.slice(1),token+'a','é'.repeat(43),'a'.repeat(10000),otherToken]){
  await assert.rejects(service.getPublic(h.id,invalid),code('LINK_UNAVAILABLE'));
  await assert.rejects(service.putPublic(h.id,invalid,body),code('LINK_UNAVAILABLE'));
 }
 assert.equal(await count('feedback_revisions'),1);assert.equal(await count('feedback_request_receipts'),1);
 assert.equal(await count('rate_limits'),1,'invalid authorization creates no per-invitation quota entries');
});

test('current authorization precedes durable receipt replay through revoke and reissue',async t=>{
 const {service,h,token,payload,count,command}=await fixture(t),first=payload();await service.putPublic(h.id,token,first);
 await service.putPublic(h.id,token,payload({expectedVersion:1,message:'Bản thứ hai'}));
 const revoked=await command(h,'revoke');await assert.rejects(service.putPublic(h.id,token,first),code('LINK_UNAVAILABLE'));
 const reissued=await command(revoked,'issue'),newToken=(await service.link(reissued.id)).url.split('#')[1];
 assert.notEqual(newToken,token);await assert.rejects(service.getPublic(h.id,token),code('LINK_UNAVAILABLE'));
 const replay=await service.putPublic(h.id,newToken,first);assert.equal(replay.replayed,true);assert.equal(replay.acknowledgedVersion,1);assert.equal(replay.latestVersion,2);assert.equal(replay.latestFeedback.message,'Bản thứ hai');
 assert.equal(await count('feedback_revisions'),2);assert.equal(await count('feedback_notifications'),2);
});

test('simultaneous admin edits cannot both overwrite the same handover version',async t=>{
 const {service,h}=await fixture(t);
 const outcomes=await Promise.allSettled(['A','B'].map(title=>service.patch(h.id,{title,requestKey:key(),expectedVersion:h.version})));
 assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);assert.equal(outcomes.find(result=>result.status==='rejected').reason.code,'VERSION_CONFLICT');
 const winner=outcomes.find(result=>result.status==='fulfilled').value.handover,final=(await service.detail(h.id)).handover;
 assert.equal(final.title,winner.title);assert.equal(final.version,h.version+1);assert.equal(final.contextVersion,h.contextVersion+1);
});

test('opposite album transfers serialize both handovers without deadlock or partial transfer',{timeout:20000},async t=>{
 const {db,service,create}=await fixture(t);
 await db.run("INSERT INTO albums(id,title,category) VALUES('transfer-a','A','wedding'),('transfer-b','B','wedding')");
 const a=await create({albumIds:['transfer-a']}),b=await create({albumIds:['transfer-b']});
 const outcomes=await Promise.allSettled([
  service.transferAlbum(a.id,{albumId:'transfer-a',toHandoverId:b.id,requestKey:key(),expectedVersion:a.version,expectedTargetVersion:b.version}),
  service.transferAlbum(b.id,{albumId:'transfer-b',toHandoverId:a.id,requestKey:key(),expectedVersion:b.version,expectedTargetVersion:a.version})
 ]);
 assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);assert.equal(outcomes.find(result=>result.status==='rejected').reason.code,'VERSION_CONFLICT');
 const afterA=(await service.detail(a.id)).handover,afterB=(await service.detail(b.id)).handover;
 assert.equal(afterA.version,a.version+1);assert.equal(afterB.version,b.version+1);
 assert.deepEqual([...afterA.albumIds,...afterB.albumIds].sort(),['transfer-a','transfer-b']);
 assert.ok(afterA.albumIds.length===0||afterB.albumIds.length===0);
});

test('read acknowledgements racing a later revision never mark that unseen revision read',async t=>{
 const {service,h,token,payload}=await fixture(t);await service.putPublic(h.id,token,payload());
 await Promise.all([service.read(h.id,1),service.putPublic(h.id,token,payload({expectedVersion:1,message:'Bản chưa đọc'}))]);
 const after=(await service.detail(h.id)).handover;assert.equal(after.latestVersion,2);assert.equal(after.readVersion,1);assert.equal(after.unread,true);
 await assert.rejects(service.read(h.id,3),code('VALIDATION_ERROR'));assert.equal((await service.detail(h.id)).handover.readVersion,1);
});

test('no-op receipt remains replayable after edits and cannot resurrect its older content',async t=>{
 const {service,h,token,payload,count}=await fixture(t);await service.putPublic(h.id,token,payload());
 const noop=payload({expectedVersion:1});assert.equal((await service.putPublic(h.id,token,noop)).changed,false);
 await service.putPublic(h.id,token,payload({expectedVersion:1,name:'Người gửi mới',message:'Nội dung mới',improvement:'Có góp ý',ratings:{overall:1,shoot:null,product:5,delivery:null}}));
 const replay=await service.putPublic(h.id,token,noop);assert.equal(replay.changed,false);assert.equal(replay.replayed,true);assert.equal(replay.acknowledgedVersion,1);assert.equal(replay.latestFeedback.name,'Người gửi mới');
 const revisions=await service.revisions(h.id);assert.equal(revisions.revisions[1].name,'An');assert.equal(revisions.revisions[1].ratings.shoot,5);assert.equal(revisions.revisions[0].ratings.shoot,null);
 assert.equal(await count('feedback_revisions'),2);assert.equal(await count('feedback_request_receipts'),3);assert.equal(await count('feedback_notifications'),2);
});

test('SQLite constraints reject fractional versions and retry counters',{skip:!!process.env.STUDIO_TEST_POSTGRES_URL},async t=>{
 const {db,service,h,token,payload}=await fixture(t);await service.putPublic(h.id,token,payload());
 const fields={handovers:['handover_version','context_version'],feedback:['context_version','latest_version','read_version'],feedback_revisions:['version','form_version'],feedback_request_receipts:['result_version','normalization_version','form_version'],feedback_notifications:['version','attempts']};
 for(const [table,columns] of Object.entries(fields))for(const column of columns){
  const value=column==='read_version'?0.5:1.5;
  await assert.rejects(db.run('UPDATE '+table+' SET '+column+'=?',[value]),/Feedback versions and counters must be integers/,table+'.'+column+' must remain an integer');
 }
});

test('SQLite integer guards cover inserts and are installed when migrating an existing database',{skip:!!process.env.STUDIO_TEST_POSTGRES_URL},async t=>{
 const {db,h}=await fixture(t),{migrateFeedbackSchema}=await import('../server/feedback-schema.mjs');
 await db.exec('DROP TRIGGER handovers_integer_insert; DROP TRIGGER handovers_integer_update;');
 await db.run('UPDATE handovers SET handover_version=1.5 WHERE id=?',[h.id]);
 assert.equal((await db.get('SELECT handover_version FROM handovers WHERE id=?',[h.id])).handover_version,1.5,'reproduce SQLite affinity before upgrading the guards');
 await db.run('UPDATE handovers SET handover_version=? WHERE id=?',[h.version,h.id]);
 await migrateFeedbackSchema(db);await migrateFeedbackSchema(db);
 await assert.rejects(db.run('UPDATE handovers SET handover_version=1.5 WHERE id=?',[h.id]),/must be integers/);
 const row={...await db.get('SELECT * FROM handovers WHERE id=?',[h.id]),id:randomBytes(16).toString('hex'),create_request_key:key(),context_version:1.5};
 await assert.rejects(db.run('INSERT INTO handovers('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')',Object.values(row)),/must be integers/);
 assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM handovers')).n),1);
});
