import {uploadIssue} from './upload-queue.mjs';
import {isPreparedPhotoFile} from './upload-policy.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const formatBytes=n=>n>=1e6?(n/1e6).toLocaleString('vi-VN',{maximumFractionDigits:2})+' MB':Math.max(1,Math.round(n/1000)).toLocaleString('vi-VN')+' KB';
export function uploadSelection(files){
 if(!files.length)return '';
 const invalid=files.filter(uploadIssue).length;
 const prepared=files.filter(isPreparedPhotoFile).length;
 return `${files.length} ảnh · ${formatBytes(files.reduce((n,f)=>n+f.size,0))} cần tải lên.${prepared?' '+prepared+' ảnh đã chuẩn bị trên máy; không nén lại.':''}${invalid?' '+invalid+' tệp không hợp lệ sẽ được bỏ qua; các ảnh còn lại vẫn được tải.':''}`;
}
export function photoSizeNote(o){
 return o?`<p class="photo-size">Web ${formatBytes(o.image_bytes)} · Thu nhỏ ${formatBytes(o.thumb_bytes)}${o.download_bytes!=null?' · JPG tải về '+formatBytes(o.download_bytes):''}<br>${o.width} × ${o.height} px</p>`:'';
}
export function uploadReport(queue){
 const saved=queue.files.filter(f=>queue.done.has(f)),known=saved.map(f=>queue.results.get(f)?.optimization).filter(Boolean);
 const source=known.reduce((n,o)=>n+o.source_bytes,0),full=known.reduce((n,o)=>n+o.image_bytes,0),thumb=known.reduce((n,o)=>n+o.thumb_bytes,0),download=known.reduce((n,o)=>n+(o.download_bytes||0),0),stored=full+thumb+download;
 const reduced=source>stored?`Giảm ${Math.round((1-stored/source)*100)}% dung lượng lưu trữ so với các ảnh nguồn tương ứng.`:source?'Các bản ảnh lưu trên web cộng lại lớn hơn hoặc bằng ảnh nguồn; giữ chất lượng, không ép nén thêm.':'';
 const problem=queue.files.filter(f=>queue.results.get(f)?.success===false),waiting=queue.files.filter(f=>!queue.results.has(f));
 const rows=[...problem,...saved,...waiting];
 return `<section class="upload-report" aria-label="Kết quả tối ưu ảnh"><p class="upload-summary" role="status">Đã lưu ${saved.length}/${queue.files.length} ảnh${problem.length?' · '+problem.length+' ảnh chưa xử lý được':''}.</p>${known.length?`<p>Ảnh nguồn tương ứng: <strong>${formatBytes(source)}</strong> → Bản web: <strong>${formatBytes(full)}</strong> + ảnh thu nhỏ: <strong>${formatBytes(thumb)}</strong>${download?' + JPG tải về: <strong>'+formatBytes(download)+'</strong>':''}.</p><p>${reduced}</p>`:''}<details ${problem.length?'open':''}><summary>Chi tiết từng ảnh${rows.length>100?' (hiển thị 100/'+rows.length+')':''}</summary><ul>${rows.slice(0,100).map(file=>{
 const r=queue.results.get(file),o=r?.optimization;
 const warning=o&&Math.max(o.width,o.height)<1600?' Ảnh đầu vào nhỏ; hệ thống giữ kích thước, không phóng lớn.':'';
 return `<li class="${r?.success===false?'upload-file-error':''}"><strong>${esc(file.name)}</strong><span>${r?.success?o?`${formatBytes(o.source_bytes)} → Web ${formatBytes(o.image_bytes)} + thu nhỏ ${formatBytes(o.thumb_bytes)}${o.download_bytes!=null?' + JPG tải về '+formatBytes(o.download_bytes):''} · ${o.width} × ${o.height} px.${warning}`:'Đã lưu; chưa có số liệu dung lượng.':esc(r?.error||'Chưa được máy chủ xác nhận; có thể tải lại.')}</span></li>`;
 }).join('')}</ul></details></section>`;
}
