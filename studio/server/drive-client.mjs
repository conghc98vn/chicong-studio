import {stat,readFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {fetchDriveThumbnail} from './drive-folder-preview.mjs';

export const DRIVE_FIELDS = 'id,name,mimeType,size,version,md5Checksum,modifiedTime,parents,trashed,driveId,capabilities(canDownload)';
export const DRIVE_FOLDER = 'application/vnd.google-apps.folder';
export const driveError = (code,status=409,extra={}) => Object.assign(new Error(code),{code,status,...extra});
export function driveId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,200}$/.test(value)) {
    throw driveError('drive_invalid_id',422);
  }
  return value;
}
export function safeDriveError(error) {
  if (typeof error?.code === 'string' && /^(drive_|media_|image_|ingest_|DRIVE_|MEDIA_|STORAGE_|ENCODER_|FILE_|IMAGE_)[a-zA-Z0-9_-]+$/.test(error.code)) return error.code.toLowerCase();
  return error?.name === 'AbortError' ? 'drive_canceled' : 'drive_operation_failed';
}
const retryAfter = value => {
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds*1000 : Date.parse(value)-Date.now();
  // Invalid upstream headers must use the queue's ordinary backoff. NaN would
  // make jobs.retry reject and leave the job running until its lease expires.
  return Number.isFinite(delay) ? Math.min(3600000,Math.max(1000,delay)) : undefined;
};

// The adapter never accepts a user-supplied download URL, refresh token, or OAuth client.
export async function createDriveClient(env=process.env,{fetchImpl=fetch,authClient}={}) {
  const keyFile = env.DRIVE_SYNC_SERVICE_ACCOUNT_FILE;
  if (!keyFile) throw driveError('drive_credentials_missing',503);
  let info;
  try { info = await stat(keyFile); }
  catch { throw driveError('drive_credentials_missing',503); }
  if (!info.isFile() || info.size > 65536 || (info.mode & 0o077)) {
    throw driveError('drive_credentials_file_permissions',503);
  }
  let credentials;
  try {
    credentials = JSON.parse(await readFile(keyFile,'utf8'));
  } catch {
    throw driveError('drive_credentials_invalid',503);
  }
  if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key || credentials.universe_domain && credentials.universe_domain !== 'googleapis.com') {
    throw driveError('drive_credentials_invalid',503);
  }
  const {GoogleAuth} = await import('google-auth-library');
  const auth = new GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/drive.readonly'],clientOptions:{transporterOptions:{timeout:30000}}});
  const client = authClient || await auth.getClient();
  const timeoutMs = Number(env.DRIVE_SYNC_REQUEST_TIMEOUT_MS || 120000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw driveError('drive_invalid_request_timeout',422);
  async function request(suffix,query,signal,refreshed=false) {
    const url = new URL('https://www.googleapis.com/drive/v3/'+suffix);
    for (const [key,value] of Object.entries(query || {})) {
      if (value !== undefined) url.searchParams.set(key,String(value));
    }
    signal?.throwIfAborted();
    let headers;
    try { headers = await client.getRequestHeaders(url.href); }
    catch { throw driveError('drive_auth_failed',503); }
    const timeout = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal,timeout]) : timeout;
    let response;
    try { response = await fetchImpl(url,{headers,signal:requestSignal,redirect:'error'}); }
    catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw driveError(timeout.aborted ? 'drive_request_timeout' : 'drive_network_failed',503,{retryable:true});
    }
    if (!response.ok) {
      if (response.status === 401 && !refreshed) {
        await response.body?.cancel();
        try { await client.refreshAccessToken(); }
        catch { throw driveError('drive_auth_failed',503); }
        return request(suffix,query,signal,true);
      }
      let reason;
      try {
        const body = await response.json();
        reason = body?.error?.errors?.[0]?.reason;
      } catch {}
      const quota = response.status === 429 || response.status === 403 && ['rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded'].includes(reason);
      throw driveError(quota ? 'drive_rate_limited' : response.status === 401 ? 'drive_auth_failed' : response.status === 404 ? 'drive_source_unavailable' : response.status === 403 ? 'drive_permission_denied' : 'drive_api_failed',503,{
        retryable:quota || response.status >= 500,
        retryAfterMs:retryAfter(response.headers.get('retry-after')),
      });
    }
    return response;
  }
  return {
    serviceAccountEmail:credentials.client_email,
    async getFile(fileId,{signal}={}) {
      return (await request('files/'+driveId(fileId),{fields:DRIVE_FIELDS},signal)).json();
    },
    async listFiles(folderId,{pageToken,signal,name,foldersOnly=false,pageSize=1000}={}) {
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw driveError('drive_invalid_page_size',422);
      if (name !== undefined && (typeof name !== 'string' || name.length > 2048)) throw driveError('drive_invalid_name',422);
      const nameFilter = name === undefined ? '' : " and name = '"+name.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'";
      return (await request('files',{
        q:"'"+driveId(folderId)+"' in parents and trashed = false"+nameFilter+(foldersOnly ? " and mimeType = '"+DRIVE_FOLDER+"'" : ''),
        fields:'nextPageToken,incompleteSearch,files('+DRIVE_FIELDS+')',
        pageSize,
        pageToken,
        spaces:'drive',
      },signal)).json();
    },
    async listFolderOverview(folderId,{pageToken,signal}={}) {
      return (await request('files',{
        q:"'"+driveId(folderId)+"' in parents and trashed = false",
        fields:'nextPageToken,incompleteSearch,files(id,mimeType,parents,trashed,driveId)',
        pageSize:1000,pageToken,spaces:'drive',
      },signal)).json();
    },
    async listPreviewImages(folderId,{signal}={}) {
      return (await request('files',{
        q:"'"+driveId(folderId)+"' in parents and trashed = false and (mimeType = 'image/jpeg' or mimeType = 'image/png' or mimeType = 'image/webp')",
        fields:'incompleteSearch,files(id,name,mimeType,parents,trashed,driveId,thumbnailLink,capabilities(canDownload))',
        pageSize:6,spaces:'drive',
      },signal)).json();
    },
    async thumbnail(url,{signal}={}) {
      // Only Google-generated thumbnail URLs are accepted by the bounded reader.
      return fetchDriveThumbnail(url,{signal,fetchImpl,getHeaders:() => client.getRequestHeaders('https://www.googleapis.com/')});
    },
    async download(fileId,destination,{maxBytes,checksum,signal}={}) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 512*1024*1024) throw driveError('drive_invalid_download_limit',422);
      const response = await request('files/'+driveId(fileId),{alt:'media'},signal);
      let bytes = 0;
      const md5 = createHash('md5');
      const guard = new Transform({transform(chunk,encoding,done) {
        bytes += chunk.length;
        if (bytes > maxBytes) return done(driveError('drive_file_too_large',422));
        md5.update(chunk);
        done(null,chunk);
      }});
      try {
        await pipeline(Readable.fromWeb(response.body),guard,createWriteStream(destination,{flags:'wx',mode:0o600}),{signal});
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error.code === 'drive_file_too_large') throw error;
        throw driveError(error.code === 'ENOSPC' ? 'drive_temp_disk_full' : 'drive_download_failed',503,{retryable:error.code !== 'ENOSPC'});
      }
      const actual = md5.digest('hex');
      if (!bytes || checksum && actual !== checksum) throw driveError('drive_checksum_mismatch',422);
      return {bytes,checksum:actual};
    },
  };
}

// Some shared-folder reads omit parents in files.get. A parent-scoped list
// still proves membership; narrow by name but identify by id because duplicate
// filenames are allowed. Empty pages and duplicate names may require paging.
export async function findDriveChild(drive,folderId,file,{signal,maxFiles=20000,maxMs=600000}={}) {
  let pageToken;
  let count = 0;
  const tokens = new Set();
  const started = Date.now();
  do {
    signal?.throwIfAborted();
    if (Date.now()-started > maxMs) throw driveError('drive_inventory_time_limit',422);
    const page = await drive.listFiles(folderId,{name:file.name,pageToken,signal});
    if (page.incompleteSearch || !Array.isArray(page.files)) throw driveError('drive_inventory_incomplete',503);
    count += page.files.length;
    if (page.files.length > 1000 || count > maxFiles) throw driveError('drive_inventory_file_limit',422);
    const match = page.files.find(current => current?.id === file.id);
    if (match) return match;
    pageToken = page.nextPageToken;
    if (pageToken && tokens.has(pageToken)) throw driveError('drive_pagination_cycle',503);
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  return null;
}

// Missing parents are not evidence that a readable folder is outside the root.
// Search only folders, under a shared request/time/node budget; never inventory
// JPEGs to establish scope. Re-list every discovered edge before accepting it.
async function proveFolderScope(drive,folderId,rootId,{signal,maxDepth,maxFolders,maxPages,maxMs}) {
  const unavailable = reason => driveError('drive_folder_scope_unverified',503,{reason});
  if (typeof drive.listFiles !== 'function') throw unavailable('listing_unavailable');
  const timeout = AbortSignal.timeout(maxMs);
  const boundedSignal = signal ? AbortSignal.any([signal,timeout]) : timeout;
  const deadline = Date.now()+maxMs;
  let pages = 0;
  let folders = 0;
  const check = () => {
    signal?.throwIfAborted();
    if (timeout.aborted || Date.now() >= deadline) throw unavailable('time_limit');
  };
  const valid = file => file && file.mimeType === DRIVE_FOLDER && !file.trashed && !file.driveId;
  async function read(id) {
    check();
    const file = await drive.getFile(id,{signal:boundedSignal});
    check();
    if (!valid(file) || file.id !== id) throw unavailable('folder_changed');
    return file;
  }
  async function children(parent,matchId) {
    let pageToken;
    const tokens = new Set();
    const result = [];
    do {
      check();
      if (++pages > maxPages) throw unavailable('page_limit');
      const page = await drive.listFiles(parent,{pageToken,signal:boundedSignal,foldersOnly:true});
      check();
      if (page.incompleteSearch || !Array.isArray(page.files) || page.files.length > 1000) throw unavailable('incomplete_listing');
      for (const file of page.files) {
        if (++folders > maxFolders) throw unavailable('folder_limit');
        if (!valid(file) || typeof file.id !== 'string') throw unavailable('invalid_listing');
        // A parent-scoped response is the proof, even if its parents are omitted.
        if (file.parents?.length && !file.parents.includes(parent)) throw unavailable('folder_changed');
        if (file.id === matchId) return true;
        result.push(file.id);
      }
      pageToken = page.nextPageToken;
      if (pageToken && tokens.has(pageToken)) throw unavailable('pagination_cycle');
      if (pageToken) tokens.add(pageToken);
    } while (pageToken);
    return matchId ? false : result;
  }
  try {
    const queue = [[rootId]];
    const seen = new Set([rootId]);
    let found;
    for (let index=0; index<queue.length && !found; index++) {
      const path = queue[index];
      for (const id of await children(path.at(-1))) {
        if (seen.has(id)) throw unavailable('folder_cycle');
        seen.add(id);
        const next = [...path,id];
        if (next.length > maxDepth) throw unavailable('depth_limit');
        if (id === folderId) { found = next; break; }
        queue.push(next);
      }
    }
    if (!found) throw driveError('drive_folder_outside_root');
    // Validate from the leaf back to the root: a subtree moved out while the
    // traversal was running must not inherit authorization from its old path.
    for (let index=found.length-1; index>0; index--) {
      const file = await read(found[index]);
      if (file.parents?.length && (file.parents.length !== 1 || file.parents[0] !== found[index-1])) throw unavailable('folder_changed');
      if (!await children(found[index-1],found[index])) throw unavailable('folder_changed');
    }
    return await read(rootId);
  } catch (error) {
    signal?.throwIfAborted();
    if (timeout.aborted) throw unavailable('time_limit');
    if (['drive_source_unavailable','drive_permission_denied'].includes(error.code)) throw unavailable('inaccessible_ancestry');
    throw error;
  }
}

export async function assertDriveFolder(drive,folderId,rootId,{signal,maxDepth=100,maxFolders=2000,maxPages=200,maxMs=30000}={}) {
  const root = await drive.getFile(rootId,{signal});
  if (root.trashed || root.mimeType !== DRIVE_FOLDER || root.driveId) throw driveError('drive_root_unavailable');
  const visited = new Set();
  let currentId = folderId;
  for (let depth=0; depth<maxDepth; depth++) {
    if (visited.has(currentId)) throw driveError('drive_folder_cycle');
    visited.add(currentId);
    let current;
    try { current = currentId === rootId ? root : await drive.getFile(currentId,{signal}); }
    catch (error) {
      if (currentId === folderId || !['drive_source_unavailable','drive_permission_denied'].includes(error.code)) throw error;
      return proveFolderScope(drive,folderId,rootId,{signal,maxDepth,maxFolders,maxPages,maxMs});
    }
    if (current.trashed || current.mimeType !== DRIVE_FOLDER || current.driveId) throw driveError('drive_folder_unavailable');
    if (currentId === rootId) return current;
    if (!current.parents?.length) return proveFolderScope(drive,folderId,rootId,{signal,maxDepth,maxFolders,maxPages,maxMs});
    if (current.parents.length !== 1) throw driveError('drive_folder_scope_unverified',503);
    currentId = current.parents[0];
  }
  throw driveError('drive_folder_depth_limit');
}
