import {mkdir,mkdtemp,readdir,readFile,writeFile,stat,statfs,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {driveError} from './drive-client.mjs';

// Original JPEG bytes never enter permanent storage. An owner marker lets a
// restarted local worker remove its own product's files only after proving that
// the process on this host has stopped; foreign/live/ambiguous owners are kept.
export function createDriveTemporary({root,maxBytes,processId}) {
  let prepared;
  async function prepare() {
    await mkdir(root,{recursive:true,mode:0o700});
    const entries = await readdir(root,{withFileTypes:true});
    for (const entry of entries.slice(0,10000)) {
      if (!entry.isDirectory() || !/^attempt-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
      const directory = path.join(root,entry.name);
      const marker = path.join(directory,'.owner.json');
      let owner;
      try {
        const metadata = await stat(marker);
        if (metadata.size > 2048 || metadata.mtimeMs > Date.now()-3600000) continue;
        owner = JSON.parse(await readFile(marker,'utf8'));
      } catch { continue; }
      if (owner.kind !== 'chicong-drive-source' || owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.pid === process.pid) continue;
      let stopped = false;
      try { process.kill(owner.pid,0); }
      catch (error) { stopped = error.code === 'ESRCH'; }
      if (stopped) await rm(directory,{recursive:true,force:true});
    }
  }
  return async callback => {
    prepared ||= prepare();
    await prepared;
    const space = await statfs(root);
    if (Number(space.bavail)*Number(space.bsize) < maxBytes*2+128*1024*1024) throw driveError('drive_temp_disk_full',503);
    const directory = await mkdtemp(path.join(root,'attempt-'));
    try {
      await writeFile(path.join(directory,'.owner.json'),JSON.stringify({kind:'chicong-drive-source',pid:process.pid,host:os.hostname(),processId}),{flag:'wx',mode:0o600});
      return await callback(path.join(directory,'source'));
    } finally {
      await rm(directory,{recursive:true,force:true});
    }
  };
}
