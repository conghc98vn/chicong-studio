import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createDriveClient,assertDriveFolder,findDriveChild,DRIVE_FOLDER} from '../server/drive-client.mjs';

async function credentialFixture(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(),'drive-client-'));
  const credential = path.join(directory,'service-account.json');
  await writeFile(credential,JSON.stringify({type:'service_account',client_email:'fixture@test.iam.gserviceaccount.com',private_key:'synthetic-non-secret-test-value'}),{mode:0o600});
  try { await callback({directory,credential,env:{DRIVE_SYNC_SERVICE_ACCOUNT_FILE:credential}}); }
  finally { await rm(directory,{recursive:true,force:true}); }
}
test('Drive client uses only fixed Google API GET URLs, official Headers, bounded bytes and checksums',async () => {
  await credentialFixture(async ({directory,env}) => {
    const bytes = Buffer.from('synthetic fixture bytes');
    const calls = [];
    const client = await createDriveClient(env,{
      authClient:{getRequestHeaders:async () => new Headers({Authorization:'Bearer synthetic-test-token'})},
      fetchImpl:async (url,options) => {
        calls.push({url:String(url),options});
        assert.equal(url.origin,'https://www.googleapis.com');
        assert.equal(options.method,undefined);
        assert.equal(options.redirect,'error');
        assert.equal(options.headers.get('Authorization'),'Bearer synthetic-test-token');
        if (url.searchParams.get('alt') === 'media') return new Response(bytes);
        return Response.json({files:[],nextPageToken:'next'});
      },
    });
    assert.equal((await client.listFiles('folder_id')).nextPageToken,'next');
    assert.match(calls[0].url,/q=/);
    await client.listFiles('folder_id',{name:"a'\\b.jpg"});
    assert.equal(new URL(calls.at(-1).url).searchParams.get('q'),"'folder_id' in parents and trashed = false and name = 'a\\'\\\\b.jpg'");
    await client.listFiles('folder_id',{foldersOnly:true});
    assert.equal(new URL(calls.at(-1).url).searchParams.get('q'),"'folder_id' in parents and trashed = false and mimeType = '"+DRIVE_FOLDER+"'");
    await client.listPreviewImages('folder_id');
    const previewQuery = new URL(calls.at(-1).url).searchParams;
    assert.equal(previewQuery.get('pageSize'),'6');
    assert.match(previewQuery.get('q'),/image\/jpeg.*image\/png.*image\/webp/);
    assert.match(previewQuery.get('fields'),/thumbnailLink/);
    assert.equal(previewQuery.has('alt'),false);
    const destination = path.join(directory,'image');
    const checksum = createHash('md5').update(bytes).digest('hex');
    await client.download('file_id',destination,{maxBytes:100,checksum});
    assert.deepEqual(await readFile(destination),bytes);
    await assert.rejects(client.download('file_id',path.join(directory,'too-big'),{maxBytes:2,checksum}),{code:'drive_file_too_large'});
    await assert.rejects(client.download('file_id',path.join(directory,'wrong-hash'),{maxBytes:100,checksum:'f'.repeat(32)}),{code:'drive_checksum_mismatch'});
    await assert.rejects(client.getFile('https://attacker.example'),{code:'drive_invalid_id'});
  });
});
test('Parent-scoped lookup handles empty pages, duplicate names and incomplete or cyclic results',async () => {
  const file = {id:'target',name:'same.jpg'};
  let requests = 0;
  const drive = {listFiles:async (folder,{name,pageToken}) => {
    assert.equal(folder,'folder');
    assert.equal(name,'same.jpg');
    requests++;
    if (!pageToken) return {files:[],nextPageToken:'empty'};
    if (pageToken === 'empty') return {files:[{id:'duplicate',name}],nextPageToken:'last'};
    return {files:[file]};
  }};
  assert.deepEqual(await findDriveChild(drive,'folder',file),file);
  assert.equal(requests,3);
  assert.equal(await findDriveChild({listFiles:async () => ({files:[{id:'duplicate',name:'same.jpg'}]})},'folder',file),null);
  await assert.rejects(findDriveChild({listFiles:async () => ({files:[],incompleteSearch:true})},'folder',file),{code:'drive_inventory_incomplete'});
  await assert.rejects(findDriveChild({listFiles:async () => ({files:[],nextPageToken:'repeated'})},'folder',file),{code:'drive_pagination_cycle'});
  await assert.rejects(findDriveChild(drive,'folder',file,{maxFiles:1}),{code:'drive_inventory_file_limit'});
});
test('Drive client refreshes one 401, differentiates quota from permissions and rejects public key files',async () => {
  await credentialFixture(async ({credential,env}) => {
    let refreshed = 0;
    let calls = 0;
    const authClient = {getRequestHeaders:async () => new Headers(),refreshAccessToken:async () => { refreshed++; }};
    const client = await createDriveClient(env,{authClient,fetchImpl:async () => {
      calls++;
      return calls === 1 ? new Response('',{status:401}) : Response.json({id:'file_id'});
    }});
    assert.equal((await client.getFile('file_id')).id,'file_id');
    assert.equal(refreshed,1);
    for (const [reason,retryable] of [['userRateLimitExceeded',true],['insufficientFilePermissions',false]]) {
      const denied = await createDriveClient(env,{authClient,fetchImpl:async () => Response.json({error:{errors:[{reason}]}},{status:403,headers:{'Retry-After':'3'}})});
      await assert.rejects(denied.getFile('file_id'),error => error.retryable === retryable && error.retryAfterMs === 3000);
    }
    await chmod(credential,0o644);
    await assert.rejects(createDriveClient(env,{authClient}),{code:'drive_credentials_file_permissions'});
  });
});
test('Folder ancestry denies outside root, shortcuts, cycles and Shared Drives',async () => {
  const rows = new Map([
    ['root',{id:'root',mimeType:DRIVE_FOLDER,parents:[]}],
    ['child',{id:'child',mimeType:DRIVE_FOLDER,parents:['root']}],
  ]);
  const drive = {getFile:async id => rows.get(id),listFiles:async () => ({files:[]})};
  await assertDriveFolder(drive,'child','root');
  rows.set('child',{id:'child',mimeType:DRIVE_FOLDER,parents:[]});
  await assert.rejects(assertDriveFolder(drive,'child','root'),{code:'drive_folder_outside_root'});
  rows.set('child',{id:'child',mimeType:DRIVE_FOLDER,parents:['child']});
  await assert.rejects(assertDriveFolder(drive,'child','root'),{code:'drive_folder_cycle'});
  rows.set('child',{id:'child',mimeType:'application/vnd.google-apps.shortcut',parents:['root']});
  await assert.rejects(assertDriveFolder(drive,'child','root'),{code:'drive_folder_unavailable'});
  rows.set('child',{id:'child',mimeType:DRIVE_FOLDER,parents:['root'],driveId:'shared'});
  await assert.rejects(assertDriveFolder(drive,'child','root'),{code:'drive_folder_unavailable'});
});

const folder = (id,extra={}) => ({id,name:'same-name',mimeType:DRIVE_FOLDER,...extra});
function scopeFixture(tree,overrides={}) {
  const calls = [];
  return {
    calls,
    getFile:async id => folder(id),
    listFiles:async (id,options) => {
      calls.push({id,...options});
      assert.equal(options.foldersOnly,true,'scope discovery must not scan album image files');
      return {files:(tree[id] || []).map(child => folder(child))};
    },
    ...overrides,
  };
}
test('Folder scope proves direct and nested membership when parents are omitted or empty',async () => {
  for (const tree of [{root:['target']},{root:['branch'],branch:['target']}]) {
    const drive = scopeFixture(tree);
    const root = await assertDriveFolder(drive,'target','root');
    assert.equal(root.id,'root');
    assert.equal(drive.calls.filter(call => call.id === 'root').length,2,'root edge must be checked again');
  }
  const drive = scopeFixture({root:['target']},{getFile:async id => folder(id,{parents:[]})});
  await assertDriveFolder(drive,'target','root');
  await assertDriveFolder({getFile:async id => folder(id)},'root','root');
});
test('Folder-only proof pages through duplicate names and empty pages and matches IDs',async () => {
  let rootListings = 0;
  const drive = scopeFixture({}, {listFiles:async (id,{pageToken,foldersOnly}) => {
    assert.equal(foldersOnly,true);
    if (id !== 'root') return {files:[]};
    if (!pageToken) { rootListings++; return {files:[],nextPageToken:'one'}; }
    if (pageToken === 'one') return {files:[folder('other')],nextPageToken:'two'};
    return {files:[folder('target')]};
  }});
  await assertDriveFolder(drive,'target','root');
  assert.equal(rootListings,2);
  await assert.rejects(assertDriveFolder(scopeFixture({root:['same-name-other-id']}),'target','root'),{code:'drive_folder_outside_root'});
});
test('Readable folders remain outside a fully exhausted folder subtree, including a photo-only root',async () => {
  for (const tree of [{},{root:['branch'],branch:['leaf']}]) {
    await assert.rejects(assertDriveFolder(scopeFixture(tree),'target','root'),{code:'drive_folder_outside_root'});
  }
  await assert.rejects(assertDriveFolder({getFile:async id => folder(id)},'target','root'),{code:'drive_folder_scope_unverified'});
});
test('Folder scope fails closed for incomplete results, cycles, and bounded work',async () => {
  for (const [drive,options,reason] of [
    [scopeFixture({}, {listFiles:async () => ({files:[folder('target')],incompleteSearch:true})}),{},'incomplete_listing'],
    [scopeFixture({}, {listFiles:async () => ({files:[],nextPageToken:'repeat'})}),{},'pagination_cycle'],
    [scopeFixture({root:['branch'],branch:['root']}),{},'folder_cycle'],
    [scopeFixture({root:['one','two']}),{maxFolders:1},'folder_limit'],
    [scopeFixture({root:['branch'],branch:['target']}),{maxDepth:2},'depth_limit'],
    [scopeFixture({}, {listFiles:async () => ({files:[],nextPageToken:Math.random().toString()})}),{maxPages:2},'page_limit'],
    [scopeFixture({}, {listFiles:async () => { await new Promise(resolve => setTimeout(resolve,15)); return {files:[folder('target')]}; }}),{maxMs:1},'time_limit'],
  ]) {
    await assert.rejects(assertDriveFolder(drive,'target','root',options),error => error.code === 'drive_folder_scope_unverified' && error.reason === reason);
  }
});
test('Folder proof revalidates edges and rejects moved ancestors, trashed and Shared Drive folders',async () => {
  let rootLists = 0;
  const moved = scopeFixture({}, {listFiles:async (id) => {
    if (id === 'root') return {files:++rootLists === 1 ? [folder('branch')] : []};
    return {files:[folder('target')]};
  }});
  await assert.rejects(assertDriveFolder(moved,'target','root'),error => error.code === 'drive_folder_scope_unverified' && error.reason === 'folder_changed');
  for (const changed of [{trashed:true},{driveId:'shared'},{mimeType:'application/vnd.google-apps.shortcut'},{parents:['elsewhere']}]) {
    let targetReads = 0;
    const drive = scopeFixture({root:['target']},{getFile:async id => folder(id,id === 'target' && ++targetReads > 1 ? changed : {})});
    await assert.rejects(assertDriveFolder(drive,'target','root'),{code:'drive_folder_scope_unverified'});
  }
});
test('Inaccessible ancestors fall back to scoped proof, inaccessible subtree stays unverified',async () => {
  const drive = scopeFixture({root:['target']},{getFile:async id => {
    if (id === 'hidden') throw Object.assign(new Error(),{code:'drive_permission_denied'});
    return folder(id,id === 'target' ? {parents:['hidden']} : {});
  }});
  // Fresh parent metadata contradicting the discovered edge must not be accepted.
  await assert.rejects(assertDriveFolder(drive,'target','root'),{code:'drive_folder_scope_unverified'});
  let reads = 0;
  drive.getFile = async id => {
    if (id === 'hidden') throw Object.assign(new Error(),{code:'drive_source_unavailable'});
    return folder(id,id === 'target' && ++reads === 1 ? {parents:['hidden']} : {});
  };
  await assertDriveFolder(drive,'target','root');
  drive.listFiles = async () => { throw Object.assign(new Error(),{code:'drive_permission_denied'}); };
  await assert.rejects(assertDriveFolder(drive,'target','root'),{code:'drive_folder_scope_unverified'});
});
