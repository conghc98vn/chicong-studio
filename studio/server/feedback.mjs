import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const uid=()=>randomBytes(16).toString('hex');
const timestamp=()=>new Date().toISOString();
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const FEEDBACK_SCHEMA=Object.freeze({formVersion:1,normalizationVersion:1,criteria:Object.freeze([
 Object.freeze({key:'overall',label:'Trải nghiệm chung'}),Object.freeze({key:'shoot',label:'Trải nghiệm buổi chụp'}),Object.freeze({key:'product',label:'Sản phẩm nhận được'}),Object.freeze({key:'delivery',label:'Quá trình bàn giao'})
]),limits:Object.freeze({name:150,message:3000,improvement:1500})});
// Never edit a published registry entry: receipts and revisions retain its semantics.
const registry=new Map([[1,FEEDBACK_SCHEMA]]);
const keys=FEEDBACK_SCHEMA.criteria.map(c=>c.key);
export function feedbackError(code,status=409,error='Không thể thực hiện thao tác này.',fields){return Object.assign(new Error(error),{code,status,fields});}
function invalid(fields){throw feedbackError('VALIDATION_ERROR',422,'Vui lòng kiểm tra các ô đã nhập.',fields);}
function text(value,max,field,required=false){if(typeof value!=='string')invalid({[field]:'Vui lòng nhập nội dung hợp lệ.'});const result=value.replace(/\r\n?/g,'\n').normalize('NFC').trim();if(result.length>max||(required&&!result)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result))invalid({[field]:`Nội dung phải ${required?'có ít nhất một ký tự và ':''}không quá ${max} ký tự.`});return result;}
function requestKey(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value))invalid({requestKey:'Mã lượt gửi không hợp lệ.'});return value;}
function version(value,field='expectedVersion',min=0){if(!Number.isSafeInteger(value)||value<min)invalid({[field]:'Phiên bản không hợp lệ.'});return value;}
function whitelist(body,allowed){if(!body||typeof body!=='object'||Array.isArray(body))invalid({form:'Dữ liệu không hợp lệ.'});for(const k of Object.keys(body))if(!allowed.includes(k))invalid({[k]:'Trường không được hỗ trợ.'});}
export function feedbackConfig(env=process.env){
 let secret,origin;
 const encoded=env.FEEDBACK_LINK_SECRET||'';
 if(/^[A-Za-z0-9_-]{43,256}$/.test(encoded)){const bytes=Buffer.from(encoded,'base64url');if(bytes.length>=32&&bytes.toString('base64url')===encoded)secret=bytes;}
 try{const u=new URL(env.SITE_URL);if(!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&(u.protocol==='https:'||(env.NODE_ENV!=='production'&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))))origin=u.origin;}catch{}
 return {secret,origin,ready:!!(secret&&origin),apiPaused:env.FEEDBACK_API_PAUSED==='true',notificationsPaused:env.FEEDBACK_NOTIFICATIONS_PAUSED==='true'};
}
function requireConfig(env){const cfg=feedbackConfig(env);if(!cfg.ready)throw feedbackError('CONFIG_UNAVAILABLE',503,'Studio chưa sẵn sàng mở nhận cảm nhận. Vui lòng thử lại sau.');return cfg;}
function signature(row,secret){return createHmac('sha256',secret).update(JSON.stringify(['chicong-feedback',1,row.id,row.invitation_nonce])).digest('base64url');}
function authorize(row,token,env){const cfg=requireConfig(env);const expected=row?signature(row,cfg.secret):'x'.repeat(43);const valid=typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)&&timingSafeEqual(Buffer.from(token),Buffer.from(expected));if(!valid||!row||row.delivery_state!=='delivered'||row.archived_at||row.invitation_state!=='active')throw feedbackError('LINK_UNAVAILABLE',403,'Đường dẫn này hiện không mở nhận cảm nhận. Bạn vui lòng liên hệ Chí Công nhé.');}
function context(row){return {id:row.id,clientName:row.client_name,title:row.title,service:row.service,shootDate:row.shoot_date,deliveredOn:row.delivered_on};}
function revisionDTO(row){return row?{version:row.version,name:row.name,message:row.message,improvement:row.improvement,ratings:Object.fromEntries(keys.map(k=>[k,row['rating_'+k]==null?null:Number(row['rating_'+k])])),formVersion:row.form_version,criteria:JSON.parse(row.criteria_snapshot),savedAt:row.server_saved_at}:null;}
export function notificationDTO(n){return {id:n.id,version:n.version,eventType:n.event_type,recipient:n.recipient,state:n.state,attempts:n.attempts,nextAttemptAt:Number(n.next_attempt_at),leaseUntil:Number(n.lease_until),errorCode:n.error_code,providerReference:n.provider_reference,suppressedReason:n.suppressed_reason,createdAt:n.created_at,updatedAt:n.updated_at};}
function normalizedFeedback(body,schema){
 whitelist(body,['name','message','improvement','ratings','formVersion','requestKey','expectedVersion','expectedContextVersion']);
 if(body.formVersion!==schema.formVersion)throw feedbackError('REQUEST_KEY_CONFLICT');
 whitelist(body.ratings,keys);
 const ratings={};for(const key of keys){const value=body.ratings[key];if(value!==null&&(!Number.isInteger(value)||value<1||value>5))invalid({['ratings.'+key]:'Chọn từ 1 đến 5 sao hoặc bỏ đánh giá.'});ratings[key]=value;}
 const expectedVersion=version(body.expectedVersion);
 return {name:text(body.name,schema.limits.name,'name',true),message:text(body.message,schema.limits.message,'message',true),improvement:text(body.improvement??'',schema.limits.improvement,'improvement'),ratings,formVersion:body.formVersion,expectedVersion,...(expectedVersion===0?{expectedContextVersion:version(body.expectedContextVersion,'expectedContextVersion',1)}:{})};
}
function contentOnly(value){return {name:value.name,message:value.message,improvement:value.improvement,ratings:value.ratings};}
export const validFeedbackRecipient=value=>typeof value==='string'&&value.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const adminFields=['clientName','title','service','shootDate','deliveredOn','inquiryId','albumIds','notes'];
function normalizeAdmin(body,partial=false){
 whitelist(body,[...adminFields,'requestKey',...(partial?['expectedVersion']:[])]);
 const result={};for(const key of ['clientName','title','service','notes'])if(!partial||Object.hasOwn(body,key))result[key]=text(body[key]??'',key==='notes'?10000:200,key,['clientName','title'].includes(key));
 for(const key of ['shootDate','deliveredOn'])if(!partial||Object.hasOwn(body,key)){const value=body[key]??'';if(typeof value!=='string'||(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)))invalid({[key]:'Ngày không hợp lệ.'});result[key]=value;}
 if(!partial||Object.hasOwn(body,'inquiryId')){const value=body.inquiryId||null;if(value!==null&&(typeof value!=='string'||value.length>128))invalid({inquiryId:'Yêu cầu không hợp lệ.'});result.inquiryId=value;}
 if(!partial||Object.hasOwn(body,'albumIds')){const value=body.albumIds??[];if(!Array.isArray(value)||value.length>100||value.some(id=>typeof id!=='string'||!id||id.length>128))invalid({albumIds:'Danh sách bộ ảnh không hợp lệ.'});result.albumIds=[...new Set(value)].sort();}
 return result;
}
const columnMap={clientName:'client_name',title:'title',service:'service',shootDate:'shoot_date',deliveredOn:'delivered_on',inquiryId:'inquiry_id',notes:'notes'};
const pageOptions=query=>({page:Math.max(1,Math.min(100000,Number.parseInt(query?.page)||1)),pageSize:Math.max(1,Math.min(100,Number.parseInt(query?.pageSize)||30))});
export function createFeedbackService({db,env=process.env,mailer,wake=()=>{},acceptedFormVersions=[1]}){
 const gate=()=>{if(feedbackConfig(env).apiPaused)throw feedbackError('FEEDBACK_PAUSED',503,'Studio đang bảo trì phần cảm nhận. Vui lòng thử lại sau.');};
 async function invitationRate(tx,h,kind){const now=Date.now(),key='feedback:invitation:'+h.id+':'+kind,windowMs=600000,limit=kind==='write'?60:600;const row=await tx.get('SELECT * FROM rate_limits WHERE key=?',[key]);if(row&&Number(row.expires)>now&&row.count>=limit)throw Object.assign(feedbackError('RATE_LIMITED',429,'Bạn vui lòng đợi một chút rồi thử lại.'),{retryAfter:Math.ceil((Number(row.expires)-now)/1000)});await tx.run('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires>? THEN rate_limits.count+1 ELSE 1 END,expires=CASE WHEN rate_limits.expires>? THEN rate_limits.expires ELSE ? END',[key,now+windowMs,now,now,now+windowMs]);}
 const lock=(tx,id)=>tx.get('SELECT * FROM handovers WHERE id=?'+(tx.cloud?' FOR UPDATE':''),[id]);
 async function required(tx,id){const h=await lock(tx,id);if(!h)throw feedbackError('NOT_FOUND',404,'Không tìm thấy hồ sơ.');return h;}
 async function latest(tx,id){const f=await tx.get('SELECT * FROM feedback WHERE handover_id=?',[id]);return {f,r:f?await tx.get('SELECT * FROM feedback_revisions WHERE feedback_id=? AND version=?',[f.id,f.latest_version]):null};}
 async function publicDTO(tx,h,ack={}){const {f,r}=await latest(tx,h.id);const contact=Object.fromEntries((await tx.all("SELECT key,value FROM settings WHERE key IN ('phone','email','zalo','facebook')")).map(row=>[row.key,row.value]));return {handover:f?JSON.parse(f.context_snapshot):context(h),contextVersion:f?.context_version??h.context_version,schema:FEEDBACK_SCHEMA,latestVersion:f?.latest_version??0,latestFeedback:revisionDTO(r),contact,...ack};}
 async function adminDTO(tx,h){const {f,r}=await latest(tx,h.id);return {...context(h),inquiryId:h.inquiry_id,notes:h.notes,albumIds:(await tx.all('SELECT album_id FROM handover_albums WHERE handover_id=? ORDER BY album_id',[h.id])).map(a=>a.album_id),version:h.handover_version,contextVersion:h.context_version,deliveryState:h.delivery_state,deliveryConfirmedAt:h.delivery_confirmed_at,invitationState:h.invitation_state,issuedAt:h.issued_at,archivedAt:h.archived_at,createdAt:h.created_at,updatedAt:h.updated_at,latestVersion:f?.latest_version??0,readVersion:f?.read_version??0,unread:!!f&&f.read_version<f.latest_version,latestFeedback:revisionDTO(r),feedbackContext:f?JSON.parse(f.context_snapshot):null,notifications:f?(await tx.all('SELECT * FROM feedback_notifications WHERE feedback_id=? ORDER BY version DESC',[f.id])).map(notificationDTO):[]};}
 async function validateRelations(tx,id,data){
  if(data.inquiryId&&!(await tx.get('SELECT id FROM inquiries WHERE id=?',[data.inquiryId])))invalid({inquiryId:'Yêu cầu không tồn tại.'});
  for(const albumId of data.albumIds||[]){if(!(await tx.get('SELECT id FROM albums WHERE id=?',[albumId])))invalid({albumIds:'Bộ ảnh không tồn tại.'});const assigned=await tx.get('SELECT handover_id FROM handover_albums WHERE album_id=?',[albumId]);if(assigned&&assigned.handover_id!==id)throw feedbackError('ALBUM_ASSIGNED',409,'Bộ ảnh đã thuộc hồ sơ khác, kể cả hồ sơ đã lưu trữ.',{albumIds:'Mở hồ sơ hiện có và dùng thao tác chuyển bộ ảnh để sửa gán nhầm.'});}
 }
 async function assign(tx,id,albumIds){if(!albumIds)return;await tx.run('DELETE FROM handover_albums WHERE handover_id=?',[id]);for(const albumId of albumIds)await tx.run('INSERT INTO handover_albums(handover_id,album_id) VALUES(?,?)',[id,albumId]);}
 async function operation(id,body,command,action){gate();const key=requestKey(body.requestKey);version(body.expectedVersion,'expectedVersion',1);const hash=digest({id,command,...body,requestKey:undefined});return db.transaction(async tx=>{const h=await required(tx,id);if(h.operation_key===key){if(h.operation_hash!==hash)throw feedbackError('REQUEST_KEY_CONFLICT',409,'Mã thao tác đã được dùng cho nội dung khác.');return {handover:await adminDTO(tx,h),replayed:true,...JSON.parse(h.operation_result)};}if(h.handover_version!==body.expectedVersion)throw feedbackError('VERSION_CONFLICT',409,'Hồ sơ đã thay đổi. Vui lòng tải lại để đối chiếu.');const changed=await action(tx,h);const result={changed};await tx.run('UPDATE handovers SET operation_key=?,operation_hash=?,operation_result=? WHERE id=?',[key,hash,JSON.stringify(result),id]);return {handover:await adminDTO(tx,await required(tx,id)),replayed:false,...result};});}
 const service={
  readiness(){const cfg=feedbackConfig(env);return {ready:cfg.ready&&!cfg.apiPaused,linkConfigured:cfg.ready,apiPaused:cfg.apiPaused,notificationsPaused:cfg.notificationsPaused,mailConfigured:!!mailer?.enabled};},
  async create(body){gate();const data=normalizeAdmin(body),key=requestKey(body.requestKey),hash=digest(data);return db.transaction(async tx=>{if(tx.cloud)await tx.get('SELECT pg_advisory_xact_lock(hashtext(?))',['feedback-create:'+key]);const old=await tx.get('SELECT * FROM handovers WHERE create_request_key=?',[key]);if(old){if(old.create_request_hash!==hash)throw feedbackError('REQUEST_KEY_CONFLICT');return {handover:await adminDTO(tx,old),replayed:true};}const id=uid(),now=timestamp();await validateRelations(tx,id,data);await tx.run('INSERT INTO handovers(id,client_name,title,service,shoot_date,delivered_on,inquiry_id,notes,invitation_nonce,create_request_key,create_request_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,data.clientName,data.title,data.service,data.shootDate,data.deliveredOn,data.inquiryId,data.notes,uid(),key,hash,now,now]);await assign(tx,id,data.albumIds);return {handover:await adminDTO(tx,await required(tx,id)),replayed:false};});},
  async patch(id,body){const data=normalizeAdmin(body,true);return operation(id,{...data,requestKey:body.requestKey,expectedVersion:body.expectedVersion},'patch',async(tx,h)=>{await validateRelations(tx,id,data);const changes=Object.entries(columnMap).filter(([key,column])=>Object.hasOwn(data,key)&&data[key]!==h[column]);let albumsChanged=false;if(data.albumIds){const current=(await tx.all('SELECT album_id FROM handover_albums WHERE handover_id=? ORDER BY album_id',[id])).map(a=>a.album_id);albumsChanged=JSON.stringify(current)!==JSON.stringify(data.albumIds);}if(!changes.length&&!albumsChanged)return false;const contextChanged=changes.some(([key])=>['clientName','title','service','shootDate','deliveredOn'].includes(key));await tx.run(`UPDATE handovers SET ${changes.map(([,column])=>column+'=?,').join('')}handover_version=handover_version+1,context_version=context_version+?,updated_at=? WHERE id=?`,[...changes.map(([key])=>data[key]),contextChanged?1:0,timestamp(),id]);if(albumsChanged)await assign(tx,id,data.albumIds);return true;});},
  async command(id,body){whitelist(body,['command','requestKey','expectedVersion']);return operation(id,body,body.command,async(tx,h)=>{
   const patch={};const active=()=>{if(h.delivery_state!=='delivered'||h.archived_at)throw feedbackError('INVALID_STATE',409,'Hồ sơ cần được bàn giao và bỏ lưu trữ trước.');};
   switch(body.command){
    case 'complete':if(h.delivery_state!=='draft'||h.archived_at)throw feedbackError('INVALID_STATE');requireConfig(env);Object.assign(patch,{delivery_state:'delivered',delivery_confirmed_at:timestamp(),invitation_state:'active',invitation_nonce:uid(),issued_at:timestamp()});break;
    case 'pause':active();if(h.invitation_state==='paused')return false;if(h.invitation_state!=='active')throw feedbackError('INVALID_STATE');patch.invitation_state='paused';break;
    case 'resume':active();requireConfig(env);if(h.invitation_state==='active')return false;if(h.invitation_state!=='paused')throw feedbackError('INVALID_STATE');patch.invitation_state='active';break;
    case 'revoke':if(h.invitation_state==='revoked')return false;Object.assign(patch,{invitation_state:'revoked',invitation_nonce:uid()});break;
    case 'issue':active();requireConfig(env);Object.assign(patch,{invitation_state:'active',invitation_nonce:uid(),issued_at:timestamp()});break;
    case 'uncomplete':if(h.delivery_state==='draft')return false;Object.assign(patch,{delivery_state:'draft',delivery_confirmed_at:null,invitation_state:'revoked',invitation_nonce:uid()});break;
    case 'archive':if(h.archived_at)return false;patch.archived_at=timestamp();if(h.invitation_state==='active')patch.invitation_state='paused';break;
    case 'unarchive':if(!h.archived_at)return false;patch.archived_at=null;break;
    default:invalid({command:'Thao tác không hợp lệ.'});
   }
   await tx.run(`UPDATE handovers SET ${Object.keys(patch).map(k=>k+'=?').join(',')},handover_version=handover_version+1,updated_at=? WHERE id=?`,[...Object.values(patch),timestamp(),id]);return true;
  });},
  async transferAlbum(id,body){
   gate();whitelist(body,['albumId','toHandoverId','expectedVersion','expectedTargetVersion','requestKey']);
   const key=requestKey(body.requestKey);version(body.expectedVersion,'expectedVersion',1);version(body.expectedTargetVersion,'expectedTargetVersion',1);
   if(typeof body.albumId!=='string'||body.albumId.length>128||!body.albumId||typeof body.toHandoverId!=='string'||!/^[a-f0-9]{32}$/.test(body.toHandoverId)||id===body.toHandoverId)invalid({albumId:'Chọn bộ ảnh và một hồ sơ nhận khác.'});
   const hash=digest({command:'transfer-album',id,albumId:body.albumId,toHandoverId:body.toHandoverId,expectedVersion:body.expectedVersion,expectedTargetVersion:body.expectedTargetVersion});
   return db.transaction(async tx=>{
    const locked=new Map();for(const target of [id,body.toHandoverId].sort())locked.set(target,await required(tx,target));
    const source=locked.get(id),target=locked.get(body.toHandoverId);
    if(source.operation_key===key){if(source.operation_hash!==hash)throw feedbackError('REQUEST_KEY_CONFLICT');return {handover:await adminDTO(tx,source),targetHandover:await adminDTO(tx,target),changed:true,replayed:true};}
    if(source.handover_version!==body.expectedVersion||target.handover_version!==body.expectedTargetVersion)throw feedbackError('VERSION_CONFLICT',409,'Một trong hai hồ sơ đã thay đổi. Vui lòng tải lại để đối chiếu trước khi chuyển.');
    const linked=await tx.get('SELECT handover_id FROM handover_albums WHERE album_id=?',[body.albumId]);if(linked?.handover_id!==id)throw feedbackError('ALBUM_ASSIGNED',409,'Bộ ảnh không còn thuộc hồ sơ nguồn. Vui lòng kiểm tra lại.');
    await tx.run('UPDATE handover_albums SET handover_id=? WHERE album_id=? AND handover_id=?',[target.id,body.albumId,source.id]);
    for(const h of [source,target])await tx.run('UPDATE handovers SET handover_version=handover_version+1,operation_key=?,operation_hash=?,operation_result=?,updated_at=? WHERE id=?',[key,hash,JSON.stringify({changed:true}),timestamp(),h.id]);
    return {handover:await adminDTO(tx,await required(tx,id)),targetHandover:await adminDTO(tx,await required(tx,target.id)),changed:true,replayed:false};
   });
  },
  async link(id){gate();return db.transaction(async tx=>{const h=await required(tx,id),cfg=requireConfig(env);const token=signature(h,cfg.secret);authorize(h,token,env);return {url:cfg.origin+'/feedback/'+h.id+'#'+token};});},
  async detail(id){gate();return db.transaction(async tx=>({handover:await adminDTO(tx,await required(tx,id))}));},
  async list(query={}){gate();const {page,pageSize}=pageOptions(query);return db.transaction(async tx=>{
   const clauses=[],params=[];if(query.q){clauses.push('(LOWER(h.client_name) LIKE ? OR LOWER(h.title) LIKE ?)');const q='%'+String(query.q).slice(0,200).toLowerCase()+'%';params.push(q,q);}
   if(query.archived==='true')clauses.push('h.archived_at IS NOT NULL');else if(query.archived!=='all')clauses.push('h.archived_at IS NULL');
   if(query.unread==='true')clauses.push('f.latest_version>f.read_version');else if(query.unread==='false')clauses.push('f.id IS NOT NULL AND f.latest_version=f.read_version');if(query.albumId){clauses.push('EXISTS(SELECT 1 FROM handover_albums ha WHERE ha.handover_id=h.id AND ha.album_id=?)');params.push(String(query.albumId));}
   const states={draft:"h.delivery_state='draft'",active:"h.delivery_state='delivered' AND h.invitation_state='active' AND h.archived_at IS NULL",closed:"h.invitation_state IN ('paused','revoked')",received:'f.id IS NOT NULL'};if(typeof query.state==='string'&&Object.hasOwn(states,query.state))clauses.push(states[query.state]);
   const where=clauses.length?' WHERE '+clauses.join(' AND '):'',join=' FROM handovers h LEFT JOIN feedback f ON f.handover_id=h.id';
   const total=Number((await tx.get('SELECT COUNT(*) AS n'+join+where,params)).n),unreadCount=Number((await tx.get('SELECT COUNT(*) AS n FROM feedback WHERE latest_version>read_version')).n);
   const rows=await tx.all('SELECT h.*,f.latest_version,f.read_version'+join+where+' ORDER BY h.updated_at DESC,h.id LIMIT ? OFFSET ?',[...params,pageSize,(page-1)*pageSize]);
   // Fixed query count per page; list never joins photos or fetches revision bodies.
   let albumRows=[],notificationRows=[];if(rows.length){const placeholders=rows.map(()=>'?').join(',');albumRows=await tx.all(`SELECT * FROM handover_albums WHERE handover_id IN (${placeholders}) ORDER BY album_id`,rows.map(r=>r.id));notificationRows=await tx.all(`SELECT n.*,f.handover_id FROM feedback_notifications n JOIN feedback f ON f.id=n.feedback_id WHERE f.handover_id IN (${placeholders}) ORDER BY n.version DESC`,rows.map(r=>r.id));}
   return {handovers:rows.map(h=>({...context(h),inquiryId:h.inquiry_id,notes:h.notes,version:h.handover_version,contextVersion:h.context_version,deliveryState:h.delivery_state,deliveryConfirmedAt:h.delivery_confirmed_at,invitationState:h.invitation_state,issuedAt:h.issued_at,archivedAt:h.archived_at,createdAt:h.created_at,updatedAt:h.updated_at,latestVersion:h.latest_version??0,readVersion:h.read_version??0,unread:(h.latest_version??0)>(h.read_version??0),albumIds:albumRows.filter(a=>a.handover_id===h.id).map(a=>a.album_id),notifications:notificationRows.filter(n=>n.handover_id===h.id).map(notificationDTO)})),total,unreadCount,page,pageSize,readiness:service.readiness()};
  });},
  async getPublic(id,token){gate();return db.transaction(async tx=>{const h=await lock(tx,id);authorize(h,token,env);await invitationRate(tx,h,'read');return publicDTO(tx,h);});},
  async putPublic(id,token,body){gate();requestKey(body?.requestKey);const result=await db.transaction(async tx=>{
   const h=await lock(tx,id);authorize(h,token,env);await invitationRate(tx,h,'write');
   const receipt=await tx.get('SELECT * FROM feedback_request_receipts WHERE handover_id=? AND request_key=?',[id,body.requestKey]);
   if(receipt){const schema=registry.get(receipt.form_version);if(!schema||schema.normalizationVersion!==receipt.normalization_version)throw feedbackError('CONFIG_UNAVAILABLE',503);let hash;try{hash=digest(normalizedFeedback(body,schema));}catch{throw feedbackError('REQUEST_KEY_CONFLICT');}if(hash!==receipt.request_hash)throw feedbackError('REQUEST_KEY_CONFLICT',409,'Mã lượt gửi đã được dùng cho nội dung khác.');return publicDTO(tx,h,{acknowledgedVersion:receipt.result_version,replayed:true,changed:!!receipt.changed});}
   const schema=registry.get(body.formVersion);if(!schema||!acceptedFormVersions.includes(body.formVersion))throw feedbackError('FORM_VERSION_UNSUPPORTED',409,'Biểu mẫu đã thay đổi. Vui lòng tải biểu mẫu mới và kiểm tra trước khi gửi lại.');
   const value=normalizedFeedback(body,schema),hash=digest(value);let {f,r}=await latest(tx,id);
   if(value.expectedVersion!==(f?.latest_version??0))throw feedbackError('VERSION_CONFLICT',409,'Đã có cập nhật mới hơn. Vui lòng xem lại trước khi gửi.');
   if(!f&&value.expectedContextVersion!==h.context_version)throw feedbackError('CONTEXT_CHANGED',409,'Thông tin buổi chụp đã thay đổi. Vui lòng kiểm tra lại trước khi gửi.');
   const changed=!r||digest(contentOnly(value))!==digest(contentOnly(revisionDTO(r))),now=timestamp();let next=f?.latest_version??0;
   if(changed){next++;if(!f){f={id:uid()};await tx.run('INSERT INTO feedback(id,handover_id,context_snapshot,context_version,latest_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',[f.id,id,JSON.stringify(context(h)),h.context_version,next,now,now]);}else await tx.run('UPDATE feedback SET latest_version=?,updated_at=? WHERE id=?',[next,now,f.id]);
    const revisionId=uid();await tx.run('INSERT INTO feedback_revisions(id,feedback_id,version,name,message,improvement,rating_overall,rating_shoot,rating_product,rating_delivery,form_version,criteria_snapshot,server_saved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[revisionId,f.id,next,value.name,value.message,value.improvement,...keys.map(k=>value.ratings[k]),schema.formVersion,JSON.stringify(schema.criteria),now]);
    const setting=await tx.get("SELECT value FROM settings WHERE key='email'");const candidate=env.NOTIFICATION_EMAIL||env.STUDIO_EMAIL||setting?.value;const recipient=validFeedbackRecipient(candidate)?candidate:null;const state=recipient&&mailer?.enabled?'pending':'blocked_config';
    await tx.run('INSERT INTO feedback_notifications(id,feedback_id,revision_id,version,event_type,recipient,state,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[uid(),f.id,revisionId,next,next===1?'new':'updated',recipient,state,state==='blocked_config'?'CONFIG_MISSING':null,now,now]);
   }
   await tx.run('INSERT INTO feedback_request_receipts(handover_id,request_key,request_hash,normalization_version,form_version,result_version,changed,created_at) VALUES(?,?,?,?,?,?,?,?)',[id,body.requestKey,hash,schema.normalizationVersion,schema.formVersion,next,changed?1:0,now]);
   return publicDTO(tx,h,{acknowledgedVersion:next,replayed:false,changed});
  });if(result.changed&&!result.replayed)wake();return result;},
  async read(id,observedVersion){gate();version(observedVersion,'observedVersion');return db.transaction(async tx=>{const h=await required(tx,id);const {f}=await latest(tx,id);if(observedVersion>(f?.latest_version??0))invalid({observedVersion:'Phiên bản chưa tồn tại.'});if(f&&observedVersion>f.read_version)await tx.run('UPDATE feedback SET read_version=? WHERE id=?',[observedVersion,f.id]);return {handover:await adminDTO(tx,h)};});},
  async revisions(id,query={}){gate();const {page,pageSize}=pageOptions(query);return db.transaction(async tx=>{await required(tx,id);const f=await tx.get('SELECT * FROM feedback WHERE handover_id=?',[id]);return {revisions:f?(await tx.all('SELECT * FROM feedback_revisions WHERE feedback_id=? ORDER BY version DESC LIMIT ? OFFSET ?',[f.id,pageSize,(page-1)*pageSize])).map(revisionDTO):[],total:f?.latest_version??0,page,pageSize};});},
  async retryNotification(id,notificationId,body={}){gate();whitelist(body,['recipient']);const result=await db.transaction(async tx=>{await required(tx,id);const n=await tx.get('SELECT n.* FROM feedback_notifications n JOIN feedback f ON f.id=n.feedback_id WHERE n.id=? AND f.handover_id=?'+(tx.cloud?' FOR UPDATE OF n':''),[notificationId,id]);if(!n)throw feedbackError('NOT_FOUND',404);if(n.state==='accepted_by_provider'||(n.state==='processing'&&Number(n.lease_until)>Date.now())||n.state==='pending')throw feedbackError('INVALID_STATE',409,'Thông báo đang gửi hoặc đã được dịch vụ email tiếp nhận.');const recipient=body.recipient??n.recipient;if(!validFeedbackRecipient(recipient))invalid({recipient:'Vui lòng xác nhận địa chỉ nhận email hợp lệ.'});if(!mailer?.enabled)throw feedbackError('CONFIG_UNAVAILABLE',503,'Chưa cấu hình dịch vụ gửi email.');await tx.run("UPDATE feedback_notifications SET recipient=?,state='pending',attempts=0,next_attempt_at=0,lease_until=0,claim_id=NULL,error_code=NULL,suppressed_reason=NULL,suppressed_at=NULL,updated_at=? WHERE id=?",[recipient,timestamp(),notificationId]);return {notification:notificationDTO(await tx.get('SELECT * FROM feedback_notifications WHERE id=?',[notificationId]))};});wake();return result;}
 };
 return service;
}

export function registerFeedbackRoutes(app,options){
 const {db,env=process.env}=options,service=createFeedbackService(options);
 const privateHeaders=(req,res,next)=>{res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer'});next();};
 app.use(['/api/feedback','/api/admin/handovers'],privateHeaders);
 const route=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(err){if(err.status){if(err.status===429)res.set('Retry-After',String(err.retryAfter||60));res.status(err.status).json({error:err.message,code:err.code,...(err.fields?{fields:err.fields}:{})});}else if(err.code==='23505'||String(err.code).startsWith('SQLITE_CONSTRAINT'))res.status(409).json({error:'Dữ liệu đã thay đổi hoặc bộ ảnh đã thuộc hồ sơ khác. Vui lòng tải lại.',code:'VERSION_CONFLICT'});else{console.error('[feedback] Request failed:',/^[A-Z0-9_]{1,40}$/.test(err?.code||'')?err.code:'INTERNAL_ERROR');res.status(500).json({error:'Chưa thể xử lý lúc này. Vui lòng thử lại.',code:'INTERNAL_ERROR'});}}};
 // Existing requestSecurity also validates Origin, but enforce the configured
 // origin here so the exported routes cannot accidentally bypass that boundary.
 const originGuard=(req,res,next)=>{if(['GET','HEAD','OPTIONS'].includes(req.method))return next();const origin=feedbackConfig(env).origin;if(!origin||req.get('origin')!==origin)return res.status(403).json({error:'Không thể gửi từ trang này.',code:'ORIGIN_REJECTED'});next();};
 app.use('/api/feedback',originGuard);
 async function rate(req){const now=Date.now(),ip=digest(String(req.ip||req.socket.remoteAddress||''));await db.transaction(async tx=>{const key='feedback:ip:'+ip;const row=await tx.get('SELECT * FROM rate_limits WHERE key=?'+(tx.cloud?' FOR UPDATE':''),[key]);if(row&&Number(row.expires)>now&&row.count>=120)throw Object.assign(feedbackError('RATE_LIMITED',429,'Bạn vui lòng đợi một chút rồi thử lại.'),{retryAfter:Math.ceil((Number(row.expires)-now)/1000)});await tx.run('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires>? THEN rate_limits.count+1 ELSE 1 END,expires=CASE WHEN rate_limits.expires>? THEN rate_limits.expires ELSE ? END',[key,now+60000,now,now,now+60000]);if(Math.random()<0.02)await tx.run('DELETE FROM rate_limits WHERE expires<?',[now]);});}
 const token=req=>{const value=req.get('authorization')||'';return value.startsWith('Bearer ')?value.slice(7):'';};
 app.get('/api/feedback/:id',route(async req=>{await rate(req);return service.getPublic(req.params.id,token(req));}));
 app.put('/api/feedback/:id',route(async req=>{await rate(req);return service.putPublic(req.params.id,token(req),req.body);}));
 app.get('/api/admin/handovers',route(req=>service.list(req.query)));
 app.post('/api/admin/handovers',route(req=>service.create(req.body)));
 app.get('/api/admin/handovers/:id',route(req=>service.detail(req.params.id)));
 app.patch('/api/admin/handovers/:id',route(req=>service.patch(req.params.id,req.body)));
 app.post('/api/admin/handovers/:id/commands',route(req=>service.command(req.params.id,req.body)));
 app.post('/api/admin/handovers/:id/transfer-album',route(req=>service.transferAlbum(req.params.id,req.body)));
 app.get('/api/admin/handovers/:id/link',route(req=>service.link(req.params.id)));
 app.post('/api/admin/handovers/:id/read',route(req=>service.read(req.params.id,req.body?.observedVersion)));
 app.get('/api/admin/handovers/:id/revisions',route(req=>service.revisions(req.params.id,req.query)));
 app.post('/api/admin/handovers/:id/notifications/:notificationId/retry',route(req=>service.retryNotification(req.params.id,req.params.notificationId,req.body)));
 return service;
}
