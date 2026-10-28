import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {createFeedbackService} from '../server/feedback.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){const result=await check();if(result)return result;await delay(30);}throw Error('Timed out: '+label);}
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'feedback-runtime-')),sockets=new Set(),children=[],messages=[];
 let heldAck,db;
 const smtp=createServer(socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));socket.write('220 localhost synthetic SMTP\r\n');
  let buffer='',data=false,lines=[];
  socket.on('data',chunk=>{
   buffer+=chunk;let end;
   while((end=buffer.indexOf('\r\n'))!==-1){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
    if(data){if(line!=='.'){lines.push(line);continue;}data=false;messages.push(lines.join('\n'));lines=[];heldAck=()=>socket.write('250 accepted-synthetic-message\r\n');continue;}
    if(/^EHLO|^HELO/.test(line))socket.write('250 localhost\r\n');
    else if(/^MAIL FROM|^RCPT TO/.test(line))socket.write('250 OK\r\n');
    else if(line==='DATA'){data=true;socket.write('354 End with dot\r\n');}
    else if(line==='QUIT')socket.end('221 Goodbye\r\n');
    else socket.write('250 OK\r\n');
   }
  });
 });
 t.after(async()=>{
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await child.done;}
  for(const socket of sockets)socket.destroy();if(smtp.listening)await new Promise(resolve=>smtp.close(resolve));
  await db?.close();await rm(dir,{recursive:true,force:true});
 });
 smtp.listen(0,'127.0.0.1');await new Promise(resolve=>smtp.once('listening',resolve));
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await new Promise(resolve=>reservation.once('listening',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const base='http://127.0.0.1:'+port,secret=randomBytes(32).toString('base64url');
 db=await openDatabase(dir);
 const service=createFeedbackService({db,env:{SITE_URL:base,FEEDBACK_LINK_SECRET:secret,NOTIFICATION_EMAIL:'studio@example.invalid'},mailer:{enabled:true}});
 let h=(await service.create({clientName:'Synthetic runtime customer',title:'Runtime fixture',requestKey:randomUUID()})).handover;
 h=(await service.command(h.id,{command:'complete',expectedVersion:h.version,requestKey:randomUUID()})).handover;
 const token=(await service.link(h.id)).url.split('#')[1];
 await service.putPublic(h.id,token,{name:'Synthetic',message:'Runtime queue verification',improvement:'',ratings:{overall:null,shoot:null,product:null,delivery:null},formVersion:1,expectedVersion:0,expectedContextVersion:h.contextVersion,requestKey:randomUUID()});
 const start=async()=>{
  const child=spawn(process.execPath,['studio/server/start.mjs'],{cwd:path.resolve('.'),env:{PATH:process.env.PATH,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir,SITE_URL:base,FEEDBACK_LINK_SECRET:secret,SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtp.address().port),EMAIL_FROM:'fixture@example.invalid',NOTIFICATION_EMAIL:'studio@example.invalid',ANALYTICS_ENABLED:'false',MEDIA_CLEANUP_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
  child.output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>child.output+=chunk);
  child.done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});children.push(child);
  await until(async()=>{if(child.exitCode!==null||child.signalCode!==null)throw Error('Runtime exited: '+child.output);try{return (await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},'runtime startup');
  return child;
 };
 const stop=async child=>{child.kill('SIGTERM');await until(()=>child.exitCode!==null||child.signalCode!==null,'runtime graceful shutdown');assert.deepEqual(await child.done,{code:0,signal:null},child.output);};
 return {db,base,h,token,start,stop,messages,ack:()=>heldAck?.()};
}

test('real runtime starts persisted mail, drains SMTP on SIGTERM, and does not resend an accepted revision after restart',{timeout:30000},async t=>{
 const f=await fixture(t),child=await f.start();
 await until(()=>f.messages.length===1,'SMTP DATA');assert.equal((await f.db.get('SELECT state FROM feedback_notifications')).state,'processing');
 child.kill('SIGTERM');await delay(100);assert.equal(child.exitCode,null,'Process exited before draining its active send');assert.equal(child.signalCode,null);
 f.ack();await until(()=>child.exitCode!==null||child.signalCode!==null,'SMTP drain');assert.deepEqual(await child.done,{code:0,signal:null},child.output);
 assert.equal((await f.db.get('SELECT state FROM feedback_notifications')).state,'accepted_by_provider');
 const restarted=await f.start();await delay(150);assert.equal(f.messages.length,1);assert.equal((await f.db.get('SELECT attempts FROM feedback_notifications')).attempts,1);await f.stop(restarted);
});

test('real runtime keeps restored feedback blocked before startup can send queued SMTP',{timeout:30000},async t=>{
 const f=await fixture(t);await f.db.run("INSERT INTO settings(key,value) VALUES('feedback_restore_pending','true')");
 const child=await f.start();const response=await fetch(f.base+'/api/feedback/'+f.h.id,{headers:{Authorization:'Bearer '+f.token}});assert.equal(response.status,503);
 await delay(150);assert.equal(f.messages.length,0);const job=await f.db.get('SELECT state,attempts FROM feedback_notifications');assert.equal(job.state,'pending');assert.equal(job.attempts,0);
 await f.stop(child);
});
