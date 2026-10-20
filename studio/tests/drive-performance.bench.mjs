import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {driveFixture} from './drive-test-fixture.mjs';
import {createDriveJobs} from '../server/drive-jobs.mjs';
import {createDriveSync} from '../server/drive-sync.mjs';
import {DRIVE_FOLDER} from '../server/drive-client.mjs';

// Isolated deterministic metadata workload. No credentials, remote requests,
// image downloads or encoders are used. Times describe this machine, not Drive.
export async function benchmarkDriveMetadata(count = 500, {batchSize = 5, hooks = {}} = {}) {
  const fixture = await driveFixture();
  const metrics = {queries:0,rows:0,folder_gets:0,file_gets:0,list_pages:0,membership_pages:0,downloads:0,batches:0};
  function instrument(connection) {
    return {...connection,...Object.fromEntries(['get','all','run','exec'].map(method => [method,async (...args) => {
      metrics.queries++;
      const result = await connection[method](...args);
      if (method === 'all') metrics.rows += result.length;
      if (method === 'get' && result) metrics.rows++;
      return result;
    }])),transaction:callback => connection.transaction(tx => callback(instrument(tx)))};
  }
  const db = instrument(fixture.db);
  const files = Array.from({length:count},(_,index) => ({id:'file'+index,name:'IMG_'+index+'.jpg',mimeType:'image/jpeg',parents:['folder'],version:'1',size:'1000',md5Checksum:'fixture-checksum-'+index,capabilities:{canDownload:true}}));
  const byId = new Map(files.map(file => [file.id,file]));
  const byName = new Map(files.map(file => [file.name,file]));
  const folders = new Map([['root',{id:'root',name:'Root',mimeType:DRIVE_FOLDER,parents:[],version:'1'}],['folder',{id:'folder',name:'Folder',mimeType:DRIVE_FOLDER,parents:['root'],version:'1'}]]);
  const drive = {
    serviceAccountEmail:'test@example.invalid',
    async getFile(id) {
      if (folders.has(id)) { metrics.folder_gets++; return structuredClone(folders.get(id)); }
      metrics.file_gets++;
      const file = structuredClone(byId.get(id));
      delete file.parents;
      return file;
    },
    async listFiles(folder,{pageToken,name}={}) {
      assert.equal(folder,'folder');
      if (name !== undefined) { metrics.membership_pages++; return {files:byName.has(name) ? [structuredClone(byName.get(name))] : []}; }
      metrics.list_pages++;
      const offset = Number(pageToken || 0);
      return {files:structuredClone(files.slice(offset,offset+1000)),nextPageToken:offset+1000 < files.length ? String(offset+1000) : undefined};
    },
    async download() { metrics.downloads++; throw Error('Metadata benchmark must never download'); },
  };
  try {
    await fixture.db.transaction(async tx => {
      for (const file of files) {
        await tx.run("INSERT INTO photos(id,album_id,filename,original,width,height,source) VALUES(?,'album',?,?,2400,1600,'google_drive')",['photo'+file.id,'rendition'+file.id,file.name]);
        await tx.run("INSERT INTO drive_source_files(id,connection_id,drive_file_id,mapping_id,photo_id,source_name,mime,size,imported_generation,imported_version,observed_version,checksum) VALUES(?,'connection',?,'mapping',?,?,?,1000,1,'1','1',?)",['source'+file.id,file.id,'photo'+file.id,file.name,file.mimeType,file.md5Checksum]);
      }
      await tx.run("UPDATE drive_album_links SET baseline_preview_id='baseline' WHERE id='mapping'");
    });
    let now = Date.now();
    const jobs = createDriveJobs(db,{now:() => now,leaseMs:3600000});
    const sync = createDriveSync({db,drive,jobs,storage:{},control:{processId:'metadata-benchmark',status:async () => ({control:{owner:null}})},env:{DRIVE_SYNC_ENABLED:'true',DRIVE_SYNC_BATCH_SIZE:String(batchSize),DRIVE_SYNC_TEMP_DIR:fixture.dir+'/temporary'},ingest:async () => { throw Error('Metadata benchmark must never ingest'); }});
    const snapshots = {};
    for (const kind of ['preview','apply']) {
      for (const key of Object.keys(metrics)) metrics[key] = 0;
      const start = performance.now();
      const job = await jobs.enqueue({mappingId:'mapping',kind,requestKey:kind});
      await hooks.beforeRun?.({kind,db:fixture.db,jobs,job,files});
      for (let attempt=0; attempt<count+10; attempt++) {
        now += 2;
        const lease = await jobs.claim('metadata-benchmark');
        if (!lease) break;
        metrics.batches++;
        await sync.run(lease);
      }
      const completed = await jobs.get(job.id);
      assert.equal(completed.status,kind === 'preview' ? 'awaiting_review' : 'completed');
      snapshots[kind] = {...metrics,milliseconds:Math.round(performance.now()-start),status:completed.status};
      if (kind === 'apply') {
        assert.equal(Number((await fixture.db.get('SELECT COUNT(*) AS count FROM photos')).count),count);
        assert.equal(metrics.downloads,0);
        await hooks.afterApply?.({db:fixture.db,jobs,job:completed,files});
      }
    }
    return {count,batchSize,...snapshots};
  } finally { await fixture.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const count of [500,5000]) console.log(JSON.stringify(await benchmarkDriveMetadata(count)));
}
