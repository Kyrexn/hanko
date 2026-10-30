// Troca única da marca "Cofre / 金庫" para "Hanko / 判子" (só textos visíveis e configurações).
// NÃO mexe nos identificadores internos da criptografia ('cofre', 'cofre-login|', 'cofre-backup'),
// senão contas e cofres existentes deixariam de abrir.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const edits = {
  'index.html': [['<title>Cofre</title>', '<title>Hanko</title>']],
  'extension/popup.html': [['<title>Cofre</title>', '<title>Hanko</title>']],
  'extension/manifest.json': [['"name": "Cofre"', '"name": "Hanko"'], ['"short_name": "Cofre"', '"short_name": "Hanko"'], ['"default_title": "Cofre"', '"default_title": "Hanko"'],
    ['Seu cofre de senhas e códigos 2FA', 'Hanko — suas senhas e códigos 2FA, selados']],
  'extension/src/content.ts': [['<span class="seal">金</span><span class="ttl">Cofre</span>', '<span class="seal">判</span><span class="ttl">Hanko</span>'],
    ["'Cofre · este site'", "'Hanko · este site'"], ["'Cofre bloqueado. <button type=\"button\">Abrir o Cofre</button>'", "'Hanko bloqueado. <button type=\"button\">Abrir o Hanko</button>'"]],
  'extension/src/popup.tsx': [['letterSpacing: 4 }}>金庫</span>', 'letterSpacing: 4 }}>判子</span>'], ["style={{ flex: 1 }}>cofre</span>", "style={{ flex: 1 }}>hanko</span>"]],
  'src/app/cloud.ts': [["friendlyName: 'Cofre'", "friendlyName: 'Hanko'"]],
  'src/app/vault.tsx': [['não é um backup do Cofre.', 'não é um backup do Hanko.']],
  'src/app/Dialogs.tsx': [["'金庫 COFRE — KIT DE EMERGÊNCIA'", "'判子 HANKO — KIT DE EMERGÊNCIA'"], ["'Cofre-Kit-de-Emergencia.txt'", "'Hanko-Kit-de-Emergencia.txt'"], ['não o próprio Cofre.', 'não o próprio Hanko.']],
  'src/app/Gate.tsx': [["'金庫 COFRE — KIT DE EMERGÊNCIA'", "'判子 HANKO — KIT DE EMERGÊNCIA'"], ["'Cofre-Kit-de-Emergencia.txt'", "'Hanko-Kit-de-Emergencia.txt'"],
    ['da conta Cofre.', 'da conta Hanko.'], ['title="Cofre só neste aparelho"', 'title="Hanko só neste aparelho"'],
    ['letterSpacing: 16, paddingLeft: 16 }}>金庫</span>', 'letterSpacing: 16, paddingLeft: 16 }}>判子</span>'], ['<span className="label">cofre pessoal</span>', '<span className="label">hanko · selado, só você abre</span>'],
    ['title="Seu cofre, em silêncio."', 'title="Selado. Só você abre."']],
  'src/app/VaultScreen.tsx': [["letterSpacing: 10 }}>金庫</span>", "letterSpacing: 10 }}>判子</span>"], ["letterSpacing: 4 }}>cofre</span>", "letterSpacing: 4 }}>hanko</span>"]],
  'src/app/MobileScreen.tsx': [["letterSpacing: 6 }}>金庫</span>", "letterSpacing: 6 }}>判子</span>"]],
  'src/app/UpdateBanner.tsx': [['aria-label="Atualizando o Cofre"', 'aria-label="Atualizando o Hanko"'], ['>Cofre {info.version}</span>', '>Hanko {info.version}</span>'], ['O Cofre vai fechar', 'O Hanko vai fechar']],
  'src/app/fx.tsx': [['<span className="word">金庫</span>', '<span className="word">Hanko</span>'], ['e 金庫 aparece em tinta', 'e o nome Hanko aparece em tinta']],
  'supabase/email-templates/confirmar-cadastro.html': [['letter-spacing:8px">金庫</div>', 'letter-spacing:8px">判子</div>'], ['COFRE PESSOAL', 'HANKO'], ['no app do Cofre', 'no app Hanko'], ['Seu código do Cofre', 'Seu código do Hanko']],
  'supabase/email-templates/recuperar-acesso.html': [['letter-spacing:8px">金庫</div>', 'letter-spacing:8px">判子</div>'], ['COFRE PESSOAL', 'HANKO'], ['Recuperar o Cofre', 'Recuperar o Hanko']],
  'src-tauri/tauri.conf.json': [['"productName": "Cofre"', '"productName": "Hanko"'], ['"identifier": "com.julio.cofre"', '"identifier": "com.julio.hanko"'], ['"title": "Cofre"', '"title": "Hanko"'],
    ['"publisher": "Cofre"', '"publisher": "Hanko"'], ['© 2026 Julio — Cofre', '© 2026 Julio — Hanko'], ['"shortDescription": "Cofre de senhas com 2FA"', '"shortDescription": "Hanko — senhas e 2FA, selados"']],
  'installer/tauri.conf.json': [['"productName": "Cofre Setup"', '"productName": "Hanko Setup"'], ['"identifier": "com.julio.cofre.setup"', '"identifier": "com.julio.hanko.setup"']],
  'installer/Cargo.toml': [['name = "cofre-setup"', 'name = "hanko-setup"'], ['description = "Instalador do Cofre"', 'description = "Instalador do Hanko"']],
  'installer/build.rs': [['COFRE_PAYLOAD', 'HANKO_PAYLOAD'], ['COFRE_PAYLOAD', 'HANKO_PAYLOAD'], ['COFRE_VERSION', 'HANKO_VERSION']],
  'installer/ui/build.mjs': [["'金庫済新別心を静めて鍵を守る一二三四'", "'判子金庫済新別心を静めて鍵を守る一二三四'"]],
  'tools/release.mjs': [['`Cofre-${version}-Setup.exe`', '`Hanko-${version}-Setup.exe`'], ['`Cofre-${version}-Setup.exe.sig`', '`Hanko-${version}-Setup.exe.sig`'],
    ['`Cofre-${version}-android.apk`', '`Hanko-${version}-android.apk`'], ['`Cofre-${version}-extensao-chrome.zip`', '`Hanko-${version}-extensao-chrome.zip`'],
    ['`windows/Cofre-${version}-Setup.exe`', '`windows/Hanko-${version}-Setup.exe`'], ['`android/Cofre-${version}.apk`', '`android/Hanko-${version}.apk`'],
    ['`extension/Cofre-extensao-${version}.zip`', '`extension/Hanko-extensao-${version}.zip`'], ['金庫  Publicar', '判子  Publicar'], ['notes || `Cofre ${version}`', 'notes || `Hanko ${version}`']],
  'README.md': [['# 金庫 Cofre', '# 判子 Hanko']]
};

let total = 0, miss = [];
for (const [file, list] of Object.entries(edits)) {
  const p = join(root, file);
  let t = readFileSync(p, 'utf8');
  for (const [a, b] of list) {
    if (!t.includes(a)) { miss.push(`${file}: ${a}`); continue; }
    t = t.split(a).join(b);
    total++;
  }
  writeFileSync(p, t);
}
console.log(`${total} trocas.`);
if (miss.length) console.log('Não encontrados:\n' + miss.join('\n'));
