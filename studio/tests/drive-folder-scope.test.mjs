import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDriveClient,DRIVE_FOLDER} from '../server/drive-client.mjs';
import {assertConnectionFolder,browseConnectionFolders,driveFolderScope} from '../server/drive-folder-scope.mjs';

test('Shared scope checks chosen folder and identity while rejecting shortcuts, trash and Shared Drives',async () => {
  const connection = {folder_scope:'shared',root_folder_id:'oldroot',service_account_email:'fixture@test.iam.gserviceaccount.com'};
  let folder = {id:'outside',name:'Folder',mimeType:DRIVE_FOLDER};
  const drive = {serviceAccountEmail:connection.service_account_email,getFile:async id => { assert.equal(id,'outside'); return folder; }};
  await assertConnectionFolder(drive,'outside',connection);
  await assert.rejects(assertConnectionFolder({...drive,serviceAccountEmail:'other'},'outside',connection),{code:'drive_identity_mismatch'});
  for (const patch of [{mimeType:'application/vnd.google-apps.shortcut'},{trashed:true},{driveId:'shared-drive'}]) {
    folder = {id:'outside',name:'Folder',mimeType:DRIVE_FOLDER,...patch};
    await assert.rejects(assertConnectionFolder(drive,'outside',connection));
  }
  assert.equal(driveFolderScope({}),'root');
});

test('Browser reads folder-only pages of 100 via fixed Google GET endpoint and preserves empty-page cursor',async () => {
  const dir = await mkdtemp(path.join(tmpdir(),'drive-browse-client-'));
  const key = path.join(dir,'key.json');
  const email = 'fixture@test.iam.gserviceaccount.com';
  await writeFile(key,JSON.stringify({type:'service_account',client_email:email,private_key:'synthetic-test-value'}),{mode:0o600});
  let listCalls = 0, metadataCalls = 0;
  try {
    const drive = await createDriveClient({DRIVE_SYNC_SERVICE_ACCOUNT_FILE:key},{authClient:{getRequestHeaders:async () => new Headers()},fetchImpl:async (url,options) => {
      assert.equal(url.origin,'https://www.googleapis.com');
      assert.equal(options.method,undefined);
      assert.equal(url.searchParams.has('alt'),false);
      if (url.pathname.endsWith('/files/outside')) {metadataCalls++;return Response.json({id:'outside',name:'Outside',mimeType:DRIVE_FOLDER});}
      if(url.searchParams.get('pageSize')==='1000') {
        assert.equal(url.searchParams.get('fields'),'nextPageToken,incompleteSearch,files(id,mimeType,parents,trashed,driveId)');
        assert.equal(url.searchParams.get('q'),"'outside' in parents and trashed = false");
        return Response.json({files:[]});
      }
      assert.equal(url.pathname,'/drive/v3/files');
      assert.equal(url.searchParams.get('pageSize'),'100');
      assert.equal(url.searchParams.get('pageToken'),'page2');
      assert.equal(url.searchParams.get('q'),"'outside' in parents and trashed = false and mimeType = '"+DRIVE_FOLDER+"'");
      listCalls++;
      return Response.json({files:[],nextPageToken:'page3'});
    }});
    const result = await browseConnectionFolders(drive,'outside',{folder_scope:'shared',service_account_email:email},{pageToken:'page2'});
    assert.deepEqual(result,{folder:{id:'outside',name:'Outside'},folders:[],nextPageToken:'page3',scope:'shared'});
    assert.equal(listCalls,1);
    assert.equal(metadataCalls,2);
    assert.deepEqual(await drive.listFolderOverview('outside'),{files:[]});
    await assert.rejects(drive.listFiles('outside',{pageSize:1001}),{code:'drive_invalid_page_size'});
  } finally { await rm(dir,{recursive:true,force:true}); }
});
