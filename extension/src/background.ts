import { totp } from '../../src/core/totp';
import type { Item } from '../../src/core/types';
import { baseDomain, hostOf, matchesSite, openData, safeTransport, sess, siteItems, touch, type Capture } from './store';

// Serviço de fundo: responde à página só com o mínimo e só para o site certo.
// A página nunca recebe a lista inteira do cofre — só nome/usuário das contas daquele domínio,
// e a senha apenas quando a pessoa clica em "preencher".

type Msg =
  | { type: 'matches' }
  | { type: 'fill'; id: string }
  | { type: 'otp'; id: string }
  | { type: 'openPopup' }
  | { type: 'capture'; username: string; password: string }
  | { type: 'pendingCapture' }
  | { type: 'dismissCapture' }
  | { type: 'clearClipboard'; seconds: number }
  | { type: 'offscreen-done' }
  | { type: 'checkSelfUpdate' };

const CAPTURE_TTL = 5 * 60_000;

async function setBadge(tabId: number | undefined, on: boolean) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#B8302A' });
    await chrome.action.setBadgeText({ text: on ? '1' : '', ...(tabId ? { tabId } : {}) });
  } catch { /* aba fechada */ }
}

/** A área de transferência só pode ser limpa por um documento: cria o invisível sob demanda. */
async function clearClipboardLater(seconds: number) {
  const has = (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length > 0;
  if (!has) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.CLIPBOARD], justification: 'Apagar a senha copiada depois de alguns segundos' });
  await chrome.runtime.sendMessage({ type: 'offscreen-clear', seconds });
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, reply) => {
  handle(msg, sender).then(reply, () => reply({ error: true }));
  return true;
});

async function handle(msg: Msg, sender: chrome.runtime.MessageSender) {
  if (msg.type === 'openPopup') {
    try { await chrome.action.openPopup(); return { ok: true }; } catch { return { ok: false }; } // alguns Chromes só abrem pelo ícone
  }
  if (msg.type === 'checkSelfUpdate') { await checkOwnUpdate(); return { ok: true }; }
  if (msg.type === 'clearClipboard') { await clearClipboardLater(msg.seconds); return { ok: true }; }
  if (msg.type === 'offscreen-done') { await chrome.offscreen.closeDocument().catch(() => {}); return { ok: true }; }

  // Salvar logins: só a página principal da aba (nunca iframes) e só sites http(s).
  if (msg.type === 'capture' || msg.type === 'pendingCapture' || msg.type === 'dismissCapture') {
    const url = sender.tab?.url || '';
    const tabId = sender.tab?.id;
    if (!/^https?:/.test(url) || (sender.frameId ?? 0) !== 0) return { offer: null };
    if (msg.type === 'dismissCapture') { await sess.set('capture', null); await setBadge(tabId, false); return { ok: true }; }
    if (msg.type === 'pendingCapture') {
      const cap = await sess.get<Capture>('capture');
      if (!cap || Date.now() - cap.at > CAPTURE_TTL || baseDomain(hostOf(cap.url)) !== baseDomain(hostOf(url))) return { offer: null };
      return { offer: cap.offer, username: cap.username, host: hostOf(cap.url) };
    }
    const username = (msg.username || '').trim().slice(0, 200), password = (msg.password || '').slice(0, 500);
    if (!password) return { offer: null };
    let offer: Capture['offer'] = 'new';
    let itemId: string | undefined;
    const data = await openData();
    if (data) {
      const site = siteItems(data, url);
      const same = site.find(i => i.username.toLowerCase() === username.toLowerCase()) || (!username ? site.find(i => i.password === password) : undefined);
      if (same && same.password === password) return { offer: null }; // já está salvo igual
      if (same) { offer = 'update'; itemId = same.id; }
    }
    const cap: Capture = { url, username, password, offer, itemId, at: Date.now() };
    await sess.set('capture', cap);
    await setBadge(tabId, true);
    return { offer, username, host: hostOf(url) };
  }

  // As URLs vêm do próprio Chrome (sender), não da página — uma página não consegue se passar por outra.
  // `sender.url` é o quadro (iframe) que pediu; a aba é a página de cima. Os dois precisam ser do site da conta:
  // assim um iframe de anúncio/terceiro dentro de um site nunca recebe a senha desse site.
  const tabUrl = sender.tab?.url || '';
  const pageUrl = sender.url || tabUrl;
  if (!/^https?:/.test(pageUrl)) return { locked: false, items: [] };
  const sameSite = (i: Item) => matchesSite(i, pageUrl) && (!tabUrl || matchesSite(i, tabUrl));
  const data = await openData();
  if (!data) return { locked: true };
  await touch(data.settings.autoLockMinutes);

  if (msg.type === 'matches') {
    return {
      locked: false,
      items: siteItems(data, pageUrl).filter(sameSite).map(i => ({ id: i.id, name: i.name, username: i.username, hasOtp: !!i.otp && i.otp.type !== 'hotp', hasPassword: !!i.password }))
    };
  }
  const item = data.items.find(i => i.id === msg.id);
  if (!item || !sameSite(item)) return { error: 'site' };
  if (msg.type === 'fill') return { username: item.username, password: safeTransport(item, pageUrl) ? item.password : '' };
  if (msg.type === 'otp' && item.otp && item.otp.type !== 'hotp') return { code: (await totp(item.otp)) };
  return { error: 'otp' };
}

// Bloqueio automático: confere a cada minuto se o prazo venceu e apaga a chave da memória.
chrome.alarms.create('autolock', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== 'autolock') return;
  const lockAt = await sess.get<number>('lockAt');
  if (lockAt && Date.now() > lockAt) await sess.clear();
});

// Atualização sem loja: quando instalada pela pasta que o app do Hanko mantém, os arquivos novos chegam
// junto com a atualização do app. Aqui a extensão percebe a versão nova no disco e se recarrega.
async function checkOwnUpdate() {
  try {
    const disk = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' }).then(r => r.json()) as { version?: string };
    if (disk.version && disk.version !== chrome.runtime.getManifest().version) chrome.runtime.reload();
  } catch { /* arquivo sendo escrito agora: tenta na próxima */ }
}
chrome.alarms.create('selfupdate', { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'selfupdate') checkOwnUpdate(); });
chrome.runtime.onStartup.addListener(checkOwnUpdate);

// Atalho Ctrl+Shift+L: preenche o login deste site (o usado por último, se houver mais de um).
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'preencher') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return;
  const data = await openData();
  const item = data ? siteItems(data, tab.url).find(i => i.password || i.username) : undefined;
  if (!data || !item) { try { await chrome.action.openPopup(); } catch { /* só pelo ícone */ } return; }
  await touch(data.settings.autoLockMinutes);
  const code = item.otp && item.otp.type !== 'hotp' ? await totp(item.otp) : undefined;
  await chrome.tabs.sendMessage(tab.id, { type: 'doFill', username: item.username, password: safeTransport(item, tab.url) ? item.password : '', code }, { frameId: 0 }).catch(() => {});
});
