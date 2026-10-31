// Monta o site em site/dist: copia as páginas, gera Privacidade e Segurança a partir dos .md do repositório
// (o texto fica igual ao do GitHub) e leva só os pedaços de fonte que o site usa.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(here, 'src');
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

for (const f of readdirSync(src)) copyFileSync(join(src, f), join(out, f));
copyFileSync(join(root, 'public/icon.svg'), join(out, 'icon.svg'));

/* ---------- Markdown simples → HTML (títulos, parágrafos, listas, tabelas, negrito, código, links) ---------- */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s)
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u.replace(/^PRIVACIDADE\.md$/, 'privacidade.html').replace(/^SECURITY\.md$/, 'seguranca.html')}">${t}</a>`);

function markdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^# /.test(l)) { html.push(`<h1>${inline(l.slice(2))}</h1>`); i++; continue; }
    if (/^## /.test(l)) { html.push(`<h2>${inline(l.slice(3))}</h2>`); i++; continue; }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = r => r.split('|').slice(1, -1).map(c => c.trim());
      const [head, , ...body] = rows;
      html.push(`<table><thead><tr>${cells(head).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^- /.test(l)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      html.push(`<ul>${items.map(t => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||- )/.test(lines[i])) para.push(lines[i++]);
    html.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return html.join('\n');
}

const index = readFileSync(join(src, 'index.html'), 'utf8');
const head = index.slice(0, index.indexOf('<main'));
const tail = index.slice(index.indexOf('<footer'));
for (const [md, page, title] of [['PRIVACIDADE.md', 'privacidade.html', 'Privacidade'], ['SECURITY.md', 'seguranca.html', 'Segurança']]) {
  const body = markdown(readFileSync(join(root, md), 'utf8'));
  const html = head
    .replace(/<title>[^<]*<\/title>/, `<title>${title} — Hanko</title>`)
    .replace(/href="#(recursos|seguranca|baixar|perguntas|topo)"/g, 'href="index.html#$1"')
    + `<main class="doc"><span class="eyebrow">hanko · ${title.toLowerCase()}</span>\n${body}\n</main>\n` + tail;
  writeFileSync(join(out, page), html);
}

/* ---------- Fontes: alfabeto latino + só os ideogramas que aparecem no site ---------- */
const text = readdirSync(out).filter(f => /\.(html|js)$/.test(f)).map(f => readFileSync(join(out, f), 'utf8')).join('');
const used = new Set([...text].map(c => c.codePointAt(0)).filter(cp => cp > 0x2e7f));
const wanted = range => range.split(',').some(part => {
  const [a, b] = part.trim().replace(/^U\+/i, '').split('-').map(x => parseInt(x, 16));
  const hi = b ?? a;
  if (hi < 0x2e80) return a <= 0x24f; // latim, latim estendido (acentos) e pontuação
  for (const cp of used) if (cp >= a && cp <= hi) return true;
  return false;
});

let css = '';
for (const [pkg, file, family, weight] of [
  ['shippori-mincho', '500.css', 'Shippori Mincho', 500],
  ['shippori-mincho', '600.css', 'Shippori Mincho', 600],
  ['zen-kaku-gothic-new', '400.css', 'Zen Kaku Gothic New', 400],
  ['zen-kaku-gothic-new', '500.css', 'Zen Kaku Gothic New', 500],
  ['dm-mono', '400.css', 'DM Mono', 400],
  ['dm-mono', '500.css', 'DM Mono', 500]
]) {
  const dir = join(root, 'node_modules', '@fontsource', pkg);
  const fontCss = readFileSync(join(dir, file), 'utf8');
  for (const block of fontCss.split('@font-face').slice(1)) {
    const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1] || '';
    const woff2 = (block.match(/url\(\.\/files\/([^)]+\.woff2)\)/) || [])[1];
    if (!woff2 || (range && !wanted(range))) continue;
    copyFileSync(join(dir, 'files', woff2), join(out, 'fonts', woff2));
    css += `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url(fonts/${woff2}) format('woff2');${range ? `unicode-range:${range};` : ''}}\n`;
  }
}
writeFileSync(join(out, 'fonts.css'), css);
console.log(`Site pronto em ${out}`);
