import type { Item } from './types';
import { WORDS } from './words';

const POOLS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!@#$%&*+-=?_.:;'
} as const;

export type PoolName = keyof typeof POOLS;
export type PoolSet = Record<PoolName, boolean>;

function randInt(n: number): number {
  const lim = Math.floor(0x100000000 / n) * n;
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return a[0] % n;
}

/** Senha aleatória com pelo menos um caractere de cada conjunto escolhido (sem caracteres ambíguos como l/1/O/0). */
export function generatePassword(length = 20, sets: PoolSet = { lower: true, upper: true, digits: true, symbols: true }): string {
  const pools = (Object.keys(POOLS) as PoolName[]).filter(k => sets[k]).map(k => POOLS[k] as string);
  if (!pools.length) pools.push(POOLS.lower);
  const all = pools.join('');
  const chars = pools.map(p => p[randInt(p.length)]);
  while (chars.length < length) chars.push(all[randInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Frase-senha: palavras sorteadas + um número, ex.: "Farol-Tucano-Brisa-Cometa-Lapis-Vulcao-47". */
export function generatePassphrase(words = 7, sep = '-', capitalize = true, withNumber = true): string {
  const list = WORDS;
  const out = Array.from({ length: words }, () => {
    const w = list[randInt(list.length)];
    return capitalize ? w[0].toUpperCase() + w.slice(1) : w;
  });
  if (withNumber) out.push(String(randInt(90) + 10));
  return out.join(sep);
}

export type StrengthLevel = 'vazia' | 'fraca' | 'razoavel' | 'boa' | 'excelente';

/** Senhas que aparecem no topo de todos os vazamentos (inclui as brasileiras mais comuns). */
const COMMON = new Set(('123456 123456789 12345678 password senha 12345 qwerty 1234567 111111 123123 abc123 1234567890 000000 '
  + 'iloveyou admin welcome monkey dragon letmein football baseball master sunshine princess flamengo corinthians palmeiras '
  + 'saopaulo vasco gremio brasil amor teamo deus jesus familia mudar123 senha123 senha1234 password1 qwerty123 asdfgh '
  + 'zxcvbn 654321 123321 102030 121212 159753 147258 abcdef abcd1234 a1b2c3 trustno1 superman batman pokemon').split(' '));

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];

/** Quantos caracteres fazem parte de sequências previsíveis (abc, 321, qwe) ou repetições (aaa). */
function patternChars(pw: string): number {
  const s = pw.toLowerCase();
  let bad = 0;
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    const kb = ROWS.some(r => { const a = r.indexOf(s[i - 1]); return a >= 0 && (r[a + 1] === s[i] || r[a - 1] === s[i]); });
    if (d === 0 || d === 1 || d === -1 || kb) { run++; if (run === 3) bad += 3; else if (run > 3) bad++; }
    else run = 1;
  }
  return bad;
}

export interface Strength { level: StrengthLevel; bits: number; label: string; tips: string[] }

/** Estimativa por entropia, descontando padrões que quem ataca testa primeiro (sequências, teclado, anos, senhas comuns). */
export function strength(pw: string): Strength {
  if (!pw) return { level: 'vazia', bits: 0, label: '—', tips: [] };
  const tips: string[] = [];
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z\d]/.test(pw)) pool += 33;
  const pattern = patternChars(pw);
  // Caracteres de padrão valem quase nada; o resto vale o tamanho do conjunto usado.
  let bits = Math.round((pw.length - pattern) * Math.log2(pool || 1) + pattern * 1.5);
  const base = pw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const core = base.replace(/\d+$/, '').replace(/^\d+/, '');
  if (COMMON.has(pw.toLowerCase()) || COMMON.has(base) || (core.length >= 4 && COMMON.has(core))) {
    bits = Math.min(bits, 10);
    tips.push('Essa senha está entre as mais usadas do mundo.');
  }
  if (/(19|20)\d{2}/.test(pw)) { bits -= 8; tips.push('Evite anos e datas — são os primeiros a serem testados.'); }
  if (pattern >= 3) tips.push('Tem sequências previsíveis (abc, 123, qwerty, aaa).');
  if (pw.length < 12) tips.push('Use pelo menos 12 caracteres (ou uma frase-senha).');
  if (pool <= 36 && pw.length < 16) tips.push('Misture letras maiúsculas, números e símbolos.');
  bits = Math.max(0, bits);
  const level: StrengthLevel = bits < 45 ? 'fraca' : bits < 64 ? 'razoavel' : bits < 90 ? 'boa' : 'excelente';
  const label = { fraca: 'fraca', razoavel: 'razoável', boa: 'boa', excelente: 'excelente', vazia: '—' }[level];
  return { level, bits, label, tips: level === 'excelente' ? [] : tips };
}

/** Entropia real de uma senha gerada (pelo sorteio, não pela aparência). */
export function generatedBits(length: number, sets: PoolSet): number {
  const size = (Object.keys(POOLS) as PoolName[]).filter(k => sets[k]).reduce((n, k) => n + POOLS[k].length, 0) || POOLS.lower.length;
  return Math.round(length * Math.log2(size));
}

export function passphraseBits(words: number, withNumber: boolean): number {
  return Math.round(words * Math.log2(WORDS.length) + (withNumber ? Math.log2(90) : 0));
}

/** PIN numérico (cartões, celulares). */
export function generatePin(length = 6): string {
  return Array.from({ length }, () => String(randInt(10))).join('');
}

/** Ids de itens cuja senha aparece em mais de um item. */
export function reusedIds(items: Item[]): Set<string> {
  const byPw = new Map<string, string[]>();
  for (const i of items) if (i.password) byPw.set(i.password, [...(byPw.get(i.password) || []), i.id]);
  const out = new Set<string>();
  for (const ids of byPw.values()) if (ids.length > 1) ids.forEach(id => out.add(id));
  return out;
}

export async function sha1Hex(text: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)));
  return Array.from(h, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Verifica vazamentos no Have I Been Pwned com k-anonimato:
 * só os 5 primeiros caracteres do hash SHA-1 saem do aparelho; a senha nunca é enviada.
 * Retorna quantas vezes a senha apareceu (0 = não encontrada).
 */
export async function breachCount(password: string, fetcher: typeof fetch = fetch): Promise<number> {
  const hash = await sha1Hex(password);
  const res = await fetcher(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } });
  if (!res.ok) throw new Error('Serviço de verificação indisponível');
  const suffix = hash.slice(5);
  for (const line of (await res.text()).split('\n')) {
    const [s, n] = line.trim().split(':');
    if (s === suffix) return parseInt(n, 10) || 0;
  }
  return 0;
}

export interface Health {
  score: number;
  weak: Item[];
  reused: Item[];
  breached: Item[];
  withoutTfa: Item[];
}

/** `breachedIds`: itens cuja senha atual foi encontrada em vazamento (a entrada é apagada quando a senha muda). */
export function vaultHealth(items: Item[], breachedIds: Record<string, number>): Health {
  const logins = items.filter(i => i.kind === 'login' && i.password);
  const reusedSet = reusedIds(logins);
  const weak = logins.filter(i => ['fraca', 'razoavel'].includes(strength(i.password).level));
  const reused = logins.filter(i => reusedSet.has(i.id));
  const breached = logins.filter(i => (breachedIds[i.id] || 0) > 0);
  const withoutTfa = logins.filter(i => !i.otp);
  const bad = new Set([...weak, ...reused, ...breached].map(i => i.id));
  const score = logins.length ? Math.round(100 * (1 - bad.size / logins.length) - Math.min(10, breached.length * 5)) : 100;
  return { score: Math.max(0, Math.min(100, score)), weak, reused, breached, withoutTfa };
}
