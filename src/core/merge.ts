import type { Folder, Item, VaultData } from './types';

/** Chave da lápide de uma pasta apagada em `deleted` (itens usam o próprio id). */
export const folderTombstone = (id: string) => 'pasta:' + id;

/**
 * Junta dois cofres (deste aparelho e do servidor) sem perder edições:
 * • cada item fica com a versão editada por último (`updated`);
 * • exclusões viajam como "lápides" (`deleted`) e vencem edições mais antigas;
 * • pastas são unidas; ajustes vêm do cofre alterado por último.
 */
export function mergeVaults(a: VaultData, b: VaultData): VaultData {
  const newer = b.lastChange > a.lastChange ? b : a;

  const deleted: Record<string, number> = { ...a.deleted };
  for (const [id, t] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);

  const items = new Map<string, Item>();
  for (const it of [...a.items, ...b.items]) {
    const cur = items.get(it.id);
    if (!cur || it.updated > cur.updated) items.set(it.id, it);
  }
  for (const [id, t] of Object.entries(deleted)) {
    const it = items.get(id);
    if (it && it.updated <= t) items.delete(id);
  }

  const folders = new Map<string, Folder>();
  for (const f of [...(newer === a ? b : a).folders, ...newer.folders]) if (!deleted[folderTombstone(f.id)]) folders.set(f.id, f);

  const breached: Record<string, number> = { ...a.breached, ...b.breached };
  for (const id of Object.keys(breached)) if (!items.has(id)) delete breached[id];

  const maxOrNull = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : Math.max(x, y));

  return {
    version: 1,
    items: [...items.values()],
    folders: [...folders.values()],
    settings: { ...newer.settings },
    breached,
    lastBreachCheck: maxOrNull(a.lastBreachCheck, b.lastBreachCheck),
    lastBackup: maxOrNull(a.lastBackup, b.lastBackup),
    lastChange: Math.max(a.lastChange, b.lastChange),
    deleted
  };
}

/** Verdadeiro se `b` traz algo que `a` ainda não tem (para saber se vale a pena gravar/enviar). */
export function differs(a: VaultData, b: VaultData): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}
