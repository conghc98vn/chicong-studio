// Keep chronological order and finish each row before introducing a large frame.
export function albumRows(photos) {
 const rows=[];
 let row=[],ratio=0;
 for(const photo of photos){
  const aspect=photo.width>0&&photo.height>0?photo.width/photo.height:1;
  if(!row.length&&aspect>=1.3&&(rows.length===0||rows.length%5===0)){
   rows.push([photo]);
   continue;
  }
  row.push(photo);ratio+=aspect;
  if(ratio>=2.4||row.length===3){rows.push(row);row=[];ratio=0;}
 }
 if(row.length){
  const previous=rows.at(-1);
  const combined=previous?[...previous,...row]:row;
  if(row.length===1&&previous?.length>1&&combined.length<=3)rows[rows.length-1]=combined;
  else rows.push(row);
 }
 return rows;
}

// Match the proportional desktop flex row, not the width of the entire album.
export function albumPhotoSizes(row,photo){
 const mobile='(max-width:380px) calc(100vw - 40px), (max-width:750px) calc(100vw - 48px)';
 if(row.length===1)return `${mobile}, ${photo.width<photo.height?'min(46.28vw, 560px)':'min(80.1vw, 1000px)'}`;
 const ratio=p=>p.width>0&&p.height>0?p.width/p.height:1;
 const share=ratio(photo)/row.reduce((sum,p)=>sum+ratio(p),0);
 const width=(1120-24*(row.length-1))*share;
 return `${mobile}, min(calc(${(89*share).toFixed(3)}vw - ${(24*(row.length-1)*share).toFixed(3)}px), ${Math.ceil(width)}px)`;
}

export function initAlbumLayout(root){
 root.querySelectorAll('.album-photo-row .photo-item').forEach(item=>{
  const photo=item.querySelector('img');
  const width=Number(photo?.getAttribute('width')),height=Number(photo?.getAttribute('height'));
  item.style.flex=String(width>0&&height>0?width/height:1)+' 1 0%';
 });
}

export function clientGridCols() {
 return typeof window !== 'undefined' && window.innerWidth <= 750 ? 2 : 3;
}

// Pixel geometry keeps the DOM in album order, reserves offscreen image space,
// and changes positions on resize without replacing focused buttons or images.
export function clientMasonryLayout(photos, width, columns=3, gap=16) {
 const count=Math.max(1,Math.min(Math.floor(columns)||1,photos.length||1));
 const cardWidth=Math.max(1,(width-gap*(count-1))/count);
 const heights=Array(count).fill(0);
 const items=photos.map(photo=>{
  const ratio=Number(photo.height)/Number(photo.width);
  const height=Math.ceil(cardWidth*(Number.isFinite(ratio)&&ratio>0?ratio:2/3))+24;
  const column=heights.indexOf(Math.min(...heights));
  const top=heights[column];heights[column]+=height+gap;
  return {left:column*(cardWidth+gap),top,width:cardWidth,height};
 });
 return {items,columns:count,height:Math.max(0,...heights)- (items.length?gap:0)};
}
let stopClientLayout=()=>{};
export function initClientLayout(root) {
 stopClientLayout();
 const grid=root?.querySelector('.client-masonry');
 if(!grid)return;
 const cards=[...grid.querySelectorAll('.photo-item')];
 const photos=cards.map(card=>{const img=card.querySelector('img');return {width:Number(img.getAttribute('width')),height:Number(img.getAttribute('height'))};});
 let previous='';
 const layout=()=>{
  const width=grid.clientWidth,gap=innerWidth<=750?8:16,columns=clientGridCols();
  if(!width)return;
  const key=[width,gap,columns].join(':');if(key===previous)return;
  const active=document.activeElement?.closest('.photo-item');
  const anchor=previous&&!document.querySelector('#lightbox[open]')?(grid.contains(active)?active:cards.find(card=>{const rect=card.getBoundingClientRect();return rect.bottom>80&&rect.top<innerHeight-110;})):null;
  const before=anchor?.getBoundingClientRect().top;previous=key;
  const result=clientMasonryLayout(photos,width,columns,gap);
  grid.dataset.columns=result.columns;grid.style.height=result.height+'px';
  result.items.forEach((item,i)=>{
   const card=cards[i];
   card.style.cssText=`left:${item.left}px;top:${item.top}px;width:${item.width}px;height:${item.height}px`;
   card.querySelector('img').sizes=Math.ceil(item.width)+'px';
  });
  if(anchor)window.scrollBy({top:anchor.getBoundingClientRect().top-before,behavior:'instant'});
 };
 layout();
 const observer=new ResizeObserver(layout);observer.observe(grid);
 window.addEventListener('resize',layout);
 stopClientLayout=()=>{observer.disconnect();window.removeEventListener('resize',layout);};
}
