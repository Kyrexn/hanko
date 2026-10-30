import { describe, expect, it } from 'vitest';
import { baseDomain, hostOf, matchesSite, safeTransport } from './store';
import { newItem } from '../../src/core/types';

const item = (url: string) => newItem({ url, password: 'x' });

describe('a extensão só preenche no site certo', () => {
  it('domínio-base', () => {
    expect(baseDomain('accounts.google.com')).toBe('google.com');
    expect(baseDomain('app.nubank.com.br')).toBe('nubank.com.br');
    expect(baseDomain('github.com')).toBe('github.com');
    expect(hostOf('www.GitHub.com/login')).toBe('github.com');
  });

  it('aceita o mesmo site e seus subdomínios', () => {
    expect(matchesSite(item('github.com'), 'https://github.com/login')).toBe(true);
    expect(matchesSite(item('https://accounts.google.com'), 'https://mail.google.com/')).toBe(true);
    expect(matchesSite(item('nubank.com.br'), 'https://app.nubank.com.br/entrar')).toBe(true);
  });

  it('recusa sites parecidos (phishing)', () => {
    expect(matchesSite(item('github.com'), 'https://github.com.evil.io/login')).toBe(false);
    expect(matchesSite(item('github.com'), 'https://githubb.com/')).toBe(false);
    expect(matchesSite(item('nubank.com.br'), 'https://nubank.com.br.golpe.com/')).toBe(false);
    expect(matchesSite(item('nubank.com.br'), 'https://outro.com.br/')).toBe(false);
  });

  it('hospedagem compartilhada exige o mesmo endereço exato', () => {
    expect(matchesSite(item('alice.github.io'), 'https://bob.github.io/login')).toBe(false);
    expect(matchesSite(item('alice.github.io'), 'https://alice.github.io/login')).toBe(true);
    expect(matchesSite(item('meuapp.vercel.app'), 'https://golpe.vercel.app/')).toBe(false);
  });

  it('itens na lixeira não são oferecidos', () => {
    expect(matchesSite(newItem({ url: 'github.com', trashed: Date.now() }), 'https://github.com')).toBe(false);
  });

  it('senha não vai para página sem HTTPS (salvo se a conta for http://)', () => {
    expect(safeTransport(item('github.com'), 'http://github.com/login')).toBe(false);
    expect(safeTransport(item('github.com'), 'https://github.com/login')).toBe(true);
    expect(safeTransport(item('http://192.168.0.1'), 'http://192.168.0.1/')).toBe(true);
  });

  it('itens sem site ou notas nunca são oferecidos', () => {
    expect(matchesSite(item(''), 'https://github.com')).toBe(false);
    expect(matchesSite(newItem({ kind: 'note', url: 'github.com' }), 'https://github.com')).toBe(false);
  });
});
