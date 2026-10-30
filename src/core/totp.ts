import type { OtpAlgorithm, OtpParams } from './types';

// TOTP conforme RFC 6238 (o mesmo usado por Google Authenticator, Authy etc.).

export function base32Decode(str: string): Uint8Array<ArrayBuffer> {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = str.toUpperCase().replace(/[\s=-]/g, '');
  if (!s) throw new Error('Segredo vazio');
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const c of s) {
    const i = alpha.indexOf(c);
    if (i < 0) throw new Error('O segredo 2FA tem caracteres inválidos (use base32: A–Z e 2–7)');
    val = ((val << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export const isHotp = (otp: OtpParams | null | undefined) => otp?.type === 'hotp';

/** TOTP (RFC 6238): o contador é o tempo. */
export function totp(otp: OtpParams, t = Date.now()): Promise<string> {
  return otpAt(otp, Math.floor(t / 1000 / otp.period));
}

/** HOTP (RFC 4226): código do contador informado (ou do contador atual guardado no item). */
export function hotp(otp: OtpParams, counter = otp.counter || 0): Promise<string> {
  return otpAt(otp, counter);
}

async function otpAt(otp: OtpParams, counter: number): Promise<string> {
  const msg = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { msg[i] = counter & 255; counter = Math.floor(counter / 256); }
  const key = await crypto.subtle.importKey('raw', base32Decode(otp.secret), { name: 'HMAC', hash: otp.algorithm }, false, ['sign']);
  const hm = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = hm[hm.length - 1] & 15;
  const bin = ((hm[o] & 127) << 24) | (hm[o + 1] << 16) | (hm[o + 2] << 8) | hm[o + 3];
  return String(bin % 10 ** otp.digits).padStart(otp.digits, '0');
}

/** "482913" → "482 913"; "12345678" → "1234 5678". */
export function formatCode(code: string): string {
  const h = Math.ceil(code.length / 2);
  return code.length > 5 ? code.slice(0, h) + ' ' + code.slice(h) : code;
}

export function secondsLeft(period: number, t = Date.now()): number {
  return period - Math.floor((t / 1000) % period);
}

export interface ParsedOtp extends OtpParams {
  issuer?: string;
  account?: string;
}

/** Aceita a chave secreta pura ("JBSW Y3DP …") ou um link otpauth://totp/… (o conteúdo do QR code). */
export function parseOtp(input: string): ParsedOtp | null {
  input = input.trim();
  if (!input) return null;
  const m = input.match(/^otpauth:\/\/([^/]+)\/([^?]*)\??(.*)$/i);
  if (!m) return { secret: input.replace(/\s/g, '').toUpperCase(), digits: 6, period: 30, algorithm: 'SHA-1' };
  const kind = m[1].toLowerCase();
  if (kind !== 'totp' && kind !== 'hotp') throw new Error('Tipo de 2FA não suportado (use TOTP ou HOTP)');
  const p = new URLSearchParams(m[3]);
  const label = decodeURIComponent(m[2]);
  const algo = ({ SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' } as Record<string, OtpAlgorithm>)[(p.get('algorithm') || 'SHA1').toUpperCase()];
  if (!algo) throw new Error('Algoritmo 2FA não suportado');
  const secret = (p.get('secret') || '').replace(/\s/g, '').toUpperCase();
  if (!secret) throw new Error('O link otpauth não tem segredo');
  const digits = parseInt(p.get('digits') || '6', 10);
  const period = parseInt(p.get('period') || '30', 10);
  if (![6, 7, 8].includes(digits) || !(period > 0)) throw new Error('Parâmetros 2FA inválidos');
  const counter = parseInt(p.get('counter') || '0', 10);
  if (kind === 'hotp' && !(counter >= 0)) throw new Error('Contador HOTP inválido');
  const [issuerFromLabel, ...rest] = label.split(':');
  return {
    secret, digits, period, algorithm: algo, ...(kind === 'hotp' ? { type: 'hotp' as const, counter } : {}),
    issuer: p.get('issuer') || (rest.length ? issuerFromLabel : ''),
    account: (rest.length ? rest.join(':') : label).trim()
  };
}

export function otpToText(otp: OtpParams | null): string {
  if (!otp) return '';
  if (isHotp(otp)) return `otpauth://hotp/conta?secret=${otp.secret}&digits=${otp.digits}&counter=${otp.counter || 0}&algorithm=${otp.algorithm.replace('-', '')}`;
  if (otp.digits === 6 && otp.period === 30 && otp.algorithm === 'SHA-1') return otp.secret;
  return `otpauth://totp/conta?secret=${otp.secret}&digits=${otp.digits}&period=${otp.period}&algorithm=${otp.algorithm.replace('-', '')}`;
}
