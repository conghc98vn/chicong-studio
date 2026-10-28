import {randomBytes} from 'node:crypto';
import {feedbackConfig,validFeedbackRecipient} from './feedback.mjs';
const nowISO=()=>new Date().toISOString();
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function buildFeedbackEmail({notification,revision,feedback,siteUrl}){
 const ctx=JSON.parse(feedback.context_snapshot),criteria=JSON.parse(revision.criteria_snapshot);
 const kind=notification.event_type==='new'?'Cảm nhận mới':'Cảm nhận được cập nhật';
 const subject=`[ChiCong Studio] ${kind} — ${revision.name.replace(/[\r\n]/g,' ')} (#${ctx.id} · v${revision.version})`;
 const adminUrl=new URL('/admin',siteUrl);adminUrl.hash='feedback/'+ctx.id;
 const lines=[kind,`Mã hồ sơ: ${ctx.id}`,`Phiên bản: ${revision.version}`,`Thời điểm lưu: ${revision.server_saved_at}`,`Khách hàng: ${ctx.clientName}`,`Buổi chụp: ${ctx.title}`,`Dịch vụ: ${ctx.service||'Chưa ghi nhận'}`,`Ngày chụp: ${ctx.shootDate||'Chưa ghi nhận'}`,`Ngày bàn giao: ${ctx.deliveredOn||'Chưa ghi nhận'}`,`Người gửi: ${revision.name}`,'',...criteria.map(c=>`${c.label}: ${revision['rating_'+c.key]??'Chưa đánh giá'}`),'','Lời chia sẻ:',revision.message,'','Điều Chí Công có thể làm tốt hơn:',revision.improvement||'Chưa có góp ý bổ sung','','Đây là nội dung của phiên bản được ghi phía trên. Khách có thể đã cập nhật phiên bản mới hơn.',`Mở hồ sơ trong quản trị: ${adminUrl}`];
 return {subject,text:lines.join('\n'),html:`<!doctype html><html lang="vi"><meta charset="utf-8"><body style="font-family:system-ui,sans-serif;color:#292524;line-height:1.7;max-width:640px;margin:32px auto;padding:20px"><h1>${escape(kind)}</h1><div style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(lines.slice(1,-1).join('\n'))}</div><p><a href="${escape(adminUrl)}">Mở hồ sơ trong quản trị</a></p></body></html>`};
}

export function createFeedbackDispatcher({db,env=process.env,mailer,intervalMs=30000,batchSize=10,leaseMs=120000,clock=Date.now}){
 if(leaseMs<60000)throw Error('Feedback lease must be at least 60 seconds and exceed the mailer transport timeout.');
 let stopped=false,timer=null,running=null;
 const gated=()=>stopped||feedbackConfig(env).notificationsPaused||feedbackConfig(env).apiPaused;
 async function claim(){if(gated())return null;return db.transaction(async tx=>{
  if(gated())return null;const now=clock();
  // Recovery never substitutes a new recipient for an old event.
  if(mailer?.enabled&&feedbackConfig(env).origin)await tx.run("UPDATE feedback_notifications SET state='pending',error_code=NULL,updated_at=? WHERE state='blocked_config' AND recipient IS NOT NULL",[nowISO()]);
  const row=await tx.get("SELECT * FROM feedback_notifications WHERE (state IN ('pending','retry_wait') AND next_attempt_at<=?) OR (state='processing' AND lease_until<=?) ORDER BY created_at,id LIMIT 1"+(tx.cloud?' FOR UPDATE SKIP LOCKED':''),[now,now]);
  if(!row)return null;
  if(row.attempts>=6){await tx.run("UPDATE feedback_notifications SET state='failed',error_code='RETRIES_EXHAUSTED',claim_id=NULL,lease_until=0,updated_at=? WHERE id=?",[nowISO(),row.id]);return {skipped:true};}
  if(!mailer?.enabled||!validFeedbackRecipient(row.recipient)||!feedbackConfig(env).origin){await tx.run("UPDATE feedback_notifications SET state='blocked_config',error_code='CONFIG_MISSING',claim_id=NULL,lease_until=0,updated_at=? WHERE id=?",[nowISO(),row.id]);return null;}
  const claimId=randomBytes(16).toString('hex');
  await tx.run("UPDATE feedback_notifications SET state='processing',attempts=attempts+1,claim_id=?,lease_until=?,updated_at=? WHERE id=?",[claimId,now+leaseMs,nowISO(),row.id]);
  return {...row,claim_id:claimId,attempts:row.attempts+1,lease_until:now+leaseMs};
 });}
 async function deliver(job){
  // Reload the immutable revision after claim; no body remains queued in memory
  // between jobs, and a purged job cannot be reconstructed from a revision.
  const data=await db.transaction(async tx=>{const current=await tx.get("SELECT * FROM feedback_notifications WHERE id=? AND claim_id=? AND state='processing'",[job.id,job.claim_id]);if(!current)return null;const revision=await tx.get('SELECT * FROM feedback_revisions WHERE id=?',[job.revision_id]),feedback=await tx.get('SELECT * FROM feedback WHERE id=?',[job.feedback_id]);return revision&&feedback?{revision,feedback}:null;});
  if(!data)return;
  if(gated()){await db.run("UPDATE feedback_notifications SET state='pending',attempts=attempts-1,claim_id=NULL,lease_until=0,updated_at=? WHERE id=? AND claim_id=? AND state='processing'",[nowISO(),job.id,job.claim_id]);return;}
  try{
   // sendEmail owns a real finite transport timeout (HTTP abort / SMTP close).
   // A Promise.race here would permit a timed-out SMTP send to continue in parallel.
   const result=await mailer.sendEmail({to:job.recipient,...buildFeedbackEmail({notification:job,...data,siteUrl:feedbackConfig(env).origin})});
   if(result?.skipped){await db.run("UPDATE feedback_notifications SET state='blocked_config',attempts=attempts-1,error_code='CONFIG_MISSING',lease_until=0,claim_id=NULL,updated_at=? WHERE id=? AND claim_id=? AND state='processing'",[nowISO(),job.id,job.claim_id]);return;}
   if(!result?.success)throw Object.assign(Error('Provider did not accept notification'),{code:'PROVIDER_REJECTED'});
   const reference=String(result.id||result.messageId||'').replace(/[\r\n\u0000-\u001f]/g,'').slice(0,300)||null;
   await db.run("UPDATE feedback_notifications SET state='accepted_by_provider',provider_reference=?,error_code=NULL,lease_until=0,claim_id=NULL,updated_at=? WHERE id=? AND claim_id=? AND state='processing'",[reference,nowISO(),job.id,job.claim_id]);
  }catch(err){const permanent=err?.permanent===true||(Number(err?.status)>=400&&Number(err?.status)<500&&![408,429].includes(Number(err.status)))||Number(err?.responseCode)>=500;const failed=permanent||job.attempts>=6,backoff=[60000,300000,1800000,7200000,21600000][Math.min(job.attempts-1,4)];const code=permanent?'PERMANENT_FAILURE':job.attempts>=6?'RETRIES_EXHAUSTED':'TRANSPORT_FAILURE';await db.run("UPDATE feedback_notifications SET state=?,next_attempt_at=?,error_code=?,lease_until=0,claim_id=NULL,updated_at=? WHERE id=? AND claim_id=? AND state='processing'",[failed?'failed':'retry_wait',clock()+backoff,code,nowISO(),job.id,job.claim_id]);}
 }
 function runOnce(){if(running)return running;if(gated())return Promise.resolve();running=(async()=>{for(let i=0;i<batchSize&&!gated();i++){const job=await claim();if(!job)break;if(!job.skipped)await deliver(job);}})().finally(()=>{running=null;});return running;}
 function wake(){if(gated())return;void runOnce().catch(()=>console.error('[feedback] Notification dispatch failed.'));}
 return {runOnce,wake,start(){if(timer)return;stopped=false;timer=setInterval(wake,intervalMs);timer.unref?.();wake();},async stop(){stopped=true;if(timer)clearInterval(timer);timer=null;if(running)await running;}};
}

export async function suppressFeedbackNotifications(db,{reason='RESTORE_RECONCILIATION'}={}){
 // Caller must first pause all dispatchers using the out-of-database gate and
 // drain sends. Claim identity still protects against a stale late ACK.
 const safe=/^[A-Z0-9_]{1,80}$/.test(reason)?reason:'OPERATIONS_REVIEW';
 return db.run("UPDATE feedback_notifications SET state='suppressed',suppressed_reason=?,suppressed_at=?,claim_id=NULL,lease_until=0,updated_at=? WHERE state IN ('pending','processing','retry_wait','blocked_config','failed')",[safe,nowISO(),nowISO()]);
}
