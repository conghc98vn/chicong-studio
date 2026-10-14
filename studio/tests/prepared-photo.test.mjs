import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {optimizePhoto,imagePolicy} from '../server/image-optimizer.mjs';
import {encodePreparedPhoto,decodePreparedPhoto,isPreparedPhoto,preparedPolicyVersion} from '../server/prepared-photo.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const original=await sharp({create:{width:151,height:101,channels:3,background:'#bb7733'}}).jpeg().toBuffer();
const optimized=await optimizePhoto(original);
const photo={originalName:'CC - 0001.jpg',sourceHash:hash(original),...optimized};
const bundle=encodePreparedPhoto(photo);
function rewrite(buffer,update){
 const size=buffer.readUInt32BE(8),header=JSON.parse(buffer.subarray(12,12+size));
 let payload=buffer.subarray(12+size);const changed=update(header,payload);if(changed)payload=changed;
 const json=Buffer.from(JSON.stringify(header)),prefix=Buffer.from(buffer.subarray(0,12));prefix.writeUInt32BE(json.length,8);
 return Buffer.concat([prefix,json,payload]);
}
const reject=bytes=>assert.rejects(decodePreparedPhoto(bytes),error=>error.retryable===false&&/^PREPARED_/.test(error.code));
test('Prepared photos preserve every byte of all three renditions and original metadata',async()=>{
 assert.equal(preparedPolicyVersion,1);assert.equal(isPreparedPhoto(bundle),true);assert.equal(isPreparedPhoto(original),false);assert.equal(isPreparedPhoto(Buffer.from('CCPHOTO')),false);
 const decoded=await decodePreparedPhoto(bundle);assert.equal(decoded.originalName,photo.originalName);assert.equal(decoded.sourceHash,photo.sourceHash);assert.equal(decoded.policyVersion,1);
 for(const key of ['data','thumbnail','download','optimization'])assert.deepEqual(decoded[key],photo[key]);
 assert.deepEqual(encodePreparedPhoto(decoded),bundle);
});
test('Prepared framing rejects truncation, oversized input or header, trailing data and invalid JSON',async()=>{
 for(const bytes of [Buffer.alloc(0),original,bundle.subarray(0,11),bundle.subarray(0,bundle.length-1),Buffer.concat([bundle,Buffer.from('trailing')]),Buffer.alloc(imagePolicy.maxBytes+1)])await reject(bytes);
 const oversized=Buffer.from(bundle);oversized.writeUInt32BE(4097,8);await reject(oversized);
 const truncated=Buffer.from(bundle);truncated.writeUInt32BE(bundle.length,8);await reject(truncated);
 const json=Buffer.from(bundle);json[12]=0xff;await reject(json);
});
test('Prepared header validates versions, filenames, integer bounds, hashes and strict rendition records',async()=>{
 const invalidHeaders=[
  h=>{h.version=2;},h=>{h.version='1';},h=>{h.originalName='../secret.jpg';},h=>{h.originalName='folder\\secret.jpg';},h=>{h.originalName='bad\nname.jpg';},h=>{h.originalName='a'.repeat(181)+'.jpg';},h=>{h.originalName='image.svg';},
  h=>{h.sourceHash='not-a-hash';},h=>{h.sourceBytes=0;},h=>{h.sourceBytes=imagePolicy.maxBytes+1;},h=>{h.width=2401;},h=>{h.height=.5;},h=>{h.renditions.data.bytes=-1;},h=>{h.renditions.data.bytes='12';},h=>{h.renditions.data.sha256='';},h=>{h.renditions.extra={};},h=>{h.renditions.data.path='/tmp/a';},h=>{h.exif='private data';},
 ];
 for(const edit of invalidHeaders)await reject(rewrite(bundle,edit));
 const changed=Buffer.from(bundle);changed[changed.length-20]^=1;
 await assert.rejects(decodePreparedPhoto(changed),error=>error.code==='PREPARED_CHECKSUM'&&!error.retryable);
 assert.throws(()=>encodePreparedPhoto({...photo,originalName:'../image.jpg'}),error=>error.retryable===false);
 assert.throws(()=>encodePreparedPhoto({...photo,data:Buffer.alloc(imagePolicy.maxBytes)}),error=>error.code==='PREPARED_TOO_LARGE');
});
test('Valid checksums cannot conceal truncated, unsupported, rotated, private-metadata or oversized images',async()=>{
 const replace=(role,bytes)=>encodePreparedPhoto({...photo,[role]:bytes});
 await reject(replace('download',optimized.download.subarray(0,optimized.download.length-50)));
 const truncatedWebp=Buffer.from(optimized.data.subarray(0,optimized.data.length-10));truncatedWebp.writeUInt32LE(truncatedWebp.length-8,4);await reject(replace('data',truncatedWebp));
 await reject(replace('data',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="151" height="101"/>')));
 await reject(replace('data',await sharp(original).withMetadata({orientation:6}).webp().toBuffer()));
 await reject(replace('data',await sharp(original).withXmp('<x:xmpmeta>private GPS data</x:xmpmeta>').webp().toBuffer()));
 await reject(replace('download',await sharp(original).withMetadata().jpeg({chromaSubsampling:'4:4:4'}).toBuffer()));
 await reject(replace('download',await sharp(original).withIccProfile('p3').jpeg({chromaSubsampling:'4:4:4'}).toBuffer()));
 await reject(replace('data',await sharp({create:{width:2401,height:1,channels:3,background:'red'}}).webp().toBuffer()));
 await reject(replace('thumbnail',await sharp({create:{width:901,height:1,channels:3,background:'red'}}).webp().toBuffer()));
 const pixels=Buffer.alloc(151*202*3);pixels.fill(255,151*101*3);
 const frames=await sharp(pixels,{raw:{width:151,height:202,pageHeight:101,channels:3}}).webp({delay:[100,200]}).toBuffer();assert.equal((await sharp(frames,{animated:true}).metadata()).pages,2);await reject(replace('data',frames));
});
test('Prepared image dimensions and thumbnail proportions must agree with the header',async()=>{
 await reject(rewrite(bundle,h=>{h.width=150;}));
 await reject(encodePreparedPhoto({...photo,download:await sharp(original).resize(150,100).withIccProfile('srgb').jpeg({chromaSubsampling:'4:4:4'}).toBuffer()}));
 await reject(encodePreparedPhoto({...photo,thumbnail:await sharp(original).resize(151,90).webp().toBuffer()}));
 const large=await sharp({create:{width:3001,height:2003,channels:3,background:'red'}}).jpeg().toBuffer();
 const largePhoto={originalName:'portrait.JPG',sourceHash:hash(large),...await optimizePhoto(large)};
 assert.deepEqual((await decodePreparedPhoto(encodePreparedPhoto(largePhoto))).optimization,largePhoto.optimization);
});
