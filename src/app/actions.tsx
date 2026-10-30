import { useCallback } from 'react';
import { folderTombstone } from '../core/merge';
import { hotp } from '../core/totp';
import type { Folder, Item } from '../core/types';
import { useConfirm, usePrompt, useToast } from './ui';
import { useVault } from './vault';

/**
 * Ações de exclusão com rede de segurança:
 *  - lixeira: imediata, com "Desfazer" no aviso (e 30 dias para restaurar);
 *  - exclusão definitiva: só pela lixeira, segurando o botão de confirmar.
 */
export function useItemActions() {
  const vault = useVault();
  const toast = useToast();
  const ask = useConfirm();
  const askText = usePrompt();

  const setTrashed = useCallback((ids: string[], when: number | null) => vault.update(d => {
    for (const x of d.items) if (ids.includes(x.id)) { x.trashed = when; x.updated = Date.now(); }
  }), [vault]);

  const trash = useCallback(async (item: Item) => {
    await setTrashed([item.id], Date.now());
    toast.show('捨', `“${item.name}” foi para a lixeira`, { label: 'Desfazer', run: () => { setTrashed([item.id], null); toast.show('戻', 'Restaurado'); } });
  }, [setTrashed, toast]);

  const restore = useCallback(async (item: Item) => {
    await setTrashed([item.id], null);
    toast.show('戻', `“${item.name}” restaurado`);
  }, [setTrashed, toast]);

  /** Apaga de vez (e propaga a exclusão para os outros aparelhos). */
  const purge = useCallback(async (items: Item[]) => {
    const ids = new Set(items.map(i => i.id));
    await vault.update(d => {
      d.items = d.items.filter(i => !ids.has(i.id));
      for (const id of ids) { delete d.breached[id]; d.deleted[id] = Date.now(); }
    });
    for (const it of items) for (const a of it.attachments) await vault.deleteFile(a.id);
  }, [vault]);

  const destroy = useCallback(async (item: Item) => {
    const ok = await ask({
      title: `Excluir “${item.name}” para sempre?`,
      text: <>A senha, o 2FA e os anexos somem deste aparelho e da nuvem. <b>Não dá para desfazer.</b></>,
      confirm: 'Excluir para sempre', danger: true, hold: true, mark: '消'
    });
    if (!ok) return false;
    await purge([item]);
    toast.show('消', 'Excluído para sempre');
    return true;
  }, [ask, purge, toast]);

  const emptyTrash = useCallback(async () => {
    const list = vault.data!.items.filter(i => i.trashed);
    if (!list.length) return;
    const ok = await ask({
      title: 'Esvaziar a lixeira?',
      text: <>{list.length} item(ns) serão excluídos de vez, com anexos, em todos os aparelhos. <b>Não dá para desfazer.</b></>,
      confirm: 'Esvaziar', danger: true, hold: true, mark: '消'
    });
    if (!ok) return;
    await purge(list);
    toast.show('消', 'Lixeira vazia');
  }, [ask, purge, toast, vault]);

  const restoreAll = useCallback(async () => {
    const ids = vault.data!.items.filter(i => i.trashed).map(i => i.id);
    if (!ids.length) return;
    await setTrashed(ids, null);
    toast.show('戻', `${ids.length} item(ns) restaurado(s)`);
  }, [setTrashed, toast, vault]);

  /** HOTP: gera o código do contador atual e já avança o contador (cada código vale uma vez). */
  const nextHotp = useCallback(async (item: Item): Promise<string> => {
    const otp = vault.data?.items.find(i => i.id === item.id)?.otp || item.otp;
    if (!otp) return '';
    const code = await hotp(otp);
    await vault.update(d => {
      const x = d.items.find(i => i.id === item.id);
      if (x?.otp) { x.otp = { ...x.otp, counter: (x.otp.counter || 0) + 1 }; x.updated = Date.now(); x.lastUsed = Date.now(); }
    });
    return code;
  }, [vault]);

  /** Itens na lixeira há mais de 30 dias somem de vez, com os anexos. */
  const purgeExpired = useCallback(async () => {
    const old = vault.data?.items.filter(i => i.trashed && Date.now() - i.trashed > 30 * 86400_000) || [];
    if (old.length) await purge(old);
  }, [purge, vault]);

  /* ---------- Pastas ---------- */

  const addFolder = useCallback(async (): Promise<string | null> => {
    const name = await askText({ title: 'Nova pasta', placeholder: 'ex.: Estudos', confirm: 'Criar pasta', mark: '箱' });
    if (!name) return null;
    const id = crypto.randomUUID();
    await vault.update(d => { d.folders.push({ id, name }); });
    toast.show('箱', `Pasta “${name}” criada`);
    return id;
  }, [askText, toast, vault]);

  const renameFolder = useCallback(async (f: Folder) => {
    const name = await askText({ title: 'Renomear pasta', value: f.name, confirm: 'Renomear', mark: '名' });
    if (name && name !== f.name) await vault.update(d => { const x = d.folders.find(y => y.id === f.id); if (x) x.name = name; });
  }, [askText, vault]);

  /** Apaga a pasta (os itens ficam sem pasta) e avisa os outros aparelhos para não ressuscitá-la. */
  const deleteFolder = useCallback(async (f: Folder) => {
    const ok = await ask({ title: `Apagar a pasta “${f.name}”?`, text: 'Os itens dela não são apagados — só ficam sem pasta.', confirm: 'Apagar pasta', danger: true, mark: '消' });
    if (!ok) return false;
    await vault.update(d => {
      d.folders = d.folders.filter(y => y.id !== f.id);
      d.deleted[folderTombstone(f.id)] = Date.now();
      for (const i of d.items) if (i.folderId === f.id) { i.folderId = null; i.updated = Date.now(); }
    });
    return true;
  }, [ask, vault]);

  return { trash, restore, destroy, emptyTrash, restoreAll, purgeExpired, addFolder, renameFolder, deleteFolder, nextHotp };
}
