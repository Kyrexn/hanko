// Preenchimento automático na página.
// Ao focar num campo de usuário, senha ou código 2FA, mostra um pequeno pergaminho (num Shadow DOM isolado
// da página) com as contas deste site. Nada é preenchido sem um clique da pessoa.

import { generatePassword } from '../../src/core/passwords';

interface Match { id: string; name: string; username: string; hasOtp: boolean; hasPassword: boolean }
type Kind = 'login' | 'otp';

const OTP_RE = /(otp|totp|2fa|mfa|one.?time|verif|token|c[oó]digo|code|security.?code|authenticat)/i;

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function fieldKind(el: Element | null): Kind | null {
  if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly) return null;
  const type = (el.type || 'text').toLowerCase();
  const hints = `${el.name} ${el.id} ${el.autocomplete} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`;
  if (el.autocomplete === 'one-time-code') return 'otp';
  if (type === 'password') return 'login';
  if (!['text', 'email', 'tel', 'number', ''].includes(type)) return null;
  if (OTP_RE.test(hints) && (el.maxLength > 0 && el.maxLength <= 10 || el.inputMode === 'numeric' || type === 'number' || type === 'tel')) return 'otp';
  if (/user|login|email|e-mail|conta|account|cpf|identifier/i.test(hints) || type === 'email') {
    // Só conta como login se houver um campo de senha na página (ou se o site pedir o usuário primeiro).
    return document.querySelector('input[type=password]') || /username|email/i.test(el.autocomplete) || /identifier|login/i.test(hints) ? 'login' : null;
  }
  return null;
}

function setValue(input: HTMLInputElement, value: string) {
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter ? setter.call(input, value) : (input.value = value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Acha os campos de usuário e senha relacionados ao campo focado. */
function loginFields(anchor: HTMLInputElement): { user: HTMLInputElement | null; pass: HTMLInputElement | null } {
  const scope: ParentNode = anchor.form || document;
  const inputs = Array.from(scope.querySelectorAll('input')).filter(isVisible) as HTMLInputElement[];
  const pass = anchor.type === 'password' ? anchor : inputs.find(i => i.type === 'password') || null;
  const before = pass ? inputs.slice(0, inputs.indexOf(pass)) : inputs;
  const user = anchor.type !== 'password' ? anchor
    : [...before].reverse().find(i => ['text', 'email', 'tel', ''].includes(i.type) && !OTP_RE.test(`${i.name} ${i.id}`)) || null;
  return { user, pass };
}

/* ---------- UI no Shadow DOM ---------- */

const host = document.createElement('cofre-preencher');
host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; z-index: 2147483647;';
const root = host.attachShadow({ mode: 'closed' });
root.innerHTML = `
<style>
  .p { position: absolute; width: 300px; background: linear-gradient(170deg, #18140F, #0D0B09); color: #EFE8D8; border: 1px solid rgba(201,164,92,.35); border-radius: 14px; overflow: hidden; box-shadow: 0 16px 40px rgba(0,0,0,.45);
       font: 13px/1.45 system-ui, 'Segoe UI', sans-serif; animation: un .35s cubic-bezier(.5,0,.2,1) both; }
  @keyframes un { from { clip-path: inset(0 0 100% 0) } to { clip-path: inset(0 0 0 0) } }
  .rod { display: none; }
  .hd { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #2E2B27; font-size: 11px; letter-spacing: 2px; color: #C9A45C; text-transform: uppercase; }
  .seal { width: 16px; height: 16px; background: #C8372D; color: #F6F1E7; display: grid; place-items: center; font-size: 10px; transform: rotate(-4deg); letter-spacing: 0; }
  button.it { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 12px; cursor: pointer; border-bottom: 1px solid #24221F; }
  button.it:hover, button.it:focus-visible { background: rgba(201,164,92,.1); }
  .av { width: 26px; height: 26px; border-radius: 50%; border: 1px solid #5A554C; display: grid; place-items: center; flex: none; font-size: 12px; }
  .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .us { color: #A9A397; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .go { color: #C9A45C; font-size: 12px; flex: none; }
  .msg { padding: 12px; color: #A9A397; }
  .msg button { all: unset; color: #C9A45C; cursor: pointer; }
</style>
<div class="p" hidden><div class="rod"></div><div class="hd"><span class="seal">判</span><span class="ttl">Hanko</span></div><div class="body"></div><div class="rod"></div></div>`;
const panel = root.querySelector('.p') as HTMLDivElement;
const body = root.querySelector('.body') as HTMLDivElement;
const title = root.querySelector('.ttl') as HTMLSpanElement;
let current: HTMLInputElement | null = null;
let kind: Kind = 'login';

function send<T>(msg: unknown): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function hide() {
  panel.hidden = true;
  current = null;
}

function place(el: HTMLInputElement) {
  if (!host.isConnected) document.documentElement.append(host);
  const r = el.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + innerWidth - 310))}px`;
  panel.style.top = `${window.scrollY + r.bottom + 6}px`;
}

function row(m: Match): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'it';
  b.innerHTML = '<span class="av"></span><span class="tx"><span class="nm"></span><span class="us"></span></span><span class="go"></span>';
  (b.querySelector('.av') as HTMLElement).textContent = (m.name.trim()[0] || '?').toUpperCase();
  (b.querySelector('.nm') as HTMLElement).textContent = m.name;
  (b.querySelector('.us') as HTMLElement).textContent = m.username || '—';
  (b.querySelector('.go') as HTMLElement).textContent = kind === 'otp' ? 'código' : 'preencher';
  b.addEventListener('mousedown', e => e.preventDefault()); // não tira o foco do campo
  b.addEventListener('click', () => choose(m));
  return b;
}

async function choose(m: Match) {
  const el = current;
  if (!el) return;
  if (kind === 'otp') {
    const r = await send<{ code?: string }>({ type: 'otp', id: m.id });
    if (r.code) setValue(el, r.code);
  } else {
    const r = await send<{ username?: string; password?: string }>({ type: 'fill', id: m.id });
    const { user, pass } = loginFields(el);
    if (user && r.username) setValue(user, r.username);
    if (pass && r.password) setValue(pass, r.password);
  }
  hide();
}

/** Campo de senha de cadastro/troca (o site pede uma senha nova)? */
function isNewPassword(el: HTMLInputElement): boolean {
  if (el.type !== 'password') return false;
  if (el.autocomplete === 'new-password') return true;
  if (el.autocomplete === 'current-password') return false;
  const scope: ParentNode = el.form || document;
  const passes = Array.from(scope.querySelectorAll('input[type=password]')).filter(i => isVisible(i as HTMLElement));
  const hints = `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''} ${el.form?.textContent?.slice(0, 400) || ''}`;
  return passes.length >= 2 || /cadastr|criar conta|crie sua|nova senha|new password|sign ?up|register|confirm/i.test(hints);
}

/** Sugere uma senha forte num cadastro: preenche a senha e a confirmação do mesmo formulário. */
function suggestRow(el: HTMLInputElement): HTMLButtonElement {
  const pw = generatePassword(20);
  const b = document.createElement('button');
  b.className = 'it';
  b.innerHTML = '<span class="av">鍛</span><span class="tx"><span class="nm">Usar senha forte</span><span class="us"></span></span><span class="go">usar</span>';
  (b.querySelector('.us') as HTMLElement).textContent = pw;
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('click', () => {
    const scope: ParentNode = el.form || document;
    const passes = (Array.from(scope.querySelectorAll('input[type=password]')) as HTMLInputElement[]).filter(i => isVisible(i) && !i.disabled);
    for (const p of passes.length ? passes : [el]) setValue(p, pw);
    hide();
  });
  return b;
}

async function show(el: HTMLInputElement, k: Kind) {
  current = el;
  kind = k;
  if (k === 'login' && isNewPassword(el)) {
    body.replaceChildren(suggestRow(el));
    title.textContent = 'Hanko · senha nova';
    place(el);
    panel.hidden = false;
    return;
  }
  const r = await send<{ locked?: boolean; items?: Match[] }>({ type: 'matches' }).catch(() => null);
  if (current !== el || !r) return;
  const items = (r.items || []).filter(m => (k === 'otp' ? m.hasOtp : m.hasPassword || m.username));
  if (!r.locked && !items.length) return hide(); // nada para este site: não atrapalha
  body.replaceChildren();
  title.textContent = k === 'otp' ? 'Código 2FA' : 'Hanko · este site';
  if (r.locked) {
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.innerHTML = 'Hanko bloqueado. <button type="button">Abrir o Hanko</button>';
    const btn = msg.querySelector('button')!;
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => { send({ type: 'openPopup' }); hide(); });
    body.append(msg);
  } else {
    items.forEach(m => body.append(row(m)));
  }
  place(el);
  panel.hidden = false;
}

document.addEventListener('focusin', e => {
  const k = fieldKind(e.target as Element);
  if (k && e.target instanceof HTMLInputElement && isVisible(e.target)) show(e.target, k);
}, true);

document.addEventListener('focusout', e => {
  if (e.target === current) setTimeout(() => { if (document.activeElement !== current && document.activeElement !== host) hide(); }, 150);
}, true);

document.addEventListener('keydown', e => {
  if (panel.hidden) return;
  if (e.key === 'Escape') { hide(); return; }
  // Seta para baixo entra no painel; setas navegam; Enter escolhe.
  const rows = Array.from(body.querySelectorAll('button.it')) as HTMLButtonElement[];
  if (!rows.length) return;
  const at = rows.indexOf(root.activeElement as HTMLButtonElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); rows[Math.min(rows.length - 1, at + 1)].focus(); }
  else if (e.key === 'ArrowUp' && at >= 0) { e.preventDefault(); (at === 0 ? current : rows[at - 1])?.focus(); }
}, true);
window.addEventListener('resize', () => { if (current && !panel.hidden) place(current); });

// Pedido vindo do popup ("preencher login" no botão da extensão).
chrome.runtime.onMessage.addListener((msg: { type: string; username?: string; password?: string; code?: string }, _s, reply) => {
  if (msg.type === 'doFill') {
    const active = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    const anchor = active && fieldKind(active) === 'login' ? active
      : (Array.from(document.querySelectorAll('input[type=password]')).find(i => isVisible(i as HTMLElement)) as HTMLInputElement | undefined)
        || (Array.from(document.querySelectorAll('input[type=email], input[autocomplete=username]')).find(i => isVisible(i as HTMLElement)) as HTMLInputElement | undefined);
    if (anchor) {
      const { user, pass } = loginFields(anchor);
      if (user && msg.username) setValue(user, msg.username);
      if (pass && msg.password) setValue(pass, msg.password);
    }
    const otp = Array.from(document.querySelectorAll('input')).find(i => fieldKind(i) === 'otp' && isVisible(i)) as HTMLInputElement | undefined;
    if (otp && msg.code) setValue(otp, msg.code);
    reply({ filled: !!anchor || !!otp });
  }
});

/* ---------- Salvar logins: ao enviar um formulário com senha, oferece guardar no Hanko ---------- */

const bar = document.createElement('div');
bar.className = 'bar';
bar.hidden = true;
root.append(bar);
const barStyle = document.createElement('style');
barStyle.textContent = `
  .bar { position: fixed; top: 14px; right: 14px; width: 330px; padding: 14px 16px; background: linear-gradient(170deg, #18140F, #0D0B09); color: #EFE8D8;
         border: 1px solid rgba(201,164,92,.45); border-radius: 14px; box-shadow: 0 18px 50px rgba(0,0,0,.5); font: 13px/1.5 system-ui, 'Segoe UI', sans-serif;
         animation: bin .35s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes bin { from { opacity: 0; transform: translateY(-10px) } to { opacity: 1; transform: none } }
  .bar .t { display: flex; align-items: center; gap: 10px; font-weight: 600; }
  .bar .s { color: #A69C88; font-size: 12px; margin: 4px 0 12px 30px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar .r { display: flex; gap: 8px; justify-content: flex-end; }
  .bar button { all: unset; cursor: pointer; padding: 7px 12px; border-radius: 9px; font-size: 12.5px; }
  .bar .ok { background: linear-gradient(180deg, #C63A31, #B8302A); color: #F7F0E2; font-weight: 600; }
  .bar .no { color: #A69C88; border: 1px solid #2C261D; }
  .bar .no:hover { color: #EFE8D8; }
  .bar .x { margin-left: auto; color: #857B69; padding: 0 4px; }`;
root.append(barStyle);

function showBar(offer: 'new' | 'update', username: string, site: string) {
  if (!site.trim()) return;
  if (!host.isConnected) document.documentElement.append(host);
  bar.innerHTML = '<div class="t"><span class="seal">判</span><span class="h"></span><button class="x" aria-label="Fechar">✕</button></div><div class="s"></div><div class="r"><button class="no">Agora não</button><button class="ok"></button></div>';
  (bar.querySelector('.h') as HTMLElement).textContent = offer === 'update' ? 'Atualizar a senha no Hanko?' : 'Salvar este login no Hanko?';
  (bar.querySelector('.s') as HTMLElement).textContent = `${username || 'sem usuário'} · ${site}`;
  (bar.querySelector('.ok') as HTMLElement).textContent = offer === 'update' ? 'Atualizar' : 'Salvar';
  const close = () => { bar.hidden = true; };
  bar.querySelector('.x')!.addEventListener('click', close);
  bar.querySelector('.no')!.addEventListener('click', () => { send({ type: 'dismissCapture' }); close(); });
  bar.querySelector('.ok')!.addEventListener('click', async () => {
    const r = await send<{ ok?: boolean }>({ type: 'openPopup' }).catch(() => null);
    if (r?.ok) close();
    else (bar.querySelector('.s') as HTMLElement).textContent = 'Clique no ícone do Hanko (判) na barra do Chrome para salvar.';
  });
  bar.hidden = false;
}

let lastCapture = '';
function capture(pass: HTMLInputElement | null) {
  if (!pass || !pass.value || window.top !== window) return;
  const { user } = loginFields(pass);
  const key = `${user?.value || ''}\u0000${pass.value}`;
  if (key === lastCapture) return;
  lastCapture = key;
  send<{ offer: 'new' | 'update' | null; username?: string; host?: string }>({ type: 'capture', username: user?.value || '', password: pass.value })
    .then(r => { if (r?.offer) showBar(r.offer, r.username || '', r.host || location.hostname); })
    .catch(() => {});
}

const filledPassword = (scope: ParentNode = document) =>
  (Array.from(scope.querySelectorAll('input[type=password]')) as HTMLInputElement[]).find(i => i.value && isVisible(i)) || null;

document.addEventListener('submit', e => capture(filledPassword(e.target as HTMLFormElement)), true);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement && (e.target.type === 'password' || fieldKind(e.target) === 'login')) capture(filledPassword(e.target.form || document));
}, true);
document.addEventListener('click', e => {
  const b = (e.target as HTMLElement | null)?.closest?.('button, input[type=submit], [role=button]');
  if (!b) return;
  const form = b.closest('form');
  const isSubmit = (b instanceof HTMLButtonElement && (b.type === 'submit' || !!form)) || (b instanceof HTMLInputElement && b.type === 'submit')
    || /entrar|login|log in|sign in|acessar|continuar|cadastr|criar conta|sign up|register/i.test(b.textContent || '');
  if (isSubmit) capture(filledPassword(form || document));
}, true);

// Depois do envio a página costuma mudar: na página nova, se ainda houver um login esperando, mostra de novo.
if (window.top === window) {
  setTimeout(() => {
    send<{ offer: 'new' | 'update' | null; username?: string; host?: string }>({ type: 'pendingCapture' })
      .then(r => { if (r?.offer) showBar(r.offer, r.username || '', r.host || location.hostname); })
      .catch(() => {});
  }, 600);
}
