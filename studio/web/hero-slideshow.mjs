let dispose=()=>{};
export function initHeroSlideshow(root){
 dispose();
 if(!root)return;
 const slides=[...root.querySelectorAll('.highlight-slide')];
 if(slides.length<2)return;
 const preference=matchMedia('(prefers-reduced-motion: reduce)');
 const controller=new AbortController(),options={signal:controller.signal};
 let index=0,timer,paused=preference.matches,visible=true,request=0,ready=false;
 const count=root.querySelector('.highlight-count');
 const schedule=()=>{clearTimeout(timer);if(ready&&!paused&&visible&&!document.hidden)timer=setTimeout(()=>show(index+1),5000);};
 async function show(next,manual=false){
  clearTimeout(timer);const token=++request;
  const direction=next<index?-1:1;
  for(let attempt=0;attempt<slides.length;attempt++){
   const target=((next+attempt*direction)%slides.length+slides.length)%slides.length;
   if(target===index)continue;
   try{await slides[target].querySelector('img').decode();}catch{continue;}
   if(token!==request||(!manual&&(paused||!visible||document.hidden)))return;
   slides[index].classList.remove('is-active');slides[index].setAttribute('aria-hidden','true');
   index=target;ready=true;slides[index].classList.add('is-active');slides[index].setAttribute('aria-hidden','false');
   count.textContent=`${String(index+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}`;
   const link=root.querySelector('.highlight-album');link.href=slides[index].dataset.href;link.textContent=slides[index].dataset.title+' ↗';
   schedule();return;
  }
  if(token===request)paused=true;
 }
 root.addEventListener('click',event=>{
  const button=event.target.closest('[data-slide]');if(!button)return;
  request++;
  paused=preference.matches;
  show(index+(button.dataset.slide==='next'?1:-1),true);
 },options);
 document.addEventListener('visibilitychange',()=>{request++;schedule();},options);
 preference.addEventListener('change',()=>{paused=preference.matches;request++;schedule();},options);
 const observer=new IntersectionObserver(entries=>{visible=entries[0].intersectionRatio>=0.15;request++;schedule();},{threshold:0.15});observer.observe(root);
 // Start the viewing interval only after the first photograph can be displayed.
 slides[0].querySelector('img').decode().then(()=>{
  if(controller.signal.aborted||ready)return;
  ready=true;schedule();
 }).catch(()=>{
  if(!controller.signal.aborted&&!ready)show(1,true);
 });
 dispose=()=>{request++;clearTimeout(timer);observer.disconnect();controller.abort();};
}
