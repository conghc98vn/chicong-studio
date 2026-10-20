import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFolderOverview} from '../server/drive-folder-overview.mjs';
import {DRIVE_FOLDER} from '../server/drive-client.mjs';
const file=(id,mimeType='image/jpeg')=>({id:'file'+id,mimeType,parents:['folder']});

test('overview counts 5000 direct images in five metadata pages without media downloads',async()=>{
  let calls=0;
  const summary=await collectFolderOverview({listFolderOverview:async(folder,{pageToken})=>{
    assert.equal(folder,'folder');const offset=Number(pageToken||0);calls++;
    return {files:Array.from({length:1000},(_,i)=>file(offset+i)),...(offset<4000?{nextPageToken:String(offset+1000)}:{})};
  },download:()=>assert.fail('No downloads')},'folder');
  assert.equal(calls,5);assert.equal(summary.images,5000);assert.equal(summary.scanned,5000);assert.equal(summary.complete,true);
});

test('overview separates supported images, child folders and other files',async()=>{
  const summary=await collectFolderOverview({listFolderOverview:async()=>({files:[file(1),file(2,'image/png'),file(3,'image/webp'),file(4,DRIVE_FOLDER),file(5,'image/tiff')]})},'folder');
  assert.equal(summary.images,3);assert.equal(summary.folders,1);assert.equal(summary.otherFiles,1);assert.equal(summary.status,'ready');
});

test('parent-scoped overview accepts withheld parents but rejects contradictory membership',async()=>{
  const summary=await collectFolderOverview({listFolderOverview:async()=>({files:[{id:'omitted',mimeType:'image/jpeg'},{id:'emptyparents',mimeType:DRIVE_FOLDER,parents:[]}]})},'folder');
  assert.equal(summary.complete,true);assert.equal(summary.images,1);assert.equal(summary.folders,1);
  const invalid=await collectFolderOverview({listFolderOverview:async()=>({files:[{id:'outside',mimeType:'image/jpeg',parents:['other']}]})},'folder');
  assert.equal(invalid.complete,false);assert.equal(invalid.images,null);
});

test('overview never calls partial, duplicate, malformed, quota-limited or cyclic results exact',async()=>{
  for(const page of [
    {files:[file(1)],incompleteSearch:true},
    {files:[file(1),file(1)]},
    {files:[file(1),file(2)],nextPageToken:'invalid token'},
    {files:[file(1),{...file(2),parents:['other']}]},
  ]) {
    const summary=await collectFolderOverview({listFolderOverview:async()=>page},'folder');
    assert.equal(summary.complete,false);assert.equal(summary.status,'partial');assert.equal(summary.images<=2,true);
  }
  let calls=0;
  const partial=await collectFolderOverview({listFolderOverview:async()=>{if(calls++) throw Error('quota');return {files:[file(1)],nextPageToken:'next'};}},'folder');
  assert.equal(partial.status,'partial');assert.equal(partial.images,1);
  const cycle=await collectFolderOverview({listFolderOverview:async()=>({files:[file(++calls)],nextPageToken:'repeat'})},'folder');
  assert.equal(cycle.complete,false);
  const unavailable=await collectFolderOverview({listFolderOverview:async()=>{throw Error('quota');}},'folder');
  assert.equal(unavailable.images,null);assert.equal(unavailable.status,'unavailable');
  assert.equal((await collectFolderOverview({},'folder')).status,'unavailable');
});

test('overview limits traversal and propagates caller cancellation even for adapters ignoring signals',async()=>{
  let calls=0;
  const result=await collectFolderOverview({listFolderOverview:async()=>({files:[file(++calls)],nextPageToken:'page'+calls})},'folder',{maxPages:2});
  assert.equal(calls,2);assert.equal(result.complete,false);
  const bounded=await collectFolderOverview({listFolderOverview:async()=>({files:[file(1),file(2),file(3)]})},'folder',{maxItems:2});
  assert.equal(bounded.scanned,2);assert.equal(bounded.complete,false);
  const abort=new AbortController();
  const pending=collectFolderOverview({listFolderOverview:()=>new Promise(()=>{})},'folder',{signal:abort.signal});
  abort.abort(Error('canceled overview'));await assert.rejects(pending,/canceled overview/);
  const keepAlive=setTimeout(()=>{},100);
  try { assert.equal((await collectFolderOverview({listFolderOverview:()=>new Promise(()=>{})},'folder',{maxMs:10})).status,'unavailable'); }
  finally {clearTimeout(keepAlive);}
});
