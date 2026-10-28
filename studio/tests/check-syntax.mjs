import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(directory) {
  return readdirSync(path.join(root, directory), {withFileTypes: true}).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(?:[cm]?js|sh|command)$/.test(entry.name) ? [file] : [];
  });
}

const files = [...sourceFiles('studio'), ...sourceFiles('scripts'), 'ecosystem.config.cjs'].sort();
for (const file of files) {
  const shell = /\.(?:sh|command)$/.test(file);
  // Syntax-only: never execute fixtures, CLI operations or deployment scripts.
  const check = spawnSync(shell ? 'bash' : process.execPath, [shell ? '-n' : '--check', path.join(root, file)], {stdio: 'inherit'});
  if (check.error) console.error(`${file}: ${check.error.message}`);
  if (check.status !== 0) process.exit(check.status || 1);
}
console.log(`${files.length} JavaScript/config/shell files: syntax verified (including tests and operational scripts).`);
