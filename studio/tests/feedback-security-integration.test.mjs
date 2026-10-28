import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';

async function fixture(t) {
 const dir=await mkdtemp(path.join(tmpdir(),'feedback-security-'));
 let instance,server;
 t.after(async()=>{
  await instance?.feedbackDispatcher.stop();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await instance?.photoCleanup.close();await instance?.mediaControl.close();instance?.storage.close?.();await instance?.db.close();
  await rm(dir,{recursive:true,force:true});
 });
 const env={FEEDBACK_LINK_SECRET:randomBytes(32).toString('base64url'),FEEDBACK_NOTIFICATIONS_PAUSED:'true',CF_BEACON_TOKEN:'synthetic-beacon-enabled'};
 instance=await createApp({dataDir:dir,env,mailer:{enabled:false}});
 server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;env.SITE_URL=base;
 const setup=await fetch(base+'/api/admin/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic@example.invalid',password:'synthetic-feedback-password'})});
 assert.equal(setup.status,201);const cookie=setup.headers.get('set-cookie').split(';')[0];
 const service=instance.feedback;
 const make=async()=>{let h=(await service.create({clientName:'PRIVATE_CLIENT_'+randomUUID(),title:'Private shoot',notes:'PRIVATE_INTERNAL_NOTE',requestKey:randomUUID()})).handover;h=(await service.command(h.id,{command:'complete',expectedVersion:h.version,requestKey:randomUUID()})).handover;return {h,token:(await service.link(h.id)).url.split('#')[1]};};
 const {h,token}=await make();
 const payload={name:'PRIVATE_SENDER',message:'PRIVATE_FEEDBACK_CONTENT',improvement:'PRIVATE_IMPROVEMENT',ratings:{overall:5,shoot:null,product:null,delivery:null},formVersion:1,requestKey:randomUUID(),expectedVersion:0,expectedContextVersion:h.contextVersion};
 await service.putPublic(h.id,token,payload);
 return {instance,service,base,env,cookie,h,token,payload,make};
}
function privateResponse(response) {
 assert.match(response.headers.get('cache-control')||'',/no-store/);
 assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 assert.match(response.headers.get('x-robots-tag')||'',/noindex/);
}
function noPrivateData(text,f) {
 for(const value of [f.h.clientName,f.payload.message,f.payload.improvement,'PRIVATE_INTERNAL_NOTE',f.token,f.env.FEEDBACK_LINK_SECRET])assert.ok(!text.includes(value),'Private value leaked into unauthorized/public response');
}

test('HTTP authority requires the matching bearer token; admin cookies and URL tokens cannot substitute',async t=>{
 const f=await fixture(t),other=await f.make(),url=f.base+'/api/feedback/'+f.h.id;
 for(const [suffix,headers] of [['',{}],['',{Cookie:f.cookie}],['?token='+f.token,{}],['?access_token='+f.token,{}],['',{Authorization:'Bearer '+other.token}],['',{Authorization:'Bearer '+f.token+'x'}]]){
  const response=await fetch(url+suffix,{headers});assert.equal(response.status,403);privateResponse(response);noPrivateData(await response.text(),f);
 }
 const latest=await fetch(url,{headers:{Authorization:'Bearer '+f.token}});assert.equal(latest.status,200);privateResponse(latest);const json=await latest.json();assert.equal(json.latestFeedback.message,f.payload.message);
 assert.equal(json.handover.notes,undefined);assert.equal(json.handover.inquiryId,undefined);assert.equal(json.handover.albumIds,undefined);assert.equal(json.history,undefined);assert.equal(json.notifications,undefined);
 for(const suffix of ['/revisions','/notifications']){const response=await fetch(url+suffix,{headers:{Cookie:f.cookie,Authorization:'Bearer '+f.token}});assert.equal(response.status,404);privateResponse(response);noPrivateData(await response.text(),f);}
});

test('public pages/settings and private shell contain no feedback data even with analytics configured',async t=>{
 const f=await fixture(t);await f.instance.db.run("INSERT INTO settings(key,value) VALUES('feedback_private_test',?)",[f.payload.message]);
 for(const route of ['/','/api/site','/api/portfolio','/sitemap.xml','/robots.txt']){const response=await fetch(f.base+route);assert.equal(response.status,200);noPrivateData(await response.text(),f);}
 for(const route of ['/feedback/'+f.h.id,'/feedback/'+f.h.id+'?token='+f.token,'/FEEDBACK/'+f.h.id,'/%66eedback/'+f.h.id,'/feedback%2f'+f.h.id,'/feedback/%ZZ']){
  const response=await fetch(f.base+route);assert.equal(response.status,200);privateResponse(response);const html=await response.text();noPrivateData(html,f);assert.match(html,/feedback-page\.mjs/);assert.doesNotMatch(html,/synthetic-beacon-enabled|cloudflareinsights|bootstrap\.js|\/main\.js|page-data/);
 }
 const denied=await fetch(f.base+'/api/admin/export');assert.equal(denied.status,401);assert.match(denied.headers.get('cache-control'),/no-store/);noPrivateData(await denied.text(),f);
 const exportResponse=await fetch(f.base+'/api/admin/export',{headers:{Cookie:f.cookie}});assert.equal(exportResponse.status,200);assert.match(exportResponse.headers.get('cache-control'),/no-store/);const output=await exportResponse.text();assert.ok(output.includes(f.payload.message));assert.ok(!output.includes(f.env.FEEDBACK_LINK_SECRET));assert.ok(!output.includes(f.token));
});

test('early parser, origin, authorization and unsupported-method failures retain privacy headers and do not write',async t=>{
 const f=await fixture(t),url=f.base+'/api/feedback/'+f.h.id;
 const common={'Content-Type':'application/json',Authorization:'Bearer '+f.token};
 for(const [method,headers,body,status] of [
  ['PUT',{...common,Origin:f.base},'{invalid',400],
  ['PUT',{...common,Origin:f.base},JSON.stringify({message:'x'.repeat(140000)}),413],
  ['PUT',common,JSON.stringify(f.payload),403],
  ['PUT',{...common,Origin:'https://attacker.example'},JSON.stringify(f.payload),403],
  ['POST',{...common,Origin:f.base},JSON.stringify(f.payload),404],
 ]){const response=await fetch(url,{method,headers,body});assert.equal(response.status,status);privateResponse(response);noPrivateData(await response.text(),f);}
 const admin=await fetch(f.base+'/api/admin/handovers/'+f.h.id);assert.equal(admin.status,401);privateResponse(admin);noPrivateData(await admin.text(),f);
 assert.equal(Number((await f.instance.db.get('SELECT COUNT(*) AS n FROM feedback_revisions')).n),1);
});

test('conditional reads cannot reuse an authorized response after pause or global API gate',async t=>{
 const f=await fixture(t),url=f.base+'/api/feedback/'+f.h.id,headers={Authorization:'Bearer '+f.token};
 const first=await fetch(url,{headers});assert.equal(first.status,200);const etag=first.headers.get('etag');assert.ok(etag);await first.text();
 await f.service.command(f.h.id,{command:'pause',expectedVersion:f.h.version,requestKey:randomUUID()});
 const paused=await fetch(url,{headers:{...headers,'If-None-Match':etag}});assert.equal(paused.status,403);privateResponse(paused);noPrivateData(await paused.text(),f);
 f.env.FEEDBACK_API_PAUSED='true';
 for(const [route,requestHeaders] of [['/api/feedback/'+f.h.id,headers],['/api/admin/handovers/'+f.h.id,{Cookie:f.cookie}],['/api/admin/export',{Cookie:f.cookie}]]){
  const response=await fetch(f.base+route,{headers:requestHeaders});assert.equal(response.status,503);assert.match(response.headers.get('cache-control'),/no-store/);noPrivateData(await response.text(),f);
 }
});
