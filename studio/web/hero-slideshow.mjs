let dispose=()=>{};
function loadSlide(slide){
 const photo=slide.querySelector('img');
 if(photo.dataset?.src){
  // Hidden slides have no network URLs until the viewer requests them.
  for(const source of slide.querySelectorAll('source[data-srcset]')){source.srcset=source.dataset.srcset;delete source.dataset.srcset;}
  photo.loading='eager';
  if(photo.dataset.srcset){photo.srcset=photo.dataset.srcset;delete photo.dataset.srcset;}
  photo.src=photo.dataset.src;delete photo.dataset.src;
 }
 return photo;
}
export function initHeroSlideshow(root){
 dispose();dispose=()=>{};
 if(!root)return;
 const slides=[...root.querySelectorAll('.highlight-slide')];
 if(slides.length<2)return;
 const controller=new AbortController(),options={signal:controller.signal};
 const images=root.querySelector('.highlight-images');
 const count=root.querySelector('.highlight-count');
 const link=root.querySelector('.highlight-album');
 const title=link.querySelector('.highlight-album-title');
 let index=0,request=0,gesture=null;
 async function show(next){
  const token=++request,direction=next<index?-1:1;
  images.setAttribute('aria-busy','true');
  try{
   for(let attempt=0;attempt<slides.length;attempt++){
    const target=((next+attempt*direction)%slides.length+slides.length)%slides.length;
    if(target===index)continue;
    try{await loadSlide(slides[target]).decode();}catch{if(token!==request)return;continue;}
    if(token!==request)return;
    slides[index].classList.remove('is-active');slides[index].setAttribute('aria-hidden','true');
    index=target;slides[index].classList.add('is-active');slides[index].setAttribute('aria-hidden','false');
    count.textContent=`${String(index+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}`;
    link.href=slides[index].dataset.href;title.textContent=slides[index].dataset.title;
    return;
   }
  }finally{if(token===request)images.setAttribute('aria-busy','false');}
 }
 const resetGesture=()=>{
  const pointerId=gesture?.id;gesture=null;images.classList.remove('is-dragging');
  if(pointerId!==undefined&&images.hasPointerCapture(pointerId))images.releasePointerCapture(pointerId);
 };
 images.addEventListener('pointerdown',event=>{
  if(!event.isPrimary){resetGesture();return;}
  if(event.button!==0)return;
  gesture={id:event.pointerId,x:event.clientX,y:event.clientY,axis:null};
  images.setPointerCapture(event.pointerId);
 },options);
 images.addEventListener('pointermove',event=>{
  if(!gesture||gesture.id!==event.pointerId)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>8){
   if(Math.abs(dy)>=Math.abs(dx)){resetGesture();return;}
   gesture.axis='horizontal';images.classList.add('is-dragging');
  }
 },options);
 images.addEventListener('pointerup',event=>{
  if(!gesture||gesture.id!==event.pointerId)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  resetGesture();
  // A tap or a vertical page scroll must never advance the gallery.
  if(Math.abs(dx)>=48&&Math.abs(dx)>Math.abs(dy)*1.25)show(index+(dx<0?1:-1));
 },options);
 images.addEventListener('pointercancel',resetGesture,options);
 images.addEventListener('lostpointercapture',resetGesture,options);
 images.addEventListener('dragstart',event=>event.preventDefault(),options);
 images.addEventListener('keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;
  event.preventDefault();show(index+(event.key==='ArrowRight'?1:-1));
 },options);
 root.addEventListener('click',event=>{
  const button=event.target.closest('[data-slide]');if(!button)return;
  show(index+(button.dataset.slide==='next'?1:-1));
 },options);
 // A broken opening photograph can fall back, but normal viewing never auto-advances.
 slides[0].querySelector('img').decode().catch(()=>{
  if(!controller.signal.aborted&&request===0)show(1);
 });
 dispose=()=>{request++;resetGesture();controller.abort();};
}
