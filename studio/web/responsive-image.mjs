// Shared by HTML preloads and rendered images so the browser chooses the same resource.
export const heroDesktopSizes='(max-width:1200px) 90vw, 1120px';
// Mobile hero uses a 4:5 frame with object-fit:contain. Describe the visible
// photograph, not the surrounding frame, so portrait images do not overfetch.
export function heroMobileSizes(photo){
 const aspect=Number(photo?.width)/Number(photo?.height);
 const fraction=Number.isFinite(aspect)&&aspect>0?Math.min(1,aspect/(4/5)):1;
 const round=value=>Number(value.toFixed(4));
 return `(max-width:380px) calc(${round(100*fraction)}vw - ${round(40*fraction)}px), calc(${round(100*fraction)}vw - ${round(48*fraction)}px)`;
}
export function imageSources(photo){
 const thumbWidth=Math.round(photo.width*Math.min(1,900/Math.max(photo.width,photo.height)));
 return Math.max(photo.width,photo.height)>900?`${photo.thumb} ${thumbWidth}w, ${photo.src} ${photo.width}w`:`${photo.thumb} ${photo.width}w`;
}

// Cards use three desktop columns (two for related albums), then two on tablet.
export function albumCardSizes(layout='grid'){
 const mobile='(max-width:380px) calc(100vw - 40px), (max-width:750px) calc(100vw - 48px)';
 return layout==='related'?`${mobile}, min(calc((89vw - 48px)/2), 536px)`:`${mobile}, (max-width:1000px) calc((89vw - 32px)/2), min(calc((89vw - 64px)/3), 352px)`;
}
