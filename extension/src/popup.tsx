import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
// Só o alfabeto latino das fontes (os ideogramas usam as fontes japonesas do próprio Windows):
// a extensão fica leve e atualiza rápido.
import '@fontsource/shippori-mincho/latin-400.css';
import '@fontsource/shippori-mincho/latin-500.css';
import '@fontsource/zen-kaku-gothic-new/latin-400.css';
import '@fontsource/zen-kaku-gothic-new/latin-700.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import '../../src/styles.css';
import '../../src/theme-laca.css';
import '../../src/kura.css';
import './popup.css';
import { b64, deriveAuthSecret, headerOf, openVault, seal, unsealWithKey, importDataKey } from '../../src/core/crypto';
import { totp } from '../../src/core/totp';
import { newItem, type Item, type SealedBlob, type SealedBlobV2, type VaultData } from '../../src/core/types';
import { ConflictError, cloud } from '../../src/app/cloud';
import { fetchMobileManifest, isNewer } from '../../src/app/updates';
import { useNow, useTotp } from '../../src/app/hooks';
import { Avatar, Enso, Logo, Paper, ToastProvider, useToast } from '../../src/app/ui';
import { Icon, Ring } from '../../src/app/glyphs';
import { PasswordForge } from '../../src/app/generator';
import { baseDomain, hostOf, local, matchesSite, openData, safeTransport, sess, siteItems, touch, type Capture, type Link } from './store';

type Screen = 'loading' | 'login' | 'locked' | 'open';

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function Popup() {
  const toast = useToast();
  const [screen, setScreen] = useState<Screen>('loading');
  const [data, setData] = useState<VaultData | null>(null);
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  const [link, setLink] = useState<Link | null>(null);

  async function start() {
    setTab(await activeTab());
    const [blob, l] = await Promise.all([local.get<SealedBlob>('vault'), local.get<Link>('link')]);
    setLink(l || null);
    if (!blob) return setScreen('login');
    const d = await openData();
    if (!d) return setScreen('locked');
    setData(d);
    setScreen('open');
    await touch(d.settings.autoLockMinutes);
    refresh();
  }

  /** Busca a versão mais nova do cofre no servidor (só leitura). */
  async function refresh() {
    try {
      if (!(await cloud.session())) return;
      const [remote, dekB64, cur] = await Promise.all([cloud.pull(), sess.get<string>('dek'), local.get<SealedBlobV2>('vault')]);
      if (!remote || !dekB64) return;
      if (!cur || remote.blob.ct !== cur.ct) {
        const d = await unsealWithKey<VaultData>(await importDataKey(b64.from(dekB64)), remote.blob);
        await local.set('vault', remote.blob);
        setData(d);
      }
      const l = { email: link?.email || (await local.get<Link>('link'))?.email || '', pulledAt: Date.now() };
      await local.set('link', l);
      setLink(l);
    } catch { /* sem conexão: usa a cópia local */ }
  }

  useEffect(() => { start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function afterOpen(dekRaw: Uint8Array, d: VaultData) {
    await sess.set('dek', b64.to(dekRaw));
    await touch(d.settings.autoLockMinutes);
    setData(d);
    setScreen('open');
  }

  async function fill(item: Item) {
    const t = tab;
    if (!t?.id || !t.url || !matchesSite(item, t.url)) return toast.show('誤', 'Esta conta não é deste site');
    const secure = safeTransport(item, t.url);
    if (!secure) toast.show('危', 'Página sem HTTPS: preenchi só o usuário');
    const code = item.otp && item.otp.type !== 'hotp' ? await totp(item.otp) : undefined;
    try {
      // frameId 0: só a página principal da aba recebe — nunca um iframe de outro site dentro dela.
      const r = await chrome.tabs.sendMessage(t.id, { type: 'doFill', username: item.username, password: secure ? item.password : '', code }, { frameId: 0 });
      if (r?.filled) window.close();
      else toast.show('誤', 'Não achei os campos de login nesta página');
    } catch {
      toast.show('誤', 'Recarregue a página e tente de novo');
    }
  }

  async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text);
    // O popup fecha logo; quem apaga a cópia depois é a extensão em segundo plano.
    const seconds = data?.settings.clipboardSeconds || 30;
    chrome.runtime.sendMessage({ type: 'clearClipboard', seconds }).catch(() => {});
    toast.show('写', `${what} copiado — some em ${seconds} s`);
  }

  /* ---------- Login capturado numa página: salvar ou atualizar no cofre ---------- */
  const [capture, setCapture] = useState<Capture | null>(null);
  useEffect(() => {
    if (!tab?.url) return;
    sess.get<Capture>('capture').then(c => {
      if (c && Date.now() - c.at < 5 * 60_000 && baseDomain(hostOf(c.url)) === baseDomain(hostOf(tab.url!))) setCapture(c);
    });
  }, [tab, screen]);

  async function dropCapture() {
    await sess.set('capture', null);
    await chrome.action.setBadgeText({ text: '', tabId: tab?.id }).catch(() => {});
    setCapture(null);
  }

  /** Grava no cofre da conta: baixa a versão mais nova, junta o login e envia (tenta de novo se outro aparelho gravou no meio). */
  async function saveCapture(cap: Capture, name: string) {
    const dekB64 = await sess.get<string>('dek');
    if (!dekB64) throw new Error('Hanko bloqueado. Abra o cofre e tente de novo.');
    if (!(await cloud.session())) throw new Error('Entre na conta para salvar logins pela extensão.');
    const dekRaw = b64.from(dekB64);
    const dek = await importDataKey(dekRaw);
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await cloud.pull();
      if (!remote) throw new Error('Esta conta ainda não tem cofre.');
      const d = await unsealWithKey<VaultData>(dek, remote.blob);
      const now = Date.now();
      const old = cap.itemId ? d.items.find(i => i.id === cap.itemId && !i.trashed) : undefined;
      if (old) {
        if (old.password && old.password !== cap.password) old.history = [{ password: old.password, changed: now }, ...(old.history || [])].slice(0, 10);
        old.password = cap.password;
        if (cap.username) old.username = cap.username;
        old.passwordChanged = now;
        old.updated = now;
      } else {
        const u = new URL(cap.url);
        d.items.push(newItem({ name: name.trim() || hostOf(cap.url), url: u.origin, username: cap.username, password: cap.password, passwordChanged: now, lastUsed: now }));
      }
      d.lastChange = now;
      const blob = await seal({ dek, dekRaw, header: headerOf(remote.blob) }, d);
      try {
        await cloud.push(blob, remote.version);
      } catch (e) {
        if (e instanceof ConflictError) continue;
        throw e;
      }
      await local.set('vault', blob);
      setData(d);
      await dropCapture();
      toast.show('封', old ? 'Senha atualizada no cofre' : 'Login salvo no cofre');
      return;
    }
    throw new Error('O cofre mudou várias vezes seguidas. Tente de novo.');
  }

  async function lock() {
    await sess.clear();
    setData(null);
    setScreen('locked');
  }

  async function logout() {
    if (!confirm('Sair da conta nesta extensão? O cofre cifrado é apagado do navegador.')) return;
    await cloud.signOut().catch(() => {});
    await Promise.all([local.remove('vault'), local.remove('link'), sess.clear()]);
    setData(null);
    setScreen('login');
  }

  return (
    <div className="pop">
      <header className="pop-top">
        <Logo size={30} />
        <span className="pop-word">Hanko</span>
        <span className="pop-acct">{screen === 'open' ? (link?.email || 'só neste navegador') : ''}</span>
        {screen === 'open' && <button className="icon-btn ghost pop-lock" title="Bloquear" aria-label="Bloquear" onClick={lock}>閉</button>}
      </header>
      <ExtensionUpdate />
      <main className="pop-body">
        {screen === 'loading' && null}
        {screen === 'login' && <Login onDone={async (email, raw, d) => { setLink({ email, pulledAt: Date.now() }); await afterOpen(raw, d); }} />}
        {screen === 'locked' && <Unlock email={link?.email} onDone={async (raw, d) => { await afterOpen(raw, d); refresh(); }} onLogout={logout} />}
        {screen === 'locked' && capture && <span className="faint small" style={{ textAlign: 'center' }}>Abra o cofre para salvar o login de {hostOf(capture.url)}.</span>}
        {screen === 'open' && data && (
          <Open data={data} tab={tab} onFill={fill} onCopy={copy}
            save={capture ? <SaveCard capture={capture} data={data} onSave={saveCapture} onDrop={dropCapture} /> : null} />
        )}
      </main>
    </div>
  );
}

/* ---------- Aviso de versão nova da extensão ---------- */

function ExtensionUpdate() {
  const [next, setNext] = useState<{ version: string; url: string } | null>(null);
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'checkSelfUpdate' }).catch(() => {});
    fetchMobileManifest().then(m => {
      const e = m?.extension;
      if (e && isNewer(e.version, chrome.runtime.getManifest().version)) setNext(e);
    }).catch(() => {});
  }, []);
  if (!next) return null;
  return (
    <div className="pop-update">
      <span className="gold-k">新</span>
      <span>Versão <b className="mono">{next.version}</b> disponível. Instalada pelo app do Hanko, ela chega sozinha quando o app atualizar.</span>
      <button className="link" onClick={() => chrome.tabs.create({ url: next.url })}>zip</button>
    </div>
  );
}

/* ---------- Entrar na conta ---------- */

function Login({ onDone }: { onDone(email: string, dekRaw: Uint8Array, d: VaultData): void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!email.includes('@') || !pw) return setErr('Informe o e-mail e a senha mestra.');
    setBusy(true);
    try {
      const mail = email.trim().toLowerCase();
      await cloud.signIn(mail, await deriveAuthSecret(pw, mail));
      const remote = await cloud.pull();
      if (!remote) throw new Error('Esta conta ainda não tem cofre. Ative a sincronização no app primeiro.');
      const opened = await openVault<VaultData>(remote.blob, pw).catch(() => { throw new Error('Senha mestra diferente da do cofre.'); });
      await local.set('vault', remote.blob);
      await local.set('link', { email: mail, pulledAt: Date.now() });
      onDone(mail, opened.key.dekRaw, opened.data);
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
      <span className="brush ink-in" style={{ fontSize: 26 }}>Entrar na conta</span>
      <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>Use o mesmo e-mail e a mesma senha mestra do app. O cofre chega cifrado e só abre aqui.</span>
      <label className="field"><span>e-mail</span><input className="input" type="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="field"><span>senha mestra</span><input className="input mono" type="password" value={pw} onChange={e => setPw(e.target.value)} style={{ letterSpacing: 3 }} /></label>
      <p className="err" role="alert">{err}</p>
      <button className="btn btn-solid" disabled={busy}>{busy ? 'abrindo…' : 'Entrar'}</button>
    </form>
  );
}

/* ---------- Desbloquear ---------- */

function Unlock({ email, onDone, onLogout }: { email?: string; onDone(dekRaw: Uint8Array, d: VaultData): void; onLogout(): void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const blob = await local.get<SealedBlob>('vault');
      const opened = await openVault<VaultData>(blob!, pw);
      onDone(opened.key.dekRaw, opened.data);
    } catch {
      await new Promise(r => setTimeout(r, 400));
      setErr('Senha incorreta.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="pop-unlock">
      <Enso size={150} progress={null} filterId="rough-pop"><Logo size={60} /></Enso>
      <span className="pop-title">Escreva a senha mestra</span>
      <input className="input mono" type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} style={{ letterSpacing: 3, width: '100%' }} aria-label="Senha mestra" />
      <p className="err" role="alert">{err}</p>
      <button className="btn btn-solid" disabled={busy} style={{ width: '100%' }}>{busy ? 'abrindo…' : '開く · abrir'}</button>
      <button type="button" className="btn-quiet" onClick={onLogout}>{email ? `sair de ${email}` : 'sair da conta'}</button>
    </form>
  );
}

/* ---------- Cofre aberto: este site · cofre · gerar ---------- */

type PopTab = 'site' | 'vault' | 'forge';

function Open({ data, tab, onFill, onCopy, save }: { data: VaultData; tab?: chrome.tabs.Tab; onFill(i: Item): void; onCopy(t: string, w: string): void; save: ReactNode }) {
  const now = useNow();
  const url = tab?.url || '';
  const here = /^https?:/.test(url) ? siteItems(data, url) : [];
  const [view, setView] = useState<PopTab>(here.length || save ? 'site' : 'vault');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const qq = q.trim().toLowerCase();
  const list = data.items
    .filter(i => !i.trashed)
    .filter(i => !qq || [i.name, i.username, i.url].some(x => x.toLowerCase().includes(qq)))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
    .slice(0, qq ? 80 : 40);

  return (
    <>
      <div className="pop-scroll" key={view}>
        {view === 'site' && (
          <>
            {save}
            <span className="eyebrow">此 · {hostOf(url) || 'nenhum site'}</span>
            {here.length ? here.map(it => <SiteCard key={it.id} item={it} now={now} online={data.settings.onlineIcons} onFill={() => onFill(it)} onCopy={onCopy} />) : (
              <div className="empty-note small">
                <span className="empty-kanji">空</span>
                <p>Nenhuma conta salva para este site. Ao entrar ou se cadastrar, o Hanko oferece salvar.</p>
                <button className="btn btn-sm" onClick={() => setView('forge')}><Icon name="refresh" size={14} /> Gerar senha para cadastro</button>
              </div>
            )}
          </>
        )}

        {view === 'vault' && (
          <>
            <label className="field-search">
              <Icon name="search" />
              <input autoFocus placeholder="procurar no cofre" aria-label="Buscar" value={q} onChange={e => setQ(e.target.value)} />
              {q && <button className="field-clear" onClick={() => setQ('')} aria-label="Limpar"><Icon name="close" size={12} /></button>}
            </label>
            <div className="pop-list">
              {list.map(it => {
                const open = openId === it.id;
                const fits = !!url && matchesSite(it, url);
                return (
                  <div key={it.id} className={`pop-item ${open ? 'open' : ''}`}>
                    <button className="card-row" onClick={() => setOpenId(open ? null : it.id)}>
                      <Avatar name={it.name} url={it.url} size={32} online={data.settings.onlineIcons} />
                      <span className="card-text">
                        <span className="card-name">{it.favorite ? '★ ' : ''}{it.name}</span>
                        <span className="card-sub">{it.username || it.url || '—'}</span>
                      </span>
                      {it.otp && <ListCode item={it} now={now} />}
                    </button>
                    {open && (
                      <div className="pop-actions">
                        {fits && <button className="btn btn-solid btn-sm" onClick={() => onFill(it)}>Preencher</button>}
                        {it.username && <button className="btn btn-sm" onClick={() => onCopy(it.username, 'Usuário')}><Icon name="copy" size={13} /> usuário</button>}
                        {it.password && <button className="btn btn-sm" onClick={() => onCopy(it.password, 'Senha')}><Icon name="copy" size={13} /> senha</button>}
                        {it.otp && it.otp.type !== 'hotp' && <button className="btn btn-sm" onClick={async () => onCopy(await totp(it.otp!), 'Código')}><Icon name="copy" size={13} /> código</button>}
                      </div>
                    )}
                  </div>
                );
              })}
              {!list.length && <p className="faint small" style={{ textAlign: 'center', padding: 24 }}>Nada encontrado.</p>}
            </div>
          </>
        )}

        {view === 'forge' && <PasswordForge compact onCopy={p => onCopy(p, 'Senha')} />}
      </div>

      <nav className="pop-tabs" aria-label="Seções">
        {([['site', '此', 'Este site'], ['vault', '蔵', 'Cofre'], ['forge', '鍛', 'Gerar']] as const).map(([id, k, name]) => (
          <button key={id} className={`m-tab ${view === id ? 'on' : ''}`} onClick={() => setView(id)}>
            <span className="m-tab-k">{k}</span><span className="m-tab-n">{name}{id === 'site' && here.length ? ` · ${here.length}` : ''}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

function SiteCard({ item, now, online, onFill, onCopy }: { item: Item; now: number; online: boolean; onFill(): void; onCopy(t: string, w: string): void }) {
  const t = useTotp(item.otp, now);
  return (
    <div className="site-card">
      <div className="site-head">
        <Avatar name={item.name} url={item.url} size={40} online={online} />
        <span className="card-text">
          <span className="card-name" style={{ fontSize: 17 }}>{item.name}</span>
          <span className="card-sub">{item.username || 'sem usuário'}</span>
        </span>
        {t && item.otp && (
          <button className="site-otp" onClick={() => onCopy(t.code.replace(/\s/g, ''), 'Código')} title="Copiar código">
            <Ring progress={t.left / item.otp.period} size={18} urgent={t.left <= 5} />
            <span key={t.counter} className="otp-code code-flip">{t.code}</span>
          </button>
        )}
      </div>
      <button className="btn btn-solid" onClick={onFill}>Preencher login{t ? ' e código' : ''}</button>
      <div className="pop-actions">
        {item.username && <button className="btn btn-sm" onClick={() => onCopy(item.username, 'Usuário')}><Icon name="copy" size={13} /> usuário</button>}
        {item.password && <button className="btn btn-sm" onClick={() => onCopy(item.password, 'Senha')}><Icon name="copy" size={13} /> senha</button>}
      </div>
    </div>
  );
}

function SaveCard({ capture, data, onSave, onDrop }: { capture: Capture; data: VaultData; onSave(c: Capture, name: string): Promise<void>; onDrop(): void }) {
  const host = hostOf(capture.url);
  const target = capture.itemId ? data.items.find(i => i.id === capture.itemId) : undefined;
  const guess = baseDomain(host).split('.')[0];
  const [name, setName] = useState(target?.name || (guess ? guess[0].toUpperCase() + guess.slice(1) : host));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="site-card save-card">
      <span className="pop-title" style={{ fontSize: 18 }}>{target ? `Atualizar a senha de ${target.name}?` : 'Salvar este login?'}</span>
      <span className="faint small">{capture.username || 'sem usuário'} · {host}</span>
      {!target && <label className="field"><span>nome no cofre</span><input className="input" value={name} onChange={e => setName(e.target.value)} /></label>}
      {err && <p className="err" role="alert">{err}</p>}
      <div className="pop-actions">
        <button className="btn btn-sm" onClick={onDrop}>Descartar</button>
        <button className="btn btn-solid btn-sm" disabled={busy} onClick={async () => {
          setBusy(true); setErr('');
          try { await onSave(capture, name); } catch (e) { setErr((e as Error).message); setBusy(false); }
        }}>{busy ? 'salvando…' : target ? 'Atualizar' : 'Salvar no cofre'}</button>
      </div>
    </div>
  );
}

function ListCode({ item, now }: { item: Item; now: number }) {
  const t = useTotp(item.otp, now);
  return <span className="otp-code" style={{ fontSize: 14, color: t && t.left <= 5 ? 'var(--red-hi)' : 'var(--gold)' }}>{t?.code || ''}</span>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <Popup />
      <Paper />
    </ToastProvider>
  </StrictMode>
);
