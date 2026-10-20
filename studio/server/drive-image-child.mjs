import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {hostname} from 'node:os';
import sharp from 'sharp';
import {optimizeDrivePhotoPath} from './image-optimizer.mjs';

let completed = false;
process.once('disconnect', () => {
  if (!completed) process.kill(process.pid, 'SIGKILL');
});
sharp.concurrency(1);
sharp.cache({memory: 32, files: 0, items: 16});
process.once('message', async ({inputPath, directory, policy}) => {
  try {
    await writeFile(path.join(directory, 'owner.json'), JSON.stringify({parentPid: process.ppid, childPid: process.pid, hostname: hostname(), created: Date.now()}), {mode: 0o600});
    const result = await optimizeDrivePhotoPath(inputPath, policy);
    for (const name of ['data', 'thumbnail', 'download']) {
      await writeFile(path.join(directory, name), result[name], {mode: 0o600});
    }
    process.send({ok: true, optimization: result.optimization}, () => { completed = true; process.disconnect(); });
  } catch (error) {
    process.send({ok: false, code: error.code || 'ENCODER_FAILED', message: error.message, retryable: error.retryable !== false}, () => { completed = true; process.disconnect(); });
  }
});
