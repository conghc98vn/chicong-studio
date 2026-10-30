import {randomBytes} from 'node:crypto';
import {buildClientEmail,buildStudioEmail} from './mailer.mjs';

export const INQUIRY_NOTIFICATION_MAX_ATTEMPTS = 6;
export const INQUIRY_NOTIFICATION_BACKOFF_MS = Object.freeze([
  60_000,300_000,1_800_000,7_200_000,21_600_000
]);

const EMAIL_PATTERN=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nowISO=clock=>new Date(clock()).toISOString();
const newId=()=>randomBytes(16).toString('hex');
const validEmail=value=>typeof value==='string'&&EMAIL_PATTERN.test(value.trim());
const originOf=env=>(env.SITE_URL||'https://chicongphoto.vn').replace(/\/$/,'');
const paused=env=>env.INQUIRY_NOTIFICATIONS_PAUSED==='true';
const backoffFor=attempt=>INQUIRY_NOTIFICATION_BACKOFF_MS[Math.min(Math.max(attempt-1,0),INQUIRY_NOTIFICATION_BACKOFF_MS.length-1)];
const mailReady=mailer=>Boolean(mailer?.enabled&&typeof mailer.sendEmail==='function');
const dispatcherError=(status,code,message)=>Object.assign(Error(message),{status,code});
const notificationDTO=row=>({id:row.id,kind:row.kind,recipient:row.recipient,state:row.state,attempts:Number(row.attempts||0),nextAttemptAt:Number(row.next_attempt_at||0),leaseUntil:Number(row.lease_until||0),errorCode:row.error_code||null,providerReference:row.provider_reference||null});

export function resolveStudioRecipient(settings={},env={}){
  for(const value of [env.NOTIFICATION_EMAIL,env.STUDIO_EMAIL,settings.email]){
    if(validEmail(value))return value.trim();
  }
  return null;
}

export function inquiryNotificationRecipients({inquiry,settings={},env={}}){
  const recipients=[{kind:'studio',recipient:resolveStudioRecipient(settings,env)}];
  if(validEmail(inquiry?.email))recipients.push({kind:'client',recipient:inquiry.email.trim()});
  return recipients;
}

function permanentDeliveryError(error){
  const status=Number(error?.status);
  const responseCode=Number(error?.responseCode);
  return error?.permanent===true || (status>=400&&status<500&&![408,409,425,429].includes(status)) || responseCode>=500;
}

export function createInquiryDispatcher({db,env=process.env,mailer,intervalMs=30_000,batchSize=10,leaseMs=120_000,clock=Date.now}){
  if(leaseMs<60_000)throw Error('Inquiry notification lease must be at least 60 seconds and exceed the mailer transport timeout.');
  let stopped=false,timer=null,running=null;
  const available=()=>mailReady(mailer);
  const timestamp=()=>nowISO(clock);

  async function enqueueInTransaction(tx,{inquiryId,settings={}}){
    const inquiry=await tx.get('SELECT * FROM inquiries WHERE id=?',[inquiryId]);
    if(!inquiry)return {created:0};
    const stamp=timestamp();
    let created=0;
    for(const {kind,recipient} of inquiryNotificationRecipients({inquiry,settings,env})){
      const state=available()&&validEmail(recipient)?'pending':'blocked_config';
      const errorCode=state==='pending'?null:'CONFIG_MISSING';
      const result=await tx.run(`INSERT INTO inquiry_notifications(
          id,inquiry_id,kind,recipient,state,attempts,next_attempt_at,lease_until,error_code,created_at,updated_at
        ) VALUES(?,?,?,?,?,0,0,0,?,?,?) ON CONFLICT(inquiry_id,kind) DO NOTHING`,[
        newId(),inquiryId,kind,recipient,state,errorCode,stamp,stamp
      ]);
      created+=Number(result.changes||0);
    }
    return {created};
  }

  async function claim(){
    if(stopped||paused(env))return null;
    return db.transaction(async tx=>{
      if(stopped||paused(env))return null;
      const now=clock();
      if(available())await tx.run(
        "UPDATE inquiry_notifications SET state='pending',error_code=NULL,updated_at=? WHERE state='blocked_config' AND recipient IS NOT NULL",
        [timestamp()]
      );
      // Skip rows that are permanently unusable and continue to the next queue item.
      // This keeps one missing studio recipient from holding a valid client email.
      for(let guard=0;guard<INQUIRY_NOTIFICATION_MAX_ATTEMPTS*2;guard++){
        const row=await tx.get(
          "SELECT * FROM inquiry_notifications WHERE ((state IN ('pending','retry_wait') AND next_attempt_at<=?) OR (state='processing' AND lease_until<=?)) ORDER BY created_at,CASE kind WHEN 'studio' THEN 0 ELSE 1 END,id LIMIT 1"+(tx.cloud?' FOR UPDATE SKIP LOCKED':''),
          [now,now]
        );
        if(!row)return null;
        if(row.attempts>=INQUIRY_NOTIFICATION_MAX_ATTEMPTS){
          await tx.run(
            "UPDATE inquiry_notifications SET state='failed',error_code='RETRIES_EXHAUSTED',claim_id=NULL,lease_until=0,updated_at=? WHERE id=?",
            [timestamp(),row.id]
          );
          continue;
        }
        if(!available()||!validEmail(row.recipient)){
          await tx.run(
            "UPDATE inquiry_notifications SET state='blocked_config',error_code='CONFIG_MISSING',claim_id=NULL,lease_until=0,updated_at=? WHERE id=?",
            [timestamp(),row.id]
          );
          continue;
        }
        const claimId=newId();
        await tx.run(
          "UPDATE inquiry_notifications SET state='processing',attempts=attempts+1,claim_id=?,lease_until=?,updated_at=? WHERE id=?",
          [claimId,now+leaseMs,timestamp(),row.id]
        );
        return {...row,claim_id:claimId,attempts:row.attempts+1,lease_until:now+leaseMs};
      }
      return null;
    });
  }

  async function releaseForPause(job){
    await db.run(
      "UPDATE inquiry_notifications SET state='pending',attempts=CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END,claim_id=NULL,lease_until=0,updated_at=? WHERE id=? AND claim_id=? AND state='processing'",
      [timestamp(),job.id,job.claim_id]
    );
  }

  async function deliver(job){
    const data=await db.transaction(async tx=>{
      const current=await tx.get("SELECT * FROM inquiry_notifications WHERE id=? AND claim_id=? AND state='processing'",[job.id,job.claim_id]);
      if(!current)return null;
      const inquiry=await tx.get('SELECT * FROM inquiries WHERE id=?',[job.inquiry_id]);
      const settings=Object.fromEntries((await tx.all('SELECT key,value FROM settings')).map(row=>[row.key,row.value]));
      return inquiry?{inquiry,settings}:null;
    });
    if(!data)return;
    if(stopped||paused(env)){await releaseForPause(job);return;}
    try{
      const common={inquiry:data.inquiry,reference:data.inquiry.id.slice(0,8),settings:data.settings,siteUrl:originOf(env)};
      const mail=job.kind==='client'?buildClientEmail(common):buildStudioEmail(common);
      const replyTo=job.kind==='client'?resolveStudioRecipient(data.settings,env):(validEmail(data.inquiry.email)?data.inquiry.email.trim():undefined);
      const result=await mailer.sendEmail({to:job.recipient,...mail,replyTo});
      if(result?.skipped){
        await db.run(
          "UPDATE inquiry_notifications SET state='blocked_config',attempts=CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END,error_code='CONFIG_MISSING',lease_until=0,claim_id=NULL,updated_at=? WHERE id=? AND claim_id=? AND state='processing'",
          [timestamp(),job.id,job.claim_id]
        );
        return;
      }
      if(!result?.success)throw Object.assign(Error('Provider did not accept inquiry notification'),{code:'PROVIDER_REJECTED'});
      const reference=String(result.id||result.messageId||'').replace(/[\r\n\u0000-\u001f\u007f]/g,'').slice(0,300)||null;
      await db.run(
        "UPDATE inquiry_notifications SET state='accepted_by_provider',provider_reference=?,error_code=NULL,lease_until=0,claim_id=NULL,updated_at=? WHERE id=? AND claim_id=? AND state='processing'",
        [reference,timestamp(),job.id,job.claim_id]
      );
    }catch(error){
      const permanent=permanentDeliveryError(error);
      const failed=permanent||job.attempts>=INQUIRY_NOTIFICATION_MAX_ATTEMPTS;
      const code=permanent?'PERMANENT_FAILURE':job.attempts>=INQUIRY_NOTIFICATION_MAX_ATTEMPTS?'RETRIES_EXHAUSTED':'TRANSPORT_FAILURE';
      await db.run(
        "UPDATE inquiry_notifications SET state=?,next_attempt_at=?,error_code=?,lease_until=0,claim_id=NULL,updated_at=? WHERE id=? AND claim_id=? AND state='processing'",
        [failed?'failed':'retry_wait',clock()+backoffFor(job.attempts),code,timestamp(),job.id,job.claim_id]
      );
    }
  }

  async function listForInquiry(inquiryId){
    return (await db.all('SELECT * FROM inquiry_notifications WHERE inquiry_id=? ORDER BY CASE kind WHEN \'studio\' THEN 0 ELSE 1 END,id',[inquiryId])).map(notificationDTO);
  }

  async function retryNotification(notificationId,{recipient,inquiryId}={}){
    if(paused(env))throw dispatcherError(503,'INQUIRY_NOTIFICATIONS_PAUSED','Email yêu cầu tư vấn đang tạm dừng để đối soát.');
    if(!available())throw dispatcherError(503,'CONFIG_UNAVAILABLE','Chưa cấu hình dịch vụ gửi email.');
    const result=await db.transaction(async tx=>{
      const row=await tx.get('SELECT * FROM inquiry_notifications WHERE id=?',[notificationId]);
      if(!row)throw dispatcherError(404,'NOT_FOUND','Không tìm thấy thông báo email.');
      if(inquiryId&&row.inquiry_id!==inquiryId)throw dispatcherError(404,'NOT_FOUND','Không tìm thấy thông báo email.');
      if(row.state==='accepted_by_provider'||row.state==='pending'||row.state==='processing'&&Number(row.lease_until)>clock())throw dispatcherError(409,'INVALID_STATE','Thông báo đang gửi hoặc đã được dịch vụ email tiếp nhận.');
      const settings=Object.fromEntries((await tx.all('SELECT key,value FROM settings')).map(item=>[item.key,item.value]));
      const configured=resolveStudioRecipient(settings,env);
      const candidate=row.kind==='studio'?(recipient===undefined?(validEmail(row.recipient)?row.recipient:configured):recipient):row.recipient;
      if(!validEmail(candidate))throw dispatcherError(422,'VALIDATION_ERROR','Vui lòng xác nhận địa chỉ email studio hợp lệ.');
      if(row.kind==='client'&&recipient!==undefined&&(typeof recipient!=='string'||recipient.trim()!==row.recipient))throw dispatcherError(422,'VALIDATION_ERROR','Không thể đổi địa chỉ email xác nhận của khách từ màn hình quản trị.');
      await tx.run(`UPDATE inquiry_notifications SET recipient=?,state='pending',attempts=0,next_attempt_at=0,lease_until=0,claim_id=NULL,error_code=NULL,suppressed_reason=NULL,suppressed_at=NULL,updated_at=? WHERE id=?`,[candidate.trim(),timestamp(),notificationId]);
      return await tx.get('SELECT * FROM inquiry_notifications WHERE id=?',[notificationId]);
    });
    wake();
    return notificationDTO(result);
  }

  function runOnce(){
    if(running)return running;
    if(stopped||paused(env))return Promise.resolve();
    running=(async()=>{
      for(let i=0;i<batchSize&&!stopped&&!paused(env);i++){
        const job=await claim();
        if(!job)break;
        if(!job.skipped)await deliver(job);
      }
    })().finally(()=>{running=null;});
    return running;
  }
  function wake(){if(stopped||paused(env))return;void runOnce().catch(error=>console.error('[inquiry] Notification dispatch failed:',error?.message||error));}
  return {
    enqueueInTransaction,runOnce,wake,listForInquiry,retryNotification,
    async summary(){return db.all('SELECT state,COUNT(*) AS count FROM inquiry_notifications GROUP BY state ORDER BY state');},
    start(){if(timer)return;stopped=false;timer=setInterval(wake,intervalMs);timer.unref?.();wake();},
    async stop(){stopped=true;if(timer)clearInterval(timer);timer=null;if(running)await running;}
  };
}
