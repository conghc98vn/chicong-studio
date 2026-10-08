export const defaultHeroSelection=[
  {
    "albumId": "4c5afcfeff9518b24e9da470aeb58fd8",
    "wideId": "b174b94473777107c026b9075446c47c",
    "tallId": "62e964452f59aa8b30058e3530c0d94b"
  },
  {
    "albumId": "91d8e5f65a0ea8c06a876b6702195f26",
    "wideId": "bbfc55916bd953bbae69cfc1d66e151c",
    "tallId": "dc1fe0b2f696ec4fe8a26a32c3d55ce9"
  },
  {
    "albumId": "f80819d221858f1f3093537114d08320",
    "wideId": "64182980a0cb78eede81ed9033fdcff4",
    "tallId": "583a746b76914342091ac2fec1b6f8dd"
  }
];
export function parseSelection(value,defaults){
 if(!value)return defaults;
 try{const choices=JSON.parse(value);return Array.isArray(choices)?choices:defaults;}catch{return defaults;}
}
export function selectHeroSlides(albums,config='') {
 return parseSelection(config,defaultHeroSelection).flatMap(choice => {
  const album=albums.find(a=>a.id===choice.albumId);
  const wide=album?.photos.find(p=>p.id===choice.wideId);
  const tall=album?.photos.find(p=>p.id===choice.tallId)||wide;
  return wide?[{album,wide,tall}]:[];
 });
}
