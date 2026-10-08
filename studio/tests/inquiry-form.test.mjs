import test from 'node:test';
import assert from 'node:assert/strict';
import {submissionPayload,completeSubmission,postInquiry} from '../web/inquiry-form.mjs';
import {validateInquiry} from '../web/inquiry-validation.mjs';
const request={name:'Cặp đôi',email:'couple@example.com',phone:'',date:'',service:'Tư vấn',budget:'Chưa xác định',message:'Tư vấn ngày cưới của hai bạn'};
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),values};};
test('Retry retains request identity without storing the personal draft',async()=>{
 const store=storage();completeSubmission(store);const first=await submissionPayload(request,store),retry=await submissionPayload({...request},store);
 assert.equal(first.requestKey,retry.requestKey);assert.doesNotMatch([...store.values.values()].join(''),/couple@example|Cặp đôi|Tư vấn/);
 const changed=await submissionPayload({...request,budget:'20 triệu'},store);assert.notEqual(changed.requestKey,first.requestKey);
 completeSubmission(store);assert.notEqual((await submissionPayload(request,store)).requestKey,first.requestKey);
});
test('Uncertain network result and timeout preserve a retryable identity',async()=>{
 const store=storage(),payload=await submissionPayload(request,store);let received;
 await assert.rejects(postInquiry(payload,{fetcher:async(url,options)=>{received=JSON.parse(options.body);throw new TypeError('network failed');}}),/Thử|thử gửi lại/);
 assert.equal((await submissionPayload(request,store)).requestKey,received.requestKey);
 await assert.rejects(postInquiry(payload,{timeout:5,fetcher:(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))}),/giữ lại/);
 const result=await postInquiry(payload,{fetcher:async()=>({ok:true,json:async()=>({success:true,reference:'12345678'})})});assert.equal(result.reference,'12345678');
});
test('Field errors identify optional invalid contacts and malformed dates',()=>{
 assert.deepEqual(validateInquiry(request).fields,{});
 assert.deepEqual(validateInquiry({...request,email:'',phone:'0900000000'}).fields,{});
 assert.ok(validateInquiry({...request,phone:'123'}).fields.phone);
 assert.ok(validateInquiry({...request,email:'bad',phone:'0900000000'}).fields.email);
 assert.ok(validateInquiry({...request,email:''}).fields.email);
 for(const date of ['2099-02-30','2020-01-01'])assert.ok(validateInquiry({...request,date},'2026-10-08').fields.date);
 assert.ok(validateInquiry({...request,message:'     '}).fields.message);
 assert.ok(validateInquiry({...request,budget:'x'.repeat(101)}).fields.budget);
});
