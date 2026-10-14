import sharp from 'sharp';
export const imagePolicy=Object.freeze({maxBytes:8*1024*1024,maxPixels:40000000,edge:2400,quality:88,thumbEdge:900,thumbQuality:80,downloadEdge:2400,downloadQuality:92});
const invalid=(code,message)=>Object.assign(new Error(message),{code,retryable:false});
// Shared by source uploads and legacy full-size WebP downloads. JPEG has no alpha;
// a white backdrop keeps transparent PNG input from becoming black on download.
export async function encodeDownloadJpeg(buffer,{onDemand=false}={}){
 return sharp(buffer,{limitInputPixels:imagePolicy.maxPixels,animated:false,failOn:'warning'}).rotate()
  .resize({width:imagePolicy.downloadEdge,height:imagePolicy.downloadEdge,fit:'inside',withoutEnlargement:true})
  .flatten({background:'#ffffff'}).withIccProfile('srgb')
  // Stored source renditions favor compact files; legacy requests favor encoding
  // speed at the same quality, dimensions and chroma settings.
  .jpeg({quality:imagePolicy.downloadQuality,mozjpeg:!onDemand,chromaSubsampling:'4:4:4'}).toBuffer();
}
// No target byte ceiling: keep fine detail rather than repeatedly lowering quality.
export async function optimizePhoto(buffer){
 if(!buffer.length)throw invalid('EMPTY_FILE','Tệp rỗng. Hãy xuất lại ảnh từ Lightroom.');
 if(buffer.length>imagePolicy.maxBytes)throw invalid('FILE_TOO_LARGE','Ảnh vượt quá 8 MB. Hãy xuất JPEG sRGB, cạnh dài 2400–4096 px rồi tải lại.');
 const input=sharp(buffer,{limitInputPixels:imagePolicy.maxPixels,animated:false,failOn:'warning'});
 let meta;
 try{meta=await input.metadata();}catch(error){
  if(/pixel limit/i.test(error.message))throw invalid('PIXEL_LIMIT','Ảnh vượt quá 40 megapixel. Hãy xuất cạnh dài tối đa 6000 px rồi tải lại.');
  throw invalid('INVALID_IMAGE','Không đọc được ảnh hoặc tệp bị hỏng. Hãy xuất lại JPEG, PNG hoặc WebP.');
 }
 if(!['jpeg','png','webp'].includes(meta.format))throw invalid('UNSUPPORTED_FORMAT','Chỉ hỗ trợ JPEG, PNG và WebP. Hãy xuất ảnh JPEG từ Lightroom.');
 if((meta.pages||1)>1)throw invalid('ANIMATED_IMAGE','Chưa hỗ trợ ảnh động. Hãy chọn ảnh tĩnh JPEG, PNG hoặc WebP.');
 const render=(edge,quality)=>input.clone().rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).toColourspace('srgb').webp({quality,effort:6,smartSubsample:true}).toBuffer({resolveWithObject:true});
 try{
  const full=await render(imagePolicy.edge,imagePolicy.quality);
  // Each rendition is encoded from the source, never from another lossy rendition.
  const thumb=await render(imagePolicy.thumbEdge,imagePolicy.thumbQuality);
  const download=await encodeDownloadJpeg(buffer);
  const optimization={source_bytes:buffer.length,image_bytes:full.data.length,thumb_bytes:thumb.data.length,download_bytes:download.length,width:full.info.width,height:full.info.height};
  return {data:full.data,thumbnail:thumb.data,download,optimization};
 }catch{throw invalid('INVALID_IMAGE','Ảnh bị lỗi khi giải mã. Hãy xuất lại ảnh từ Lightroom; không chỉ đổi đuôi tệp.');}
}
export function photoOptimization(photo){
 if(photo.source_bytes==null||photo.image_bytes==null||photo.thumb_bytes==null)return null;
 return {source_bytes:Number(photo.source_bytes),image_bytes:Number(photo.image_bytes),thumb_bytes:Number(photo.thumb_bytes),download_bytes:photo.download_bytes==null?null:Number(photo.download_bytes),width:photo.width,height:photo.height};
}
