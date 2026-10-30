import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addRecovery, b64, decryptBytes, deriveAuthSecret, encryptBytes, headerOf, isSealedBlob, needsKdfUpgrade, newKey, newRecoveryKey, openVault,
  importDataKey, rewrap, seal, unsealWithKey, unwrapKey, unwrapWithRecovery, type OpenKey
} from '../core/crypto';
import { mergeVaults } from '../core/merge';
import { emptyVault, newItem, DEFAULT_SETTINGS, type Attachment, type SealedBlob, type VaultData } from '../core/types';
import { ConflictError, cloud, cloudConfigured } from './cloud';
import { db } from './db';
import { bioAvailable, bioProtect, bioReset, bioUnlock } from './native';

type Status = 'loading' | 'setup' | 'locked' | 'unlocked';
export type SyncStatus = 'off' | 'syncing' | 'ok' | 'error' | 'offline';

interface SyncLink { email: string; version: number }

export interface SyncState {
  available: boolean;
  linked: boolean;
  email: string | null;
  status: SyncStatus;
  last: number | null;
  error: string | null;
}

interface BackupFile {
  app: 'cofre-backup';
  v: 1;
  vault: SealedBlob;
  files: Record<string, { iv: string; ct: string }>;
}

interface VaultApi {
  status: Status;
  data: VaultData | null;
  sync: SyncState;
  /** O cofre aberto tem Kit de Emergência (chave de recuperação)? */
  hasKit: boolean;
  /** Desbloqueio rápido (Windows Hello / digital): o aparelho suporta? está ligado neste aparelho? */
  bio: { available: boolean; enabled: boolean };
  enableBio(password: string): Promise<void>;
  disableBio(): Promise<void>;
  /** 'cancel' = a pessoa desistiu; 'invalid' = precisa reativar (chave do cofre mudou ou digital nova cadastrada). */
  unlockBio(): Promise<'ok' | 'cancel' | 'invalid'>;
  create(password: string): Promise<void>;
  unlock(password: string): Promise<boolean>;
  /** Cadastro: cria o cofre com Kit de Emergência e a conta. `needsCode`: falta confirmar o e-mail. */
  register(name: string, email: string, password: string): Promise<{ needsCode: boolean; recoveryKey: string }>;
  verifySignup(code: string): Promise<void>;
  verifySignupLink(): Promise<void>;
  resendSignup(): Promise<void>;
  /** Termina o cadastro/recuperação e abre o cofre. */
  enter(): void;
  /** Primeiro acesso num aparelho novo: entra na conta e baixa o cofre. 'mfa' = falta o código 2FA da conta. */
  login(email: string, password: string): Promise<'ok' | 'mfa'>;
  loginMfa(code: string): Promise<void>;
  /** Recuperação pela conta: envia código ao e-mail → confirma → nova senha mestra com o Kit de Emergência. */
  recoverRequest(email: string): Promise<void>;
  recoverVerify(email: string, code: string): Promise<'ok' | 'mfa'>;
  recoverMfa(code: string): Promise<void>;
  recoverFinish(email: string, recoveryKey: string, newPassword: string): Promise<void>;
  /** Recuperação só neste aparelho (sem conta). */
  recoverLocal(recoveryKey: string, newPassword: string): Promise<void>;
  /** Gera (ou troca) o Kit de Emergência do cofre aberto e devolve a chave nova. */
  addEmergencyKit(): Promise<string>;
  lock(): void;
  update(mutate: (d: VaultData) => void): Promise<void>;
  addFile(file: File): Promise<Attachment>;
  readFile(att: Attachment): Promise<Blob>;
  deleteFile(id: string): Promise<void>;
  changeMaster(current: string, next: string): Promise<boolean>;
  exportBackup(): Promise<Blob>;
  importBackup(file: File): Promise<void>;
  /** Liga a sincronização deste cofre a uma conta. Retorna 'confirm' se o e-mail precisar ser confirmado antes. */
  enableSync(email: string, password: string, mode: 'create' | 'link'): Promise<'ok' | 'confirm'>;
  disableSync(): Promise<void>;
  /** Apaga a conta e tudo do servidor (o cofre continua neste aparelho, sem sincronizar). */
  deleteAccount(password: string): Promise<void>;
  syncNow(): Promise<void>;
}

const Ctx = createContext<VaultApi | null>(null);
const KEY = 'vault';
const LINK = 'sync';
/** Chave do cofre protegida pelo sistema (só deste aparelho; nunca sincroniza). */
const BIO = 'bio';

interface LegacyEntry {
  id: string; name: string; url?: string; username?: string; password?: string;
  otp?: VaultData['items'][number]['otp']; notes?: string; created?: number; updated?: number;
}

/** Aceita cofres de versões anteriores (inclusive o cofre.html de arquivo único) e completa campos novos. */
function migrate(raw: VaultData | { entries: LegacyEntry[] }): VaultData {
  if ('entries' in raw && Array.isArray(raw.entries)) {
    const v = emptyVault();
    v.items = raw.entries.map(e => newItem({
      id: e.id, name: e.name, url: e.url || '', username: e.username || '', password: e.password || '',
      otp: e.otp || null, notes: e.notes || '', created: e.created || Date.now(), updated: e.updated || Date.now()
    }));
    return v;
  }
  const d = raw as VaultData;
  return {
    ...emptyVault(), ...d,
    settings: { ...DEFAULT_SETTINGS, ...d.settings },
    deleted: d.deleted || {},
    items: d.items.map(i => newItem(i))
  };
}

/** Recifra os anexos locais de uma chave para outra (migração v1→v2 ou ao adotar a chave da conta). */
async function reencryptFiles(from: CryptoKey, to: CryptoKey) {
  for (const id of await db.fileIds()) {
    const f = await db.getFile(String(id));
    if (f) await db.setFile(String(id), await encryptBytes(to, await decryptBytes(from, f.iv, f.ct)));
  }
}

const OFF: SyncState = { available: cloudConfigured, linked: false, email: null, status: 'off', last: null, error: null };

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<VaultData | null>(null);
  const [sync, setSync] = useState<SyncState>(OFF);
  const [bio, setBio] = useState({ available: false, enabled: false });
  const session = useRef<OpenKey | null>(null);
  const dataRef = useRef<VaultData | null>(null);
  const linkRef = useRef<SyncLink | null>(null);
  const syncing = useRef(false);
  const again = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>();
  dataRef.current = data;

  const setLocal = useCallback((d: VaultData) => { dataRef.current = d; setData(d); }, []);

  useEffect(() => {
    (async () => {
      const [b, link, stored, available] = await Promise.all([db.get<SealedBlob>(KEY), db.get<SyncLink>(LINK), db.get<string>(BIO), bioAvailable()]);
      if (link) { linkRef.current = link; setSync(s => ({ ...s, linked: true, email: link.email })); }
      setBio({ available, enabled: available && !!stored });
      setStatus(b ? 'locked' : 'setup');
    })().catch(() => setStatus('setup'));
  }, []);

  // Gravações em fila: duas edições seguidas (ex.: excluir e "Desfazer") não podem chegar ao disco fora de ordem,
  // senão a versão mais antiga, cifrada por último, sobrescreveria a nova.
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const persist = useCallback((next: VaultData) => {
    const s = session.current;
    if (!s) return Promise.reject(new Error('Hanko bloqueado'));
    const run = writes.current.catch(() => {}).then(async () => { await db.set(KEY, await seal(s, next)); });
    writes.current = run;
    return run;
  }, []);

  /* ---------- Sincronização ---------- */

  const syncFiles = useCallback(async (d: VaultData) => {
    const s = session.current;
    if (!s) return;
    const wanted = new Set(d.items.flatMap(i => i.attachments.map(a => a.id)));
    const local = new Set((await db.fileIds()).map(String));
    const remote = await cloud.listFiles();
    for (const id of wanted) {
      if (local.has(id) && !remote.has(id)) {
        const f = await db.getFile(id);
        if (f) await cloud.uploadFile(id, f.iv, f.ct);
      } else if (!local.has(id) && remote.has(id)) {
        const f = await cloud.downloadFile(id);
        if (f) await db.setFile(id, f);
      }
    }
    for (const id of remote) if (!wanted.has(id)) await cloud.removeFile(id);
    for (const id of local) if (!wanted.has(id)) await db.deleteFile(id);
  }, []);

  const syncNow = useCallback(async () => {
    const link = linkRef.current;
    if (!cloudConfigured || !link || !session.current || !dataRef.current) return;
    if (syncing.current) { again.current = true; return; }
    syncing.current = true;
    setSync(s => ({ ...s, status: 'syncing', error: null }));
    const started = session.current!;
    // Se o cofre for bloqueado no meio da sincronização, nada do que veio do servidor volta para a memória.
    const stillOpen = () => !!session.current && session.current.dekRaw === started.dekRaw;
    try {
      const snapshot = dataRef.current;
      let merged = snapshot;
      for (let attempt = 0; ; attempt++) {
        const remote = await cloud.pull();
        merged = snapshot;
        let changed = !remote;
        if (remote) {
          let rd: VaultData;
          try { rd = migrate(await unsealWithKey<VaultData>(session.current.dek, remote.blob)); }
          catch { throw new Error('O cofre desta conta foi criado com outra chave. Saia da conta e entre de novo.'); }
          merged = mergeVaults(rd, snapshot);
          if (remote.blob.kt > session.current.header.kt) session.current = { ...session.current, header: headerOf(remote.blob) };
          changed = JSON.stringify(merged) !== JSON.stringify(rd) || remote.blob.kt !== session.current.header.kt;
        }
        if (!changed) { link.version = remote!.version; break; }
        try {
          link.version = await cloud.push(await seal(session.current, merged), remote?.version ?? 0);
          break;
        } catch (e) {
          if (e instanceof ConflictError && attempt < 3) continue;
          throw e;
        }
      }
      await db.set(LINK, link);
      if (!stillOpen()) { setSync(s => ({ ...s, status: 'ok', last: Date.now(), error: null })); return; }
      // Se a pessoa editou algo durante a sincronização, junta e agenda outra rodada.
      const latest = dataRef.current!;
      const final = latest === snapshot ? merged : mergeVaults(merged, latest);
      if (latest !== snapshot) again.current = true;
      setLocal(final);
      await persist(final);
      await syncFiles(final);
      setSync(s => ({ ...s, status: 'ok', last: Date.now(), error: null }));
    } catch (e) {
      const msg = (e as Error).message || 'Erro';
      setSync(s => ({ ...s, status: /conexão|fetch|network/i.test(msg) || !navigator.onLine ? 'offline' : 'error', error: msg }));
    } finally {
      syncing.current = false;
      if (again.current) { again.current = false; setTimeout(() => syncNow(), 300); }
    }
  }, [persist, setLocal, syncFiles]);

  const scheduleSync = useCallback(() => {
    if (!linkRef.current) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => syncNow(), 1200);
  }, [syncNow]);

  // Enquanto aberto: sincroniza a cada minuto e ao voltar para o app.
  useEffect(() => {
    if (status !== 'unlocked' || !sync.linked) return;
    const t = setInterval(() => syncNow(), 60_000);
    const onFocus = () => syncNow();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [status, sync.linked, syncNow]);

  /* ---------- Abrir, criar, bloquear ---------- */

  const create = useCallback(async (password: string) => {
    session.current = await newKey(password);
    const fresh = emptyVault();
    await persist(fresh);
    setLocal(fresh);
    setStatus('unlocked');
  }, [persist, setLocal]);

  const unlock = useCallback(async (password: string) => {
    const blob = await db.get<SealedBlob>(KEY);
    if (!blob) return false;
    let opened;
    try { opened = await openVault<VaultData | { entries: LegacyEntry[] }>(blob, password); }
    catch { return false; }
    session.current = opened.key;
    setHasKit(!!opened.key.header.rk);
    const d = migrate(opened.data);
    // Cofre ainda com PBKDF2: re-embrulha a chave com Argon2id (a senha é a mesma; o cabeçalho novo vai para a nuvem).
    const upgrade = !opened.legacyKey && needsKdfUpgrade(opened.key.header);
    if (upgrade) session.current = { ...opened.key, header: await rewrap(password, opened.key) };
    if (opened.legacyKey) { // cofre da versão 0.1: passa a usar a chave própria do cofre
      await reencryptFiles(opened.legacyKey, opened.key.dek);
    }
    if (opened.legacyKey || upgrade) await persist(d);
    setLocal(d);
    setStatus('unlocked');
    if (linkRef.current) setTimeout(() => syncNow(), 50);
    return true;
  }, [persist, setLocal, syncNow]);

  /* ---------- Conta: login, cadastro e recuperação ---------- */

  const pending = useRef<{ email: string; password: string } | null>(null);
  const [hasKit, setHasKit] = useState(false);

  /** Liga este aparelho à conta já autenticada e salva o cofre vindo do servidor. */
  const adoptRemote = useCallback(async (email: string, key: OpenKey, blob: SealedBlob, version: number, d: VaultData) => {
    session.current = key;
    await db.clearFiles();
    await db.set(KEY, blob);
    await forgetBio();
    const link = { email: email.trim().toLowerCase(), version };
    linkRef.current = link;
    await db.set(LINK, link);
    setSync(s => ({ ...s, linked: true, email: link.email, error: null }));
    setHasKit(!!key.header.rk);
    setLocal(migrate(d));
  }, [setLocal]);

  const finishLogin = useCallback(async (email: string, password: string) => {
    const remote = await cloud.pull();
    if (!remote) { await cloud.signOut(); throw new Error('Esta conta ainda não tem um cofre. Crie o cofre e ative a sincronização nos ajustes.'); }
    let opened;
    try { opened = await openVault<VaultData>(remote.blob, password); }
    catch { await cloud.signOut(); throw new Error('Senha mestra diferente da usada no cofre desta conta.'); }
    await adoptRemote(email, opened.key, remote.blob, remote.version, opened.data);
    if (needsKdfUpgrade(opened.key.header)) {
      session.current = { ...opened.key, header: await rewrap(password, opened.key) };
      await persist(migrate(opened.data));
    }
    pending.current = null;
    setStatus('unlocked');
    setTimeout(() => syncNow(), 50);
  }, [adoptRemote, syncNow]);

  const login = useCallback(async (email: string, password: string): Promise<'ok' | 'mfa'> => {
    await cloud.signIn(email, await deriveAuthSecret(password, email));
    if (await cloud.needsMfa()) { pending.current = { email, password }; return 'mfa'; }
    await finishLogin(email, password);
    return 'ok';
  }, [finishLogin]);

  const loginMfa = useCallback(async (code: string) => {
    const p = pending.current;
    if (!p) throw new Error('Comece o login de novo.');
    await cloud.verifyMfa(code);
    await finishLogin(p.email, p.password);
  }, [finishLogin]);

  /** Grava o cofre novo localmente, liga a conta e envia ao servidor. */
  const linkAndPush = useCallback(async (email: string) => {
    const d = dataRef.current!;
    await persist(d);
    const link = { email: email.trim().toLowerCase(), version: 0 };
    linkRef.current = link;
    await db.set(LINK, link);
    setSync(s => ({ ...s, linked: true, email: link.email, error: null }));
    await syncNow();
  }, [persist, syncNow]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const mail = email.trim().toLowerCase();
    const key = await newKey(password);
    const recoveryKey = newRecoveryKey();
    key.header = await addRecovery(key.header, key.dekRaw, recoveryKey);
    session.current = key;
    setHasKit(true);
    setLocal(emptyVault());
    pending.current = { email: mail, password };
    const hasSession = await cloud.signUp(mail, await deriveAuthSecret(password, mail), name.trim());
    if (hasSession) await linkAndPush(mail);
    return { needsCode: !hasSession, recoveryKey };
  }, [setLocal, linkAndPush]);

  const verifySignup = useCallback(async (code: string) => {
    const p = pending.current;
    if (!p) throw new Error('Comece o cadastro de novo.');
    await cloud.verifySignup(p.email, code);
    await linkAndPush(p.email);
  }, [linkAndPush]);

  /** Se o e-mail veio com link (em vez de código): depois de clicar, entra com os dados do cadastro. */
  const verifySignupLink = useCallback(async () => {
    const p = pending.current;
    if (!p) throw new Error('Comece o cadastro de novo.');
    await cloud.signIn(p.email, await deriveAuthSecret(p.password, p.email));
    await linkAndPush(p.email);
  }, [linkAndPush]);

  const resendSignup = useCallback(async () => {
    if (pending.current) await cloud.resendSignup(pending.current.email);
  }, []);

  const enter = useCallback(() => {
    pending.current = null;
    if (session.current && dataRef.current) setStatus('unlocked');
  }, []);

  const recoverRequest = useCallback((email: string) => cloud.requestRecovery(email), []);

  const recoverVerify = useCallback(async (email: string, code: string): Promise<'ok' | 'mfa'> => {
    await cloud.verifyRecovery(email, code);
    return (await cloud.needsMfa()) ? 'mfa' : 'ok';
  }, []);

  const recoverMfa = useCallback((code: string) => cloud.verifyMfa(code), []);

  const recoverFinish = useCallback(async (email: string, recoveryKey: string, newPassword: string) => {
    const remote = await cloud.pull();
    if (!remote) throw new Error('Esta conta não tem cofre no servidor.');
    let key: OpenKey;
    try { key = await unwrapWithRecovery(recoveryKey, headerOf(remote.blob)); }
    catch (e) { throw new Error((e as Error).message.includes('Kit') ? (e as Error).message : 'Chave de recuperação incorreta.'); }
    const d = await unsealWithKey<VaultData>(key.dek, remote.blob);
    const opened = { ...key, header: await rewrap(newPassword, key) };
    await cloud.changeSecret(await deriveAuthSecret(newPassword, email));
    const blob = await seal(opened, d);
    const version = await cloud.push(blob, remote.version);
    await adoptRemote(email, opened, blob, version, d);
    setTimeout(() => syncNow(), 50);
  }, [adoptRemote, syncNow]);

  const recoverLocal = useCallback(async (recoveryKey: string, newPassword: string) => {
    const blob = await db.get<SealedBlob>(KEY);
    if (!blob || blob.v !== 2) throw new Error('Este cofre não tem Kit de Emergência.');
    let key: OpenKey;
    try { key = await unwrapWithRecovery(recoveryKey, headerOf(blob)); }
    catch (e) { throw new Error((e as Error).message.includes('Kit') ? (e as Error).message : 'Chave de recuperação incorreta.'); }
    const d = migrate(await unsealWithKey<VaultData>(key.dek, blob));
    session.current = { ...key, header: await rewrap(newPassword, key) };
    const link = linkRef.current;
    if (link && (await cloud.session())) await cloud.changeSecret(await deriveAuthSecret(newPassword, link.email)).catch(() => {});
    await persist(d);
    setHasKit(true);
    setLocal(d);
  }, [persist, setLocal]);

  const addEmergencyKit = useCallback(async () => {
    const s = session.current;
    if (!s || !dataRef.current) throw new Error('Hanko bloqueado');
    const rk = newRecoveryKey();
    session.current = { ...s, header: await addRecovery(s.header, s.dekRaw, rk) };
    await persist(dataRef.current);
    setHasKit(true);
    scheduleSync();
    return rk;
  }, [persist, scheduleSync]);

  /* ---------- Desbloqueio rápido ---------- */

  async function forgetBio() {
    await db.set(BIO, null);
    bioReset();
    setBio(b => ({ ...b, enabled: false }));
  }

  const enableBio = useCallback(async (password: string) => {
    const s = session.current;
    if (!s) throw new Error('Hanko bloqueado');
    try { await unwrapKey(password, s.header); } catch { throw new Error('Senha mestra incorreta.'); }
    const stored = await bioProtect(s.dekRaw);
    await db.set(BIO, stored);
    setBio(b => ({ ...b, enabled: true }));
  }, []);

  const disableBio = useCallback(() => forgetBio(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const unlockBio = useCallback(async (): Promise<'ok' | 'cancel' | 'invalid'> => {
    const [blob, stored] = await Promise.all([db.get<SealedBlob>(KEY), db.get<string>(BIO)]);
    if (!blob || blob.v !== 2 || !stored) return 'invalid';
    let dekRaw;
    try { dekRaw = await bioUnlock(stored); }
    catch (e) { const m = (e as Error).message; if (/cancel/i.test(m)) return 'cancel'; if (/invalida/i.test(m)) { await forgetBio(); return 'invalid'; } throw e; }
    const dek = await importDataKey(dekRaw);
    let raw;
    try { raw = await unsealWithKey<VaultData>(dek, blob); }
    catch { await forgetBio(); return 'invalid'; } // a chave do cofre mudou desde que o desbloqueio rápido foi ligado
    session.current = { dek, dekRaw, header: headerOf(blob) };
    setHasKit(!!blob.rk);
    setLocal(migrate(raw));
    setStatus('unlocked');
    if (linkRef.current) setTimeout(() => syncNow(), 50);
    return 'ok';
  }, [setLocal, syncNow]); // eslint-disable-line react-hooks/exhaustive-deps

  const lock = useCallback(() => {
    clearTimeout(debounce.current);
    session.current = null;
    pending.current = null;
    setLocal(null as unknown as VaultData);
    setStatus('locked');
  }, [setLocal]);

  const update = useCallback(async (mutate: (d: VaultData) => void) => {
    const cur = dataRef.current;
    if (!cur) return;
    const next: VaultData = structuredClone(cur);
    mutate(next);
    next.lastChange = Date.now();
    setLocal(next);
    await persist(next);
    scheduleSync();
  }, [persist, setLocal, scheduleSync]);

  // Só no modo de desenvolvimento: permite popular um cofre de teste pelo console.
  if (import.meta.env.DEV) (window as unknown as { __hankoUpdate?: typeof update }).__hankoUpdate = update;

  /* ---------- Anexos ---------- */

  const addFile = useCallback(async (file: File): Promise<Attachment> => {
    const s = session.current;
    if (!s) throw new Error('Hanko bloqueado');
    const id = crypto.randomUUID();
    const { iv, ct } = await encryptBytes(s.dek, new Uint8Array(await file.arrayBuffer()));
    await db.setFile(id, { iv, ct });
    return { id, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, added: Date.now() };
  }, []);

  const readFile = useCallback(async (att: Attachment) => {
    const s = session.current;
    if (!s) throw new Error('Hanko bloqueado');
    let f = await db.getFile(att.id);
    if (!f && linkRef.current) {
      const r = await cloud.downloadFile(att.id);
      if (r) { f = r; await db.setFile(att.id, r); }
    }
    if (!f) throw new Error('Arquivo não encontrado');
    return new Blob([await decryptBytes(s.dek, f.iv, f.ct)], { type: att.mime });
  }, []);

  const deleteFile = useCallback(async (id: string) => {
    await db.deleteFile(id);
    if (linkRef.current) cloud.removeFile(id).catch(() => {});
  }, []);

  /* ---------- Senha mestra ---------- */

  const changeMaster = useCallback(async (current: string, next: string) => {
    const s = session.current;
    const cur = dataRef.current;
    if (!s || !cur) return false;
    try { await unwrapKey(current, s.header); } catch { return false; }
    const header = await rewrap(next, s);
    const link = linkRef.current;
    if (link) await cloud.changeSecret(await deriveAuthSecret(next, link.email));
    session.current = { ...s, header };
    const d = { ...cur, lastBackup: null, lastChange: Date.now() };
    setLocal(d);
    await persist(d);
    scheduleSync();
    return true;
  }, [persist, setLocal, scheduleSync]);

  /* ---------- Conta ---------- */

  const enableSync = useCallback(async (email: string, password: string, mode: 'create' | 'link'): Promise<'ok' | 'confirm'> => {
    const s = session.current;
    const cur = dataRef.current;
    if (!s || !cur) throw new Error('Hanko bloqueado');
    try { await unwrapKey(password, s.header); } catch { throw new Error('Senha mestra incorreta.'); }
    const mail = email.trim().toLowerCase();
    const secret = await deriveAuthSecret(password, mail);
    if (mode === 'create') {
      const hasSession = await cloud.signUp(mail, secret);
      if (!hasSession) return 'confirm';
    } else {
      await cloud.signIn(mail, secret);
    }
    const remote = await cloud.pull();
    let merged = cur;
    let version = 0;
    if (remote) {
      let opened;
      try { opened = await openVault<VaultData>(remote.blob, password); }
      catch { await cloud.signOut(); throw new Error('O cofre desta conta usa outra senha mestra.'); }
      // Adota a chave do cofre da conta e traz os anexos deste aparelho para ela.
      await reencryptFiles(s.dek, opened.key.dek);
      session.current = opened.key;
      await forgetBio();
      merged = mergeVaults(migrate(opened.data), cur);
      version = remote.version;
    }
    const link = { email: mail, version };
    linkRef.current = link;
    await db.set(LINK, link);
    setSync(st => ({ ...st, linked: true, email: mail, error: null }));
    setLocal(merged);
    await persist(merged);
    await syncNow();
    return 'ok';
  }, [persist, setLocal, syncNow]);

  const disableSync = useCallback(async () => {
    linkRef.current = null;
    await db.set(LINK, null);
    await cloud.signOut().catch(() => {});
    setSync({ ...OFF });
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    const s = session.current;
    if (!s) throw new Error('Hanko bloqueado');
    try { await unwrapKey(password, s.header); } catch { throw new Error('Senha mestra incorreta.'); }
    await cloud.deleteAccount();
    linkRef.current = null;
    await db.set(LINK, null);
    setSync({ ...OFF });
  }, []);

  /* ---------- Backup ---------- */

  const exportBackup = useCallback(async () => {
    const cur = dataRef.current;
    if (!cur) throw new Error('Hanko bloqueado');
    const d = { ...cur, lastBackup: Date.now() + 1 };
    setLocal(d);
    await persist(d);
    const files: BackupFile['files'] = {};
    for (const id of await db.fileIds()) {
      const f = await db.getFile(String(id));
      if (f) files[String(id)] = { iv: b64.to(f.iv), ct: b64.to(f.ct) };
    }
    const vault = (await db.get<SealedBlob>(KEY))!;
    const backup: BackupFile = { app: 'cofre-backup', v: 1, vault, files };
    return new Blob([JSON.stringify(backup)], { type: 'application/json' });
  }, [persist, setLocal]);

  const importBackup = useCallback(async (file: File) => {
    const parsed = JSON.parse(await file.text()) as BackupFile | SealedBlob;
    let vault: SealedBlob, files: BackupFile['files'] = {};
    if ((parsed as BackupFile).app === 'cofre-backup') ({ vault, files } = parsed as BackupFile);
    else vault = parsed as SealedBlob; // backup da primeira versão (arquivo único)
    if (!isSealedBlob(vault)) throw new Error('Este arquivo não é um backup do Hanko.');
    await db.clearFiles();
    for (const [id, f] of Object.entries(files)) await db.setFile(id, { iv: b64.from(f.iv), ct: b64.from(f.ct) });
    await db.set(KEY, vault);
    await forgetBio();
    // Um backup pode ter outra chave: desliga a sincronização até a pessoa religar.
    if (linkRef.current) await disableSync();
    lock();
  }, [lock, disableSync]);

  const api = useMemo<VaultApi>(() => ({
    status, data, sync, hasKit, bio, enableBio, disableBio, unlockBio, create, unlock, register, verifySignup, verifySignupLink, resendSignup, enter, login, loginMfa,
    recoverRequest, recoverVerify, recoverMfa, recoverFinish, recoverLocal, addEmergencyKit,
    lock, update, addFile, readFile, deleteFile, changeMaster, exportBackup, importBackup, enableSync, disableSync, deleteAccount, syncNow
  }), [status, data, sync, hasKit, bio, enableBio, disableBio, unlockBio, create, unlock, register, verifySignup, verifySignupLink, resendSignup, enter, login, loginMfa,
    recoverRequest, recoverVerify, recoverMfa, recoverFinish, recoverLocal, addEmergencyKit,
    lock, update, addFile, readFile, deleteFile, changeMaster, exportBackup, importBackup, enableSync, disableSync, deleteAccount, syncNow]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useVault(): VaultApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVault fora do VaultProvider');
  return v;
}
