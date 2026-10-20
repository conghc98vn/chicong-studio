import {assertDriveFolder,driveError,driveId,DRIVE_FOLDER} from './drive-client.mjs';

export function driveFolderScope(connection) {
  const scope = connection.folder_scope ?? 'root';
  if (!['root','shared'].includes(scope)) throw driveError('drive_invalid_folder_scope',422);
  return scope;
}
export async function assertConnectionFolder(drive,folderId,connection,options={}) {
  driveId(folderId);
  if (drive.serviceAccountEmail !== connection.service_account_email) throw driveError('drive_identity_mismatch',503);
  return assertDriveFolder(drive,folderId,driveFolderScope(connection) === 'shared' ? folderId : driveId(connection.root_folder_id),options);
}
export function drivePageToken(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) throw driveError('drive_invalid_page_token',422);
  return value;
}
export async function browseConnectionFolders(drive,folderId,connection,{pageToken,signal}={}) {
  pageToken = drivePageToken(pageToken);
  const validated = await assertConnectionFolder(drive,folderId,connection,{signal});
  const folder = driveFolderScope(connection) === 'shared' ? validated : await drive.getFile(folderId,{signal});
  if (folder.id !== folderId || folder.trashed || folder.mimeType !== DRIVE_FOLDER || folder.driveId || typeof folder.name !== 'string') throw driveError('drive_folder_unavailable');
  const page = await drive.listFiles(folderId,{pageToken,signal,foldersOnly:true,pageSize:100});
  if (page.incompleteSearch || !Array.isArray(page.files) || page.files.length > 100) throw driveError('drive_inventory_incomplete',503);
  let nextPageToken;
  try { nextPageToken = drivePageToken(page.nextPageToken); }
  catch { throw driveError('drive_invalid_pagination',503); }
  if (nextPageToken && nextPageToken === pageToken) throw driveError('drive_pagination_cycle',503);
  const ids = new Set();
  const folders = page.files.map(file => {
    if (!file || file.mimeType !== DRIVE_FOLDER || file.trashed || file.driveId || typeof file.name !== 'string' || file.parents?.length && !file.parents.includes(folderId)) throw driveError('drive_inventory_incomplete',503);
    try { driveId(file.id); } catch { throw driveError('drive_inventory_incomplete',503); }
    if (ids.has(file.id)) throw driveError('drive_inventory_incomplete',503);
    ids.add(file.id);
    return {id:file.id,name:file.name};
  });
  await assertConnectionFolder(drive,folderId,connection,{signal});
  return {folder:{id:folder.id,name:folder.name},folders,nextPageToken:nextPageToken || null,scope:driveFolderScope(connection)};
}
