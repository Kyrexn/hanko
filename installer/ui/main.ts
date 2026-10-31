// Interface do Hanko Setup: laca negra, ensō dourado e progresso 100% real
// (o número vem dos bytes copiados e dos arquivos removidos, contados no Rust).
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface Info {
  mode: 'install' | 'uninstall' | 'update';
  version: string;
  defaultDir: string;
  installedVersion: string | null;
  installedDir: string | null;
  sizeMb: number;
}
interface Progress { pct: number; step: number; text: string; done: number; total: number }

const app = document.getElementById('app')!;
const win = getCurrentWindow();
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
let info: Info;
const opts = { dir: '', desktop: true, startMenu: true, launch: true, removeData: false };

/* ---------- Peças visuais ---------- */

const ENSO_PATH = 'M156 26 C 226 26, 278 84, 273 156 C 268 228, 208 276, 144 273 C 80 270, 28 218, 29 150 C 30 96, 64 50, 116 33';

/** O carimbo do Hanko (mesmo desenho do ícone do app). */
const logo = (size: number) => `
  <svg class="logo" width="${size}" height="${size}" viewBox="200 200 624 624" aria-hidden="true">
    <g transform="rotate(-5 512 512)">
      <rect x="212" y="212" width="600" height="600" rx="54" fill="#B8302A"/>
      <rect x="252" y="252" width="520" height="520" rx="34" fill="none" stroke="#F7F0E2" stroke-width="10" opacity=".85"/>
      <path d="M528 318 C 628 316, 706 396, 700 500 C 694 604, 612 676, 508 672 C 410 668, 330 594, 332 498 C 334 420, 382 356, 452 330" fill="none" stroke="#F7F0E2" stroke-width="44" stroke-linecap="round"/>
      <circle cx="515" cy="472" r="52" fill="#F7F0E2"/>
      <path d="M493 500 L 537 500 L 556 612 Q 515 628 474 612 Z" fill="#F7F0E2"/>
    </g>
  </svg>`;

/** Ensō dourado; com `ring`, um anel de progresso que segue o valor real. */
function enso(size: number, inner: string, ring = false): string {
  return `
  <div class="enso ${ring ? 'ring' : ''}" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 300 300" aria-hidden="true">
      <defs>
        <filter id="rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="4"/><feDisplacementMap in="SourceGraphic" scale="7"/></filter>
        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E8CB8A"/><stop offset=".5" stop-color="#C9A45C"/><stop offset="1" stop-color="#8C6A2E"/></linearGradient>
      </defs>
      <path class="draw" pathLength="1" filter="url(#rough)" d="${ENSO_PATH}" fill="none" stroke="url(#gold)" stroke-width="${ring ? 10 : 18}" stroke-linecap="round" opacity="${ring ? .35 : .95}"/>
      ${ring ? `<circle cx="150" cy="150" r="112" fill="none" stroke="#2C261D" stroke-width="5"/>
      <circle class="arc" id="arc" cx="150" cy="150" r="112" pathLength="1000" fill="none" stroke="url(#gold)" stroke-width="7" stroke-linecap="round" stroke-dasharray="1000" stroke-dashoffset="1000" transform="rotate(-90 150 150)"/>` : ''}
    </svg>
    <div class="enso-center">${inner}</div>
  </div>`;
}

const seal = (ch: string, size = 64) => `<span class="seal" style="width:${size}px;height:${size}px;font-size:${size * 0.5}px">${ch}</span>`;

function leaves(n: number): string {
  return Array.from({ length: n }, (_, i) =>
    `<i class="leaf ${i % 4 === 0 ? 'red' : ''}" style="left:${(i * 37) % 100}%;animation-duration:${9 + (i % 5) * 2}s;animation-delay:${-(i * 1.7) % 12}s"></i>`).join('');
}

/** Folhas de ouro saindo do centro de um elemento (comemoração ao terminar). */
function burst(el: Element) {
  const r = el.getBoundingClientRect();
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;width:0;height:0;z-index:20;pointer-events:none`;
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * .3, d = 70 + Math.random() * 90;
    const p = document.createElement('i');
    p.className = 'burst';
    p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    p.style.setProperty('--r', `${Math.random() * 540 - 270}deg`);
    if (i % 5 === 0) p.style.background = 'linear-gradient(135deg,#F07A68,#B8302A)';
    host.append(p);
  }
  document.body.append(host);
  setTimeout(() => host.remove(), 1400);
}

function frame(content: string): string {
  const title = info.mode === 'uninstall' ? 'desinstalar' : info.mode === 'update' ? 'atualização' : 'instalação';
  return `
  <div class="frame">
    <header class="titlebar" data-tauri-drag-region>
      ${logo(20)}
      <span class="word" data-tauri-drag-region>HANKO</span>
      <span class="ttl" data-tauri-drag-region>· ${title}</span>
      <button class="tb-btn" id="min" aria-label="Minimizar"><svg width="10" height="10"><path d="M1 5h8" stroke="currentColor" stroke-width="1.2"/></svg></button>
      <button class="tb-btn close" id="close" aria-label="Fechar"><svg width="10" height="10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2"/></svg></button>
    </header>
    ${content}
  </div>`;
}

function hero(): string {
  return `
  <aside class="hero">
    <div class="shippo"></div>
    ${leaves(12)}
    ${enso(210, logo(92))}
    <span class="wordmark">Hanko</span>
    <span class="tag">Selado. Só você abre.</span>
    <span class="chip">versão ${esc(info.version)}</span>
  </aside>`;
}

let stageEl: HTMLElement | null = null;

/** Troca a tela da direita com transição. */
function show(html: string, bind: (root: HTMLElement) => void, extra = '') {
  const next = document.createElement('section');
  next.className = `screen enter ${extra}`;
  next.innerHTML = html;
  const old = stageEl?.querySelector('.screen:not(.leave)');
  if (old) { old.classList.add('leave'); setTimeout(() => old.remove(), 300); }
  stageEl!.append(next);
  bind(next);
}

function wireChrome() {
  document.getElementById('min')?.addEventListener('click', () => win.minimize());
  document.getElementById('close')?.addEventListener('click', () => invoke('finish'));
}

/* ---------- Progresso real, com movimento suave ---------- */

const mb = (n: number) => (n / 1_048_576).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Liga o anel, a barra e as etapas aos eventos de progresso do Rust.
 * O número mostrado persegue o valor real (nunca passa dele) para o anel não "pular".
 */
function tracker(root: ParentNode, unit: 'bytes' | 'files') {
  let target = 0, shown = 0, raf = 0, last: Progress | null = null;
  const arc = root.querySelector('#arc') as SVGCircleElement | null;
  const pct = root.querySelector('#pct');
  const amount = root.querySelector('#amount');
  const bar = root.querySelector('.bar i') as HTMLElement | null;
  const now = root.querySelector('#now');
  const paint = () => {
    shown = target - shown < 0.05 ? target : shown + (target - shown) * 0.22;
    arc?.setAttribute('stroke-dashoffset', String(1000 - shown * 10));
    if (bar) bar.style.width = `${shown}%`;
    if (pct) {
      const [i, d] = shown.toFixed(1).split('.');
      pct.innerHTML = `${i}<small>,${d}%</small>`;
    }
    if (shown !== target) raf = requestAnimationFrame(paint); else raf = 0;
  };
  const on = (p: Progress) => {
    last = p;
    target = Math.max(target, p.pct);
    if (!raf) raf = requestAnimationFrame(paint);
    if (amount) amount.textContent = unit === 'bytes' ? `${mb(p.done)} de ${mb(p.total)} MB` : `${p.done} de ${p.total} itens`;
    if (now) now.textContent = p.text;
    root.querySelectorAll<HTMLElement>('.step').forEach(s => {
      const i = Number(s.dataset.i);
      s.classList.toggle('done', i < p.step || p.step >= 5);
      s.classList.toggle('on', i === p.step && p.step < 5);
    });
  };
  return { on, last: () => last };
}

function progressHtml(steps: string[], unit: 'bytes' | 'files'): string {
  return `
    <div class="progress">
      ${enso(200, `<span class="pct" id="pct">0<small>,0%</small></span><span class="amount" id="amount">${unit === 'bytes' ? 'calculando…' : 'contando…'}</span>`, true)}
      <div class="steps">${steps.map((n, i) => `<div class="step" data-i="${i + 1}"><span class="dot"></span>${n}</div>`).join('')}</div>
    </div>
    <div class="bar"><i></i></div>
    <div class="now"><span id="now">preparando…</span></div>`;
}

/* ---------- Instalar ---------- */

function welcome() {
  const upgrading = !!info.installedVersion;
  show(`
    <span class="eyebrow">${upgrading ? `instalado: ${esc(info.installedVersion!)}` : 'bem-vindo'}</span>
    <h1>${upgrading ? `Atualizar para a ${esc(info.version)}` : 'Suas senhas,<br/>seladas.'}</h1>
    <p class="lead">${upgrading
      ? `A versão <b class="mono">${esc(info.version)}</b> substitui a ${esc(info.installedVersion!)}. Seu cofre e seus ajustes ficam onde estão.`
      : 'Senhas, códigos 2FA e documentos cifrados neste computador antes de sair dele — sincronizados com o Android e o navegador.'}</p>
    <div class="feats">
      <span class="feat"><b>鍵</b>Argon2id + AES-256</span>
      <span class="feat"><b>符</b>Códigos 2FA ao vivo</span>
      <span class="feat"><b>手</b>Windows Hello</span>
      <span class="feat"><b>新</b>Atualiza em silêncio</span>
    </div>
    <div class="actions">
      <button class="btn btn-main" id="go">${upgrading ? 'Atualizar agora' : 'Instalar o Hanko'}</button>
      <button class="link" id="opts">opções</button>
      <span class="size">${info.sizeMb} MB</span>
    </div>
    ${upgrading ? `<button class="link" id="un" style="align-self:flex-start">desinstalar o Hanko</button>` : ''}`,
  root => {
    root.querySelector('#go')!.addEventListener('click', installing);
    root.querySelector('#opts')!.addEventListener('click', options);
    root.querySelector('#un')?.addEventListener('click', uninstallConfirm);
  });
}

function options() {
  show(`
    <span class="eyebrow">opções</span>
    <h1>Onde e como</h1>
    <label class="field"><span>pasta de instalação</span><input class="input" id="dir" value="${esc(opts.dir)}" spellcheck="false" /></label>
    <label class="check"><input type="checkbox" id="sm" ${opts.startMenu ? 'checked' : ''}/> atalho no Menu Iniciar</label>
    <label class="check"><input type="checkbox" id="dk" ${opts.desktop ? 'checked' : ''}/> atalho na Área de Trabalho</label>
    <label class="check"><input type="checkbox" id="ln" ${opts.launch ? 'checked' : ''}/> abrir o Hanko ao terminar</label>
    <div class="actions">
      <button class="btn btn-main" id="go">Instalar</button>
      <button class="link" id="back">voltar</button>
    </div>`,
  root => {
    const read = () => {
      opts.dir = (root.querySelector('#dir') as HTMLInputElement).value.trim() || info.defaultDir;
      opts.startMenu = (root.querySelector('#sm') as HTMLInputElement).checked;
      opts.desktop = (root.querySelector('#dk') as HTMLInputElement).checked;
      opts.launch = (root.querySelector('#ln') as HTMLInputElement).checked;
    };
    root.querySelector('#go')!.addEventListener('click', () => { read(); installing(); });
    root.querySelector('#back')!.addEventListener('click', () => { read(); welcome(); });
  });
}

const INSTALL_STEPS = ['Preparar a pasta', 'Copiar o Hanko', 'Atalhos e desinstalador', 'Registrar no Windows'];
const UNINSTALL_STEPS = ['Fechar o Hanko', 'Remover atalhos', 'Remover o programa', 'Apagar dados (se pedido)'];

function installing() {
  if (!opts.dir) opts.dir = info.defaultDir;
  show(`
    <span class="eyebrow">instalando · ${esc(info.version)}</span>
    ${progressHtml(INSTALL_STEPS, 'bytes')}
    <p class="path">${esc(opts.dir)}</p>
    <p class="err" id="err"></p>`,
  async root => {
    const t = tracker(root, 'bytes');
    const un = await listen<Progress>('progress', e => t.on(e.payload));
    try {
      await invoke('install', { dir: opts.dir, desktop: opts.desktop, startMenu: opts.startMenu });
      un();
      setTimeout(done, 700);
    } catch (e) {
      un();
      root.querySelector('#err')!.textContent = String(e);
      const b = document.createElement('div');
      b.className = 'actions';
      b.innerHTML = '<button class="btn" id="retry">Tentar de novo</button>';
      root.append(b);
      b.querySelector('#retry')!.addEventListener('click', installing);
    }
  });
}

function done() {
  show(`
    <span class="eyebrow">concluído</span>
    <div style="display:flex;gap:22px;align-items:center">${seal('済', 76)}<h1>Tudo em seu lugar.</h1></div>
    <p class="lead">O Hanko ${esc(info.version)} está instalado. Ao abrir, crie sua conta ou entre — e guarde o seu <b>Kit de Emergência</b>.</p>
    <div class="actions">
      <button class="btn btn-main" id="open">Abrir o Hanko</button>
      <button class="link" id="close2">concluir</button>
    </div>`,
  root => {
    setTimeout(() => burst(root.querySelector('.seal')!), 350);
    root.querySelector('#open')!.addEventListener('click', async () => { await invoke('launch', { dir: opts.dir }); invoke('finish'); });
    root.querySelector('#close2')!.addEventListener('click', async () => { if (opts.launch) await invoke('launch', { dir: opts.dir }); invoke('finish'); });
  });
}

/* ---------- Desinstalar ---------- */

function uninstallConfirm() {
  show(`
    <span class="eyebrow">desinstalar</span>
    <h1>Remover o Hanko</h1>
    <p class="lead">O app sai deste computador. Seu cofre continua na sua conta (se você sincroniza) e no seu backup.</p>
    <label class="check"><input type="checkbox" id="rd"/> apagar também os dados do Hanko deste computador</label>
    <div class="warn" id="warn" style="display:none">Isso apaga o cofre local deste PC. Só marque se ele estiver sincronizado com a sua conta ou se você tiver um backup.</div>
    <div class="actions">
      <button class="btn btn-main" id="go">Desinstalar</button>
      <button class="link" id="back">cancelar</button>
    </div>`,
  root => {
    const rd = root.querySelector('#rd') as HTMLInputElement;
    rd.addEventListener('change', () => { (root.querySelector('#warn') as HTMLElement).style.display = rd.checked ? '' : 'none'; });
    root.querySelector('#go')!.addEventListener('click', () => { opts.removeData = rd.checked; uninstalling(); });
    root.querySelector('#back')!.addEventListener('click', () => (info.mode === 'uninstall' ? invoke('finish') : welcome()));
  });
}

function uninstalling() {
  show(`
    <span class="eyebrow">removendo</span>
    ${progressHtml(UNINSTALL_STEPS, 'files')}`,
  async root => {
    const t = tracker(root, 'files');
    const un = await listen<Progress>('progress', e => t.on(e.payload));
    await invoke('uninstall', { removeData: opts.removeData }).catch(() => {});
    un();
    setTimeout(() => show(`
      <span class="eyebrow">concluído</span>
      <div style="display:flex;gap:22px;align-items:center">${seal('別', 76)}<h1>Até logo.</h1></div>
      <p class="lead">O Hanko foi removido deste computador. Se um dia voltar, sua conta traz tudo de volta.</p>
      <div class="actions"><button class="btn btn-main" id="ok">Fechar</button></div>`,
    r => r.querySelector('#ok')!.addEventListener('click', () => invoke('finish'))), 700);
  }, 'danger');
}

/* ---------- Atualização automática (janela pequena) ---------- */

async function updateMode() {
  app.innerHTML = frame(`
    <div class="compact">
      <div class="shippo"></div>
      ${leaves(8)}
      ${enso(170, `<span class="pct" id="pct" style="font-size:36px">0<small>,0%</small></span><span class="amount" id="amount">calculando…</span>`, true)}
      <span class="title">Atualizando para o Hanko ${esc(info.version)}</span>
      <div class="bar"><i></i></div>
      <span class="faint" id="now" style="font-size:12.5px">preparando…</span>
    </div>`);
  wireChrome();
  const t = tracker(document, 'bytes');
  const un = await listen<Progress>('progress', e => t.on(e.payload));
  try {
    await invoke('install', { dir: info.installedDir || info.defaultDir, desktop: false, startMenu: true });
    un();
    const center = document.querySelector('.enso-center')!;
    setTimeout(() => {
      center.innerHTML = seal('新', 58);
      burst(center);
      document.getElementById('now')!.textContent = 'pronto — abrindo o Hanko';
    }, 500);
    setTimeout(async () => {
      if (await invoke<boolean>('should_restart')) await invoke('launch', { dir: info.installedDir || info.defaultDir });
      invoke('finish');
    }, 1800);
  } catch (e) {
    un();
    document.getElementById('now')!.textContent = String(e);
  }
}

/* ---------- Início ---------- */

(async () => {
  info = await invoke<Info>('info');
  opts.dir = info.installedDir || info.defaultDir;
  if (info.mode === 'update') return updateMode();
  app.innerHTML = frame(`<div class="body">${hero()}<main class="stage"></main></div>`);
  stageEl = app.querySelector('.stage');
  wireChrome();
  if (info.mode === 'uninstall') uninstallConfirm();
  else welcome();
})();
