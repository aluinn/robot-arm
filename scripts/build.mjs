// The app has no bundler. "Build" copies the static site into dist/ and verifies it:
// every relative import and stylesheet/script reference must resolve inside dist/.
import { cp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await cp(join(root, 'index.html'), join(dist, 'index.html'));
await cp(join(root, 'css'), join(dist, 'css'), { recursive: true });
await cp(join(root, 'src'), join(dist, 'src'), { recursive: true });
await cp(join(root, 'docs', 'assets'), join(dist, 'docs', 'assets'), { recursive: true });

const exists = (p) => stat(p).then(() => true, () => false);
const problems = [];

async function checkFile(file, text, re) {
  for (const m of text.matchAll(re)) {
    const target = resolve(dirname(file), m[1]);
    if (!(await exists(target))) problems.push(`${file.replace(dist, 'dist')}: missing ${m[1]}`);
  }
}

const html = await readFile(join(dist, 'index.html'), 'utf8');
await checkFile(join(dist, 'index.html'), html, /(?:href|src)="(?!https?:|data:)([^"]+)"/g);
if (!html.includes('"three"') || !html.includes('"cannon-es"')) problems.push('index.html: import map for three / cannon-es not found');

for (const f of await readdir(join(dist, 'src'))) {
  const text = await readFile(join(dist, 'src', f), 'utf8');
  await checkFile(join(dist, 'src', f), text, /from '(\.[^']+)'/g);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('Built dist/ and verified all relative references.');
