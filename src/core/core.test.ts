import { describe, expect, it } from 'vitest';
import { deriveKey, newKey, openVault, seal, encryptBytes, decryptBytes } from './crypto';
import { totp, parseOtp, formatCode } from './totp';
import { generatePassword, generatePin, generatedBits, passphraseBits, strength, reusedIds, sha1Hex, breachCount } from './passwords';
import { WORDS } from './words';
import { newItem } from './types';

const ascii = (s: string) => new TextEncoder().encode(s);
function b32(bytes: Uint8Array): string {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, v = 0, o = '';
  for (const b of bytes) { v = (v << 8) | b; bits += 8; while (bits >= 5) { o += a[(v >>> (bits - 5)) & 31]; bits -= 5; } v &= 0xff; }
  if (bits) o += a[(v << (5 - bits)) & 31];
  return o;
}

describe('TOTP (vetores oficiais do RFC 6238)', () => {
  const s1 = b32(ascii('12345678901234567890'));
  const s256 = b32(ascii('12345678901234567890123456789012'));
  const s512 = b32(ascii('1234567890'.repeat(6) + '1234'));
  const cases: [number, string, string, string][] = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901']
  ];
  for (const [t, e1, e256, e512] of cases) {
    it(`t=${t}`, async () => {
      expect(await totp({ secret: s1, digits: 8, period: 30, algorithm: 'SHA-1' }, t * 1000)).toBe(e1);
      expect(await totp({ secret: s256, digits: 8, period: 30, algorithm: 'SHA-256' }, t * 1000)).toBe(e256);
      expect(await totp({ secret: s512, digits: 8, period: 30, algorithm: 'SHA-512' }, t * 1000)).toBe(e512);
    });
  }
  it('lê links otpauth', () => {
    const p = parseOtp('otpauth://totp/GitHub:voce%40email.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub');
    expect(p).toMatchObject({ secret: 'JBSWY3DPEHPK3PXP', issuer: 'GitHub', account: 'voce@email.com', digits: 6, period: 30 });
  });
  it('formata código sem quebrar', () => {
    expect(formatCode('482913')).toBe('482 913');
    expect(formatCode('12345678')).toBe('1234 5678');
  });
});

describe('criptografia', () => {
  it('cifra e decifra; senha errada falha', async () => {
    const key = await newKey('mestra-teste-123');
    const blob = await seal(key, { ok: 42 });
    expect(blob.ct).not.toContain('42');
    expect((await openVault<{ ok: number }>(blob, 'mestra-teste-123')).data.ok).toBe(42);
    await expect(openVault(blob, 'errada')).rejects.toThrow();
  });
  it('anexos binários', async () => {
    const key = await deriveKey('x', new Uint8Array(16), 100_000);
    const data = crypto.getRandomValues(new Uint8Array(5000));
    const { iv, ct } = await encryptBytes(key, data);
    expect(await decryptBytes(key, iv, ct)).toEqual(data);
  });
});

describe('senhas', () => {
  it('gera senha com todos os conjuntos', () => {
    const p = generatePassword(20);
    expect(p).toHaveLength(20);
    expect(/[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^a-zA-Z\d]/.test(p)).toBe(true);
  });
  it('força', () => {
    expect(strength('123456').level).toBe('fraca');
    expect(strength(generatePassword(20)).level).toBe('excelente');
  });
  it('força desconta padrões que parecem fortes mas não são', () => {
    expect(strength('Flamengo2024!').level).toBe('fraca');
    expect(strength('qwerty123456').level).toBe('fraca');
    expect(strength('aaaaaaaaaaaaaaaa').level).toBe('fraca');
    expect(strength('Senha@123').tips.length).toBeGreaterThan(0);
    expect(strength('Farol-Tucano-Brisa-Cometa-Lapis-47').level).toBe('excelente');
  });
  it('gera PIN e calcula entropia real', () => {
    expect(generatePin(6)).toMatch(/^\d{6}$/);
    expect(generatedBits(20, { lower: true, upper: true, digits: true, symbols: true })).toBeGreaterThan(110);
    expect(passphraseBits(7, true)).toBeGreaterThanOrEqual(75);
    expect(WORDS.length).toBeGreaterThanOrEqual(1024);
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });
  it('detecta reutilizadas', () => {
    const a = newItem({ password: 'igual' }), b = newItem({ password: 'igual' }), c = newItem({ password: 'outra' });
    expect([...reusedIds([a, b, c])].sort()).toEqual([a.id, b.id].sort());
  });
  it('vazamento por k-anonimato envia só 5 caracteres', async () => {
    const hash = await sha1Hex('password');
    let asked = '';
    const fake = (async (url: string) => { asked = url; return new Response(`${hash.slice(5)}:3861493\nABC:1`); }) as unknown as typeof fetch;
    expect(await breachCount('password', fake)).toBe(3861493);
    expect(asked.endsWith('/range/' + hash.slice(0, 5))).toBe(true);
  });
});
