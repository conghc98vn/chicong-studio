export const uploadRequestTimeout=180000;
export async function api(url,options={},{timeout=12000,fetcher=fetch}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetcher(url,{credentials:'same-origin',...options,signal:controller.signal,headers:options.body instanceof FormData?options.headers:{'Content-Type':'application/json',...options.headers}});
  let data;try{data=await response.json();}catch(error){
   if(controller.signal.aborted)throw error;
   if(response.ok)throw Object.assign(Error('Máy chủ trả về phản hồi chưa đầy đủ. Vui lòng thử lại.'),{code:'INVALID_RESPONSE'});
  }
  if(!response.ok)throw Object.assign(Error(data?.error||`Máy chủ trả về lỗi HTTP ${response.status}. Vui lòng thử lại.`),{status:response.status,data});
  return data;
 }catch(error){
  if(controller.signal.aborted)throw Object.assign(Error('Quá thời gian chờ máy chủ xác nhận. Vui lòng thử lại.'),{code:'REQUEST_TIMEOUT'});
  if(error.status||error.code)throw error;
  throw Object.assign(Error('Không kết nối được máy chủ. Vui lòng thử lại.'),{code:'NETWORK_ERROR'});
 }finally{clearTimeout(timer);}
}
