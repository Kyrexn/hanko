import { describe, expect, it } from 'vitest';
import { dedupe, exportCsv, importCsv, importGoogleAuthenticator, importJson, parseCsv } from './importers';
import { generatePassphrase } from './passwords';
import { emptyVault, newItem } from './types';

describe('importar', () => {
  it('CSV do Chrome', () => {
    const r = importCsv('name,url,username,password,note\r\nGitHub,https://github.com/login,voce@email.com,"se,nha""1",oi\n', []);
    expect(r.source).toBe('Chrome / Edge');
    expect(r.items[0]).toMatchObject({ name: 'GitHub', url: 'https://github.com/login', username: 'voce@email.com', password: 'se,nha"1', notes: 'oi' });
  });

  it('CSV do Bitwarden com pasta e 2FA', () => {
    const csv = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nTrabalho,1,login,Google,,,0,https://accounts.google.com,eu@gmail.com,x,JBSWY3DPEHPK3PXP';
    const r = importCsv(csv, []);
    expect(r.folders.map(f => f.name)).toEqual(['Trabalho']);
    expect(r.items[0].folderId).toBe(r.folders[0].id);
    expect(r.items[0].favorite).toBe(true);
    expect(r.items[0].otp?.secret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('CSV com ponto e vírgula', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('JSON do Bitwarden (login, cartão, identidade)', () => {
    const j = { encrypted: false, folders: [{ id: 'f1', name: 'Banco' }], items: [
      { type: 1, name: 'Site', folderId: 'f1', login: { uris: [{ uri: 'site.com' }], username: 'u', password: 'p' } },
      { type: 3, name: 'Cartão', card: { cardholderName: 'EU', number: '4111111111111111', expMonth: '7', expYear: '2030', code: '123' } },
      { type: 4, name: 'Docs', identity: { firstName: 'Ana', lastName: 'Silva', ssn: '123' } }
    ] };
    const r = importJson(JSON.stringify(j), []);
    expect(r.items.map(i => i.kind)).toEqual(['login', 'card', 'identity']);
    expect(r.items[1].card).toMatchObject({ expiry: '07/30', cvv: '123' });
    expect(r.items[2].identity?.fullName).toBe('Ana Silva');
    expect(r.items[0].folderId).toBe(r.folders[0].id);
  });

  it('QR de exportação do Google Authenticator', () => {
    // Monta um payload protobuf igual ao do app: secret "Hello!\xDE\xAD\xBE\xEF", nome "conta", emissor "Exemplo", TOTP.
    const enc = new TextEncoder();
    const bytesField = (f: number, b: Uint8Array) => [f * 8 + 2, b.length, ...b];
    const param = [...bytesField(1, new Uint8Array([72, 101, 108, 108, 111, 33, 0xde, 0xad, 0xbe, 0xef])), ...bytesField(2, enc.encode('Exemplo:voce@ex.com')),
      ...bytesField(3, enc.encode('Exemplo')), 4 * 8, 1, 5 * 8, 1, 6 * 8, 2];
    const payload = new Uint8Array([...bytesField(1, new Uint8Array(param)), 2 * 8, 1]);
    const data = encodeURIComponent(btoa(String.fromCharCode(...payload)));
    const r = importGoogleAuthenticator(`otpauth-migration://offline?data=${data}`);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ name: 'Exemplo', username: 'voce@ex.com' });
    expect(r.items[0].otp).toEqual({ secret: 'JBSWY3DPEHPK3PXP', digits: 6, period: 30, algorithm: 'SHA-1' });
  });

  it('não duplica o que já existe', () => {
    const a = newItem({ name: 'X', username: 'u' });
    expect(dedupe([newItem({ name: 'x', username: 'U' }), newItem({ name: 'Y' })], [a])).toHaveLength(1);
  });

  it('exportar CSV volta pela importação', () => {
    const v = { ...emptyVault(), items: [newItem({ name: 'A,B', username: 'u', password: 'p"q', url: 'a.com' })] };
    const back = importCsv(exportCsv(v), []);
    expect(back.items[0]).toMatchObject({ name: 'A,B', password: 'p"q' });
  });
});

describe('frase-senha', () => {
  it('7 palavras + número', () => {
    const p = generatePassphrase();
    expect(p.split('-')).toHaveLength(8);
    expect(p).toMatch(/^([A-Z][a-z]+-){7}\d{2}$/);
  });
});
