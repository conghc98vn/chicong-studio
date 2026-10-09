let dispose=()=>{};
export function initBackToTop(button){
 dispose();
 if(!button)return;
 let frame=0;
 const update=()=>{
  frame=0;
  const distance=document.documentElement.scrollHeight-window.innerHeight;
  const editing=document.activeElement?.matches('input,textarea,select,[contenteditable=true]');
  button.hidden=editing||distance<=0||window.scrollY/distance<0.5;
 };
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 window.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('resize',schedule);
 document.addEventListener('focusin',schedule);
 document.addEventListener('focusout',schedule);
 const observer=new ResizeObserver(schedule);
 observer.observe(document.body);
 update();
 dispose=()=>{
  window.removeEventListener('scroll',schedule);
  window.removeEventListener('resize',schedule);
  document.removeEventListener('focusin',schedule);
  document.removeEventListener('focusout',schedule);
  observer.disconnect();
  cancelAnimationFrame(frame);
 };
}
