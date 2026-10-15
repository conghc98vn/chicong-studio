const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const weddingSections=['Chi tiết trang trí','Nhà gái chuẩn bị','Nhà trai chuẩn bị','Đón dâu & trao quà','Nghi thức gia tiên','Ảnh nhóm & bạn bè'];
export function orderedPhotos(album){
 if(!album.sections?.length)return album.photos;
 const order=new Map(album.sections.map((s,i)=>[s.id,i]));
 return [...album.photos].sort((a,b)=>(order.get(a.section_id)??order.size)-(order.get(b.section_id)??order.size)||a.position-b.position||a.id.localeCompare(b.id));
}
export function sectionPhotos(album,filter='all',selectedOnly=false){
 return orderedPhotos(album).filter(p=>(filter==='all'||(filter==='unassigned'?!p.section_id:p.section_id===filter))&&(!selectedOnly||p.selected));
}
export function sectionOptions(album,value=''){
 return `<option value="">Chưa phân loại</option>`+(album.sections||[]).map(s=>`<option value="${s.id}" ${value===s.id?'selected':''}>${esc(s.title)}</option>`).join('');
}
export function sectionTabs(album,active='all',admin=false,selectedOnly=false,showCounts=true){
 if(!album.sections?.length)return '';
 const visible=selectedOnly?album.photos.filter(p=>p.selected):album.photos;
 const counts=new Map();for(const p of visible){const key=p.section_id||'unassigned';counts.set(key,(counts.get(key)||0)+1);}
 const tabs=[{id:'all',title:'Tất cả',count:visible.length},...album.sections.map(s=>({...s,count:counts.get(s.id)||0})),...(album.photos.some(p=>!p.section_id)||admin?[{id:'unassigned',title:'Chưa phân loại',count:counts.get('unassigned')||0}]:[])];
 return `<div class="section-tabs" role="group" aria-label="${selectedOnly?'Lọc ảnh đã chọn theo phần':'Lọc ảnh theo phần'}">${tabs.map(s=>`<button type="button" data-action="${admin?'admin-section-filter':'section-filter'}" data-section="${s.id}" aria-pressed="${active===s.id}">${esc(s.title)}${showCounts?` <span>${s.count}</span>`:''}</button>`).join('')}</div>`;
}
export function sectionManager(album){
 const sections=album.sections||[];
 return `<section class="panel section-manager" aria-labelledby="sections-heading"><div class="panel-heading"><div><h2 id="sections-heading">Các phần trong bộ ảnh</h2><p class="panel-note">Chia ảnh theo từng giai đoạn để khách dễ xem và chọn ảnh.</p></div><div class="section-tools"><button class="small-btn" data-action="section-preset">Dùng mẫu ngày cưới</button><button class="small-btn" data-action="section-new">+ Thêm phần</button></div></div>${sections.length?`<ol class="section-list">${sections.map((s,i)=>`<li data-section-row="${s.id}"><button class="section-drag" draggable="true" aria-label="Kéo để sắp xếp ${esc(s.title)}" title="Kéo để đổi thứ tự; hoặc dùng nút lên/xuống">⠿</button><span class="section-title"><strong>${i+1}. ${esc(s.title)}</strong><small>${album.photos.filter(p=>p.section_id===s.id).length} ảnh</small></span><div class="section-tools"><button class="small-btn" data-action="section-move" data-id="${s.id}" data-direction="up" aria-label="Đưa phần ${esc(s.title)} lên" ${i===0?'disabled':''}>↑</button><button class="small-btn" data-action="section-move" data-id="${s.id}" data-direction="down" aria-label="Đưa phần ${esc(s.title)} xuống" ${i===sections.length-1?'disabled':''}>↓</button><button class="small-btn" data-action="section-rename" data-id="${s.id}" aria-label="Đổi tên phần ${esc(s.title)}">Đổi tên</button><button class="small-btn" data-action="section-remove" data-id="${s.id}" aria-label="Xóa phần ${esc(s.title)}">Xóa phần</button></div></li>`).join('')}</ol><p class="form-note">Kéo tay nắm hoặc dùng ↑ ↓ để đổi thứ tự. Ảnh chưa phân loại nằm cuối mục “Tất cả”.</p>`:'<p class="panel-note">Ví dụ: Trang trí, Lễ gia tiên, Buổi lễ, Ảnh nhóm. Bạn có thể tạo phần trước hoặc sau khi tải ảnh.</p>'}</section>`;
}
export function sectionBulkToolbar(album,selected){
 return `<div class="section-bulk"><div class="bulk-selection-summary"><label class="bulk-check"><input type="checkbox" data-select-visible> Chọn tất cả ảnh đang hiển thị</label><strong data-bulk-count role="status">${selected.size} ảnh đang chọn</strong><button class="link-btn" data-action="section-clear" ${selected.size?'':'disabled'}>Bỏ chọn</button></div><div class="bulk-photo-actions">${album.sections?.length?`<label>Chuyển ảnh đã chọn vào<select data-bulk-section>${sectionOptions(album)}</select></label><button class="small-btn" data-action="section-assign" ${selected.size?'':'disabled'}>Chuyển phần</button>`:''}<button class="small-btn danger-text" data-action="bulk-delete" ${selected.size?'':'disabled'}>Xóa ảnh đã chọn</button></div><span class="form-note">Áp dụng cho ô chọn bên dưới · Tối đa 1.000 ảnh mỗi lượt.</span></div>`;
}
