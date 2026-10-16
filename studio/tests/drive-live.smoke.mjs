// Opt-in rehearsal using only a completed synthetic r2-live run and a new Drive folder.
// Does not read DATABASE_URL, production media, or existing personal Drive folders.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {driveRepository} from '../tools/drive-backup.mjs';
import {readBackup,verifyBackup,exportBackup,restoreBackup,sha256} from '../tools/media-backup.mjs';
import {openDatabase} from '../server/db.mjs';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--source-r2-run','--output','--folder'].includes(args[i])||!args[i+1])throw Error('Use --source-r2-run DIR --output NEW_DIR --folder NEW_DRIVE_FOLDER_ID');options[args[i].slice(2)]=args[i+1];}
if(!options['source-r2-run']||!options.output||!options.folder||options.folder!==process.env.BACKUP_DRIVE_FOLDER_ID)throw Error('Explicit synthetic source, fresh output and matching Drive folder required');
const source=path.resolve(options['source-r2-run']),root=path.resolve(options.output),repository=path.join(source,'offline');
const rehearsal=JSON.parse(await readFile(path.join(source,'report.json'),'utf8'));
assert.equal(rehearsal.syntheticOnly,true);assert.equal(rehearsal.success,true);assert.equal(rehearsal.remainingObjects,0);
const manifest=await readBackup(repository);await verifyBackup(repository,manifest);
assert.equal(manifest.objects.length,rehearsal.backupObjects);
await mkdir(root,{mode:0o700});
const report={startedAt:new Date().toISOString(),syntheticOnly:true,folder:options.folder,runId:manifest.runId,steps:[],operations:{},success:false};
const save=()=>writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
const step=async(name,fn)=>{const start=performance.now();await fn();report.steps.push({name,success:true,ms:Math.round(performance.now()-start)});await save();};
const observedFetch=async(url,init={})=>{
 const kind=new URL(url).hostname==='oauth2.googleapis.com'?'refresh':init.method||'GET';
 report.operations[kind]=(report.operations[kind]||0)+1;
 return fetch(url,init);
};
const drive=driveRepository(process.env,{fetchImpl:observedFetch});
try{
 await step('Refresh credentials, verify owner-only folder and quota',async()=>{
  const account=await drive.initialize();report.storageQuota=account.storageQuota;
  assert.equal((await drive.age()).runId,null,'Use a new empty backup folder for this rehearsal');
 });
 await step('Publish synthetic snapshot with upload and download verification',async()=>{
  await drive.publish(repository,manifest);report.objects=manifest.objects.length;report.uniqueBlobs=new Set([manifest.databaseSha256,...manifest.objects.map(o=>o.sha256)]).size;
 });
 await step('Republish is idempotent with no extra uploads',async()=>{
  const puts=report.operations.PUT;await drive.publish(repository,manifest);assert.equal(report.operations.PUT,puts);
 });
 await step('New OAuth refresh and download from Drive into an empty repository',async()=>{
  const restarted=driveRepository(process.env,{fetchImpl:observedFetch});
  assert.equal((await restarted.age()).runId,manifest.runId);
  const downloaded=await restarted.exportLocal(path.join(root,'downloaded'),manifest.runId);assert.equal(downloaded.runId,manifest.runId);
  await verifyBackup(path.join(root,'downloaded'),downloaded);
 });
 await step('Export independent offline copy and restore without Drive or R2',async()=>{
  const offline=path.join(root,'offline'),restored=path.join(root,'restored');
  await exportBackup(path.join(root,'downloaded'),offline,manifest.runId);await restoreBackup(offline,restored,manifest.runId);
  for(const item of manifest.objects)assert.equal(sha256(await readFile(path.join(restored,'uploads',item.key))),item.sha256);
  const db=await openDatabase(restored,{url:null,initialize:false});
  try{assert.equal((await db.all('SELECT id FROM photos')).length,3);assert.equal((await db.all('SELECT * FROM sessions')).length,0);assert.equal((await db.all('SELECT * FROM selections')).length,1);}finally{await db.close();}
 });
 report.success=true;
}catch(error){report.failureCode=error.code||error.name;report.failureMessage=String(error.message);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({success:report.success,steps:report.steps,report:path.join(root,'report.json'),failureCode:report.failureCode},null,2));}
