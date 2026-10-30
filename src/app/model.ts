import { reusedIds, strength } from '../core/passwords';
import type { Item, VaultData } from '../core/types';

export const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export interface Category {
  id: string;
  name: string;
  test: (i: Item) => boolean;
}

export const activeItems = (d: VaultData) => d.items.filter(i => !i.trashed);

const YEAR = 365 * 86400_000;

export function categories(data: VaultData): Category[] {
  const reused = reusedIds(activeItems(data));
  const needsReview = (i: Item) =>
    i.kind === 'login' && !!i.password &&
    (['fraca', 'razoavel'].includes(strength(i.password).level) || reused.has(i.id) || (data.breached[i.id] || 0) > 0
      || (!!i.passwordChanged && Date.now() - i.passwordChanged > YEAR));
  const live = (fn: (i: Item) => boolean) => (i: Item) => !i.trashed && fn(i);
  return [
    { id: 'all', name: 'Todos', test: live(() => true) },
    { id: 'fav', name: 'Favoritos', test: live(i => i.favorite) },
    { id: 'login', name: 'Logins', test: live(i => i.kind === 'login') },
    { id: 'tfa', name: 'Códigos 2FA', test: live(i => !!i.otp) },
    { id: 'card', name: 'Cartões', test: live(i => i.kind === 'card') },
    { id: 'identity', name: 'Identidades', test: live(i => i.kind === 'identity') },
    { id: 'note', name: 'Notas seguras', test: live(i => i.kind === 'note') },
    { id: 'rec', name: 'Recuperação', test: live(i => i.attachments.length > 0 || !!i.recoveryCodes.trim()) },
    { id: 'review', name: 'A rever', test: live(needsReview) },
    { id: 'trash', name: 'Lixeira', test: i => !!i.trashed }
  ];
}

export const KIND_LABEL: Record<Item['kind'], string> = { login: 'Login', card: 'Cartão', identity: 'Identidade', note: 'Nota segura' };

/** Linha de apoio na lista (o que aparece embaixo do nome). */
export function subtitle(i: Item): string {
  if (i.kind === 'note') return 'nota segura';
  if (i.kind === 'card' && i.card) return `${i.card.brand || 'cartão'} •••• ${i.card.number.replace(/\D/g, '').slice(-4)}`;
  if (i.kind === 'identity' && i.identity) return i.identity.fullName || 'identidade';
  return i.username;
}

export function passwordLabel(i: Item, data: VaultData, reused: Set<string>): { text: string; color: string } {
  if (i.kind === 'note' || !i.password) return { text: '—', color: 'var(--faint)' };
  if ((data.breached[i.id] || 0) > 0) return { text: 'vazada', color: 'var(--red)' };
  if (reused.has(i.id)) return { text: 'repetida', color: 'var(--amber)' };
  const s = strength(i.password);
  if (s.level === 'fraca' || s.level === 'razoavel') return { text: s.label, color: 'var(--amber)' };
  return { text: s.label, color: 'var(--washi-3)' };
}

export function ago(ts: number | null): string {
  if (!ts) return '—';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d`;
  if (s < 86400 * 31) return `${Math.floor(s / 86400 / 7)} sem`;
  return `${Math.floor(s / 86400 / 30)} mês`;
}

export function greeting(d = new Date()): { title: string; when: string } {
  const h = d.getHours();
  const part = h < 5 ? 'madrugada' : h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite';
  const month = d.toLocaleDateString('pt-BR', { month: 'long' });
  return { title: part === 'manhã' ? 'Bom dia.' : part === 'tarde' ? 'Boa tarde.' : 'Boa noite.', when: `${d.getDate()} · ${month} · ${part}` };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
