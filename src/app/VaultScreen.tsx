import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { reusedIds, strength } from '../core/passwords';
import type { Item } from '../core/types';
import { formatCode, isHotp } from '../core/totp';
import { useNow, useTotp } from './hooks';
import { KANJI, KIND_LABEL, activeItems, ago, categories, download, formatBytes, passwordLabel, subtitle } from './model';
import { Avatar, Logo, copySecret, useToast } from './ui';
import { useVault } from './vault';
import { Editor } from './Editor';
import { SettingsPanel, syncLabel } from './Dialogs';
import { CatIcon } from './fx';
import { useItemActions } from './actions';
import { Icon, Ring } from './glyphs';
import { CodesBoard, ForgePage, HealthPage, Overview, type View } from './views';

type Dialog = { kind: 'edit'; item: Item | null } | null;

const RAIL: { id: View; kanji: string; name: string }[] = [
  { id: 'vault', kanji: '蔵', name: 'Cofre' },
  { id: 'codes', kanji: '符', name: 'Códigos' },
  { id: 'forge', kanji: '鍛', name: 'Gerar' },
  { id: 'health', kanji: '診', name: 'Saúde' },
  { id: 'settings', kanji: '設', name: 'Ajustes' }
];

export function VaultScreen() {
  const vault = useVault();
  const data = vault.data!;
  const toast = useToast();
  const act = useItemActions();
  const [view, setView] = useState<View>('vault');
  const [catId, setCatId] = useState('all');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [settingsTab, setSettingsTab] = useState<string | undefined>();
  const searchRef = useRef<HTMLInputElement>(null);

  const cats = useMemo(() => categories(data), [data]);
  const active = useMemo(() => activeItems(data), [data]);
  const reused = useMemo(() => reusedIds(active), [active]);
  const folderName = (id: string | null) => data.folders.find(f => f.id === id)?.name || '';
  const folderKanji = (id: string | null) => KANJI[data.folders.findIndex(f => f.id === id)] || '';

  // Itens na lixeira há mais de 30 dias somem de vez (com anexos; a exclusão viaja para os outros aparelhos).
  useEffect(() => { act.purgeExpired(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cat = cats.find(c => c.id === catId) || cats[0];
  const qq = q.trim().toLowerCase();
  const items = data.items
    .filter(cat.test)
    .filter(i => !folderId || (i.folderId === folderId && !i.trashed))
    .filter(i => !qq || [i.name, i.username, i.url, i.notes, i.tags.join(' '), subtitle(i), ...i.fields.filter(f => !f.hidden).map(f => f.value)]
      .some(x => x.toLowerCase().includes(qq)))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  const favCount = items.filter(i => i.favorite).length;

  const sel = data.items.find(i => i.id === selId) || null;
  const openItem = (id: string) => { setView('vault'); setSelId(id); };
  const go = (v: View, tab?: string) => { setView(v); if (v === 'settings') setSettingsTab(tab); if (v !== 'vault') setSelId(null); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.overlay')) return;
      if (e.key === 'Escape') { setSelId(null); return; }
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'l') { e.preventDefault(); vault.lock(); }
      else if (k === 'n') { e.preventDefault(); setDialog({ kind: 'edit', item: null }); }
      else if (k === 'f') { e.preventDefault(); setView('vault'); setTimeout(() => searchRef.current?.focus(), 0); }
      else if (/^[1-5]$/.test(k)) { e.preventDefault(); go(RAIL[+k - 1].id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [vault]); // eslint-disable-line react-hooks/exhaustive-deps

  const markUsed = (id: string) => vault.update(d => { const it = d.items.find(x => x.id === id); if (it) it.lastUsed = Date.now(); });

  async function copy(text: string, what: string, itemId?: string) {
    if (!text) return;
    try {
      await copySecret(text, data.settings.clipboardSeconds);
      toast.show('写', `${what} copiado — some em ${data.settings.clipboardSeconds} s`);
      if (itemId) markUsed(itemId);
    } catch {
      toast.show('誤', 'Não consegui copiar');
    }
  }

  const visibleCats = cats.filter(c => c.id === 'all' || c.id === catId || data.items.some(c.test));
  const issues = data.items.filter(cats.find(c => c.id === 'review')!.test).length;

  return (
    <div className={`kura view-${view}`}>
      {/* ---------- Trilho ---------- */}
      <nav className="rail" aria-label="Navegação">
        <button className="rail-logo" onClick={() => { go('vault'); setSelId(null); }} title="Hanko — início">
          <Logo size={40} className="logo-stamp" />
        </button>
        <div className="rail-items">
          {RAIL.map((r, i) => (
            <button key={r.id} className={`rail-btn ${view === r.id ? 'on' : ''}`} onClick={() => go(r.id)} title={`${r.name} (Ctrl ${i + 1})`} aria-current={view === r.id ? 'page' : undefined}>
              <span className="rail-kanji">{r.kanji}</span>
              <span className="rail-name">{r.name}</span>
              {r.id === 'health' && issues > 0 && <i className="rail-badge">{issues}</i>}
            </button>
          ))}
        </div>
        <div className="rail-foot">
          <button className={`rail-sync ${vault.sync.status}`} onClick={() => go('settings', 'conta')} title={vault.sync.error || syncLabel(vault.sync)} aria-label={syncLabel(vault.sync)}>
            <i className={vault.sync.status === 'syncing' ? 'sync-dot' : undefined} />
          </button>
          <button className="rail-btn lock" onClick={vault.lock} title="Bloquear (Ctrl L)">
            <span className="rail-kanji">閉</span>
            <span className="rail-name">Bloquear</span>
          </button>
        </div>
      </nav>

      {/* ---------- Estante (lista) ---------- */}
      {view === 'vault' && (
        <section className="shelf" aria-label="Itens do cofre">
          <div className="shelf-head">
            <div>
              <span className="eyebrow">蔵 · {active.length} itens</span>
              <h2 className="shelf-title">{folderId ? folderName(folderId) : cat.id === 'all' ? 'Cofre' : cat.name}</h2>
            </div>
            <button className="btn btn-solid btn-icon" onClick={() => setDialog({ kind: 'edit', item: null })} title="Novo item (Ctrl N)" aria-label="Novo item"><Icon name="plus" size={18} /></button>
          </div>

          <label className="field-search">
            <Icon name="search" />
            <input ref={searchRef} placeholder="procurar" aria-label="Buscar" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } }} />
            {q ? <button className="field-clear" onClick={() => setQ('')} aria-label="Limpar busca"><Icon name="close" size={12} /></button> : <span className="kbd">Ctrl F</span>}
          </label>

          <div className="chips" role="tablist" aria-label="Categorias">
            {visibleCats.map(c => {
              const n = data.items.filter(c.test).length;
              return (
                <button key={c.id} role="tab" aria-selected={c.id === catId && !folderId} className={`chip-btn ${c.id === catId && !folderId ? 'on' : ''} ${c.id === 'review' ? 'warn' : ''}`}
                  onClick={() => { setCatId(c.id); setFolderId(null); }}>
                  <CatIcon id={c.id} /> {c.name} <span className="mono">{n}</span>
                </button>
              );
            })}
          </div>

          <div className="folders">
            {data.folders.map((f, i) => {
              const n = active.filter(x => x.folderId === f.id).length;
              return (
                <button key={f.id} className={`folder-tab ${folderId === f.id ? 'on' : ''} ${n ? '' : 'empty'}`} onClick={() => { setFolderId(folderId === f.id ? null : f.id); setCatId('all'); }}
                  onDoubleClick={() => act.renameFolder(f)} title="Clique para filtrar · dois cliques para renomear">
                  <span className="folder-kanji">{KANJI[i] || '・'}</span>{f.name}{n > 0 && <span className="mono">{n}</span>}
                </button>
              );
            })}
            <button className="folder-tab add" onClick={async () => { const id = await act.addFolder(); if (id) { setFolderId(id); setCatId('all'); } }} title="Nova pasta" aria-label="Nova pasta"><Icon name="plus" size={12} /></button>
          </div>

          {cat.id === 'trash' && items.length > 0 && (
            <div className="shelf-actions">
              <button className="btn btn-sm" onClick={act.restoreAll}>Restaurar tudo</button>
              <button className="btn btn-sm danger" onClick={act.emptyTrash}>Esvaziar lixeira</button>
            </div>
          )}

          <div className="shelf-list">
            {items.map((it, idx) => {
              const pl = passwordLabel(it, data, reused);
              const warn = pl.color !== 'var(--washi-3)' && pl.text !== '—';
              return (
                <Fragment key={it.id}>
                  {idx === 0 && favCount > 0 && <span className="list-sep">★ favoritos</span>}
                  {idx === favCount && favCount > 0 && <span className="list-sep">todos</span>}
                  <button className={`card-row ${sel?.id === it.id ? 'on' : ''}`} style={{ animationDelay: `${Math.min(idx, 14) * 0.025}s` }}
                    onClick={() => setSelId(sel?.id === it.id ? null : it.id)} onDoubleClick={() => setDialog({ kind: 'edit', item: it })}>
                    <Avatar name={it.name} url={it.url} size={38} on={sel?.id === it.id} online={data.settings.onlineIcons} />
                    <span className="card-text">
                      <span className="card-name">{it.name}</span>
                      <span className="card-sub">{subtitle(it) || KIND_LABEL[it.kind].toLowerCase()}</span>
                    </span>
                    <span className="card-tags">
                      {it.otp && <span className="tag gold" title="Tem código 2FA">2FA</span>}
                      {warn && <span className="tag warn" title={`Senha ${pl.text}`}>{pl.text}</span>}
                      {it.folderId && <span className="tag kanji" title={folderName(it.folderId)}>{folderKanji(it.folderId)}</span>}
                    </span>
                  </button>
                </Fragment>
              );
            })}
            {!items.length && (
              <div className="empty-note small">
                <span className="empty-kanji">空</span>
                <p>{data.items.length ? (qq ? `Nada encontrado para “${q}”.` : 'Nada aqui ainda.') : 'O cofre está vazio.'}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---------- Palco ---------- */}
      <main className="stage" key={view === 'vault' ? `v-${sel?.id || 'home'}` : view}>
        {view === 'vault' && sel ? (
          <Detail
            item={sel} folder={folderName(sel.folderId)} kanji={folderKanji(sel.folderId)}
            label={passwordLabel(sel, data, reused)} online={data.settings.onlineIcons}
            onCopy={(t, w) => copy(t, w, sel.id)}
            onClose={() => setSelId(null)}
            onEdit={() => setDialog({ kind: 'edit', item: sel })}
            onFavorite={() => vault.update(d => { const x = d.items.find(i => i.id === sel.id); if (x) { x.favorite = !x.favorite; x.updated = Date.now(); } })}
            onOpenFile={async att => { try { download(await vault.readFile(att), att.name); toast.show('封', `${att.name} salvo em Downloads`); } catch { toast.show('誤', 'Não consegui abrir o arquivo'); } }}
          />
        ) : view === 'vault' ? (
          <Overview onOpen={openItem} onNew={() => setDialog({ kind: 'edit', item: null })} onGo={v => go(v, v === 'settings' ? (vault.hasKit ? 'dados' : 'seguranca') : undefined)}
            onCopy={(code, it) => copy(code, `Código de ${it.name}`, it.id)} onImport={() => go('settings', 'dados')} />
        ) : view === 'codes' ? (
          <CodesBoard onCopy={(code, it) => copy(code, `Código de ${it.name}`, it.id)} onOpen={openItem} onNew={() => setDialog({ kind: 'edit', item: null })} />
        ) : view === 'forge' ? (
          <ForgePage onCopy={p => copy(p, 'Senha')} />
        ) : view === 'health' ? (
          <HealthPage onOpen={openItem} />
        ) : (
          <SettingsPanel initialTab={settingsTab} />
        )}
      </main>

      {dialog?.kind === 'edit' && <Editor item={dialog.item} onClose={id => { setDialog(null); if (id) openItem(id); }} />}
    </div>
  );
}

/* ---------- Painel do item ---------- */

export function Detail({ item, folder, kanji, label, online, onCopy, onEdit, onFavorite, onOpenFile, onBack, onClose }: {
  item: Item; folder: string; kanji: string; label: { text: string; color: string }; online: boolean;
  onCopy(text: string, what: string): void; onEdit(): void; onFavorite(): void; onOpenFile(att: Item['attachments'][number]): void;
  onBack?(): void; onClose?(): void;
}) {
  const [showCodes, setShowCodes] = useAutoHide();
  const now = useNow();
  const t = useTotp(item.otp, now);
  const act = useItemActions();
  const leave = () => (onClose || onBack)?.();
  const s = item.kind === 'login' && item.password ? strength(item.password) : null;

  return (
    <article className="tablet" aria-label={`Detalhes de ${item.name}`}>
      <header className="tablet-head">
        {onBack && <button className="icon-btn ghost" onClick={onBack} aria-label="Voltar"><Icon name="back" size={18} /></button>}
        <Avatar name={item.name} url={item.url} size={60} online={online} />
        <div className="tablet-id">
          <span className="eyebrow">{KIND_LABEL[item.kind]}{folder ? <> · <span className="gold-k">{kanji}</span> {folder}</> : null}</span>
          <h1 className="tablet-title">{item.name}</h1>
          {item.url && <button className="tablet-url" onClick={() => onCopy(item.url, 'Endereço')} title="Copiar endereço"><Icon name="link" size={13} /> {item.url}</button>}
        </div>
        <div className="tablet-actions">
          <button className={`icon-btn ghost ${item.favorite ? 'fav' : ''}`} onClick={onFavorite} title={item.favorite ? 'Tirar dos favoritos' : 'Favoritar'} aria-label="Favorito" aria-pressed={item.favorite}>
            <Icon name="star" size={17} />
          </button>
          {!item.trashed && (
            <>
              <button className="icon-btn ghost danger" onClick={() => { leave(); act.trash(item); }} title="Mover para a lixeira" aria-label="Mover para a lixeira"><Icon name="trash" size={17} /></button>
              <button className="btn btn-sm" onClick={onEdit}><Icon name="edit" size={14} /> Editar</button>
            </>
          )}
          {onClose && <button className="icon-btn ghost" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar"><Icon name="close" size={16} /></button>}
        </div>
      </header>

      {item.trashed && <TrashActions item={item} onGone={leave} />}

      {item.otp && isHotp(item.otp) && !item.trashed && <HotpPlate item={item} onCopy={onCopy} />}

      {item.otp && t && (
        <button className={`otp-plate ${t.left <= 5 ? 'urgent' : ''}`} onClick={() => onCopy(t.code.replace(/\s/g, ''), 'Código 2FA')} title="Copiar código">
          <Ring progress={t.left / item.otp.period} size={54} stroke={3} urgent={t.left <= 5} />
          <span className="otp-plate-text">
            <span className="eyebrow">código 2FA · {t.left} s</span>
            <span key={t.counter} className="otp-code code-flip">{t.code}</span>
          </span>
          <span className="otp-plate-copy"><Icon name="copy" size={16} /> copiar</span>
        </button>
      )}

      <div className="slips">
        {item.kind === 'login' && (
          <>
            <Slip label="usuário" value={item.username} onCopy={onCopy} />
            <Slip label="senha" value={item.password} secret onCopy={onCopy}
              extra={s && <span className="slip-meter"><span className="track"><i style={{ width: `${Math.min(100, s.bits)}%`, background: label.color === 'var(--washi-3)' ? 'var(--gold)' : label.color }} /></span><em style={{ color: label.color === 'var(--washi-3)' ? 'var(--gold)' : label.color }}>{label.text}</em></span>} />
          </>
        )}
        {item.kind === 'card' && item.card && (
          <>
            <div className="card-face">
              <span className="eyebrow">{item.card.brand || 'cartão'}</span>
              <span className="mono card-num">•••• •••• •••• {item.card.number.replace(/\D/g, '').slice(-4)}</span>
              <div className="card-bottom"><span>{item.card.holder}</span><span className="mono">{item.card.expiry}</span></div>
            </div>
            <Slip label="número" value={item.card.number} secret onCopy={onCopy} />
            <Slip label="titular" value={item.card.holder} onCopy={onCopy} />
            <Slip label="validade" value={item.card.expiry} onCopy={onCopy} />
            <Slip label="código de segurança (CVV)" value={item.card.cvv} secret onCopy={onCopy} />
            <Slip label="senha do cartão" value={item.card.pin} secret onCopy={onCopy} />
          </>
        )}
        {item.kind === 'identity' && item.identity && (
          <>
            <Slip label="nome completo" value={item.identity.fullName} onCopy={onCopy} />
            <Slip label="CPF" value={item.identity.cpf} onCopy={onCopy} />
            <Slip label="RG" value={item.identity.rg} onCopy={onCopy} />
            <Slip label="nascimento" value={item.identity.birth} onCopy={onCopy} />
            <Slip label="telefone" value={item.identity.phone} onCopy={onCopy} />
            <Slip label="e-mail" value={item.identity.email} onCopy={onCopy} />
            <Slip label="endereço" value={item.identity.address} onCopy={onCopy} />
          </>
        )}
        {item.fields.map(f => <Slip key={f.id} label={f.label || 'campo'} value={f.value} secret={f.hidden} onCopy={onCopy} />)}
      </div>

      {item.notes && (
        <section className="tablet-sec">
          <h3>Notas</h3>
          <p className="notes">{item.notes}</p>
        </section>
      )}

      {(item.attachments.length > 0 || item.recoveryCodes.trim()) ? (
        <section className="tablet-sec">
          <h3>Documentos e recuperação</h3>
          {item.attachments.length > 0 && (
            <div className="letters">
              {item.attachments.filter(a => a.mime.startsWith('image/')).map(att => <PhotoThumb key={att.id} att={att} onSave={() => onOpenFile(att)} />)}
              {item.attachments.filter(a => !a.mime.startsWith('image/')).map(att => (
                <button key={att.id} className="letter" onClick={() => onOpenFile(att)} title="Salvar uma cópia aberta em Downloads">
                  <span className="ribbon" /><span className="wax">封</span>
                  <span className="letter-name">{att.name}</span>
                  <span className="faint mono letter-size">{formatBytes(att.size)}</span>
                </button>
              ))}
            </div>
          )}
          {item.recoveryCodes.trim() && (
            <div className="rec-codes">
              <div className={`mono rec-text ${showCodes ? '' : 'hidden'}`}>{item.recoveryCodes.trim()}</div>
              <div className="row-actions">
                <button className="btn btn-sm" onClick={() => setShowCodes(v => !v)}><Icon name={showCodes ? 'eyeOff' : 'eye'} size={14} /> {showCodes ? 'Ocultar' : 'Revelar'}</button>
                <button className="btn btn-sm" onClick={() => onCopy(item.recoveryCodes.trim(), 'Códigos')}><Icon name="copy" size={14} /> Copiar</button>
              </div>
            </div>
          )}
        </section>
      ) : !item.trashed && (
        <button className="add-rec" onClick={onEdit}><Icon name="plus" size={14} /> anexar foto de documento, PDF ou códigos de recuperação</button>
      )}

      {item.history.length > 0 && <History item={item} onCopy={onCopy} />}

      <footer className="tablet-foot mono">
        {item.tags.map(tg => <span key={tg} className="tag">#{tg}</span>)}
        <span>criado {new Date(item.created).toLocaleDateString('pt-BR')}</span>
        <span>alterado {ago(item.updated)}</span>
        <span>usado {ago(item.lastUsed)}</span>
      </footer>
    </article>
  );
}

/** Foto de documento: decifrada só na memória para a miniatura; clique amplia, com opção de salvar. */
function PhotoThumb({ att, onSave }: { att: Item['attachments'][number]; onSave(): void }) {
  const vault = useVault();
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let u: string | null = null, alive = true;
    vault.readFile(att).then(b => { if (!alive) return; u = URL.createObjectURL(b); setUrl(u); }).catch(() => {});
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [att.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return (
    <>
      <button className="photo" onClick={() => setOpen(true)} title={att.name} disabled={!url}>
        {url ? <img src={url} alt={att.name} /> : <span className="faint small">abrindo…</span>}
        <span className="photo-name">{att.name}</span>
      </button>
      {open && url && (
        <div className="overlay lightbox" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <figure>
            <img src={url} alt={att.name} />
            <figcaption>
              <span>{att.name} · {formatBytes(att.size)}</span>
              <span className="row-actions">
                <button className="btn btn-sm" onClick={onSave}><Icon name="download" size={14} /> Salvar cópia</button>
                <button className="btn btn-sm" onClick={() => setOpen(false)}><Icon name="close" size={14} /> Fechar</button>
              </span>
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}

/** HOTP: o código só existe quando pedido; cada pedido avança o contador. */
function HotpPlate({ item, onCopy }: { item: Item; onCopy(t: string, w: string): void }) {
  const act = useItemActions();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  async function next() {
    setBusy(true);
    try {
      const c = await act.nextHotp(item);
      setCode(c);
      onCopy(c, 'Código 2FA');
    } finally { setBusy(false); }
  }
  return (
    <button className="otp-plate hotp" onClick={next} disabled={busy} title="Gerar o próximo código e copiar">
      <span className="hotp-k">符</span>
      <span className="otp-plate-text">
        <span className="eyebrow">código por contador · nº {item.otp?.counter || 0}</span>
        <span key={code} className="otp-code code-flip">{code ? formatCode(code) : '··· ···'}</span>
      </span>
      <span className="otp-plate-copy"><Icon name="refresh" size={16} /> {code ? 'gerar outro' : 'gerar e copiar'}</span>
    </button>
  );
}

/** Uma linha de dado com copiar (e ver/ocultar quando é segredo). */
function Slip({ label, value, secret = false, extra, onCopy }: { label: string; value: string; secret?: boolean; extra?: ReactNode; onCopy(t: string, w: string): void }) {
  const [show, setShow] = useAutoHide();
  if (!value) return null;
  const what = label.charAt(0).toUpperCase() + label.slice(1);
  return (
    <div className="slip">
      <span className="slip-label">{label}{extra}</span>
      <div className="slip-row">
        <span className={`slip-value ${secret ? 'mono' : ''} ${secret && !show ? 'masked' : ''}`}>{secret && !show ? '•'.repeat(Math.min(14, Math.max(8, value.length))) : value}</span>
        <span className="slip-actions">
          {secret && <button className="icon-btn ghost" onClick={() => setShow(v => !v)} title={show ? 'Ocultar' : 'Ver'} aria-label={show ? 'Ocultar' : 'Ver'}><Icon name={show ? 'eyeOff' : 'eye'} size={16} /></button>}
          <button className="icon-btn ghost copy" onClick={() => onCopy(value, what)} title={`Copiar ${label}`} aria-label={`Copiar ${label}`}><Icon name="copy" size={16} /></button>
        </span>
      </div>
    </div>
  );
}

function History({ item, onCopy }: { item: Item; onCopy(t: string, w: string): void }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  return (
    <section className="tablet-sec">
      <button className="sec-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Icon name="chevron" size={13} className={open ? 'rot' : ''} /> Histórico de senhas <span className="mono faint">{item.history.length}</span>
      </button>
      {open && item.history.map((h, i) => (
        <div key={i} className="slip-row hist">
          <span className="mono slip-value">{shown === i ? h.password : '••••••••'}</span>
          <span className="faint small">até {new Date(h.changed).toLocaleDateString('pt-BR')}</span>
          <span className="slip-actions">
            <button className="icon-btn ghost" onClick={() => setShown(shown === i ? null : i)} aria-label="Ver"><Icon name={shown === i ? 'eyeOff' : 'eye'} size={15} /></button>
            <button className="icon-btn ghost copy" onClick={() => onCopy(h.password, 'Senha antiga')} aria-label="Copiar"><Icon name="copy" size={15} /></button>
          </span>
        </div>
      ))}
    </section>
  );
}

function TrashActions({ item, onGone }: { item: Item; onGone?(): void }) {
  const act = useItemActions();
  const days = Math.max(0, 30 - Math.floor((Date.now() - (item.trashed || 0)) / 86400_000));
  return (
    <div className="banner danger">
      <Icon name="trash" size={18} />
      <span>Na lixeira · {days ? `some de vez em ${days} dia(s)` : 'some de vez hoje'}.</span>
      <button className="btn btn-solid btn-sm" onClick={() => act.restore(item)}>Restaurar</button>
      <button className="btn btn-sm danger" onClick={async () => { if (await act.destroy(item)) onGone?.(); }}>Excluir para sempre</button>
    </div>
  );
}

/** Segredo revelado volta a se esconder sozinho depois de 20 s (ou ao trocar de item). */
function useAutoHide(ms = 20_000): [boolean, (v: boolean | ((s: boolean) => boolean)) => void] {
  const [show, setShow] = useState(false);
  useEffect(() => { if (!show) return; const t = setTimeout(() => setShow(false), ms); return () => clearTimeout(t); }, [show, ms]);
  return [show, setShow];
}
