import { useEffect, useMemo, useState } from 'react';
import { reusedIds, vaultHealth } from '../core/passwords';
import type { Item } from '../core/types';
import { useNow } from './hooks';
import { KANJI, KIND_LABEL, activeItems, categories, download, greeting, passwordLabel, subtitle } from './model';
import { Avatar, Logo, copySecret, useToast } from './ui';
import { useVault } from './vault';
import { Detail } from './VaultScreen';
import { Editor } from './Editor';
import { useItemActions } from './actions';
import { SettingsPanel, syncLabel } from './Dialogs';
import { Icon } from './glyphs';
import { ForgePage, HealthPage, OtpCard } from './views';

type Tab = 'codes' | 'vault' | 'forge' | 'settings' | 'health';

const NAV: { id: Tab; kanji: string; name: string }[] = [
  { id: 'codes', kanji: '符', name: 'Códigos' },
  { id: 'vault', kanji: '蔵', name: 'Cofre' },
  { id: 'forge', kanji: '鍛', name: 'Gerar' },
  { id: 'settings', kanji: '設', name: 'Ajustes' }
];

/** Layout de celular: abas embaixo, item aberto em tela cheia (o "voltar" do Android fecha). */
export function MobileScreen() {
  const vault = useVault();
  const data = vault.data!;
  const toast = useToast();
  const act = useItemActions();
  const now = useNow();
  const [tab, setTab] = useState<Tab>('codes');
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ item: Item | null } | null>(null);

  const cats = useMemo(() => categories(data), [data]);
  const active = useMemo(() => activeItems(data), [data]);
  const reused = useMemo(() => reusedIds(active), [active]);
  const health = useMemo(() => vaultHealth(active, data.breached), [active, data.breached]);
  const folderName = (id: string | null) => data.folders.find(f => f.id === id)?.name || '';
  const folderKanji = (id: string | null) => KANJI[data.folders.findIndex(f => f.id === id)] || '';

  useEffect(() => { act.purgeExpired(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Botão "voltar" do Android: fecha o item aberto em vez de sair do app.
  useEffect(() => {
    if (!openId) return;
    history.pushState({ hanko: 'item' }, '');
    const onPop = () => setOpenId(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [openId]);
  const closeItem = () => { if (history.state?.hanko === 'item') history.back(); else setOpenId(null); };

  const tfa = active.filter(i => i.otp).sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.lastUsed || 0) - (a.lastUsed || 0) || a.name.localeCompare(b.name, 'pt-BR'));
  const chips = [
    ...cats.filter(c => c.id === 'all' || data.items.some(c.test)).map(c => ({ id: c.id, name: c.name, test: c.test })),
    ...data.folders.map((f, i) => ({ id: 'f:' + f.id, name: `${KANJI[i] || ''} ${f.name}`, test: (it: Item) => it.folderId === f.id && !it.trashed }))
  ];
  const chip = chips.find(c => c.id === filter) || chips[0];
  const qq = q.trim().toLowerCase();
  const list = data.items.filter(chip.test)
    .filter(i => !qq || [i.name, i.username, i.url, i.tags.join(' ')].some(x => x.toLowerCase().includes(qq)))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  const opened = data.items.find(i => i.id === openId) || null;

  async function copy(text: string, what: string, itemId?: string) {
    if (!text) return;
    try {
      await copySecret(text, data.settings.clipboardSeconds);
      toast.show('写', `${what} copiado`);
      if (itemId) vault.update(d => { const it = d.items.find(x => x.id === itemId); if (it) it.lastUsed = Date.now(); });
    } catch {
      toast.show('誤', 'Não consegui copiar');
    }
  }

  const g = greeting(new Date(now));
  const issues = health.weak.length + health.reused.length + health.breached.length;
  const title = tab === 'codes' ? g.title : tab === 'vault' ? 'Cofre' : tab === 'forge' ? 'Gerar' : tab === 'health' ? 'Saúde' : 'Ajustes';

  return (
    <div className="m-shell">
      <header className="m-top">
        <Logo size={34} />
        <div className="m-top-text">
          <span className="eyebrow">{active.length} itens · {syncLabel(vault.sync)}</span>
          <span className="m-top-title">{title}</span>
        </div>
        <button className="icon-btn ghost m-lock" onClick={vault.lock} aria-label="Bloquear"><span className="m-lock-k">閉</span></button>
      </header>

      <div className="m-page" key={tab}>
        {tab === 'codes' && (
          <>
            {!vault.hasKit && (
              <button className="banner danger m-banner" onClick={() => setTab('settings')}>
                <Icon name="shield" size={18} /><span>Gere o <b>Kit de Emergência</b> — sem ele, esquecer a senha mestra apaga tudo.</span><Icon name="chevron" size={14} />
              </button>
            )}
            {active.length > 0 && (
              <button className={`m-health ${health.breached.length ? 'alert' : ''}`} onClick={() => setTab('health')}>
                <span className="m-health-score">{health.score}</span>
                <span className="m-health-text"><b>Saúde do cofre</b><span>{health.breached.length ? `${health.breached.length} senha(s) vazada(s) — cuidar hoje` : issues ? `${issues} senha(s) para rever` : 'tudo sereno'}</span></span>
                <Icon name="chevron" size={14} />
              </button>
            )}
            {tfa.length ? (
              <div className="otp-grid m-otp">
                {tfa.map((it, i) => <OtpCard key={it.id} item={it} now={now} delay={i} online={data.settings.onlineIcons} onCopy={(c, x) => copy(c, `Código de ${x.name}`, x.id)} onOpen={setOpenId} />)}
              </div>
            ) : (
              <div className="empty-note">
                <span className="empty-kanji">符</span>
                <p>{active.length ? 'Nenhuma conta com 2FA ainda. Ao editar uma conta, cole a chave 2FA ou a imagem do QR code.' : 'Toque em + para guardar a primeira conta.'}</p>
              </div>
            )}
          </>
        )}

        {tab === 'vault' && (
          <>
            <label className="field-search">
              <Icon name="search" />
              <input placeholder="procurar" aria-label="Buscar" value={q} onChange={e => setQ(e.target.value)} />
              {q && <button className="field-clear" onClick={() => setQ('')} aria-label="Limpar busca"><Icon name="close" size={12} /></button>}
            </label>
            <div className="chips m-chips-row">
              {chips.map(c => (
                <button key={c.id} className={`chip-btn ${c.id === chip.id ? 'on' : ''}`} onClick={() => setFilter(c.id)}>{c.name}</button>
              ))}
            </div>
            {chip.id === 'trash' && list.length > 0 && (
              <div className="shelf-actions">
                <button className="btn btn-sm" onClick={act.restoreAll}>Restaurar tudo</button>
                <button className="btn btn-sm danger" onClick={act.emptyTrash}>Esvaziar lixeira</button>
              </div>
            )}
            <div className="m-list">
              {list.map((it, idx) => {
                const pl = passwordLabel(it, data, reused);
                const warn = pl.color !== 'var(--washi-3)' && pl.text !== '—';
                return (
                  <button key={it.id} className="card-row" style={{ animationDelay: `${Math.min(idx, 14) * 0.025}s` }} onClick={() => setOpenId(it.id)}>
                    <Avatar name={it.name} url={it.url} size={40} online={data.settings.onlineIcons} />
                    <span className="card-text">
                      <span className="card-name">{it.favorite ? '★ ' : ''}{it.name}</span>
                      <span className="card-sub">{subtitle(it) || KIND_LABEL[it.kind].toLowerCase()}</span>
                    </span>
                    <span className="card-tags">
                      {it.otp && <span className="tag gold">2FA</span>}
                      {warn && <span className="tag warn">{pl.text}</span>}
                    </span>
                  </button>
                );
              })}
              {!list.length && (
                <div className="empty-note small">
                  <span className="empty-kanji">空</span>
                  <p>{data.items.length ? 'Nada encontrado aqui.' : 'Toque em + para guardar a primeira conta.'}</p>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'forge' && <ForgePage onCopy={p => copy(p, 'Senha')} />}
        {tab === 'health' && <HealthPage onOpen={setOpenId} />}
        {tab === 'settings' && <SettingsPanel initialTab={vault.hasKit ? undefined : 'seguranca'} />}
      </div>

      <nav className="m-nav" aria-label="Navegação">
        {NAV.slice(0, 2).map(n => <NavBtn key={n.id} n={n} on={tab === n.id} onClick={() => setTab(n.id)} />)}
        <button className="m-plus" aria-label="Novo item" onClick={() => setEditing({ item: null })}><Icon name="plus" size={22} /></button>
        {NAV.slice(2).map(n => <NavBtn key={n.id} n={n} on={tab === n.id} onClick={() => setTab(n.id)} />)}
      </nav>

      {opened && (
        <div className="m-sheet">
          <Detail
            key={opened.id} item={opened} folder={folderName(opened.folderId)} kanji={folderKanji(opened.folderId)}
            label={passwordLabel(opened, data, reused)} online={data.settings.onlineIcons}
            onBack={closeItem}
            onCopy={(t, w) => copy(t, w, opened.id)}
            onEdit={() => setEditing({ item: opened })}
            onFavorite={() => vault.update(d => { const x = d.items.find(i => i.id === opened.id); if (x) { x.favorite = !x.favorite; x.updated = Date.now(); } })}
            onOpenFile={async att => { try { download(await vault.readFile(att), att.name); } catch { toast.show('誤', 'Não consegui abrir o arquivo'); } }}
          />
        </div>
      )}

      {editing && <Editor item={editing.item} onClose={id => { setEditing(null); if (id) setOpenId(id); }} />}
    </div>
  );
}

function NavBtn({ n, on, onClick }: { n: { kanji: string; name: string }; on: boolean; onClick(): void }) {
  return (
    <button className={`m-tab ${on ? 'on' : ''}`} onClick={onClick} aria-current={on ? 'page' : undefined}>
      <span className="m-tab-k">{n.kanji}</span>
      <span className="m-tab-n">{n.name}</span>
    </button>
  );
}
