const grid=document.querySelector('[data-calendar-grid]');
const title=document.querySelector('[data-calendar-title]');
const status=document.querySelector('[data-calendar-status]');
const selection=document.querySelector('[data-calendar-selection]');
const unknownLegend=document.querySelector('[data-calendar-unknown-legend]');
const copyButton=document.querySelector('[data-copy-booking]');
const stickyCta=document.querySelector('.freelancer-sticky-cta');
const previousMonthButton=document.querySelector('[data-calendar-prev]');
const nextMonthButton=document.querySelector('[data-calendar-next]');
const pad=value=>String(value).padStart(2,'0');
const toKey=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
const labels=['T2','T3','T4','T5','T6','T7','CN'];
let availability={blocked:[],today:'',unavailable:false,loading:true};
let month=new Date();month.setDate(1);
let selectedDate='';
const dateLabel=key=>key?new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(key+'T12:00:00')):'';
const navLinks=[...document.querySelectorAll('[data-freelancer-nav]')];
const navSections=navLinks.map(link=>document.getElementById(link.dataset.freelancerNav)).filter(Boolean);
const hasDirectContact=!!document.querySelector('.freelancer-contact-actions a');
function restoreHashPosition(){
 const target=document.getElementById(location.hash.slice(1));
 if(target)requestAnimationFrame(()=>requestAnimationFrame(()=>target.scrollIntoView({block:'start',behavior:'auto'})));
}
if(location.hash){if(document.readyState==='complete')setTimeout(restoreHashPosition,0);else window.addEventListener('load',restoreHashPosition,{once:true});}
function setActiveNav(id){navLinks.forEach(link=>{if(link.dataset.freelancerNav===id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});}
if(navSections.length){
 const initial=navSections.find(section=>section.id===location.hash.slice(1))||navSections[0];
 let frame=0;
 const updateActiveNav=()=>{
  const marker=window.scrollY+Math.min(window.innerHeight*.32,240);
  let current=navSections[0];
  for(const section of navSections){if(section.offsetTop<=marker)current=section;else break;}
  setActiveNav(current.id);
 };
 const scheduleActiveNav=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;updateActiveNav();});};
 setActiveNav(initial.id);
 window.addEventListener('scroll',scheduleActiveNav,{passive:true});
 window.addEventListener('resize',scheduleActiveNav);
 window.addEventListener('hashchange',scheduleActiveNav);
 scheduleActiveNav();
}
function drawCalendar(){
 if(!grid||!title)return;
 grid.setAttribute('aria-busy',String(availability.loading));
 const year=month.getFullYear(),number=month.getMonth(),first=new Date(year,number,1),last=new Date(year,number+1,0);
 const today=availability.today?new Date(availability.today+'T12:00:00'):new Date();
 if(previousMonthButton)previousMonthButton.disabled=availability.loading||first<=new Date(today.getFullYear(),today.getMonth(),1);
 const throughMonth=availability.through?new Date(availability.through+'T12:00:00'):null;
 if(nextMonthButton)nextMonthButton.disabled=availability.loading||!!(throughMonth&&first>=new Date(throughMonth.getFullYear(),throughMonth.getMonth(),1));
 title.textContent=new Intl.DateTimeFormat('vi-VN',{month:'long',year:'numeric'}).format(first);
 grid.innerHTML=labels.map(label=>`<span>${label}</span>`).join('');
 const offset=(first.getDay()+6)%7;
 for(let i=0;i<offset;i++)grid.insertAdjacentHTML('beforeend','<span aria-hidden="true"></span>');
 for(let day=1;day<=last.getDate();day++){
  const key=toKey(new Date(year,number,day));
  const busy=availability.blocked.includes(key),past=key<availability.today,afterSyncRange=!!availability.through&&key>availability.through,unknown=availability.unavailable||afterSyncRange,disabled=busy||past||unknown||availability.loading;
  const classes=['freelancer-day'];if(busy)classes.push('busy');if(key===availability.today)classes.push('today');if(past)classes.push('past');if(unknown&&!past&&!busy)classes.push('unavailable');if(key===selectedDate)classes.push('selected');
  const label=`${day} tháng ${number+1} năm ${year}${busy?' — đã bận':past?' — đã qua':availability.loading?' — đang tải lịch':availability.unavailable||afterSyncRange?' — chưa xác minh':key===selectedDate?' — đã chọn':' — chưa có lịch xác nhận'}`;
  grid.insertAdjacentHTML('beforeend',`<button type="button" class="${classes.join(' ')}" data-calendar-day data-date="${key}" aria-label="${label}" ${key===selectedDate?'aria-current="date"':''} ${disabled?'disabled':''}>${day}</button>`);
 }
 const rangeNote=availability.through&&!availability.unavailable?` Lịch được kiểm tra đến ${dateLabel(availability.through)}; các ngày sau mốc này đang tạm khóa.`:'';
 if(status)status.textContent=availability.loading?'Đang tải lịch…':availability.unavailable?'Lịch chưa tải đủ. Các ngày tương lai đang tạm khóa; vui lòng nhắn Công để kiểm tra ngày.':`Màu nâu là ngày đã bận. Ngày còn lại là ngày chưa có lịch đã xác nhận; xem lịch chưa giữ chỗ.${rangeNote}`;
 if(unknownLegend)unknownLegend.hidden=availability.loading||(!availability.unavailable&&!availability.through);
 if(selection){selection.hidden=!selectedDate;selection.textContent=selectedDate?`Đã chọn ${dateLabel(selectedDate)}. ${hasDirectContact?'Hãy bấm nút liên hệ hoặc sao chép mẫu tin nhắn để gửi cho Công.':'Hãy sao chép mẫu tin nhắn rồi gửi cho Công qua Messenger hoặc Zalo.'}`:'';}
 if(copyButton){copyButton.disabled=!selectedDate;copyButton.textContent=selectedDate?'Sao chép mẫu tin nhắn ↗':'Chọn ngày để sao chép mẫu tin nhắn';}
 if(stickyCta){stickyCta.hidden=!selectedDate;const label=stickyCta.querySelector('span');if(label)label.textContent=selectedDate?`Đã chọn ${dateLabel(selectedDate)}`:'Đã chọn ngày?';}
}
function chooseDate(key){if(!key||availability.loading||availability.unavailable||availability.blocked.includes(key)||key<availability.today||availability.through&&key>availability.through)return;selectedDate=key;drawCalendar();selection?.scrollIntoView({block:'nearest',behavior:'smooth'});}
async function copyText(text){
 try{
  if(navigator.clipboard?.writeText){
   await Promise.race([navigator.clipboard.writeText(text),new Promise((_,reject)=>setTimeout(()=>reject(Error('clipboard-timeout')),800))]);
   return true;
  }
 }catch{}
 const fallback=document.createElement('textarea');fallback.value=text;fallback.setAttribute('readonly','');fallback.style.position='fixed';fallback.style.opacity='0';fallback.style.pointerEvents='none';document.body.append(fallback);fallback.select();fallback.setSelectionRange(0,fallback.value.length);
 let copied=false;try{copied=document.execCommand('copy');}catch{}fallback.remove();return copied;
}
 async function loadAvailability(){
 try{const response=await fetch('/api/freelancer/availability',{headers:{Accept:'application/json'}});if(!response.ok)throw Error('availability');const payload=await response.json();if(!payload||typeof payload.today!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(payload.today)||!Array.isArray(payload.blocked))throw Error('availability-payload');availability={...payload,blocked:payload.blocked,loading:false};}
 catch{availability={...availability,loading:false,unavailable:true};}
 const today=availability.today?new Date(availability.today+'T12:00:00'):new Date();month=new Date(today.getFullYear(),today.getMonth(),1);drawCalendar();if(location.hash)restoreHashPosition();
}
document.querySelector('[data-calendar-prev]')?.addEventListener('click',()=>{month.setMonth(month.getMonth()-1);selectedDate='';drawCalendar();});
document.querySelector('[data-calendar-next]')?.addEventListener('click',()=>{month.setMonth(month.getMonth()+1);selectedDate='';drawCalendar();});
grid?.addEventListener('click',event=>{const day=event.target.closest('[data-calendar-day]');if(day)chooseDate(day.dataset.date);});
copyButton?.addEventListener('click',async event=>{
 const button=event.currentTarget;
 const text=['Studio/đơn vị:','Ngày chụp:'+(selectedDate?' '+dateLabel(selectedDate):''),'Địa điểm:','Thời gian dự kiến:','Vị trí cần book:','Bàn giao file hay có edit:','Yêu cầu thêm:'].join('\n');
 button.disabled=true;button.textContent='Đang sao chép…';
 const copied=await copyText(text);
 button.disabled=false;
 if(copied){button.textContent='Đã sao chép mẫu tin nhắn ✓';setTimeout(()=>{if(button.isConnected)button.textContent='Sao chép mẫu tin nhắn ↗';},2400);}else button.textContent='Không sao chép được · Thử lại';
});
drawCalendar();void loadAvailability();
