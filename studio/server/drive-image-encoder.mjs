import {fork} from 'node:child_process';
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir, hostname} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const finite = (value, fallback, maximum, name) => {
  const number = value == null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) throw Error('Invalid ' + name);
  return number;
};
// Finite bootstrap policy. Representative production files still need measurement.
export function driveImagePolicy(env = process.env) {
  return Object.freeze({
    maxBytes: finite(env.DRIVE_SYNC_MAX_SOURCE_BYTES, 128 * 1024 * 1024, 512 * 1024 * 1024, 'DRIVE_SYNC_MAX_SOURCE_BYTES'),
    maxPixels: finite(env.DRIVE_SYNC_MAX_SOURCE_PIXELS, 120000000, 300000000, 'DRIVE_SYNC_MAX_SOURCE_PIXELS'),
    timeoutMs: finite(env.DRIVE_SYNC_ENCODE_TIMEOUT_MS, 120000, 600000, 'DRIVE_SYNC_ENCODE_TIMEOUT_MS')
  });
}

export async function encodeDrivePhoto(inputPath, {policy = driveImagePolicy(), signal} = {}) {
  policy = driveImagePolicy({DRIVE_SYNC_MAX_SOURCE_BYTES: policy.maxBytes, DRIVE_SYNC_MAX_SOURCE_PIXELS: policy.maxPixels, DRIVE_SYNC_ENCODE_TIMEOUT_MS: policy.timeoutMs});
  signal?.throwIfAborted();
  const source = await stat(inputPath);
  if (!source.isFile() || !source.size || source.size > policy.maxBytes) {
    throw Object.assign(Error('Ảnh Drive rỗng hoặc vượt giới hạn dung lượng đã cấu hình.'), {code: 'FILE_TOO_LARGE', retryable: false});
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'chicong-encode-'));
  let child;
  try {
    const optimization = await new Promise((resolve, reject) => {
      child = fork(fileURLToPath(new URL('./drive-image-child.mjs', import.meta.url)), [], {
        execArgv: ['--max-old-space-size=256'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        // Credentials are never inherited by the image decoder.
        env: {PATH: process.env.PATH || '', TMPDIR: directory}
      });
      let result;
      let failure;
      const stop = () => {
        failure ||= signal?.reason || Object.assign(Error('Image encoding cancelled'), {code: 'ENCODER_CANCELLED'});
        child.kill('SIGKILL');
      };
      const timeout = setTimeout(() => {
        failure = Object.assign(Error('Ảnh mất quá lâu để xử lý.'), {code: 'ENCODER_TIMEOUT', retryable: false});
        child.kill('SIGKILL');
      }, policy.timeoutMs);
      timeout.unref();
      signal?.addEventListener('abort', stop, {once: true});
      child.once('error', error => { failure = error; });
      child.once('message', message => {
        if (message.ok) result = message.optimization;
        else failure = Object.assign(Error(message.message), {code: message.code, retryable: message.retryable});
      });
      child.once('close', code => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', stop);
        if (failure) reject(failure);
        else if (code !== 0 || !result) reject(Object.assign(Error('Image encoder stopped before completion'), {code: 'ENCODER_FAILED'}));
        else resolve(result);
      });
      if (signal?.aborted) stop();
      else child.send({inputPath: path.resolve(inputPath), directory, policy});
    });
    signal?.throwIfAborted();
    const result = {optimization};
    for (const name of ['data', 'thumbnail', 'download']) {
      const file = path.join(directory, name);
      if ((await stat(file)).size > 40 * 1024 * 1024) throw Error('Encoded rendition exceeds bounded output size');
      result[name] = await readFile(file, {signal});
    }
    return result;
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}


export async function cleanupEncoderTemps({root = tmpdir(), minimumAgeMs = 3600000} = {}) {
  if (!Number.isFinite(minimumAgeMs) || minimumAgeMs < 3600000) throw Error('Encoder cleanup requires at least one hour grace');
  const dead = pid => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return false; }
    catch (error) { return error.code === 'ESRCH'; }
  };
  let removed = 0;
  for (const entry of await readdir(root, {withFileTypes: true})) {
    if (!entry.isDirectory() || !entry.name.startsWith('chicong-encode-')) continue;
    const directory = path.join(root, entry.name);
    let owner;
    try { owner = JSON.parse(await readFile(path.join(directory, 'owner.json'), 'utf8')); }
    catch { continue; }
    if (owner.hostname !== hostname() || !Number.isFinite(owner.created) || Date.now() - owner.created < minimumAgeMs) continue;
    if (!dead(owner.parentPid) || !dead(owner.childPid)) continue;
    await rm(directory, {recursive: true, force: true});
    removed++;
  }
  return {removed};
}
