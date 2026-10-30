import { b64, importDataKey, unsealWithKey } from '../../src/core/crypto';
import type { Item, SealedBlobV2, VaultData } from '../../src/core/types';

// Armazenamento da extensão:
// • chrome.storage.local  → cofre CIFRADO e o e-mail da conta (persistem no disco);
// • chrome.storage.session → chave de dados aberta (só na memória; some ao fechar o navegador ou no bloqueio).

export const local = {
  get: async <T>(k: string) => (await chrome.storage.local.get(k))[k] as T | undefined,
  set: (k: string, v: unknown) => chrome.storage.local.set({ [k]: v }),
  remove: (k: string) => chrome.storage.local.remove(k)
};

export const sess = {
  get: async <T>(k: string) => (await chrome.storage.session.get(k))[k] as T | undefined,
  set: (k: string, v: unknown) => chrome.storage.session.set({ [k]: v }),
  clear: () => chrome.storage.session.clear()
};

export interface Link { email: string; pulledAt: number }

/** Login capturado num formulário, esperando a pessoa decidir se salva (fica só na memória da sessão). */
export interface Capture { url: string; username: string; password: string; offer: 'new' | 'update'; itemId?: string; at: number }

/** Abre o cofre com a chave guardada na memória da sessão. `null` = bloqueado. */
export async function openData(): Promise<VaultData | null> {
  const [dek, blob, lockAt] = await Promise.all([sess.get<string>('dek'), local.get<SealedBlobV2>('vault'), sess.get<number>('lockAt')]);
  if (!dek || !blob) return null;
  if (lockAt && Date.now() > lockAt) { await sess.clear(); return null; }
  try {
    return await unsealWithKey<VaultData>(await importDataKey(b64.from(dek)), blob);
  } catch {
    await sess.clear();
    return null;
  }
}

/** Adia o bloqueio automático (chamado a cada uso). */
export async function touch(minutes: number) {
  await sess.set('lockAt', Date.now() + Math.max(1, minutes) * 60_000);
}

/* ---------- Domínios: só entrega senha para o site certo ---------- */

const TWO_LEVEL = /\.(com|net|org|gov|edu|co|ac|art|blog|eco|ind|inf|log|med|mus|tv)\.[a-z]{2}$/i;

export function hostOf(url: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'https://' + url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** "accounts.google.com" → "google.com"; "app.nubank.com.br" → "nubank.com.br". */
export function baseDomain(host: string): string {
  const parts = host.split('.');
  return parts.slice(TWO_LEVEL.test(host) ? -3 : -2).join('.');
}

/**
 * Domínios onde cada subdomínio é de um dono diferente (hospedagem compartilhada):
 * neles "alice.github.io" NUNCA pode receber a senha de "bob.github.io".
 */
const SHARED_HOSTS = /(^|\.)(github\.io|gitlab\.io|vercel\.app|netlify\.app|pages\.dev|workers\.dev|herokuapp\.com|firebaseapp\.com|web\.app|appspot\.com|blogspot\.com|wordpress\.com|wixsite\.com|azurewebsites\.net|cloudfront\.net|amazonaws\.com|onrender\.com|fly\.dev|glitch\.me|repl\.co|ngrok\.io|ngrok-free\.app|neocities\.org|myshopify\.com|supabase\.co)$/i;

/** O item serve para a página? Mesmo domínio-base (subdomínios contam), exceto em hospedagens compartilhadas. */
export function matchesSite(item: Item, pageUrl: string): boolean {
  const a = hostOf(item.url), b = hostOf(pageUrl);
  if (!a || !b || item.kind !== 'login' || item.trashed) return false;
  if (SHARED_HOSTS.test(a) || SHARED_HOSTS.test(b)) return a === b;
  return baseDomain(a) === baseDomain(b);
}

/** Senha só vai para página sem HTTPS se a conta foi salva explicitamente com http:// (ex.: roteador da casa). */
export function safeTransport(item: Item, pageUrl: string): boolean {
  return /^https:/i.test(pageUrl) || /^http:\/\//i.test(item.url.trim());
}

export function siteItems(data: VaultData, pageUrl: string): Item[] {
  return data.items.filter(i => matchesSite(i, pageUrl))
    .sort((x, y) => (y.lastUsed || 0) - (x.lastUsed || 0) || x.name.localeCompare(y.name, 'pt-BR'));
}
