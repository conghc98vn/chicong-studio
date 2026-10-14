import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {optimizePhoto,encodeDownloadJpeg,photoOptimization,imagePolicy} from '../server/image-optimizer.mjs';
import {uploadReport,photoSizeNote} from '../web/upload-report.mjs';

test('Web images preserve orientation, dimensions and sRGB colour while stripping private metadata',async()=>{
 const input=await sharp({create:{width:3000,height:2000,channels:3,background:'#bd5b32'}}).withMetadata({orientation:6}).withIccProfile('p3').jpeg({quality:100}).toBuffer();
 const {data,thumbnail,download,optimization:o}=await optimizePhoto(input),full=await sharp(data).metadata(),thumb=await sharp(thumbnail).metadata(),jpg=await sharp(download).metadata();
 assert.deepEqual([full.width,full.height,thumb.width,thumb.height],[1600,2400,600,900]);
 assert.equal(full.format,'webp');assert.equal(full.space,'srgb');assert.equal(full.exif,undefined);assert.equal(full.icc,undefined);assert.equal(full.orientation,undefined);
 assert.equal(o.source_bytes,input.length);assert.equal(o.image_bytes,data.length);assert.equal(o.thumb_bytes,thumbnail.length);assert.equal(o.download_bytes,download.length);
 assert.deepEqual([jpg.width,jpg.height,jpg.format,jpg.chromaSubsampling],[1600,2400,'jpeg','4:4:4']);
 const srgbProfile=(await sharp(await sharp({create:{width:1,height:1,channels:3,background:'white'}}).withIccProfile('srgb').jpeg().toBuffer()).metadata()).icc;
 assert.deepEqual(jpg.icc,srgbProfile);assert.equal(jpg.exif,undefined);assert.equal(jpg.xmp,undefined);assert.equal(jpg.orientation,undefined);
 const expected=await sharp(input).rotate().toColourspace('srgb').resize(1,1).raw().toBuffer(),actual=await sharp(data).resize(1,1).raw().toBuffer();
 for(let i=0;i<3;i++)assert.ok(Math.abs(expected[i]-actual[i])<5,`Colour channel ${i}: ${expected[i]} vs ${actual[i]}`);
 const actualJpeg=await sharp(download).resize(1,1).raw().toBuffer();for(let i=0;i<3;i++)assert.ok(Math.abs(expected[i]-actualJpeg[i])<5,`JPEG colour channel ${i}: ${expected[i]} vs ${actualJpeg[i]}`);
});
test('Small PNG stays small, retains transparency and is not sharpened or enlarged',async()=>{
 const input=await sharp({create:{width:60,height:40,channels:4,background:{r:50,g:100,b:150,alpha:.5}}}).png().toBuffer();
 const result=await optimizePhoto(input);
 for(const bytes of [result.data,result.thumbnail]){const m=await sharp(bytes).metadata();assert.equal(m.width,60);assert.equal(m.height,40);assert.equal(m.hasAlpha,true);const raw=await sharp(bytes).raw().toBuffer();assert.ok(Math.abs(raw[3]-128)<=1);}
 const jpg=await sharp(result.download).metadata();assert.deepEqual([jpg.width,jpg.height,jpg.hasAlpha],[60,40,false]);
 const rgb=await sharp(result.download).resize(1,1).raw().toBuffer();for(const [i,value]of [152,177,202].entries())assert.ok(Math.abs(rgb[i]-value)<=2);
});
test('Download JPEG is encoded directly from source and legacy conversion uses the full WebP',async()=>{
 const pixels=Buffer.alloc(181*117*3);for(let i=0;i<pixels.length;i++)pixels[i]=(i*73+Math.floor(i/17)*91)%256;
 const input=await sharp(pixels,{raw:{width:181,height:117,channels:3}}).png().toBuffer();
 const {download,data}=await optimizePhoto(input);
 assert.deepEqual(download,await encodeDownloadJpeg(input));
 for(const onDemand of [false,true]){
  const legacy=await encodeDownloadJpeg(data,{onDemand});assert.notDeepEqual(download,legacy);
  const meta=await sharp(legacy).metadata();assert.deepEqual([meta.width,meta.height,meta.format,meta.chromaSubsampling],[181,117,'jpeg','4:4:4']);assert.ok(meta.icc);assert.equal(meta.exif,undefined);
  const expected=await sharp(data).resize(1,1).raw().toBuffer(),actual=await sharp(legacy).resize(1,1).raw().toBuffer();
  for(let i=0;i<3;i++)assert.ok(Math.abs(expected[i]-actual[i])<5);
 }
});
test('Admin reports count all stored renditions and keep legacy download sizes unknown',()=>{
 const metrics={source_bytes:1000000,image_bytes:200000,thumb_bytes:50000,download_bytes:350000,width:2400,height:1600};
 const file={name:'photo.jpg'},queue={files:[file],done:new Set([file]),results:new Map([[file,{success:true,optimization:metrics}]])};
 const report=uploadReport(queue);assert.match(report,/Giảm 40%/);assert.match(report,/JPG tải về: <strong>350 KB/);assert.match(photoSizeNote(metrics),/JPG tải về 350 KB/);
 const legacy=photoOptimization({...metrics,download_bytes:null});assert.equal(legacy.download_bytes,null);assert.doesNotMatch(photoSizeNote(legacy),/JPG/);
 queue.results.get(file).optimization=legacy;assert.match(uploadReport(queue),/Giảm 75%/);assert.doesNotMatch(uploadReport(queue),/JPG tải về/);
 assert.equal(photoOptimization({width:10,height:10}),null);
});
test('Corrupt, truncated, unsupported, oversized and over-resolution files return actionable errors',async()=>{
 await assert.rejects(optimizePhoto(Buffer.alloc(0)),e=>e.code==='EMPTY_FILE'&&!e.retryable);
 await assert.rejects(optimizePhoto(Buffer.alloc(imagePolicy.maxBytes+1)),e=>e.code==='FILE_TOO_LARGE'&&!e.retryable);
 await assert.rejects(optimizePhoto(Buffer.from('not a photo')),e=>e.code==='INVALID_IMAGE');
 await assert.rejects(optimizePhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')),e=>e.code==='UNSUPPORTED_FORMAT');
 const jpeg=await sharp({create:{width:1000,height:700,channels:3,background:'red'}}).jpeg().toBuffer();
 await assert.rejects(optimizePhoto(jpeg.subarray(0,jpeg.length-300)),e=>e.code==='INVALID_IMAGE');
 const huge=await sharp({create:{width:10001,height:4000,channels:3,background:'white'}}).png().toBuffer();
 await assert.rejects(optimizePhoto(huge),e=>e.code==='PIXEL_LIMIT');
});
test('Animated WebP is rejected rather than silently losing frames',async()=>{
 const pixels=Buffer.alloc(20*40*3);pixels.fill(255,0,20*20*3);
 const input=await sharp(pixels,{raw:{width:20,height:40,pageHeight:20,channels:3}}).webp({loop:0,delay:[100,200]}).toBuffer();
 assert.equal((await sharp(input,{animated:true}).metadata()).pages,2);
 await assert.rejects(optimizePhoto(input),e=>e.code==='ANIMATED_IMAGE');
});
