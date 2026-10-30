// Publica a versão atual para atualização automática: npm run publicar "o que mudou nesta versão"
// Envia para a área pública "updates" do Supabase:
//   latest.json  → atualizador do Windows (com a assinatura do instalador)
//   mobile.json  → aviso de versão do Android e da extensão
// Pede o e-mail e a senha mestra da sua conta (só contas autorizadas podem publicar).
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { deriveAuthSecret } from '../src/core/crypto.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const notes = process.argv.slice(2).join(' ').trim();
const version = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version;

const env = Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .map(l => l.match(/^\s*(VITE_[A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(m => [m[1], m[2]]));
const URL = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const PUBLIC = `${URL}/storage/v1/object/public/updates`;

const out = join(root, 'Instaladores');
const files = {
  windows: join(out, `Hanko-${version}-Setup.exe`),
  windowsSig: join(out, `Hanko-${version}-Setup.exe.sig`),
  android: join(out, `Hanko-${version}-android.apk`),
  extension: join(out, `Hanko-${version}-extensao-chrome.zip`)
};
for (const [k, f] of Object.entries(files)) {
  if (!existsSync(f)) { console.error(`Falta o arquivo de ${k}: ${f}\nRode antes: tools/build-all.ps1`); process.exit(1); }
}

function ask(question, hidden = false) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, a => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

console.log(`\n判子  Publicar a versão ${version}${notes ? ` — "${notes}"` : ''}\n`);
const email = (await ask('E-mail da conta: ')).toLowerCase();
const password = await ask('Senha mestra (não aparece): ', true);

const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: loginErr } = await sb.auth.signInWithPassword({ email, password: await deriveAuthSecret(password, email) });
if (loginErr) { console.error('Não consegui entrar:', loginErr.message); process.exit(1); }

async function put(path, body, contentType, cache) {
  const { error } = await sb.storage.from('updates').upload(path, body, { upsert: true, contentType, cacheControl: cache });
  if (error) {
    if (/row-level security|unauthorized|403/i.test(error.message)) {
      console.error('\nSua conta ainda não está autorizada a publicar. Autorize este e-mail em private.publishers (veja supabase/schema.sql).');
    }
    throw new Error(`${path}: ${error.message}`);
  }
  console.log(`  ✓ ${path}`);
}

const winName = `windows/Hanko-${version}-Setup.exe`;
const apkName = `android/Hanko-${version}.apk`;
const extName = `extension/Hanko-extensao-${version}.zip`;
const year = '31536000';

console.log('\nEnviando…');
await put(winName, readFileSync(files.windows), 'application/octet-stream', year);
await put(apkName, readFileSync(files.android), 'application/vnd.android.package-archive', year);
await put(extName, readFileSync(files.extension), 'application/zip', year);

// Manifestos por último: só anunciam a versão depois que os arquivos já estão lá.
const latest = {
  version,
  notes: notes || `Hanko ${version}`,
  pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature: readFileSync(files.windowsSig, 'utf8').trim(), url: `${PUBLIC}/${winName}` } }
};
const mobile = {
  android: { version, url: `${PUBLIC}/${apkName}`, notes },
  extension: { version, url: `${PUBLIC}/${extName}`, notes }
};
await put('latest.json', JSON.stringify(latest, null, 2), 'application/json', '60');
await put('mobile.json', JSON.stringify(mobile, null, 2), 'application/json', '60');

// Mantém só a versão atual de cada instalador (o plano grátis tem 1 GB).
for (const [folder, keep] of [['windows', winName], ['android', apkName], ['extension', extName]]) {
  const { data } = await sb.storage.from('updates').list(folder);
  const old = (data || []).map(f => `${folder}/${f.name}`).filter(p => p !== keep);
  if (old.length) { await sb.storage.from('updates').remove(old); old.forEach(p => console.log(`  − ${p} (antiga)`)); }
}

await sb.auth.signOut();
console.log(`\nPronto! A versão ${version} já aparece como atualização no Windows, no Android e na extensão.\n`);
