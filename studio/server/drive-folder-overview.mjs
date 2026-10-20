import {driveError,driveId,DRIVE_FOLDER} from './drive-client.mjs';
import {drivePageToken} from './drive-folder-scope.mjs';

export const emptyFolderSummary = (status='loading') => ({status,images:null,folders:null,otherFiles:null,complete:false,scanned:0,updatedAt:null});

async function bounded(operation,signal) {
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
      abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
    })]);
  } finally { signal.removeEventListener('abort',abort); }
}

// These are observations of direct children, not a point-in-time snapshot of
// Drive. An interrupted or inconsistent traversal must never claim exact totals.
export async function collectFolderOverview(drive,folderId,{signal,maxItems=20000,maxPages=30,maxMs=12000}={}) {
  signal?.throwIfAborted();
  if(typeof drive.listFolderOverview!=='function') return emptyFolderSummary('unavailable');
  driveId(folderId);
  const deadline=AbortSignal.timeout(maxMs);
  const budget=signal ? AbortSignal.any([signal,deadline]) : deadline;
  const seen=new Set(),tokens=new Set();
  let images=0,folders=0,otherFiles=0,pageToken,consistent=true;
  const result=complete=>({status:complete?'ready':seen.size?'partial':'unavailable',images:seen.size||complete?images:null,folders:seen.size||complete?folders:null,otherFiles:seen.size||complete?otherFiles:null,complete,scanned:seen.size,updatedAt:Date.now()});
  try {
    for(let index=0;index<maxPages;index++) {
      const page=await bounded(()=>drive.listFolderOverview(folderId,{pageToken,signal:budget}),budget);
      if(!page || !Array.isArray(page.files) || page.files.length>1000) throw driveError('drive_inventory_incomplete');
      if(page.incompleteSearch) consistent=false;
      for(const file of page.files) {
        driveId(file?.id);
        if(typeof file.mimeType!=='string' || !file.mimeType || file.trashed || file.driveId ||
          file.parents!==undefined && (!Array.isArray(file.parents) || file.parents.length>1 || file.parents.length===1 && file.parents[0]!==folderId)) throw driveError('drive_inventory_incomplete');
        if(seen.has(file.id)) {consistent=false;continue;}
        if(seen.size>=maxItems) return result(false);
        seen.add(file.id);
        if(['image/jpeg','image/png','image/webp'].includes(file.mimeType)) images++;
        else if(file.mimeType===DRIVE_FOLDER) folders++;
        else otherFiles++;
      }
      pageToken=drivePageToken(page.nextPageToken);
      if(!pageToken) return result(consistent);
      if(tokens.has(pageToken)) throw driveError('drive_pagination_cycle');
      tokens.add(pageToken);
      if(seen.size>=maxItems || !consistent) return result(false);
    }
  } catch { signal?.throwIfAborted(); }
  return result(false);
}
