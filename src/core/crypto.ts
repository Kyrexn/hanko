import { argon2id } from 'hash-wasm';
import type { KeyHeader, SealedBlob, SealedBlobV2 } from './types';

// Criptografia do cofre:
// • senha mestra → Argon2id (64 MiB, 3 passadas) → KEK (chave que embrulha);
//   cofres antigos usam PBKDF2-SHA256 (600 mil iterações) e passam para Argon2id ao abrir;
// • DEK = chave AES-256-GCM aleatória que cifra os dados e os anexos;
// • o arquivo salvo guarda a DEK cifrada pela KEK. Trocar a senha mestra só re-embrulha a DEK.
// Tudo acontece no aparelho; o servidor de sincronização só recebe o resultado cifrado.
export const KDF_ITERATIONS = 600_000;
/** Argon2id: 64 MiB de memória deixam cada tentativa cara também em placas de vídeo (recomendação OWASP ≥ 19 MiB). */
export const ARGON = { mem: 65_536, iter: 3, par: 1 } as const;

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Bytes sempre apoiados em ArrayBuffer comum (o que a WebCrypto exige). */
export type Bytes = Uint8Array<ArrayBuffer>;

export const b64 = {
  to(u8: Uint8Array): string {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  from(str: string): Bytes {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
  }
};

export function randomBytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function pbkdf2(password: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export const deriveKey = pbkdf2;

async function argonKey(password: string, salt: Bytes, p: { mem: number; iter: number; par: number }): Promise<CryptoKey> {
  const raw = await argon2id({ password, salt, memorySize: p.mem, iterations: p.iter, parallelism: p.par, hashLength: 32, outputType: 'binary' });
  return crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Chave que embrulha a DEK, conforme o algoritmo indicado no cabeçalho. */
function kekFor(password: string, h: Pick<KeyHeader, 'kdf' | 'iter' | 'mem' | 'par' | 'salt'>): Promise<CryptoKey> {
  const salt = b64.from(h.salt);
  if (h.kdf === 'Argon2id') return argonKey(password, salt, { mem: h.mem || ARGON.mem, iter: h.iter, par: h.par || 1 });
  return pbkdf2(password, salt, h.iter);
}

/** O cabeçalho ainda usa o algoritmo antigo (PBKDF2)? Então vale re-embrulhar com Argon2id. */
export const needsKdfUpgrade = (h: KeyHeader) => h.kdf !== 'Argon2id' || (h.mem || 0) < ARGON.mem;

export async function encryptBytes(key: CryptoKey, data: Bytes): Promise<{ iv: Bytes; ct: Bytes }> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return { iv, ct };
}

/** Lança erro se a chave estiver errada ou os dados foram alterados (autenticação do GCM). */
export async function decryptBytes(key: CryptoKey, iv: Bytes, ct: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}

export function importDataKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Sessão aberta: a DEK (e seus bytes, só na memória, para re-embrulhar ao trocar a senha) e o cabeçalho atual. */
export interface OpenKey {
  dek: CryptoKey;
  dekRaw: Bytes;
  header: KeyHeader;
}

/** Cria uma DEK nova e a embrulha com a senha mestra. */
export async function newKey(password: string): Promise<OpenKey> {
  const dekRaw = randomBytes(32);
  return { dek: await importDataKey(dekRaw), dekRaw, header: await wrapKey(password, dekRaw) };
}

/** Embrulha a DEK com uma senha mestra (sal novo a cada vez), sempre com Argon2id. */
export async function wrapKey(password: string, dekRaw: Bytes): Promise<KeyHeader> {
  const salt = randomBytes(16);
  const kek = await argonKey(password, salt, ARGON);
  const { iv, ct } = await encryptBytes(kek, dekRaw);
  return { kdf: 'Argon2id', iter: ARGON.iter, mem: ARGON.mem, par: ARGON.par, salt: b64.to(salt), wiv: b64.to(iv), wk: b64.to(ct), kt: Date.now() };
}

/** Desembrulha a DEK de um cabeçalho com a senha mestra. Lança erro se a senha estiver errada. */
export async function unwrapKey(password: string, header: KeyHeader): Promise<OpenKey> {
  const kek = await kekFor(password, header);
  const dekRaw = await decryptBytes(kek, b64.from(header.wiv), b64.from(header.wk));
  return { dek: await importDataKey(dekRaw), dekRaw, header };
}

export function headerOf(blob: SealedBlobV2): KeyHeader {
  const { kdf, iter, mem, par, salt, wiv, wk, kt, rsalt, riv, rk } = blob;
  const base: KeyHeader = kdf === 'Argon2id' ? { kdf, iter, mem, par, salt, wiv, wk, kt } : { kdf, iter, salt, wiv, wk, kt };
  return rk ? { ...base, rsalt, riv, rk } : base;
}

/* ---------- Kit de Emergência (chave de recuperação) ---------- */

const RK_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: sem I, L, O, U

/** Chave de recuperação: 30 caracteres (150 bits) em blocos de 5 — "7KQ2M-…". */
export function newRecoveryKey(): string {
  const bytes = randomBytes(30);
  const chars = Array.from(bytes, b => RK_ALPHABET[b & 31]).join('');
  return chars.match(/.{5}/g)!.join('-');
}

export function normalizeRecoveryKey(k: string): string {
  return k.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** Embrulha a DEK também com a chave de recuperação (o cofre passa a abrir com qualquer uma das duas). */
export async function addRecovery(header: KeyHeader, dekRaw: Bytes, recoveryKey: string): Promise<KeyHeader> {
  const rsalt = randomBytes(16);
  const kek = await pbkdf2(normalizeRecoveryKey(recoveryKey), rsalt, 200_000);
  const { iv, ct } = await encryptBytes(kek, dekRaw);
  return { ...header, rsalt: b64.to(rsalt), riv: b64.to(iv), rk: b64.to(ct), kt: Date.now() };
}

export async function unwrapWithRecovery(recoveryKey: string, header: KeyHeader): Promise<OpenKey> {
  if (!header.rk || !header.rsalt || !header.riv) throw new Error('Este cofre não tem Kit de Emergência.');
  const kek = await pbkdf2(normalizeRecoveryKey(recoveryKey), b64.from(header.rsalt), 200_000);
  const dekRaw = await decryptBytes(kek, b64.from(header.riv), b64.from(header.rk));
  return { dek: await importDataKey(dekRaw), dekRaw, header };
}

/** Troca a senha mestra mantendo a chave de recuperação já existente. */
export async function rewrap(password: string, key: OpenKey): Promise<KeyHeader> {
  const fresh = await wrapKey(password, key.dekRaw);
  const { rsalt, riv, rk } = key.header;
  return rk ? { ...fresh, rsalt, riv, rk } : fresh;
}

export async function seal(key: OpenKey, obj: unknown): Promise<SealedBlobV2> {
  const { iv, ct } = await encryptBytes(key.dek, enc.encode(JSON.stringify(obj)));
  return { app: 'cofre', v: 2, ...key.header, iv: b64.to(iv), ct: b64.to(ct) };
}

export async function unsealWithKey<T>(dek: CryptoKey, blob: { iv: string; ct: string }): Promise<T> {
  const pt = await decryptBytes(dek, b64.from(blob.iv), b64.from(blob.ct));
  return JSON.parse(dec.decode(pt)) as T;
}

/**
 * Abre um cofre com a senha mestra.
 * Para o formato v1 (versão 0.1) devolve `legacyKey`: a chave antiga, para recifrar os anexos na migração.
 */
export async function openVault<T>(blob: SealedBlob, password: string): Promise<{ key: OpenKey; data: T; legacyKey?: CryptoKey }> {
  if (blob.v === 2) {
    const key = await unwrapKey(password, headerOf(blob));
    return { key, data: await unsealWithKey<T>(key.dek, blob) };
  }
  const legacyKey = await pbkdf2(password, b64.from(blob.salt), blob.iter);
  const data = await unsealWithKey<T>(legacyKey, blob);
  return { key: await newKey(password), data, legacyKey };
}

/**
 * Segredo de login no servidor, derivado da senha mestra e do e-mail com um sal diferente do da KEK.
 * O servidor nunca recebe a senha mestra nem algo que abra o cofre.
 */
export async function deriveAuthSecret(password: string, email: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('cofre-login|' + email.trim().toLowerCase()), iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    base, 256
  ));
  return b64.to(bits).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isSealedBlob(b: unknown): b is SealedBlob {
  const x = b as SealedBlob;
  if (!x || x.app !== 'cofre' || typeof x.iv !== 'string' || typeof x.ct !== 'string' || typeof x.salt !== 'string') return false;
  if (!Number.isInteger(x.iter)) return false;
  if (x.v === 2 && x.kdf === 'Argon2id') { if (x.iter < 2 || !Number.isInteger(x.mem) || (x.mem as number) < 19_456) return false; }
  else if (x.iter < 100_000) return false;
  return x.v === 1 || (x.v === 2 && typeof x.wk === 'string' && typeof x.wiv === 'string');
}
