// Troca o número da versão em todos os lugares: npm run versao 0.3.0
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) {
  console.error('Use: npm run versao 0.3.0');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['package.json', 'src-tauri/tauri.conf.json', 'extension/manifest.json']) {
  const p = join(root, f);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const old = j.version;
  j.version = v;
  writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log(`${f}: ${old} → ${v}`);
}
console.log('Agora gere os instaladores (tools/build-all.ps1) e publique (npm run publicar "o que mudou").');
