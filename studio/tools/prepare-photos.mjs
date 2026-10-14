#!/usr/bin/env node
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {access,lstat,mkdir,open,readdir,readFile,realpath,rename,link,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {imagePolicy,optimizePhoto} from '../server/image-optimizer.mjs';
import {encodePreparedPhoto,decodePreparedPhoto,preparedPolicyVersion} from '../server/prepared-photo.mjs';

const supported=/\.(jpe?g|png|webp)$/i;
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const isWithin=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative));};
const abortError=()=>Object.assign(new Error('Đã dừng theo yêu cầu. Chạy lại cùng thư mục để tiếp tục.'),{code:'ABORT_ERR'});
const checkAbort=signal=>{if(signal?.aborted)throw abortError();};
const safeStat=async target=>{try{return await lstat(target);}catch(error){if(error.code==='ENOENT')return null;throw error;}};

// Output paths must not traverse symlinks: a link can otherwise redirect writes
// back into the original photo tree, even when the typed paths look separate.
async function checkedOutputPath(target){
 const absolute=path.resolve(target);
 const {root}=path.parse(absolute);
 let cursor=root;
 for(const part of absolute.slice(root.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);
  const info=await safeStat(cursor);
  if(info?.isSymbolicLink())throw new Error(`Thư mục kết quả không được đi qua liên kết tượng trưng: ${cursor}`);
  if(info&&!info.isDirectory())throw new Error(`Đường dẫn kết quả đang là một tệp: ${cursor}`);
 }
 return absolute;
}

async function discoverPhotos(source,sourceInfo){
 const files=[];
 const errors=[];
 let ignored=0;
 const visit=async(directory,relative='')=>{
  let entries;
  try{
   const info=await lstat(directory);
   if(!info.isDirectory()||info.isSymbolicLink()){ignored++;return;}
   entries=await readdir(directory,{withFileTypes:true});
  }
  catch(error){errors.push({file:relative||'.',status:'failed',error:`Không đọc được thư mục: ${error.message}`});return;}
  entries.sort((a,b)=>a.name.localeCompare(b.name,'en'));
  for(const entry of entries){
   if(entry.name.startsWith('.')||entry.isSymbolicLink()){ignored++;continue;}
   const location=path.join(directory,entry.name),name=path.join(relative,entry.name);
   if(entry.isDirectory())await visit(location,name);
   else if(entry.isFile()&&supported.test(entry.name))files.push({source:location,relative:name});
   else ignored++;
  }
 };
 if(sourceInfo.isFile()){
  if(!supported.test(source)||path.basename(source).startsWith('.'))throw new Error('Hãy chọn ảnh JPEG, PNG, WebP hoặc thư mục chứa ảnh.');
  files.push({source,relative:path.basename(source)});
 }else if(sourceInfo.isDirectory())await visit(source);
 else throw new Error('Đường dẫn nguồn phải là một ảnh hoặc thư mục ảnh.');
 return {files,errors,ignored};
}

async function existingPackage(target,originalName){
 const info=await safeStat(target);
 if(!info)return null;
 if(!info.isFile()||info.isSymbolicLink())throw new Error('Tệp kết quả trùng tên với thư mục hoặc liên kết. Hãy chọn một thư mục kết quả khác.');
 // Do not read an unrelated, potentially huge file at a colliding output path.
 if(info.size>imagePolicy.maxBytes)throw new Error('Đã có tệp khác cùng tên. Công cụ không ghi đè tệp không xác minh được.');
 try{
  const buffer=await readFile(target);
  const photo=await decodePreparedPhoto(buffer);
  if(photo.originalName!==originalName)throw new Error('original name mismatch');
  return {photo,hash:digest(buffer)};
 }catch{
  throw new Error('Đã có tệp khác hoặc gói ảnh bị hỏng cùng tên. Công cụ không ghi đè; hãy đổi thư mục kết quả hoặc di chuyển tệp đó.');
 }
}

async function writePackage(target,buffer,previous,signal){
 const directory=await checkedOutputPath(path.dirname(target));
 await mkdir(directory,{recursive:true});
 const temporary=path.join(directory,`.${path.basename(target)}.${randomUUID()}.tmp`);
 let handle;
 try{
  handle=await open(temporary,'wx',0o600);
  await handle.writeFile(buffer);
  await handle.sync();
  await handle.close();handle=null;
  checkAbort(signal);
  if(previous){
   // A known package may be refreshed when its source changes. Refuse to
   // replace anything that another process changed since our initial read.
   const current=await safeStat(target);
   if(!current?.isFile()||current.isSymbolicLink()||current.size>imagePolicy.maxBytes||digest(await readFile(target))!==previous.hash)throw new Error('Tệp kết quả vừa thay đổi bởi tiến trình khác; chưa ghi đè. Hãy chạy lại.');
   await rename(temporary,target);
  }else{
   // Hard-link publication is atomic and fails if a destination already exists.
   // Both paths are on the same volume, unlike a system temporary directory.
   await link(temporary,target);
  }
 }finally{
  if(handle)await handle.close().catch(()=>{});
  await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
 }
}

/** Prepare local photos without uploading or changing the source files. */
export async function preparePhotos({input,output,dryRun=false,onProgress=()=>{},signal}={}){
 if(!input)throw new Error('Thiếu đường dẫn thư mục ảnh. Dùng --help để xem hướng dẫn.');
 const requestedSource=path.resolve(input);
 const sourceInfo=await lstat(requestedSource).catch(error=>{if(error.code==='ENOENT')throw new Error(`Không tìm thấy đường dẫn: ${requestedSource}`);throw error;});
 if(sourceInfo.isSymbolicLink())throw new Error('Hãy chọn thư mục hoặc ảnh gốc, không chọn liên kết tượng trưng.');
 const source=await realpath(requestedSource);
 const sourceName=sourceInfo.isDirectory()?path.basename(source):path.basename(source,path.extname(source));
 const destination=await checkedOutputPath(output||path.join(path.dirname(source),`${sourceName}_WEB_UPLOAD`));
 if(destination===source||sourceInfo.isDirectory()&&isWithin(source,destination))throw new Error('Thư mục kết quả phải nằm ngoài thư mục ảnh gốc. Công cụ không ghi vào thư mục nguồn.');
 const {files,errors,ignored}=await discoverPhotos(source,sourceInfo);
 const summary={tool:'chicong-prepare-photos',policyVersion:preparedPolicyVersion,startedAt:new Date().toISOString(),input:source,output:destination,dryRun,total:files.length,created:0,updated:0,skipped:0,failed:errors.length,ignored,sourceBytes:0,preparedBytes:0,interrupted:false,files:[...errors]};
 const started=Date.now();
 onProgress({type:'start',total:files.length,output:destination,dryRun});
 for(const [index,file]of files.entries()){
  if(signal?.aborted){summary.interrupted=true;break;}
  const itemStarted=Date.now(),target=path.join(destination,`${file.relative}.ccphoto`);
  let result;
  try{
   const current=await lstat(file.source);
   if(!current.isFile()||current.isSymbolicLink())throw new Error('Ảnh nguồn đã thay đổi hoặc trở thành liên kết; đã bỏ qua.');
   if(!current.size)throw new Error('Ảnh nguồn rỗng.');
   if(current.size>imagePolicy.maxBytes)throw new Error('Ảnh nguồn vượt quá 20 MB. Hãy xuất ảnh nhỏ hơn từ Lightroom.');
   if(dryRun){
    result={file:file.relative,status:'planned',sourceBytes:current.size,output:path.relative(destination,target)};
    summary.sourceBytes+=current.size;
   }else{
    // O_NOFOLLOW protects against a source being replaced by a symlink between
    // discovery and opening. Only one original is held in memory at a time.
    const sourceHandle=await open(file.source,constants.O_RDONLY|constants.O_NOFOLLOW);
    let buffer;
    try{
     const opened=await sourceHandle.stat();
     if(!opened.isFile()||opened.size>imagePolicy.maxBytes)throw new Error('Ảnh nguồn đã thay đổi trong khi chuẩn bị. Hãy chạy lại.');
     buffer=await sourceHandle.readFile();
     const after=await sourceHandle.stat();
     if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)throw new Error('Ảnh nguồn đang được chỉnh sửa. Hãy lưu ảnh xong rồi chạy lại.');
    }finally{await sourceHandle.close();}
    checkAbort(signal);
    const sourceHash=digest(buffer),originalName=path.basename(file.source);
    await checkedOutputPath(path.dirname(target));
    const previous=await existingPackage(target,originalName);
    if(previous?.photo.sourceHash===sourceHash&&previous.photo.policyVersion===preparedPolicyVersion){
     result={file:file.relative,status:'skipped',sourceBytes:buffer.length,preparedBytes:(await lstat(target)).size,output:path.relative(destination,target)};
     summary.skipped++;
    }else{
     onProgress({type:'processing',index:index+1,total:files.length,file:file.relative});
     const optimized=await optimizePhoto(buffer);
     checkAbort(signal);
     const prepared=encodePreparedPhoto({originalName,sourceHash,...optimized});
     await writePackage(target,prepared,previous,signal);
     result={file:file.relative,status:previous?'updated':'created',sourceBytes:buffer.length,preparedBytes:prepared.length,output:path.relative(destination,target)};
     summary[result.status]++;
    }
    summary.sourceBytes+=result.sourceBytes;
    summary.preparedBytes+=result.preparedBytes;
   }
  }catch(error){
   if(error.code==='ABORT_ERR'){summary.interrupted=true;break;}
   summary.failed++;
   result={file:file.relative,status:'failed',error:error.message};
  }
  result.seconds=Number(((Date.now()-itemStarted)/1000).toFixed(2));
  summary.files.push(result);
  onProgress({type:'result',index:index+1,total:files.length,...result});
 }
 summary.seconds=Number(((Date.now()-started)/1000).toFixed(2));
 summary.finishedAt=new Date().toISOString();
 return summary;
}

export function parseArguments(args){
 const options={};
 for(let index=0;index<args.length;index++){
  const argument=args[index];
  if(argument==='--help'||argument==='-h')options.help=true;
  else if(argument==='--dry-run')options.dryRun=true;
  else if(argument==='--interactive')options.interactive=true;
  else if(argument==='--output'||argument==='-o'){
   const value=args[++index];
   if(!value||value.startsWith('--'))throw new Error('Cần đường dẫn thư mục sau --output.');
   options.output=value;
  }else if(argument==='--'){
   const rest=args.slice(index+1);
   if(options.input||rest.length!==1)throw new Error('Mỗi lần chỉ chọn một thư mục hoặc một ảnh nguồn.');
   options.input=rest[0];break;
  }else if(argument.startsWith('-'))throw new Error(`Không nhận ra tùy chọn: ${argument}`);
  else if(options.input)throw new Error('Mỗi lần chỉ chọn một thư mục hoặc một ảnh nguồn. Đặt đường dẫn có khoảng trắng trong dấu nháy.');
  else options.input=argument;
 }
 return options;
}

// Finder escapes spaces when a path is dragged into Terminal. Parse that one
// argument as text only: never eval a path or execute shell substitutions.
export function parseDraggedPath(value){
 const text=value.trim();
 let result='',quote=null,escaped=false,ended=false;
 for(const character of text){
  if(escaped){result+=character;escaped=false;continue;}
  if(character==='\\'&&quote!=="'"){escaped=true;continue;}
  if(quote){if(character===quote)quote=null;else result+=character;continue;}
  if(character==='"'||character==="'"){if(ended)throw new Error('Chỉ kéo một thư mục hoặc một ảnh vào Terminal.');quote=character;continue;}
  if(/\s/u.test(character)){if(result)ended=true;continue;}
  if(ended)throw new Error('Chỉ kéo một thư mục hoặc một ảnh vào Terminal.');
  result+=character;
 }
 if(quote||escaped)throw new Error('Đường dẫn chưa đầy đủ. Hãy kéo lại thư mục vào Terminal.');
 return result;
}

const size=bytes=>`${(bytes/1000000).toFixed(2)} MB`;
const help=`Chuẩn bị ảnh ChiCong trên máy tính; không tải ảnh lên mạng.

Cách dùng:
  npm run photos:prepare -- "/đường/dẫn/thư mục ảnh"
  npm run photos:prepare -- "/đường/dẫn/ảnh.jpg" --output "/thư mục kết quả"
  npm run photos:prepare -- "/thư mục ảnh" --dry-run

Mặc định tạo thư mục <tên nguồn>_WEB_UPLOAD cạnh thư mục nguồn.
Giữ nguyên ảnh gốc và cấu trúc các phần; mỗi ảnh tạo một tệp .ccphoto.
Gói gồm ảnh web 2400 px, ảnh nhỏ 900 px và JPG 2400 px cho khách tải.
Chạy lại sẽ bỏ qua ảnh không đổi. Ảnh nguồn đã đổi sẽ được xử lý lại.
Hỗ trợ JPEG, PNG, WebP tĩnh, tối đa 20 MB và 40 megapixel/ảnh.
--dry-run chỉ liệt kê, không tạo hoặc ghi đè tệp. --help hiện hướng dẫn.
`;

async function writeReport(summary){
 const directory=await checkedOutputPath(path.join(summary.output,'_reports'));
 await mkdir(directory,{recursive:true});
 const target=path.join(directory,`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.json`);
 const handle=await open(target,'wx',0o600);
 try{await handle.writeFile(`${JSON.stringify(summary,null,2)}\n`);}finally{await handle.close();}
 return target;
}

export async function main(args=process.argv.slice(2)){
 const options=parseArguments(args);
 if(options.help){console.log(help);return 0;}
 if(options.interactive&&!options.input){
  console.log('CHICONG — CHUẨN BỊ ẢNH ĐỂ TẢI LÊN WEB\nẢnh gốc được giữ nguyên. Không có ảnh nào tự động tải lên mạng.\n');
  const prompt=createInterface({input:process.stdin,output:process.stdout});
  try{
   const answer=await prompt.question('Kéo một thư mục ảnh (hoặc một ảnh) vào đây rồi nhấn Enter:\n> ');
   // A manually pasted absolute path may contain unescaped spaces.
   const plain=answer.trim();
   options.input=await access(plain).then(()=>plain,()=>parseDraggedPath(answer));
  }finally{prompt.close();}
 }
 const controller=new AbortController();
 const interrupt=()=>{if(!controller.signal.aborted)console.log('\nĐang dừng an toàn. Những ảnh đã hoàn tất vẫn được giữ lại.');controller.abort();};
 process.on('SIGINT',interrupt);
 process.on('SIGTERM',interrupt);
 let summary;
 try{
  summary=await preparePhotos({...options,signal:controller.signal,onProgress:event=>{
   if(event.type==='start')console.log(`\nTìm thấy ${event.total} ảnh. ${event.dryRun?'Chỉ kiểm tra.':'Xử lý lần lượt để giữ bộ nhớ ổn định.'}\nKết quả: ${event.output}\n`);
   if(event.type==='processing')console.log(`[${event.index}/${event.total}] Đang xử lý: ${event.file}`);
   if(event.type==='result'){
    const prefix=`[${event.index}/${event.total}] ${event.file}`;
    if(event.status==='failed')console.error(`${prefix}: LỖI — ${event.error}`);
    else if(event.status==='planned')console.log(`${prefix}: ${size(event.sourceBytes)}`);
    else console.log(`${prefix}: ${event.status==='skipped'?'Đã có, bỏ qua':event.status==='updated'?'Đã cập nhật':'Đã tạo'} — ${size(event.sourceBytes)} → ${size(event.preparedBytes)}; ${event.seconds}s`);
   }
  }});
 }finally{
  process.off('SIGINT',interrupt);
  process.off('SIGTERM',interrupt);
 }
 if(!summary.dryRun&&(summary.total||summary.failed)){
  try{summary.report=await writeReport(summary);}
  catch(error){console.error(`Không ghi được báo cáo: ${error.message}`);summary.reportError=error.message;}
 }
 console.log(`\n${summary.interrupted?'ĐÃ DỪNG':'HOÀN TẤT'}: ${summary.created} ảnh mới, ${summary.updated} ảnh cập nhật, ${summary.skipped} ảnh giữ nguyên, ${summary.failed} lỗi.`);
 if(!summary.dryRun&&summary.preparedBytes)console.log(`Tổng dung lượng các ảnh thành công: ${size(summary.sourceBytes)} → ${size(summary.preparedBytes)} (gồm cả ba phiên bản).`);
 console.log(`Thư mục kết quả: ${summary.output}`);
 if(summary.report)console.log(`Báo cáo chi tiết: ${summary.report}`);
 if(!summary.dryRun&&summary.preparedBytes)console.log('Trên trang quản trị đã cập nhật: chọn phần của album, rồi chọn các tệp .ccphoto trong thư mục phần tương ứng. Website sẽ nhận cả ba phiên bản mà không nén lại.');
 if(summary.interrupted)console.log('Chạy lại cùng thư mục để tiếp tục; những ảnh đã hoàn tất sẽ được bỏ qua.');
 if(summary.total===0)console.log('Không tìm thấy ảnh JPEG, PNG hoặc WebP. Tệp ẩn và liên kết được bỏ qua.');
 return summary.interrupted?130:summary.failed||summary.reportError||summary.total===0?1:0;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(`Lỗi: ${error.message}`);process.exitCode=1;});
}
