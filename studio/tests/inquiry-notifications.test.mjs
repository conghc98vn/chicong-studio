import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase,id} from '../server/db.mjs';
import {createInquiryDispatcher} from '../server/inquiry-notifications.mjs';

async function fixture(){
  const dir=await mkdtemp(path.join(tmpdir(),'chicong-inquiry-notifications-'));
  const db=await openDatabase(dir);
  const inquiry={id:id(),name:'Dâu & Rể',email:'daure@example.com',phone:'0988776655',date:'',service:'Pre-wedding',message:'Xin tư vấn gói film.',status:'new',created:new Date().toISOString(),budget:''};
  await db.run('INSERT INTO inquiries(id,name,email,phone,date,service,message,status,created,budget) VALUES(?,?,?,?,?,?,?,?,?,?)',Object.values(inquiry));
  return {dir,db,inquiry,settings:{brand:'ChiCong',email:'studio@example.com',phone:'0900000000'}};
}

test('Inquiry outbox survives provider failure and delivers after a restart',async()=>{
  const f=await fixture();let now=1000000,firstCalls=0,secondCalls=0;
  try{
    const failed=createInquiryDispatcher({db:f.db,env:{SITE_URL:'https://example.com'},mailer:{enabled:true,sendEmail:async()=>{firstCalls++;throw Error('offline');}},clock:()=>now});
    await f.db.transaction(tx=>failed.enqueueInTransaction(tx,{inquiryId:f.inquiry.id,settings:f.settings}));
    await failed.runOnce();
    assert.equal(firstCalls,2);
    assert.deepEqual((await f.db.all('SELECT kind,state,attempts FROM inquiry_notifications ORDER BY kind')).map(row=>[row.kind,row.state,row.attempts]),[['client','retry_wait',1],['studio','retry_wait',1]]);
    await failed.stop();

    now+=60001;
    const restarted=createInquiryDispatcher({db:f.db,env:{SITE_URL:'https://example.com'},mailer:{enabled:true,sendEmail:async mail=>{secondCalls++;assert.match(mail.to,/example/);return {success:true,id:'provider-'+secondCalls};}},clock:()=>now});
    await restarted.runOnce();
    assert.equal(secondCalls,2);
    assert.deepEqual((await f.db.all("SELECT state,provider_reference FROM inquiry_notifications ORDER BY kind")).map(row=>[row.state,row.provider_reference]),[['accepted_by_provider','provider-2'],['accepted_by_provider','provider-1']]);
    await restarted.stop();
  }finally{await f.db.close();await rm(f.dir,{recursive:true,force:true});}
});

test('Inquiry outbox stays blocked without a provider and resumes when configured',async()=>{
  const f=await fixture();
  try{
    const disabled=createInquiryDispatcher({db:f.db,env:{SITE_URL:'https://example.com'},mailer:{enabled:false,sendEmail:async()=>({success:true})}});
    await f.db.transaction(tx=>disabled.enqueueInTransaction(tx,{inquiryId:f.inquiry.id,settings:f.settings}));
    assert.deepEqual((await f.db.all('SELECT state FROM inquiry_notifications ORDER BY kind')).map(row=>row.state),['blocked_config','blocked_config']);
    await disabled.stop();
    let sent=0;
    const enabled=createInquiryDispatcher({db:f.db,env:{SITE_URL:'https://example.com'},mailer:{enabled:true,sendEmail:async()=>{sent++;return {success:true};}}});
    await enabled.runOnce();
    assert.equal(sent,2);
    assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM inquiry_notifications WHERE state='accepted_by_provider'")).count,2);
    await enabled.stop();
  }finally{await f.db.close();await rm(f.dir,{recursive:true,force:true});}
});

test('Inquiry notifications keep missing studio configuration isolated from client delivery',async()=>{
  const f=await fixture();let now=2000000,calls=0;
  try{
    const dispatcher=createInquiryDispatcher({db:f.db,env:{SITE_URL:'https://example.com'},mailer:{enabled:true,sendEmail:async mail=>{
      calls++;
      if(mail.to==='daure@example.com')return {success:true,id:'client-only'};
      throw Error('unexpected studio delivery');
    }},clock:()=>now});
    await f.db.transaction(tx=>dispatcher.enqueueInTransaction(tx,{inquiryId:f.inquiry.id,settings:{email:'not-an-email'}}));
    await dispatcher.runOnce();
    assert.equal(calls,1);
    assert.deepEqual((await f.db.all('SELECT kind,recipient,state,error_code FROM inquiry_notifications ORDER BY kind')).map(row=>[row.kind,row.recipient,row.state,row.error_code]),[
      ['client','daure@example.com','accepted_by_provider',null],
      ['studio',null,'blocked_config','CONFIG_MISSING']
    ]);
    await dispatcher.stop();
  }finally{await f.db.close();await rm(f.dir,{recursive:true,force:true});}
});

test('Inquiry notifications can be retried after the studio recipient is configured',async()=>{
  const f=await fixture();let calls=0;
  try{
    const dispatcher=createInquiryDispatcher({db:f.db,env:{SITE_URL:'https://example.com'},mailer:{enabled:true,sendEmail:async()=>{calls++;return {success:true,id:'retry-'+calls};}}});
    await f.db.transaction(tx=>dispatcher.enqueueInTransaction(tx,{inquiryId:f.inquiry.id,settings:{email:'not-an-email'}}));
    await dispatcher.runOnce();
    const studio=(await dispatcher.listForInquiry(f.inquiry.id)).find(row=>row.kind==='studio');
    assert.equal(studio.state,'blocked_config');
    assert.equal(studio.recipient,null);
    const retried=await dispatcher.retryNotification(studio.id,{recipient:'studio@example.com'});
    assert.equal(retried.state,'pending');
    await dispatcher.runOnce();
    assert.equal(calls,2);
    assert.deepEqual((await dispatcher.listForInquiry(f.inquiry.id)).map(row=>[row.kind,row.state,row.recipient]),[
      ['studio','accepted_by_provider','studio@example.com'],
      ['client','accepted_by_provider','daure@example.com']
    ]);
    await dispatcher.stop();
  }finally{await f.db.close();await rm(f.dir,{recursive:true,force:true});}
});

test('Inquiry notifications retry provider 5xx responses',async()=>{
  const f=await fixture();let calls=0;
  try{
    const dispatcher=createInquiryDispatcher({db:f.db,env:{SITE_URL:'https://example.com'},mailer:{enabled:true,sendEmail:async()=>{calls++;throw Object.assign(Error('provider unavailable'),{status:503});}}});
    await f.db.transaction(tx=>dispatcher.enqueueInTransaction(tx,{inquiryId:f.inquiry.id,settings:f.settings}));
    await dispatcher.runOnce();
    assert.equal(calls,2);
    assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM inquiry_notifications WHERE state='retry_wait' AND error_code='TRANSPORT_FAILURE'")).count,2);
    await dispatcher.stop();
  }finally{await f.db.close();await rm(f.dir,{recursive:true,force:true});}
});

test('Inquiry notifications classify invalid recipients as permanent failures',async()=>{
  const f=await fixture();
  try{
    const dispatcher=createInquiryDispatcher({db:f.db,env:{SITE_URL:'https://example.com'},mailer:{enabled:true,sendEmail:async()=>{throw Object.assign(Error('invalid recipient'),{status:400});}}});
    await f.db.transaction(tx=>dispatcher.enqueueInTransaction(tx,{inquiryId:f.inquiry.id,settings:f.settings}));
    await dispatcher.runOnce();
    assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM inquiry_notifications WHERE state='failed' AND error_code='PERMANENT_FAILURE'")).count,2);
    await dispatcher.stop();
  }finally{await f.db.close();await rm(f.dir,{recursive:true,force:true});}
});
