// Consume once: later gallery unlocks/admin changes must fetch current server state.
export function takePageData(pathname,document=globalThis.document){
 const element=document.getElementById('page-data');
 if(!element)return null;
 element.remove();
 try{
  const data=JSON.parse(element.textContent);
  return data.path===pathname&&data.site&&typeof data.site==='object'&&!Array.isArray(data.site)?data:null;
 }catch{return null;}
}
