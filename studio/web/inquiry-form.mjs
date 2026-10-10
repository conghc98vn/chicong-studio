import {validateInquiry} from './inquiry-validation.mjs';
const storageName='chicong-inquiry-attempt';
let memoryAttempt;
const localSession=()=>{try{return globalThis.sessionStorage;}catch{return null;}};
export async function submissionPayload(data,storage=localSession()){
 const json=JSON.stringify(data);
 const fingerprint=globalThis.crypto.subtle?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json))),n=>n.toString(16).padStart(2,'0')).join(''):json;
 let previous=memoryAttempt;
 if(globalThis.crypto.subtle)try{previous=JSON.parse(storage.getItem(storageName))||previous;}catch{}
 if(previous?.fingerprint!==fingerprint||!/^[a-f0-9]{32}$/.test(previous?.key||''))previous={fingerprint,key:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')};
 memoryAttempt=previous;
 // Persist only a random key and a digest, never names, contact details or the draft.
 if(globalThis.crypto.subtle)try{storage.setItem(storageName,JSON.stringify(previous));}catch{}
 return {...data,requestKey:previous.key};
}
export function completeSubmission(storage=localSession()){memoryAttempt=null;try{storage.removeItem(storageName);}catch{}}
export async function postInquiry(payload,{fetcher=fetch,timeout=20000}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetcher('/api/inquiries',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result=await response.json();
  if(!response.ok)throw Object.assign(Error(result.error||'Chưa gửi được yêu cầu tư vấn. Vui lòng thử gửi lại.'),{status:response.status,fields:result.fields});
  return result;
 }catch(error){
  if(error.status)throw error;
  throw Error('Chưa xác nhận được yêu cầu tư vấn đã gửi thành công. Thông tin bạn điền vẫn được giữ lại trên trang này. Hãy thử gửi lại hoặc liên hệ trực tiếp.');
 }finally{clearTimeout(timer);}
}
function showErrors(form,fields){
 for(const element of form.querySelectorAll('[data-field-error]'))element.textContent='';
 for(const input of form.querySelectorAll('[aria-invalid]'))input.removeAttribute('aria-invalid');
 for(const [name,message] of Object.entries(fields)){
  const input=form.elements.namedItem(name),note=form.querySelector(`[data-field-error="${name}"]`);
  if(note)note.textContent=message;
  if(input)input.setAttribute('aria-invalid','true');
 }
 const name=Object.keys(fields)[0];
 if(name)form.elements.namedItem(name)?.focus();
}
export function initInquiryForm(form,{onSuccess,onDateConflict}){
 form.noValidate=true;
 for(const name of ['name','email','phone','date','service','budget','message']){
  const input=form.elements.namedItem(name),note=document.createElement('span');
  note.id=`inquiry-error-${name}`;note.className='field-error';note.dataset.fieldError=name;
  input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),note.id].filter(Boolean).join(' '));
  const label=input.closest('label'),wrapper=document.createElement('div');
  wrapper.className='inquiry-field';label.before(wrapper);wrapper.append(label,note);
 }
 form.addEventListener('input',event=>{
  const input=event.target;
  if(!input.name)return;
  input.removeAttribute('aria-invalid');
  const note=form.querySelector(`[data-field-error="${input.name}"]`);if(note)note.textContent='';
  form.querySelector('.form-error').textContent='';
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();event.stopPropagation();
  if(form.dataset.sending==='true')return;
  const raw=Object.fromEntries(new FormData(form));
  // The server checks current availability after resolving any saved retry.
  const {data,fields}=validateInquiry(raw);
  showErrors(form,fields);
  const summary=form.querySelector('.form-error');
  if(Object.keys(fields).length){summary.textContent='Vui lòng kiểm tra các mục được đánh dấu trong biểu mẫu.';return;}
  const submit=form.querySelector('[type=submit]'),original=submit.innerHTML;
  form.dataset.sending='true';form.setAttribute('aria-busy','true');summary.textContent='';
  submit.disabled=true;submit.textContent='Đang gửi yêu cầu tư vấn…';
  const inputs=[...form.querySelectorAll('input,select,textarea,button')].map(input=>({input,disabled:input.disabled}));
  inputs.forEach(({input})=>input.disabled=true);
  try{
   const payload=await submissionPayload(data);payload.website=raw.website||'';
   const result=await postInquiry(payload);
   completeSubmission();onSuccess(result,data);
  }catch(error){
   // Re-enable before moving focus to the first invalid field.
   inputs.forEach(({input,disabled})=>input.disabled=disabled);
   if(error.status===409&&error.fields?.date)await onDateConflict();
   showErrors(form,error.fields||{});
   summary.textContent=error.message;
  }finally{
   form.dataset.sending='false';form.removeAttribute('aria-busy');
   inputs.forEach(({input,disabled})=>input.disabled=disabled);
   submit.disabled=false;submit.innerHTML=original;
  }
 });
}
