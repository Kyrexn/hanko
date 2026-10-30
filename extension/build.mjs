// Monta a extensão do Chrome em extension/dist (pronta para "Carregar sem compactação").
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'dist');

// Mesmo servidor do app (valores públicos de .env.local).
const env = {};
const envFile = join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(VITE_[A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
}
const define = {
  'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || ''),
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY || ''),
  'process.env.NODE_ENV': '"production"'
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'icons'), { recursive: true });

const common = { bundle: true, minify: true, target: 'chrome116', define, legalComments: 'none', logLevel: 'warning' };

await Promise.all([
  build({
    ...common,
    entryPoints: { popup: join(here, 'src/popup.tsx') },
    outdir: out,
    format: 'esm',
    splitting: true,
    jsx: 'automatic',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    // Só woff2 (o Chrome usa esse); o .woff antigo vira vazio para não pesar a extensão.
    loader: { '.woff2': 'file', '.woff': 'empty', '.svg': 'file' }
  }),
  build({ ...common, entryPoints: { background: join(here, 'src/background.ts') }, outdir: out, format: 'esm' }),
  build({ ...common, entryPoints: { content: join(here, 'src/content.ts') }, outdir: out, format: 'iife' }),
  build({ ...common, entryPoints: { offscreen: join(here, 'src/offscreen.ts') }, outdir: out, format: 'iife' })
]);

cpSync(join(here, 'manifest.json'), join(out, 'manifest.json'));
cpSync(join(here, 'popup.html'), join(out, 'popup.html'));
cpSync(join(here, 'offscreen.html'), join(out, 'offscreen.html'));
const icons = join(root, 'src-tauri/icons');
cpSync(join(icons, '32x32.png'), join(out, 'icons/32.png'));
cpSync(join(icons, '64x64.png'), join(out, 'icons/64.png'));
cpSync(join(icons, '128x128.png'), join(out, 'icons/128.png'));

console.log(`Extensão pronta em ${out}${env.VITE_SUPABASE_URL ? '' : ' (ATENÇÃO: sem servidor configurado)'}`);
