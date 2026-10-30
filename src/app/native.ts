// Recursos do sistema operacional (Windows e Android). No navegador comum tudo vira "indisponível".
import { b64, type Bytes } from '../core/crypto';

interface AndroidBridge {
  setSecure(on: boolean): void;
  bioAvailable(): boolean;
  bioReset(): void;
  bioEncrypt(reqId: string, dataB64: string): void;
  bioDecrypt(reqId: string, payload: string): void;
  installUpdate?(reqId: string, url: string): void;
}

type W = Window & { HankoAndroid?: AndroidBridge; __hankoBio?: (id: string, ok: boolean, value: string) => void; __hankoProgress?: (pct: number) => void; __TAURI_INTERNALS__?: unknown };
const w = window as W;

export const isTauri = () => '__TAURI_INTERNALS__' in window;
const android = () => w.HankoAndroid;
const isWindowsApp = () => isTauri() && /Windows/i.test(navigator.userAgent);

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Nome do desbloqueio rápido para mostrar na tela. */
export const bioName = () => (android() ? 'digital ou rosto' : 'Windows Hello');

/* ---------- Extensão do navegador (pasta mantida pelo app do Windows) ---------- */

export interface ExtensionStatus { available: boolean; installed: boolean; path: string; version: string }

export async function extensionStatus(): Promise<ExtensionStatus | null> {
  if (!isWindowsApp()) return null;
  try { return await invoke<ExtensionStatus>('extension_status'); } catch { return null; }
}
export const extensionInstall = () => invoke<string>('extension_install');
export const openBrowserExtensions = (browser: 'chrome' | 'edge') => invoke('open_browser_extensions', { browser });
export const openExtensionFolder = () => invoke('open_extension_folder');

/* ---------- Proteção contra captura de tela ---------- */

export const screenProtectSupported = () => !!android() || isWindowsApp();

export async function setScreenProtect(on: boolean) {
  try {
    if (android()) android()!.setSecure(on);
    else if (isWindowsApp()) await invoke('set_screen_protect', { on });
  } catch { /* sem suporte: segue sem a proteção */ }
}

/* ---------- Desbloqueio rápido (Windows Hello / biometria do Android) ---------- */

// Respostas assíncronas do Android chegam por window.__hankoBio(id, ok, valor).
const waiting = new Map<string, { resolve(v: string): void; reject(e: Error): void }>();
w.__hankoBio = (id, ok, value) => {
  const p = waiting.get(id);
  if (!p) return;
  waiting.delete(id);
  if (ok) p.resolve(value);
  else p.reject(new Error(value));
};
function askAndroid(run: (id: string) => void): Promise<string> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); run(id); });
}

export async function bioAvailable(): Promise<boolean> {
  try {
    if (android()) return android()!.bioAvailable();
    if (isWindowsApp()) return await invoke<boolean>('bio_available');
  } catch { /* indisponível */ }
  return false;
}

/** Guarda a chave do cofre protegida pelo sistema (pede a biometria/Hello para confirmar). Devolve o texto a guardar. */
export async function bioProtect(dekRaw: Bytes): Promise<string> {
  if (android()) return 'a:' + await askAndroid(id => android()!.bioEncrypt(id, b64.to(dekRaw)));
  const out = await invoke<number[]>('bio_protect', { data: Array.from(dekRaw) });
  return 'w:' + b64.to(new Uint8Array(out));
}

/** Pede a biometria/Hello e devolve a chave do cofre. Erro "cancelado" quando a pessoa desiste. */
export async function bioUnlock(stored: string): Promise<Bytes> {
  if (stored.startsWith('a:')) {
    if (!android()) throw new Error('invalida');
    return b64.from(await askAndroid(id => android()!.bioDecrypt(id, stored.slice(2))));
  }
  const out = await invoke<number[]>('bio_unlock', { data: Array.from(b64.from(stored.slice(2))) });
  return new Uint8Array(out);
}

/** Android: baixa o APK oficial e abre o instalador do sistema (1 toque). Sem a ponte nativa, devolve false. */
export async function androidInstallUpdate(url: string, onProgress: (pct: number | null) => void): Promise<boolean> {
  const a = android();
  if (!a?.installUpdate) return false;
  w.__hankoProgress = pct => onProgress(pct < 0 ? null : pct);
  try { await askAndroid(id => a.installUpdate!(id, url)); return true; }
  finally { w.__hankoProgress = undefined; }
}

export function bioReset() {
  try { android()?.bioReset(); } catch { /* nada a apagar */ }
}
