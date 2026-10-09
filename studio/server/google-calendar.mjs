import ical from 'node-ical';
const DAY=86400000;
const day=(date,timeZone='Asia/Ho_Chi_Minh')=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function busyDays(source,now=new Date(),{includeTransparent=false}={}){
 if(!source.includes('BEGIN:VCALENDAR')||!source.includes('END:VCALENDAR'))throw Error('Invalid calendar');
 // Include the entire final selectable day, not just its midnight boundary.
 const from=new Date(day(now)+'T00:00:00+07:00'),to=new Date(+from+731*DAY-1),blocked=new Set();
 for(const event of Object.values(ical.sync.parseICS(source))){
  if(event.type!=='VEVENT'||!event.start)continue;
  for(const item of ical.expandRecurringEvent(event,{from,to,expandOngoing:true})){
   if(item.event.status==='CANCELLED'||(!includeTransparent&&item.event.transparency==='TRANSPARENT'))continue;
   const zone=item.isFullDay?(item.start.tz||item.event.start.tz||Intl.DateTimeFormat().resolvedOptions().timeZone):'Asia/Ho_Chi_Minh';
   const first=day(item.start,zone),last=day(new Date(Math.max(+item.start,+item.end-1)),zone);
   for(let cursor=new Date(Math.max(Date.parse(first+'T00:00:00Z'),Date.parse(day(from)+'T00:00:00Z')));day(cursor,'UTC')<=last&&day(cursor,'UTC')<=day(to);cursor=new Date(+cursor+DAY))blocked.add(day(cursor,'UTC'));
  }
 }
 return {blocked:[...blocked].sort(),through:day(to)};
}
export function createGoogleCalendar(env={},fetcher=fetch,clock=()=>new Date()){
 const url=env.GOOGLE_CALENDAR_ICS_URL;
 const includeTransparent=env.GOOGLE_CALENDAR_INCLUDE_FREE==='true';
 let cached=null,lastAttempt=0,pending=null,error=false;
 async function read(){
  if(!url)return {configured:false,blocked:[]};
  if(pending)return pending;
  if(lastAttempt&&+clock()-lastAttempt<300000)return result();
  pending=(async()=>{
   lastAttempt=+clock();
   try{
    const target=new URL(url);
    if(target.protocol!=='https:'||target.hostname!=='calendar.google.com'||!target.pathname.startsWith('/calendar/ical/')||target.username||target.password)throw Error('Invalid feed URL');
    const response=await fetcher(target,{signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok)throw Error('Calendar unavailable');
    const reader=response.body.getReader();let size=0;const chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5000000){await reader.cancel();throw Error('Calendar too large');}chunks.push(Buffer.from(value));}
    cached={...busyDays(Buffer.concat(chunks).toString('utf8'),clock(),{includeTransparent}),lastSynced:clock().toISOString()};error=false;
   }catch{error=true;}
   finally{pending=null;}
   return result();
  })();
  return pending;
 }
 function result(){return {configured:true,includeTransparent,...(cached||{blocked:[]}),unavailable:error};}
 async function assertAvailable(date){
  const state=await read();
  if(state.configured&&(state.unavailable||date>state.through))throw Object.assign(Error('Chưa kiểm tra được Google Calendar cho ngày này. Bạn có thể bỏ chọn ngày để gửi tư vấn.'),{status:409,fields:{date:'Chưa kiểm tra được lịch cho ngày này. Chọn ngày khác hoặc bỏ chọn ngày để được tư vấn.'}});
  if(state.blocked.includes(date))throw Object.assign(Error('Ngày này đã bận trên Google Calendar. Vui lòng chọn ngày khác.'),{status:409,fields:{date:'Ngày này đã kín lịch. Chọn ngày khác hoặc bỏ chọn ngày để được tư vấn.'}});
 }
 return {read,assertAvailable};
}
