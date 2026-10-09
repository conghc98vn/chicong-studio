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

export function initAlbumLayout(root){
 root.querySelectorAll('.album-photo-row .photo-item').forEach(item=>{
  const photo=item.querySelector('img');
  const width=Number(photo?.getAttribute('width')),height=Number(photo?.getAttribute('height'));
  item.style.flex=String(width>0&&height>0?width/height:1)+' 1 0%';
 });
}
