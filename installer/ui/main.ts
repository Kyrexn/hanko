// Interface do Hanko Setup: telas com transição de tinta, ensō que se desenha e progresso real.
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
interface Progress { pct: number; step: number; text: string }

const app = document.getElementById('app')!;
const win = getCurrentWindow();
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
let info: Info;
const opts = { dir: '', desktop: true, startMenu: true, launch: true, removeData: false };

/* ---------- Peças ---------- */

const ENSO_PATH = 'M156 26 C 226 26, 278 84, 273 156 C 268 228, 208 276, 144 273 C 80 270, 28 218, 29 150 C 30 96, 64 50, 116 33';

function enso(size: number, inner: string, withArc = false): string {
  return `
  <div class="enso" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 300 300" aria-hidden="true">
      <defs><filter id="rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="4"/><feDisplacementMap in="SourceGraphic" scale="7"/></filter></defs>
      <path class="draw" pathLength="1" filter="url(#rough)" d="${ENSO_PATH}" fill="none" stroke="#E9E4D8" stroke-width="19" stroke-linecap="round" opacity=".9"/>
      ${withArc ? `<circle cx="150" cy="150" r="100" fill="none" stroke="#2E2B27" stroke-width="1" stroke-dasharray="1 7"/>
      <circle id="arc" class="arc" cx="150" cy="150" r="100" pathLength="100" fill="none" stroke="#E8604E" stroke-width="4" stroke-linecap="round" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 150 150)"/>` : ''}
    </svg>
    <div class="enso-center">${inner}</div>
  </div>`;
}

const seal = (ch: string, size = 64) => `<span class="seal" style="width:${size}px;height:${size}px;font-size:${size * 0.5}px">${ch}</span>`;

function frame(content: string): string {
  const title = info.mode === 'uninstall' ? 'desinstalar' : info.mode === 'update' ? 'atualização' : 'instalação';
  return `
  <div class="frame">
    <header class="titlebar" data-tauri-drag-region>
      <span class="brush" style="font-size:16px" data-tauri-drag-region>判子</span>
      <span class="ttl" data-tauri-drag-region>Hanko · ${title}</span>
      <button class="tb-btn" id="min" aria-label="Minimizar"><svg width="10" height="10"><path d="M1 5h8" stroke="currentColor" stroke-width="1.2"/></svg></button>
      <button class="tb-btn close" id="close" aria-label="Fechar"><svg width="10" height="10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2"/></svg></button>
    </header>
    ${content}
  </div>`;
}

function brandPanel(): string {
  return `
  <aside class="brand">
    <span class="verse">心を静めて鍵を守る</span>
    ${enso(190, `<span class="brush" style="font-size:44px;letter-spacing:8px;padding-left:8px">判子</span>`)}
    <span class="label">hanko · selado, só você abre</span>
    <span class="mono faint" style="font-size:11px">versão ${esc(info.version)}</span>
  </aside>`;
}

let stageEl: HTMLElement | null = null;

/** Troca a tela da direita com a transição de tinta. */
function show(html: string, bind: (root: HTMLElement) => void) {
  const next = document.createElement('section');
  next.className = 'screen stagger enter';
  next.innerHTML = html;
  const old = stageEl?.querySelector('.screen:not(.leave)');
  if (old) { old.classList.add('leave'); setTimeout(() => old.remove(), 350); }
  stageEl!.append(next);
  bind(next);
}

function wireChrome() {
  document.getElementById('min')?.addEventListener('click', () => win.minimize());
  document.getElementById('close')?.addEventListener('click', () => invoke('finish'));
  // Brilho que segue o mouse no botão principal.
  document.addEventListener('pointermove', e => {
    const b = (e.target as HTMLElement).closest('.btn-solid') as HTMLElement | null;
    if (!b) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty('--x', `${e.clientX - r.left}px`);
    b.style.setProperty('--y', `${e.clientY - r.top}px`);
  });
}

/* ---------- Telas: instalar ---------- */

function welcome() {
  const upgrading = !!info.installedVersion;
  show(`
    <span class="label">${upgrading ? `instalado: ${esc(info.installedVersion!)}` : 'bem-vindo'}</span>
    <h1>${upgrading ? 'Atualizar o Hanko' : 'Selado.<br/>Só você abre.'}</h1>
    <p class="lead">${upgrading
      ? `A versão <b class="mono">${esc(info.version)}</b> vai substituir a ${esc(info.installedVersion!)}. Seu cofre e suas configurações ficam onde estão.`
      : 'Senhas, códigos 2FA e documentos de recuperação — cifrados neste computador e sincronizados entre Windows, Android e Chrome.'}</p>
    <div class="actions">
      <button class="btn btn-solid" id="go">${upgrading ? 'Atualizar' : 'Instalar'}</button>
      <button class="link" id="opts">opções de instalação</button>
      <span class="mono faint" style="margin-left:auto;font-size:11px">${info.sizeMb} MB</span>
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
    <span class="label">opções</span>
    <h1>Onde e como</h1>
    <label class="field"><span>pasta de instalação</span><input class="input" id="dir" value="${esc(opts.dir)}" spellcheck="false" /></label>
    <label class="check"><input type="checkbox" id="sm" ${opts.startMenu ? 'checked' : ''}/> atalho no Menu Iniciar</label>
    <label class="check"><input type="checkbox" id="dk" ${opts.desktop ? 'checked' : ''}/> atalho na Área de Trabalho</label>
    <label class="check"><input type="checkbox" id="ln" ${opts.launch ? 'checked' : ''}/> abrir o Hanko ao terminar</label>
    <div class="actions">
      <button class="btn btn-solid" id="go">Instalar</button>
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

const INSTALL_STEPS = ['preparar', 'copiar o Hanko', 'criar atalhos', 'registrar no Windows'];
const UNINSTALL_STEPS = ['fechar o Hanko', 'remover atalhos', 'remover arquivos', 'apagar dados (se pedido)'];

function stepsHtml(names: string[]): string {
  return `<div class="steps">${names.map((n, i) => `<div class="step" data-i="${i + 1}"><span class="k">${'一二三四'[i]}</span>${n}<span class="tick">✓</span></div>`).join('')}</div>`;
}

function track(root: ParentNode, p: Progress) {
  const arc = document.getElementById('arc');
  arc?.setAttribute('stroke-dashoffset', String(100 - p.pct));
  const pct = root.querySelector('#pct');
  if (pct) pct.textContent = `${p.pct}%`;
  root.querySelectorAll<HTMLElement>('.step').forEach(s => {
    const i = Number(s.dataset.i);
    s.classList.toggle('done', i < p.step || p.step >= 5);
    s.classList.toggle('on', i === p.step);
  });
}

async function installing() {
  if (!opts.dir) opts.dir = info.defaultDir;
  show(`
    <span class="label">instalando</span>
    <div style="display:flex;gap:30px;align-items:center">
      ${enso(170, `<span class="mono" id="pct" style="font-size:26px">0%</span>`, true)}
      ${stepsHtml(INSTALL_STEPS)}
    </div>
    <p class="faint mono" style="font-size:11.5px">${esc(opts.dir)}</p>
    <p class="err" id="err"></p>`,
  async root => {
    const un = await listen<Progress>('progress', e => track(root, e.payload));
    try {
      await invoke('install', { dir: opts.dir, desktop: opts.desktop, startMenu: opts.startMenu });
      un();
      setTimeout(done, 500);
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
    <span class="label">concluído</span>
    <div style="display:flex;gap:22px;align-items:center">${seal('済', 72)}<h1>Tudo em seu lugar.</h1></div>
    <p class="lead">O Hanko ${esc(info.version)} está instalado. Ao abrir, crie sua conta ou entre — e guarde o seu <b>Kit de Emergência</b>.</p>
    <div class="actions">
      <button class="btn btn-solid" id="open">Abrir o Hanko</button>
      <button class="link" id="close2">concluir</button>
    </div>`,
  root => {
    root.querySelector('#open')!.addEventListener('click', async () => { await invoke('launch', { dir: opts.dir }); invoke('finish'); });
    root.querySelector('#close2')!.addEventListener('click', async () => { if (opts.launch) await invoke('launch', { dir: opts.dir }); invoke('finish'); });
  });
}

/* ---------- Telas: desinstalar ---------- */

function uninstallConfirm() {
  show(`
    <span class="label">desinstalar</span>
    <h1>Remover o Hanko</h1>
    <p class="lead">O app sai deste computador. Seu cofre continua na sua conta (se você sincroniza) e no seu backup.</p>
    <label class="check"><input type="checkbox" id="rd"/> apagar também os dados do Hanko deste computador</label>
    <div class="warn" id="warn" style="display:none">Isso apaga o cofre local deste PC. Só marque se ele estiver sincronizado com a sua conta ou se você tiver um backup.</div>
    <div class="actions">
      <button class="btn btn-red" id="go">Desinstalar</button>
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
    <span class="label">removendo</span>
    <div style="display:flex;gap:30px;align-items:center">
      ${enso(170, `<span class="mono" id="pct" style="font-size:26px">0%</span>`, true)}
      ${stepsHtml(UNINSTALL_STEPS)}
    </div>`,
  async root => {
    const un = await listen<Progress>('progress', e => track(root, e.payload));
    await invoke('uninstall', { removeData: opts.removeData }).catch(() => {});
    un();
    setTimeout(() => show(`
      <span class="label">concluído</span>
      <div style="display:flex;gap:22px;align-items:center">${seal('別', 72)}<h1>Até logo.</h1></div>
      <p class="lead">O Hanko foi removido deste computador.</p>
      <div class="actions"><button class="btn btn-solid" id="ok">Fechar</button></div>`,
    r => r.querySelector('#ok')!.addEventListener('click', () => invoke('finish'))), 500);
  });
}

/* ---------- Modo atualização (janela pequena, automática) ---------- */

async function updateMode() {
  app.innerHTML = frame(`
    <div class="compact stagger">
      ${enso(150, `<span class="mono" id="pct" style="font-size:22px">0%</span>`, true)}
      <span class="brush" style="font-size:22px">Atualizando o Hanko ${esc(info.version)}</span>
      <span class="faint" id="txt" style="font-size:12.5px">preparando…</span>
    </div>`);
  wireChrome();
  const un = await listen<Progress>('progress', e => {
    track(document, e.payload);
    document.getElementById('txt')!.textContent = e.payload.text;
  });
  try {
    await invoke('install', { dir: info.installedDir || info.defaultDir, desktop: false, startMenu: true });
    un();
    document.querySelector('.enso-center')!.innerHTML = seal('新', 54);
    document.getElementById('txt')!.textContent = 'pronto — abrindo o Hanko';
    setTimeout(async () => { await invoke('launch', { dir: info.installedDir || info.defaultDir }); invoke('finish'); }, 1300);
  } catch (e) {
    un();
    document.getElementById('txt')!.textContent = String(e);
  }
}

/* ---------- Início ---------- */

(async () => {
  info = await invoke<Info>('info');
  opts.dir = info.installedDir || info.defaultDir;
  if (info.mode === 'update') return updateMode();
  app.innerHTML = frame(`<div class="body">${brandPanel()}<main class="stage"></main></div>`);
  stageEl = app.querySelector('.stage');
  wireChrome();
  if (info.mode === 'uninstall') uninstallConfirm();
  else welcome();
})();
