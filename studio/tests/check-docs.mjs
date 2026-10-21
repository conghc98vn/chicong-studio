import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function markdown(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdown(file));
    else if (entry.name.endsWith('.md')) files.push(file);
  }
  return files;
}
const files = [...['README.md', 'OPERATIONS.md', 'HOSTING.md'].map(file => path.join(root, file)), ...await markdown(path.join(root, 'docs'))];
const failures = [];
let links = 0;
for (const file of files) {
  const content = (await readFile(file, 'utf8')).replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, '');
  for (const match of content.matchAll(/\[[^\]\n]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
    const url = match[1] || match[2];
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(url)) continue;
    const local = decodeURIComponent(url.split(/[?#]/)[0]);
    if (!local) continue;
    links++;
    const target = path.resolve(path.dirname(file), local);
    try {await stat(target);}
    catch {failures.push(path.relative(root, file) + ': missing ' + url);}
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`${files.length} Markdown files, ${links} local links: all target files exist. External URLs and heading anchors are not checked.`);
