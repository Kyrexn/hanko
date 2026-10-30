import { describe, expect, it } from 'vitest';
import { cardExpired, hostOf, luhn } from './validate';

describe('validações', () => {
  it('extrai o domínio', () => {
    expect(hostOf('https://www.GitHub.com/login?x=1')).toBe('github.com');
    expect(hostOf('accounts.google.com')).toBe('accounts.google.com');
    expect(hostOf('')).toBe('');
  });
  it('confere cartão pelo Luhn', () => {
    expect(luhn('4111 1111 1111 1111')).toBe(true);
    expect(luhn('4111 1111 1111 1112')).toBe(false);
  });
  it('detecta cartão vencido', () => {
    const now = new Date(2026, 9, 29);
    expect(cardExpired('09/26', now)).toBe(true);
    expect(cardExpired('10/26', now)).toBe(false);
    expect(cardExpired('01/30', now)).toBe(false);
  });
});
