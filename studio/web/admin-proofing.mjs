import {sectionPhotos} from './album-sections.mjs';
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLocaleLowerCase('vi').trim();
export function matchesAdminPhoto(photo,query='',selectedOnly=false){
 return (!selectedOnly||photo.selected)&&(!query.trim()||normalize(`${photo.original||''} ${photo.caption||''}`).includes(normalize(query)));
}
export function adminVisiblePhotos(album,section='all',query='',selectedOnly=false){
 return sectionPhotos(album,section).filter(photo=>matchesAdminPhoto(photo,query,selectedOnly));
}
export function selectedFileNames(album){
 return sectionPhotos(album,'all',true).map(photo=>photo.original||photo.caption||photo.id).join('\n');
}
