import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {imagePolicy} from './image-optimizer.mjs';

// One bounded, uncompressed record per photo. No paths, archives or executable
// content are extracted, and the server checks the received rendition sizes.
export const preparedPolicyVersion=1;
const magic=Buffer.from('CCPHOTO\0');
const prefixBytes=magic.length+4,maxHeaderBytes=4096;
const roles=['data','thumbnail','download'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const invalid=(message='Gói ảnh không hợp lệ hoặc bị hỏng. Hãy chạy lại công cụ chuẩn bị ảnh trên Mac.',code='PREPARED_INVALID')=>Object.assign(new Error(message),{code,retryable:false});
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const keysAre=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const validName=name=>typeof name==='string'&&name.length>0&&name.length<=180&&name===name.trim()&&!/[\/\\\x00-\x1f\x7f]/.test(name)&&/\.(jpe?g|png|webp)$/i.test(name);
function validateHeader(header){
 if(header?.version!==preparedPolicyVersion)throw invalid('Phiên bản gói ảnh chưa được hỗ trợ. Hãy cập nhật công cụ và website rồi chuẩn bị lại ảnh.','PREPARED_VERSION');
 if(!keysAre(header,['version','originalName','sourceHash','sourceBytes','width','height','renditions'])||!validName(header.originalName)||typeof header.sourceHash!=='string'||! /^[a-f0-9]{64}$/.test(header.sourceHash)||!integer(header.sourceBytes,1,imagePolicy.maxBytes)||!integer(header.width,1,imagePolicy.edge)||!integer(header.height,1,imagePolicy.edge)||!keysAre(header.renditions,roles))throw invalid();
 for(const role of roles){
  const item=header.renditions[role];
  if(!keysAre(item,['bytes','sha256'])||!integer(item.bytes,1,imagePolicy.maxBytes)||typeof item.sha256!=='string'||! /^[a-f0-9]{64}$/.test(item.sha256))throw invalid();
 }
}
export function isPreparedPhoto(buffer){return Buffer.isBuffer(buffer)&&buffer.length>=magic.length&&buffer.subarray(0,magic.length).equals(magic);}
export function encodePreparedPhoto({originalName,sourceHash,data,thumbnail,download,optimization}){
 const content={data,thumbnail,download};
 if(!roles.every(role=>Buffer.isBuffer(content[role])))throw invalid();
 const header={version:preparedPolicyVersion,originalName,sourceHash,sourceBytes:optimization?.source_bytes,width:optimization?.width,height:optimization?.height,renditions:Object.fromEntries(roles.map(role=>[role,{bytes:content[role].length,sha256:hash(content[role])}]))};
 validateHeader(header);
 const json=Buffer.from(JSON.stringify(header));
 const length=prefixBytes+json.length+roles.reduce((total,role)=>total+content[role].length,0);
 if(json.length>maxHeaderBytes||length>imagePolicy.maxBytes)throw invalid('Gói ảnh vượt quá 20 MB. Hãy xuất ảnh nhỏ hơn từ Lightroom rồi chạy lại công cụ.','PREPARED_TOO_LARGE');
 const prefix=Buffer.alloc(prefixBytes);magic.copy(prefix);prefix.writeUInt32BE(json.length,magic.length);
 return Buffer.concat([prefix,json,...roles.map(role=>content[role])],length);
}
let srgbProfile;
async function expectedSrgbProfile(){
 srgbProfile??=sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).withIccProfile('srgb').jpeg().toBuffer().then(bytes=>sharp(bytes).metadata()).then(meta=>meta.icc);
 return srgbProfile;
}
async function validateRendition(bytes,role){
 const edge=role==='thumbnail'?imagePolicy.thumbEdge:imagePolicy.edge;
 const input=sharp(bytes,{limitInputPixels:edge*edge,animated:false,failOn:'warning'}),meta=await input.metadata();
 if(meta.format!==(role==='download'?'jpeg':'webp')||!integer(meta.width,1,edge)||!integer(meta.height,1,edge)||(meta.pages||1)!==1||meta.orientation!==undefined||meta.exif||meta.xmp||meta.iptc||meta.comments?.length||meta.space!=='srgb')throw invalid();
 if(role==='download'){
  if(meta.hasAlpha||meta.chromaSubsampling!=='4:4:4'||!meta.icc?.equals(await expectedSrgbProfile())||bytes.readUInt16BE(bytes.length-2)!==0xffd9)throw invalid();
 }else if(meta.icc||bytes.length<12||bytes.toString('ascii',0,4)!=='RIFF'||bytes.readUInt32LE(4)+8!==bytes.length)throw invalid();
 // Metadata parsing alone accepts truncated payloads. Fully decode sequentially
 // with a strict pixel limit; no encoding, resizing or extra lossy generation.
 await input.raw().toBuffer();
 return {width:meta.width,height:meta.height};
}
export async function decodePreparedPhoto(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length>imagePolicy.maxBytes||buffer.length<prefixBytes||!isPreparedPhoto(buffer))throw invalid();
 const jsonBytes=buffer.readUInt32BE(magic.length);
 if(jsonBytes<2||jsonBytes>maxHeaderBytes||prefixBytes+jsonBytes>buffer.length)throw invalid();
 let header;
 try{header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(prefixBytes,prefixBytes+jsonBytes)));}catch{throw invalid();}
 validateHeader(header);
 const expectedLength=prefixBytes+jsonBytes+roles.reduce((total,role)=>total+header.renditions[role].bytes,0);
 if(expectedLength!==buffer.length)throw invalid();
 const content={},dimensions={};let offset=prefixBytes+jsonBytes;
 for(const role of roles){
  const item=header.renditions[role],bytes=buffer.subarray(offset,offset+item.bytes);offset+=item.bytes;
  if(hash(bytes)!==item.sha256)throw invalid('Gói ảnh bị thay đổi hoặc chưa được ghi xong. Hãy chuẩn bị lại ảnh trên Mac.','PREPARED_CHECKSUM');
  content[role]=bytes;
 }
 try{for(const role of roles)dimensions[role]=await validateRendition(content[role],role);}catch(error){if(error.retryable===false)throw error;throw invalid();}
 const {width,height}=header,thumb=dimensions.thumbnail;
 if(dimensions.data.width!==width||dimensions.data.height!==height||dimensions.download.width!==width||dimensions.download.height!==height||thumb.width>width||thumb.height>height||Math.max(thumb.width,thumb.height)!==Math.min(imagePolicy.thumbEdge,Math.max(width,height))||Math.abs(thumb.width*height-thumb.height*width)>Math.max(width,height))throw invalid();
 return {originalName:header.originalName,sourceHash:header.sourceHash,policyVersion:header.version,...content,optimization:{source_bytes:header.sourceBytes,image_bytes:content.data.length,thumb_bytes:content.thumbnail.length,download_bytes:content.download.length,width,height}};
}
