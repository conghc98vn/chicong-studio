// Shared by HTML preloads and rendered images so the browser chooses the same resource.
export const heroDesktopSizes='(max-width:1200px) 90vw, 1120px';
export const heroMobileSizes='100vw';
export function imageSources(photo){
 const thumbWidth=Math.round(photo.width*Math.min(1,900/Math.max(photo.width,photo.height)));
 return Math.max(photo.width,photo.height)>900?`${photo.thumb} ${thumbWidth}w, ${photo.src} ${photo.width}w`:`${photo.thumb} ${photo.width}w`;
}
