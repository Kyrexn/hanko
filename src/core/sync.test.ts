import { describe, expect, it } from 'vitest';
import {
  deriveAuthSecret, newKey, openVault, seal, unwrapKey, wrapKey, deriveKey, b64, encryptBytes,
  newRecoveryKey, addRecovery, unwrapWithRecovery, rewrap, needsKdfUpgrade, isSealedBlob, KDF_ITERATIONS
} from './crypto';
import { folderTombstone, mergeVaults } from './merge';
import { emptyVault, newItem, type SealedBlobV1 } from './types';

describe('chave do cofre (v2)', () => {
  it('abre com a senha certa e recusa a errada', async () => {
    const key = await newKey('mestra-123456');
    const blob = await seal(key, { ok: 1 });
    expect((await openVault<{ ok: number }>(blob, 'mestra-123456')).data.ok).toBe(1);
    await expect(openVault(blob, 'errada')).rejects.toThrow();
  });

  it('trocar a senha mestra mantém a mesma chave de dados', async () => {
    const key = await newKey('antiga-123456');
    const header = await wrapKey('nova-1234567', key.dekRaw);
    const reopened = await unwrapKey('nova-1234567', header);
    expect(reopened.dekRaw).toEqual(key.dekRaw);
    await expect(unwrapKey('antiga-123456', header)).rejects.toThrow();
  });

  it('abre cofres v1 da versão 0.1', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const k = await deriveKey('mestra-v1-1234', salt, 100_000);
    const { iv, ct } = await encryptBytes(k, new TextEncoder().encode(JSON.stringify({ old: true })));
    const v1: SealedBlobV1 = { app: 'cofre', v: 1, kdf: 'PBKDF2-SHA256', iter: 100_000, salt: b64.to(salt), iv: b64.to(iv), ct: b64.to(ct) };
    const r = await openVault<{ old: boolean }>(v1, 'mestra-v1-1234');
    expect(r.data.old).toBe(true);
    expect(r.legacyKey).toBeDefined();
  });

  it('Kit de Emergência abre o cofre e sobrevive à troca de senha', async () => {
    const key = await newKey('mestra-123456');
    const rkey = newRecoveryKey();
    expect(rkey).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){5}$/);
    const withRk = { ...key, header: await addRecovery(key.header, key.dekRaw, rkey) };
    const viaRk = await unwrapWithRecovery(rkey.toLowerCase().replace(/-/g, ' '), withRk.header);
    expect(viaRk.dekRaw).toEqual(key.dekRaw);
    await expect(unwrapWithRecovery(newRecoveryKey(), withRk.header)).rejects.toThrow();
    const changed = await rewrap('nova-senha-987', withRk);
    expect((await unwrapWithRecovery(rkey, changed)).dekRaw).toEqual(key.dekRaw);
    expect((await unwrapKey('nova-senha-987', changed)).dekRaw).toEqual(key.dekRaw);
  });

  it('segredo de login não é a senha e depende do e-mail', async () => {
    const a = await deriveAuthSecret('mestra-123456', 'Voce@Email.com');
    expect(a).not.toContain('mestra');
    expect(a).toBe(await deriveAuthSecret('mestra-123456', 'voce@email.com '));
    expect(a).not.toBe(await deriveAuthSecret('mestra-123456', 'outro@email.com'));
  });
});

describe('mesclagem entre aparelhos', () => {
  it('fica com a edição mais recente de cada item', () => {
    const base = newItem({ id: 'x', name: 'Antigo', updated: 100 });
    const a = { ...emptyVault(), items: [{ ...base, name: 'Do PC', updated: 200 }], lastChange: 200 };
    const b = { ...emptyVault(), items: [{ ...base, name: 'Do celular', updated: 300 }], lastChange: 300 };
    expect(mergeVaults(a, b).items[0].name).toBe('Do celular');
    expect(mergeVaults(b, a).items[0].name).toBe('Do celular');
  });

  it('une itens novos dos dois lados', () => {
    const a = { ...emptyVault(), items: [newItem({ id: 'a', updated: 1 })] };
    const b = { ...emptyVault(), items: [newItem({ id: 'b', updated: 1 })] };
    expect(mergeVaults(a, b).items.map(i => i.id).sort()).toEqual(['a', 'b']);
  });

  it('exclusão vence edição mais antiga, mas não uma mais nova', () => {
    const it1 = newItem({ id: 'x', updated: 100 });
    const a = { ...emptyVault(), items: [it1] };
    const b = { ...emptyVault(), items: [], deleted: { x: 150 } };
    expect(mergeVaults(a, b).items).toHaveLength(0);
    const edited = { ...emptyVault(), items: [{ ...it1, updated: 200 }] };
    expect(mergeVaults(edited, b).items).toHaveLength(1);
  });
});

describe('pastas na sincronização', () => {
  it('pasta apagada num aparelho não volta pelo outro', () => {
    const a = emptyVault();
    const b = structuredClone(a);
    b.folders = b.folders.filter(f => f.id !== 'trabalho');
    b.deleted[folderTombstone('trabalho')] = Date.now();
    b.lastChange = a.lastChange - 1000; // mesmo que o outro aparelho seja "mais novo"
    expect(mergeVaults(a, b).folders.map(f => f.id)).not.toContain('trabalho');
    expect(mergeVaults(b, a).folders.map(f => f.id)).not.toContain('trabalho');
  });
});

describe('Argon2id na senha mestra', () => {
  it('chaves novas usam Argon2id; cabeçalhos PBKDF2 antigos ainda abrem e pedem atualização', async () => {
    const key = await newKey('mestra-argon-123');
    expect(key.header.kdf).toBe('Argon2id');
    expect(key.header.mem).toBeGreaterThanOrEqual(19_456);
    expect(needsKdfUpgrade(key.header)).toBe(false);
    const blob = await seal(key, { ok: true });
    expect(isSealedBlob(blob)).toBe(true);
    expect((await openVault<{ ok: boolean }>(blob, 'mestra-argon-123')).data.ok).toBe(true);
    await expect(openVault(blob, 'errada')).rejects.toThrow();

    // Cabeçalho como as versões até a 1.1 gravavam (PBKDF2).
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await deriveKey('mestra-antiga-12', salt, KDF_ITERATIONS);
    const { iv, ct } = await encryptBytes(kek, key.dekRaw);
    const old = { kdf: 'PBKDF2-SHA256' as const, iter: KDF_ITERATIONS, salt: b64.to(salt), wiv: b64.to(iv), wk: b64.to(ct), kt: 1 };
    const opened = await unwrapKey('mestra-antiga-12', old);
    expect(opened.dekRaw).toEqual(key.dekRaw);
    expect(needsKdfUpgrade(old)).toBe(true);
    const upgraded = await rewrap('mestra-antiga-12', opened);
    expect(upgraded.kdf).toBe('Argon2id');
    expect((await unwrapKey('mestra-antiga-12', upgraded)).dekRaw).toEqual(key.dekRaw);
  });
});
