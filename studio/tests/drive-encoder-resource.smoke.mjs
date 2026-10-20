// Isolated full-resolution encoder resource rehearsal. No network, database,
// credentials, original studio photos or permanent media storage is involved.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile, writeFile, mkdir, stat, readdir} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import sharp from 'sharp';
import {driveImagePolicy, encodeDrivePhoto} from '../server/drive-image-encoder.mjs';

const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const checksum = async file => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const input = args.includes('--input') ? path.resolve(value('--input')) : null;
const output = args.includes('--output') ? path.resolve(value('--output')) : null;
assert.ok(input && output, 'Usage: --input synthetic.jpg --output report-directory [--generate]');
await mkdir(output, {recursive: true, mode: 0o700});
if (args.includes('--generate')) {
  sharp.concurrency(1);
  sharp.cache(false);
  await sharp(randomBytes(6500 * 6500 * 3), {raw: {width: 6500, height: 6500, channels: 3}})
    .jpeg({quality: 80, chromaSubsampling: '4:4:4'}).toFile(input);
  console.log(JSON.stringify({generated: true, width: 6500, height: 6500, bytes: (await stat(input)).size}));
  process.exit(0);
}

const scratch = path.join(output, 'encoder-temp');
await mkdir(scratch, {mode: 0o700});
process.env.TMPDIR = scratch;
const started = performance.now();
const report = {
  started_at: new Date().toISOString(), state: 'running', node: process.version,
  sharp: sharp.versions, policy: driveImagePolicy({}), iterations: [],
  memory: {scope: 'Whole cgroup, including parent, child encoder and filesystem cache', samples: 0, sampled_peak_bytes: 0},
  limitations: ['One generated high-entropy JPEG repeated twice; not a real studio photo sample.',
    'No Drive network, database or permanent storage publication is measured.',
    'This does not certify maximum 120 MP sources, a 500/5000-photo workload, or concurrent web/backup memory.']
};
let cgroup;
try {
  const entry = (await readFile('/proc/self/cgroup', 'utf8')).split('\n').find(line => line.startsWith('0::'));
  cgroup = entry ? path.join('/sys/fs/cgroup', entry.slice(3)) : null;
  report.cgroup = cgroup;
} catch {}
const sample = async () => {
  if (!cgroup) return;
  try {
    const bytes = Number((await readFile(path.join(cgroup, 'memory.current'), 'utf8')).trim());
    report.memory.samples++;
    report.memory.sampled_peak_bytes = Math.max(report.memory.sampled_peak_bytes, bytes);
  } catch {}
};
let sampling = false;
const timer = setInterval(async () => {
  if (sampling) return;
  sampling = true;
  try { await sample(); } finally { sampling = false; }
}, 100);
timer.unref();
try {
  const metadata = await sharp(input).metadata();
  const bytes = (await stat(input)).size;
  const sha256 = await checksum(input);
  report.source = {format: metadata.format, width: metadata.width, height: metadata.height, bytes, sha256};
  assert.equal(metadata.format, 'jpeg');
  assert.ok(metadata.width * metadata.height > 40000000, 'Fixture must exceed the old pixel limit');
  assert.ok(bytes > 20 * 1024 * 1024, 'Fixture must exceed the old upload size limit');
  for (let index = 0; index < 2; index++) {
    const before = performance.now();
    const encoded = await encodeDrivePhoto(input, {policy: report.policy});
    assert.equal(encoded.optimization.source_bytes, bytes);
    const formats = {};
    for (const name of ['data', 'thumbnail', 'download']) {
      const meta = await sharp(encoded[name]).metadata();
      formats[name] = {format: meta.format, width: meta.width, height: meta.height, bytes: encoded[name].length};
      assert.ok(Math.max(meta.width, meta.height) <= (name === 'thumbnail' ? 900 : 2400));
      assert.equal(meta.format, name === 'download' ? 'jpeg' : 'webp');
    }
    assert.equal((await readdir(scratch)).length, 0, 'Child scratch must be removed after encoding');
    const iteration = {index: index + 1, elapsed_ms: Math.round(performance.now() - before), outputs: formats};
    report.iterations.push(iteration);
    await sample();
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
    console.log(JSON.stringify({event: 'encoded', ...iteration}));
  }
  assert.equal(await checksum(input), sha256);
  report.state = 'passed';
} catch (error) {
  report.state = 'failed';
  report.error = {code: error.code || 'ASSERTION_OR_RUNTIME_FAILURE', message: error.message};
  process.exitCode = 1;
} finally {
  clearInterval(timer);
  await sample();
  if (cgroup) {
    for (const name of ['memory.peak', 'memory.max', 'memory.events', 'memory.swap.current', 'cpu.max', 'cpu.stat']) {
      try { report.memory[name] = (await readFile(path.join(cgroup, name), 'utf8')).trim(); } catch {}
    }
  }
  report.parent_max_rss_bytes = process.resourceUsage().maxRSS * 1024;
  report.elapsed_ms = Math.round(performance.now() - started);
  report.completed_at = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
  console.log(JSON.stringify({event: 'finished', state: report.state, elapsed_ms: report.elapsed_ms, memory: report.memory, error: report.error}));
}
