import { describe, expect, it } from 'vitest';
import { hotp, otpToText, parseOtp } from './totp';

const RFC = { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', digits: 6, period: 30, algorithm: 'SHA-1' as const, type: 'hotp' as const };

describe('HOTP (código por contador)', () => {
  it('confere com os vetores da RFC 4226', async () => {
    expect(await hotp(RFC, 0)).toBe('755224');
    expect(await hotp(RFC, 1)).toBe('287082');
    expect(await hotp({ ...RFC, counter: 9 })).toBe('520489');
  });

  it('lê e reescreve links otpauth://hotp', () => {
    const p = parseOtp('otpauth://hotp/Banco:eu?secret=GEZDGNBVGY3TQOJQ&counter=7&issuer=Banco')!;
    expect(p).toMatchObject({ type: 'hotp', counter: 7, issuer: 'Banco', account: 'eu' });
    const back = parseOtp(otpToText({ ...p }))!;
    expect(back).toMatchObject({ type: 'hotp', counter: 7, secret: 'GEZDGNBVGY3TQOJQ' });
  });

  it('TOTP continua sendo o padrão para chaves puras', () => {
    expect(parseOtp('JBSWY3DPEHPK3PXP')!.type).toBeUndefined();
  });
});
