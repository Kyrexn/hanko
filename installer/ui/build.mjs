// Monta a interface do instalador em installer/ui-dist (leve: só os pedaços de fonte necessários).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, '..', 'ui-dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

await build({ entryPoints: [join(here, 'main.ts')], bundle: true, minify: true, format: 'esm', target: 'chrome110', outfile: join(out, 'main.js'), logLevel: 'warning' });
copyFileSync(join(here, 'index.html'), join(out, 'index.html'));
copyFileSync(join(here, 'main.css'), join(out, 'main.css'));

// Caracteres que aparecem no instalador (pincel) + latim.
const used = new Set([...'判子金庫済新別心を静めて鍵を守る一二三四'].map(c => c.codePointAt(0)));
const latin = [0x20, 0x7e];

function inRange(range, cp) {
  return range.split(',').some(part => {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-').map(x => parseInt(x, 16));
    return cp >= a && cp <= (b ?? a);
  });
}

let css = '';
for (const [pkg, file, family, weight] of [
  ['yuji-boku', '400.css', 'Yuji Boku', 400],
  ['zen-kaku-gothic-new', '400.css', 'Zen Kaku Gothic New', 400],
  ['zen-kaku-gothic-new', '500.css', 'Zen Kaku Gothic New', 500],
  ['dm-mono', '400.css', 'DM Mono', 400]
]) {
  const dir = join(root, 'node_modules', '@fontsource', pkg);
  const src = readFileSync(join(dir, file), 'utf8');
  for (const block of src.split('@font-face').slice(1)) {
    const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1] || '';
    const woff2 = (block.match(/url\(\.\/files\/([^)]+\.woff2)\)/) || [])[1];
    if (!woff2) continue;
    const wanted = !range || inRange(range, latin[0]) || [...used].some(cp => inRange(range, cp));
    if (!wanted) continue;
    copyFileSync(join(dir, 'files', woff2), join(out, 'fonts', woff2));
    css += `@font-face{font-family:'${family}';font-weight:${weight};font-display:swap;src:url(fonts/${woff2}) format('woff2');${range ? `unicode-range:${range};` : ''}}\n`;
  }
}
writeFileSync(join(out, 'fonts.css'), css);
console.log('Interface do instalador pronta em', out);
