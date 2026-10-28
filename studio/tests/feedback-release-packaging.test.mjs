import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';

const source = fileURLToPath(new URL('../../', import.meta.url));

async function fixture(t) {
 const root = await mkdtemp(path.join(tmpdir(), 'feedback-release-packaging-'));
 t.after(() => rm(root, {recursive:true, force:true}));
 for (const dir of ['studio/server','studio/tools','studio/web','scripts','certs']) {
  await mkdir(path.dirname(path.join(root,dir)), {recursive:true});
  await cp(path.join(source,dir),path.join(root,dir),{recursive:true});
 }
 for (const file of ['package.json','package-lock.json','ecosystem.config.cjs']) await cp(path.join(source,file),path.join(root,file));
 if (process.platform === 'darwin') {
  const metadata = spawnSync('/usr/bin/xattr',['-w','com.codex.release-fixture','SYNTHETIC-PRIVATE-FILE-METADATA',path.join(root,'package.json')],{encoding:'utf8'});
  assert.equal(metadata.status,0,metadata.stderr);
 }
 // This test exercises packaging, not the separate syntax suite. The fixture
 // avoids dependencies and any real deployment, secret or remote access.
 await mkdir(path.join(root,'studio/tests'),{recursive:true});
 await writeFile(path.join(root,'studio/tests/check-syntax.mjs'),'// Syntax suite is tested separately.\n');
 await writeFile(path.join(root,'.env'),'FAKE_SECRET=must-not-be-packaged\n');
 await mkdir(path.join(root,'data'));
 await writeFile(path.join(root,'data','private.txt'),'synthetic private data');
 const bin=path.join(root,'fake-bin'),capture=path.join(root,'capture');
 await mkdir(bin);await mkdir(capture);
 const script = `#!${process.execPath}\nimport fs from 'node:fs';import path from 'node:path';
const command=path.basename(process.argv[1]);
if(command==='ssh') {let data='';for await(const chunk of process.stdin)data+=chunk;fs.appendFileSync(process.env.CAPTURE+'/ssh.txt',data+'\\n');}
if(command==='scp') for(const file of process.argv.slice(2,-1)) fs.copyFileSync(file,process.env.CAPTURE+'/'+path.basename(file));\n`;
 // Both transport commands are local no-op fixtures. Remote scripts are saved
 // as text and never executed; npm ci and remote tar are not invoked.
 await writeFile(path.join(bin,'package.json'),'{"type":"module"}');
 for(const command of ['ssh','scp'])await writeFile(path.join(bin,command),script,{mode:0o700});
 const run=args=>spawnSync(process.execPath,[path.join(root,'scripts/deploy-vps.mjs'),...args],{
  cwd:root,encoding:'utf8',timeout:30000,
  env:{PATH:bin+':/usr/bin:/bin',CAPTURE:capture,VPS_HOST:'fixture.invalid'},
 });
 return {root,capture,run};
}

test('release package includes feedback runtime/ops/assets and excludes private data',async t=>{
 const {capture,run}=await fixture(t),result=run(['--stage']);
 assert.equal(result.status,0,result.stderr+result.stdout);
 const manifest=JSON.parse(await readFile(path.join(capture,'release-manifest.json'),'utf8'));
 const required=['studio/server/feedback-schema.mjs','studio/server/feedback.mjs',
  'studio/server/feedback-notifications.mjs','studio/server/private-feedback-shell.mjs',
  'studio/server/handover-privacy.mjs','studio/tools/feedback-ops.mjs','studio/tools/media-backup.mjs',
  'studio/web/feedback-page.mjs','studio/web/feedback.css','studio/web/feedback-admin.mjs','studio/web/feedback-admin.css'];
 for(const file of required)assert.ok(manifest.files.includes(file),file);
 assert.equal(manifest.activated,false);
 assert.ok(manifest.files.every(file=>!file.startsWith('data/')&&!file.startsWith('.')&&!file.startsWith('docs/')));
 const archived=spawnSync('/usr/bin/tar',['-tzf',path.join(capture,'source.tar.gz')],{encoding:'utf8'});
 assert.equal(archived.status,0,archived.stderr);
 assert.deepEqual(archived.stdout.trim().split('\n').sort(),manifest.files);
 assert.ok(!gunzipSync(await readFile(path.join(capture,'source.tar.gz'))).includes(Buffer.from('SYNTHETIC-PRIVATE-FILE-METADATA')));
 const remote=await readFile(path.join(capture,'ssh.txt'),'utf8');
 assert.ok(remote.includes('npm ci --omit=dev'));
 assert.ok(!remote.includes('pm2 restart'));
});

test('release script refuses unattended activation before transport',async t=>{
 const {run,capture}=await fixture(t),result=run([]);
 assert.equal(result.status,2);
 assert.match(result.stderr,/Explicit staging is required/);
 await assert.rejects(readFile(path.join(capture,'ssh.txt')), {code:'ENOENT'});
});

test('release allowlist rejects a linked feedback source before transport',async t=>{
 const {root,run,capture}=await fixture(t);
 await symlink(path.join(root,'.env'),path.join(root,'studio/server/feedback-secret.mjs'));
 const result=run(['--stage']);
 assert.equal(result.status,1);
 assert.match(result.stderr,/hidden, linked or invalid entry/);
 await assert.rejects(readFile(path.join(capture,'ssh.txt')), {code:'ENOENT'});
});
