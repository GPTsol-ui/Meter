import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(resolve(root, path), 'utf8');
const [html, css, engine, app] = await Promise.all(['index.html', 'src/style.css', 'src/engine.js', 'src/app.js'].map(read));
// All source is first-party and controlled; imports are bundled into one offline HTML file.
const script = `${engine.replace(/^export /gm, '')}\n${app.replace(/^import .*?;\s*/m, '')}`;
if (/<\/script/i.test(script) || /<\/style/i.test(css)) throw new Error('Unsafe inline closing tag in source.');
const output = html.replace('<link rel="stylesheet" href="./src/style.css">', () => `<style>${css}</style>`)
  .replace('<script type="module" src="./src/app.js"></script>', () => `<script>\n(() => {\n'use strict';\n${script}\n})();\n</script>`);
await mkdir(resolve(root, 'dist'), { recursive: true });
await writeFile(resolve(root, 'dist/index.html'), output);
console.log(`Built dist/index.html (${Buffer.byteLength(output).toLocaleString()} bytes). No dependencies or external assets.`);
