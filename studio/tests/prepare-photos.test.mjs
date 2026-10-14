import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,readdir,stat,symlink,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {preparePhotos,parseArguments,parseDraggedPath,parseDraggedPaths} from '../tools/prepare-photos.mjs';
import {decodePreparedPhoto} from '../server/prepared-photo.mjs';

const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
async function temporary(t){
 const directory=await realpath(await mkdtemp(path.join(tmpdir(),'chicong-prepare-')));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 return directory;
}
const fixture=(background='#c68f71')=>sharp({create:{width:160,height:120,channels:3,background}}).jpeg({quality:95}).toBuffer();

test('local preparation preserves originals and timeline folders, ignores hidden files and links',async t=>{
 const root=await temporary(t),input=path.join(root,'Lễ cưới - ảnh nguồn'),section=path.join(input,'01 Chi tiết trang trí');
 await mkdir(section,{recursive:true});
 const original=await fixture(),name='CC - 0546.jpg',source=path.join(section,name);
 await writeFile(source,original);
 await writeFile(path.join(input,'readme.txt'),'unrelated');
 await writeFile(path.join(input,'.hidden.jpg'),original);
 await mkdir(path.join(input,'.cache'));
 await writeFile(path.join(input,'.cache','ignore.jpg'),original);
 await symlink(section,path.join(input,'linked folder'));
 await symlink(source,path.join(input,'linked photo.jpg'));
 const before=await stat(source);
 const summary=await preparePhotos({input});
 assert.equal(summary.total,1);assert.equal(summary.created,1);assert.equal(summary.failed,0);assert.equal(summary.ignored,5);
 assert.equal(summary.output,`${input}_WEB_UPLOAD`);
 const prepared=await decodePreparedPhoto(await readFile(path.join(summary.output,'01 Chi tiết trang trí',`${name}.ccphoto`)));
 assert.equal(prepared.originalName,name);assert.equal(prepared.sourceHash,sha(original));
 assert.equal(prepared.optimization.source_bytes,original.length);
 assert.deepEqual(await readFile(source),original);
 assert.equal((await stat(source)).mtimeMs,before.mtimeMs);
 assert.deepEqual((await readdir(section)),[name]);
});

test('unchanged photos resume without rewriting packages; changed sources refresh known packages',async t=>{
 const root=await temporary(t),input=path.join(root,'source');await mkdir(input);
 const source=path.join(input,'same.jpg');await writeFile(source,await fixture());
 const first=await preparePhotos({input}),target=path.join(first.output,'same.jpg.ccphoto');
 const before=await readFile(target),beforeStat=await stat(target);
 const second=await preparePhotos({input});
 assert.equal(second.skipped,1);assert.equal(second.created,0);assert.equal(second.updated,0);
 assert.deepEqual(await readFile(target),before);assert.equal((await stat(target)).mtimeMs,beforeStat.mtimeMs);
 const changed=await fixture('#326451');await writeFile(source,changed);
 const third=await preparePhotos({input});
 assert.equal(third.updated,1);assert.equal(third.failed,0);
 assert.equal((await decodePreparedPhoto(await readFile(target))).sourceHash,sha(changed));
 assert.deepEqual(await readFile(source),changed);
 assert.deepEqual(await readdir(first.output),['same.jpg.ccphoto']);
});

test('unknown and corrupt output collisions are retained, while independent photos complete',async t=>{
 const root=await temporary(t),input=path.join(root,'source'),output=path.join(root,'output');
 await mkdir(input);await mkdir(output);
 const original=await fixture();
 await writeFile(path.join(input,'a.jpg'),original);await writeFile(path.join(input,'b.jpg'),original);
 const collision=path.join(output,'a.jpg.ccphoto');await writeFile(collision,'my existing data');
 const summary=await preparePhotos({input,output});
 assert.equal(summary.failed,1);assert.equal(summary.created,1);
 assert.match(summary.files.find(file=>file.status==='failed').error,/không ghi đè/);
 assert.equal(await readFile(collision,'utf8'),'my existing data');
 assert.equal((await decodePreparedPhoto(await readFile(path.join(output,'b.jpg.ccphoto')))).originalName,'b.jpg');
});

test('same base filename with different extensions produces separate packages',async t=>{
 const root=await temporary(t),input=path.join(root,'source');await mkdir(input);
 await writeFile(path.join(input,'photo.jpg'),await fixture());
 await writeFile(path.join(input,'photo.png'),await sharp({create:{width:80,height:100,channels:3,background:'#eeccaa'}}).png().toBuffer());
 const summary=await preparePhotos({input});
 assert.equal(summary.created,2);assert.equal(summary.failed,0);
 assert.deepEqual((await readdir(summary.output)).sort(),['photo.jpg.ccphoto','photo.png.ccphoto']);
});

test('invalid photos fail individually and leave no partial output package',async t=>{
 const root=await temporary(t),input=path.join(root,'source');await mkdir(input);
 await writeFile(path.join(input,'a-broken.jpg'),'not an image');
 await writeFile(path.join(input,'b-empty.png'),'');
 await writeFile(path.join(input,'c-good.jpg'),await fixture());
 const summary=await preparePhotos({input});
 assert.equal(summary.failed,2);assert.equal(summary.created,1);
 assert.deepEqual(await readdir(summary.output),['c-good.jpg.ccphoto']);
 const cli=spawnSync(process.execPath,['studio/tools/prepare-photos.mjs',input],{encoding:'utf8'});
 assert.equal(cli.status,1);assert.match(cli.stdout,/2 lỗi/);assert.match(cli.stderr,/a-broken.jpg/);
 const reportDirectory=path.join(summary.output,'_reports'),reports=await readdir(reportDirectory);
 assert.equal(reports.length,1);
 const report=JSON.parse(await readFile(path.join(reportDirectory,reports[0]),'utf8'));
 assert.equal(report.failed,2);assert.equal(report.skipped,1);
});

test('output inside source, output symlinks and source links are rejected before writing',async t=>{
 const root=await temporary(t),input=path.join(root,'source');await mkdir(input);
 const source=path.join(input,'photo.jpg'),original=await fixture();await writeFile(source,original);
 for(const output of [input,path.join(input,'web'),path.join(input,'nested','web')])await assert.rejects(preparePhotos({input,output}),/ngoài thư mục ảnh gốc/);
 const alias=path.join(root,'output-alias');await symlink(input,alias);
 await assert.rejects(preparePhotos({input,output:alias}),/liên kết/);
 await assert.rejects(preparePhotos({input,output:path.join(alias,'nested')}),/liên kết/);
 await assert.rejects(preparePhotos({input:alias}),/liên kết/);
 const output=path.join(root,'output');await mkdir(output);
 await symlink(source,path.join(output,'photo.jpg.ccphoto'));
 const summary=await preparePhotos({input,output});assert.equal(summary.failed,1);assert.equal(summary.created,0);
 assert.deepEqual(await readFile(source),original);
});

test('single-photo input and dry run use a separate output without creating files',async t=>{
 const root=await temporary(t),input=path.join(root,'ảnh cưới.jpg');await writeFile(input,await fixture());
 const dry=await preparePhotos({input,dryRun:true});
 assert.equal(dry.total,1);assert.equal(dry.created,0);assert.equal(dry.files[0].status,'planned');
 assert.equal(dry.output,path.join(root,'ảnh cưới_WEB_UPLOAD'));
 await assert.rejects(stat(dry.output),{code:'ENOENT'});
 const done=await preparePhotos({input});assert.equal(done.created,1);
 assert.deepEqual(await readdir(done.output),['ảnh cưới.jpg.ccphoto']);
});

test('cancellation keeps completed packages and safely resumes remaining photos',async t=>{
 const root=await temporary(t),input=path.join(root,'source');await mkdir(input);
 const original=await fixture();await writeFile(path.join(input,'a.jpg'),original);await writeFile(path.join(input,'b.jpg'),original);
 const controller=new AbortController();
 const stopped=await preparePhotos({input,signal:controller.signal,onProgress:event=>{if(event.type==='result')controller.abort();}});
 assert.equal(stopped.interrupted,true);assert.equal(stopped.created,1);
 assert.deepEqual(await readdir(stopped.output),['a.jpg.ccphoto']);
 const resumed=await preparePhotos({input});assert.equal(resumed.skipped,1);assert.equal(resumed.created,1);
});

test('a nested output symlink cannot redirect writes into originals',async t=>{
 const root=await temporary(t),input=path.join(root,'source'),section=path.join(input,'section'),output=path.join(root,'output');
 await mkdir(section,{recursive:true});await mkdir(output);
 const source=path.join(section,'photo.jpg'),original=await fixture();await writeFile(source,original);
 // Create the link before processing; initial output-root validation does not
 // inspect nested section paths, so the per-photo protection must catch it.
 await symlink(section,path.join(output,'section'));
 const summary=await preparePhotos({input,output});
 assert.equal(summary.failed,1);assert.equal(summary.created,0);assert.match(summary.files[0].error,/liên kết/);
 assert.deepEqual(await readdir(section),['photo.jpg']);assert.deepEqual(await readFile(source),original);
});

test('source parent aliases are canonicalized before checking output separation',async t=>{
 const root=await temporary(t),realParent=path.join(root,'real'),input=path.join(realParent,'source');
 await mkdir(input,{recursive:true});
 const source=path.join(input,'photo.jpg'),original=await fixture();await writeFile(source,original);
 const alias=path.join(root,'alias');await symlink(realParent,alias);
 const aliasedSource=path.join(alias,'source');
 await assert.rejects(preparePhotos({input:aliasedSource,output:path.join(input,'web')}),/ngoài thư mục ảnh gốc/);
 const summary=await preparePhotos({input:aliasedSource});
 assert.equal(summary.input,input);assert.equal(summary.output,`${input}_WEB_UPLOAD`);assert.equal(summary.created,1);
 assert.deepEqual(await readdir(input),['photo.jpg']);assert.deepEqual(await readFile(source),original);
});

test('an all-failed run still produces a diagnostic report and a nonzero exit code',async t=>{
 const root=await temporary(t),input=path.join(root,'broken source');await mkdir(input);
 await writeFile(path.join(input,'broken.jpg'),'broken');
 const cli=spawnSync(process.execPath,['studio/tools/prepare-photos.mjs',input],{encoding:'utf8'});
 assert.equal(cli.status,1);assert.match(cli.stdout,/1 lỗi/);
 const output=`${input}_WEB_UPLOAD`,reportDirectory=path.join(output,'_reports');
 assert.deepEqual(await readdir(output),['_reports']);
 const reports=await readdir(reportDirectory);assert.equal(reports.length,1);
 const report=JSON.parse(await readFile(path.join(reportDirectory,reports[0]),'utf8'));
 assert.equal(report.failed,1);assert.equal(report.files[0].file,'broken.jpg');
});

test('CLI parses quoted paths and Finder escapes as text without shell evaluation',()=>{
 assert.deepEqual(parseArguments(['/folder with spaces','--output','/new folder','--dry-run']),{input:'/folder with spaces',output:'/new folder',dryRun:true});
 assert.throws(()=>parseArguments(['--output']),/đường dẫn/);
 assert.throws(()=>parseArguments(['--output','-x']),/đường dẫn/);
 assert.deepEqual(parseArguments(['/one','/two']),{inputs:['/one','/two']});
 assert.deepEqual(parseArguments(['--','/one','/two']),{inputs:['/one','/two']});
 assert.equal(parseDraggedPath('/Users/me/Lễ\\ cưới\\ 2026'),'/Users/me/Lễ cưới 2026');
 assert.equal(parseDraggedPath("'/Users/me/Lễ cưới 2026'"),'/Users/me/Lễ cưới 2026');
 assert.equal(parseDraggedPath('/Users/me/\"$(touch\\ x)\"'),'/Users/me/$(touch x)');
 assert.throws(()=>parseDraggedPath('/one /two'),/Chỉ kéo một/);
 assert.deepEqual(parseDraggedPaths('/Users/me/01\\ Trang\\ trí /Users/me/02\\ Tiệc'),['/Users/me/01 Trang trí','/Users/me/02 Tiệc']);
 const help=spawnSync(process.execPath,['studio/tools/prepare-photos.mjs','--help'],{encoding:'utf8'});
 assert.equal(help.status,0);assert.match(help.stdout,/2400 px/);assert.doesNotMatch(help.stdout,/\n\+/);
 const invalid=spawnSync(process.execPath,['studio/tools/prepare-photos.mjs','--unknown'],{encoding:'utf8'});
 assert.equal(invalid.status,1);assert.match(invalid.stderr,/Không nhận ra tùy chọn/);
});

test('multiple sources sharing same parent preserve timeline structure and deduplicate nested inputs',async t=>{
 const root=await temporary(t),album=path.join(root,'album 2026');
 const part1=path.join(album,'01 Trang trí'),part2=path.join(album,'02 Nhà gái');
 await mkdir(part1,{recursive:true});await mkdir(part2,{recursive:true});
 const original=await fixture();
 await writeFile(path.join(part1,'p1.jpg'),original);
 await writeFile(path.join(part2,'p2.jpg'),original);
 const summary=await preparePhotos({inputs:[part1,part2]});
 assert.equal(summary.output,path.join(root,'album 2026_WEB_UPLOAD'));
 assert.equal(summary.total,2);assert.equal(summary.created,2);
 assert.ok(await stat(path.join(summary.output,'01 Trang trí','p1.jpg.ccphoto')));
 assert.ok(await stat(path.join(summary.output,'02 Nhà gái','p2.jpg.ccphoto')));

 const dedup=await preparePhotos({inputs:[album,part1]});
 assert.equal(dedup.total,2);assert.equal(dedup.skipped,2);
});

test('multiple sources with different parents require --output; name collisions are rejected',async t=>{
 const root=await temporary(t);
 const parentA=path.join(root,'parentA','sec1'),parentB=path.join(root,'parentB','sec2');
 await mkdir(parentA,{recursive:true});await mkdir(parentB,{recursive:true});
 const original=await fixture();
 await writeFile(path.join(parentA,'photo.jpg'),original);
 await writeFile(path.join(parentB,'photo.jpg'),original);
 await assert.rejects(preparePhotos({inputs:[parentA,parentB]}),/nhiều thư mục cha khác nhau/);
 await assert.rejects(preparePhotos({input:'a',inputs:['b']}),/không dùng cả hai/);

 const output=path.join(root,'unified_output');
 const summary=await preparePhotos({inputs:[parentA,parentB],output});
 assert.equal(summary.created,2);assert.equal(summary.output,output);
 assert.ok(await stat(path.join(output,'sec1','photo.jpg.ccphoto')));
 assert.ok(await stat(path.join(output,'sec2','photo.jpg.ccphoto')));

 const colliding=path.join(root,'other','sec1');await mkdir(colliding,{recursive:true});
 await writeFile(path.join(colliding,'photo.jpg'),original);
 await assert.rejects(preparePhotos({inputs:[parentA,colliding],output:path.join(root,'colliding_out')}),/trùng nhau/);
});
