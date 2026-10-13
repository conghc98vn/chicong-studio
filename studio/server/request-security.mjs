const loopbackHosts=new Set(['localhost','127.0.0.1','[::1]']);
const loopbackAddresses=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);

export function requestSecurity({production,origin,env}){
 const configured=origin||env.SITE_URL;
 let site;
 if(configured){
  try{site=new URL(configured);}catch{throw Error('SITE_URL must be an absolute HTTP(S) URL');}
  if(!['http:','https:'].includes(site.protocol)||site.username||site.password||site.search||site.hash||site.pathname!=='/')throw Error('SITE_URL must contain only an HTTP(S) origin');
 }
 if(production&&site?.protocol!=='https:')throw Error('Production requires an HTTPS SITE_URL');
 const proxy=env.TRUST_PROXY?.trim();
 // Keep the existing Render hop count unless the operator configures verified proxies.
 // Never accept the blanket trust-all setting: clients may supply forwarding headers.
 if(proxy==='true')throw Error('TRUST_PROXY must specify trusted proxy addresses or a verified hop count');
 const trustProxy=proxy===undefined?(production?1:false):proxy==='false'?false:/^\d+$/.test(proxy)?Number(proxy):proxy;
 if(trustProxy===''||(typeof trustProxy==='number'&&!Number.isSafeInteger(trustProxy)))throw Error('Invalid TRUST_PROXY');
 return {trustProxy,middleware(req,res,next){
  let host;
  try{
   const raw=req.get('host');
   if(!raw||/[\s/@?#\\]/.test(raw))throw Error('Invalid host');
   host=new URL('http://'+raw);
  }catch{return res.status(400).set('Cache-Control','no-store').json({error:'Địa chỉ truy cập không hợp lệ.'});}
  const localHost=loopbackHosts.has(host.hostname);
  req.localSetup=!production&&localHost&&loopbackAddresses.has(req.socket.remoteAddress);
  // A browser rebinding an attacker hostname to loopback must not reach local APIs.
  if(!production&&!localHost&&host.host!==site?.host)return res.status(403).set('Cache-Control','no-store').json({error:'Vui lòng truy cập bằng địa chỉ website đã cấu hình.'});
  if(req.path.toLowerCase()==='/api'||req.path.toLowerCase().startsWith('/api/')){
   res.set('Cache-Control','no-store');
   if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    const expected=site?.origin||host.origin;
    if(req.get('origin')!==expected)return res.status(403).json({error:'Không thể gửi từ trang này. Vui lòng tải lại trang rồi thử lại.'});
   }
  }
  next();
 }};
}
