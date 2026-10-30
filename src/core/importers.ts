import type { Folder, Item, OtpAlgorithm, OtpParams, VaultData } from './types';
import { emptyCard, emptyIdentity, newItem } from './types';
import { parseOtp } from './totp';

// Importação de outros gerenciadores (tudo acontece no aparelho).

export interface ImportResult {
  items: Item[];
  folders: Folder[];
  source: string;
}

/* ---------- CSV ---------- */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  const firstLine = s.slice(0, s.search(/\r?\n|$/));
  const sep = !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

const pick = (h: string[], names: string[]) => h.findIndex(x => names.includes(x.trim().toLowerCase()));

function otpFrom(v: string): OtpParams | null {
  if (!v.trim()) return null;
  try {
    const p = parseOtp(v);
    return p ? { secret: p.secret, digits: p.digits, period: p.period, algorithm: p.algorithm } : null;
  } catch { return null; }
}

function folderFor(name: string, folders: Folder[]): string | null {
  const n = name.trim();
  if (!n) return null;
  let f = folders.find(x => x.name.toLowerCase() === n.toLowerCase());
  if (!f) { f = { id: crypto.randomUUID(), name: n }; folders.push(f); }
  return f.id;
}

export function importCsv(text: string, existing: Folder[]): ImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('O arquivo CSV está vazio.');
  const h = rows[0].map(x => x.trim().toLowerCase());
  const col = {
    name: pick(h, ['name', 'title', 'nome', 'título', 'titulo']),
    url: pick(h, ['url', 'login_uri', 'website', 'site', 'uri']),
    user: pick(h, ['username', 'login_username', 'user', 'usuário', 'usuario', 'email', 'login']),
    pass: pick(h, ['password', 'login_password', 'senha']),
    totp: pick(h, ['totp', 'login_totp', 'otpauth', 'otp', 'one-time password']),
    notes: pick(h, ['note', 'notes', 'extra', 'notas', 'observações']),
    folder: pick(h, ['folder', 'grouping', 'pasta', 'group', 'vault']),
    fav: pick(h, ['favorite', 'fav']),
    type: pick(h, ['type'])
  };
  if (col.pass < 0 && col.user < 0) throw new Error('Não reconheci as colunas do CSV (preciso de pelo menos usuário ou senha).');
  const folders = [...existing];
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] || '').trim() : '');
  const items = rows.slice(1).map(r => {
    const url = get(r, col.url);
    const isNote = get(r, col.type) === 'note' || (!!url && url === 'http://sn');
    let name = get(r, col.name);
    if (!name && url) try { name = new URL(/^\w+:\/\//.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch { name = url; }
    return newItem({
      kind: isNote ? 'note' : 'login',
      name: name || 'Sem nome',
      url: isNote ? '' : url,
      username: get(r, col.user),
      password: get(r, col.pass),
      otp: otpFrom(get(r, col.totp)),
      notes: get(r, col.notes),
      folderId: folderFor(get(r, col.folder), folders),
      favorite: ['1', 'true', 'yes', 'sim'].includes(get(r, col.fav).toLowerCase()),
      passwordChanged: Date.now()
    });
  }).filter(i => i.name || i.password);
  const source = h.includes('login_uri') ? 'Bitwarden (CSV)' : h.includes('grouping') ? 'LastPass' : h.includes('otpauth') ? '1Password' : h.join(',') === 'name,url,username,password,note' ? 'Chrome / Edge' : 'CSV';
  return { items, folders: folders.slice(existing.length), source };
}

/* ---------- Bitwarden JSON (exportação sem senha) ---------- */

interface BwItem {
  type: number; name: string; notes?: string | null; favorite?: boolean; folderId?: string | null;
  login?: { uris?: { uri: string }[]; username?: string; password?: string; totp?: string };
  card?: { cardholderName?: string; number?: string; brand?: string; expMonth?: string; expYear?: string; code?: string };
  identity?: { firstName?: string; middleName?: string; lastName?: string; ssn?: string; email?: string; phone?: string; address1?: string; city?: string; state?: string };
  fields?: { name: string; value: string; type: number }[];
}

export function importJson(text: string, existing: Folder[]): ImportResult {
  const j = JSON.parse(text);
  if (j.encrypted) throw new Error('Esse arquivo do Bitwarden está protegido por senha. Exporte no formato “.json” sem senha.');
  if (Array.isArray(j.items)) {
    const folders = [...existing];
    const fmap = new Map<string, string>();
    for (const f of j.folders || []) fmap.set(f.id, folderFor(f.name, folders)!);
    const items = (j.items as BwItem[]).map(b => {
      const base = {
        name: b.name || 'Sem nome', notes: b.notes || '', favorite: !!b.favorite, folderId: b.folderId ? fmap.get(b.folderId) || null : null,
        fields: (b.fields || []).map(f => ({ id: crypto.randomUUID(), label: f.name, value: f.value || '', hidden: f.type === 1 }))
      };
      if (b.type === 3 && b.card) {
        const c = b.card;
        return newItem({ ...base, kind: 'card', card: { ...emptyCard(), holder: c.cardholderName || '', number: c.number || '', brand: c.brand || '',
          expiry: c.expMonth && c.expYear ? `${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}` : '', cvv: c.code || '' } });
      }
      if (b.type === 4 && b.identity) {
        const i = b.identity;
        return newItem({ ...base, kind: 'identity', identity: { ...emptyIdentity(),
          fullName: [i.firstName, i.middleName, i.lastName].filter(Boolean).join(' '), cpf: i.ssn || '', email: i.email || '', phone: i.phone || '',
          address: [i.address1, i.city, i.state].filter(Boolean).join(', ') } });
      }
      if (b.type === 2) return newItem({ ...base, kind: 'note' });
      return newItem({ ...base, kind: 'login', url: b.login?.uris?.[0]?.uri || '', username: b.login?.username || '', password: b.login?.password || '',
        otp: otpFrom(b.login?.totp || ''), passwordChanged: Date.now() });
    });
    return { items, folders: folders.slice(existing.length), source: 'Bitwarden (JSON)' };
  }
  if (Array.isArray((j as VaultData).items) || Array.isArray(j)) throw new Error('Formato JSON não reconhecido.');
  throw new Error('Formato JSON não reconhecido.');
}

/* ---------- Google Authenticator: QR "otpauth-migration://offline?data=…" ---------- */

function base32(bytes: Uint8Array): string {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, v = 0, o = '';
  for (const b of bytes) { v = (v << 8) | b; bits += 8; while (bits >= 5) { o += a[(v >>> (bits - 5)) & 31]; bits -= 5; } v &= 0xff; }
  if (bits) o += a[(v << (5 - bits)) & 31];
  return o;
}

/** Leitor mínimo de protobuf para o formato de exportação do Google Authenticator. */
function readProto(buf: Uint8Array): Map<number, (number | Uint8Array)[]> {
  const out = new Map<number, (number | Uint8Array)[]>();
  let i = 0;
  const varint = () => { let r = 0, s = 0, b; do { b = buf[i++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  while (i < buf.length) {
    const key = varint(), field = Math.floor(key / 8), wire = key & 7;
    let v: number | Uint8Array;
    if (wire === 0) v = varint();
    else if (wire === 2) { const len = varint(); v = buf.slice(i, i + len); i += len; }
    else if (wire === 1) { i += 8; continue; }
    else if (wire === 5) { i += 4; continue; }
    else throw new Error('Formato inválido');
    out.set(field, [...(out.get(field) || []), v]);
  }
  return out;
}

export function importGoogleAuthenticator(uri: string): ImportResult {
  const m = uri.match(/^otpauth-migration:\/\/offline\?data=(.+)$/i);
  if (!m) throw new Error('Esse QR não é uma exportação do Google Authenticator.');
  const raw = Uint8Array.from(atob(decodeURIComponent(m[1])), c => c.charCodeAt(0));
  const dec = new TextDecoder();
  const algos: Record<number, OtpAlgorithm> = { 1: 'SHA-1', 2: 'SHA-256', 3: 'SHA-512' };
  const items: Item[] = [];
  for (const p of readProto(raw).get(1) || []) {
    const f = readProto(p as Uint8Array);
    if ((f.get(6)?.[0] ?? 2) !== 2) continue; // só TOTP
    const secret = base32(f.get(1)![0] as Uint8Array);
    const label = dec.decode((f.get(2)?.[0] as Uint8Array) || new Uint8Array());
    const issuer = dec.decode((f.get(3)?.[0] as Uint8Array) || new Uint8Array());
    const [li, ...rest] = label.split(':');
    const account = (rest.length ? rest.join(':') : label).trim();
    items.push(newItem({
      name: issuer || (rest.length ? li : account) || 'Conta 2FA',
      username: account,
      otp: { secret, digits: (f.get(5)?.[0] as number) === 2 ? 8 : 6, period: 30, algorithm: algos[(f.get(4)?.[0] as number) || 1] || 'SHA-1' }
    }));
  }
  if (!items.length) throw new Error('Nenhuma conta TOTP encontrada nesse QR.');
  return { items, folders: [], source: 'Google Authenticator' };
}

/* ---------- Exportar ---------- */

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function exportCsv(d: VaultData): string {
  const fname = (id: string | null) => d.folders.find(f => f.id === id)?.name || '';
  const head = ['folder', 'favorite', 'type', 'name', 'notes', 'login_uri', 'login_username', 'login_password', 'login_totp'];
  const rows = d.items.filter(i => !i.trashed && (i.kind === 'login' || i.kind === 'note')).map(i => [
    fname(i.folderId), i.favorite ? '1' : '', i.kind === 'note' ? 'note' : 'login', i.name, i.notes, i.url, i.username, i.password,
    i.otp ? `otpauth://totp/${encodeURIComponent(i.name)}?secret=${i.otp.secret}&digits=${i.otp.digits}&period=${i.otp.period}&algorithm=${i.otp.algorithm.replace('-', '')}` : ''
  ]);
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

/** Evita duplicar o que já existe (mesmo nome + usuário + site). */
export function dedupe(incoming: Item[], current: Item[]): Item[] {
  const key = (i: Item) => `${i.name.toLowerCase()}|${i.username.toLowerCase()}|${i.url.toLowerCase()}|${i.otp?.secret || ''}`;
  const have = new Set(current.filter(i => !i.trashed).map(key));
  return incoming.filter(i => !have.has(key(i)));
}
