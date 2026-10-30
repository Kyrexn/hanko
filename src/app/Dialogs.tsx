import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dedupe, exportCsv, importCsv, importGoogleAuthenticator, importJson, type ImportResult } from '../core/importers';
import { readQrFromImage } from './qr';
import { useClosing } from './fx';
import { PasswordForge } from './generator';
import { download } from './model';
import { cloud } from './cloud';
import { CodeInput } from './Gate';
import { copySecret, useConfirm, useToast } from './ui';
import { useItemActions } from './actions';
import { bioName, extensionInstall, extensionStatus, openBrowserExtensions, openExtensionFolder, screenProtectSupported, type ExtensionStatus } from './native';
import { Icon } from './glyphs';
import { useVault } from './vault';

function ScrollDialog({ title, verse, onClose, children }: { title: string; verse: string; onClose(): void; children: ReactNode }) {
  const [closing, close] = useClosing(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className={`overlay ${closing ? 'closing' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog" role="dialog" aria-label={title}>
        <div className="rod" />
        <div className="scroll-paper unroll" style={{ gap: 16 }}>
          <span className="scroll-verse" aria-hidden="true">{verse}</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span className="brush" style={{ fontSize: 28 }}>{title}</span>
            <button className="dialog-x" onClick={close} aria-label="Fechar">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
          {children}
        </div>
        <div className="rod" />
      </div>
    </div>
  );
}

/* ---------- Gerador ---------- */

export function GeneratorDialog({ onClose, onCopy }: { onClose(): void; onCopy(p: string): void }) {
  return (
    <ScrollDialog title="Gerador de senhas" verse="新しき鍵" onClose={onClose}>
      <PasswordForge onCopy={onCopy} />
    </ScrollDialog>
  );
}

/* ---------- Sincronização e conta ---------- */

export function syncLabel(s: ReturnType<typeof useVault>['sync']): string {
  if (!s.linked) return 'só neste aparelho';
  if (s.status === 'syncing') return 'sincronizando…';
  if (s.status === 'offline') return 'sem conexão · tenta de novo sozinho';
  if (s.status === 'error') return 'erro na sincronia';
  if (s.last) {
    const sec = Math.round((Date.now() - s.last) / 1000);
    return sec < 60 ? 'sincronizado agora' : `sincronizado há ${Math.round(sec / 60)} min`;
  }
  return 'conectado';
}

function SyncSection() {
  const vault = useVault();
  const toast = useToast();
  const ask = useConfirm();
  const s = vault.sync;
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function go(mode: 'create' | 'link') {
    setMsg('');
    if (!email.includes('@')) return setMsg('Informe um e-mail válido.');
    if (!pw) return setMsg('Digite a senha mestra para confirmar.');
    setBusy(true);
    try {
      const r = await vault.enableSync(email, pw, mode);
      if (r === 'confirm') setMsg('Conta criada! Abra o e-mail de confirmação do Supabase, confirme e depois toque em “entrar em conta existente”.');
      else { toast.show('連', 'Sincronização ligada'); setPw(''); }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="brush" style={{ fontSize: 22 }}>Sincronização e conta</span>
      {!s.available ? (
        <span className="muted" style={{ fontSize: 13 }}>Este aplicativo foi gerado sem servidor de sincronização configurado.</span>
      ) : s.linked ? (
        <>
          <span className="muted" style={{ fontSize: 13 }}>Conta <span style={{ color: 'var(--washi)' }}>{s.email}</span> · {syncLabel(s)}</span>
          {s.error && <span className="err">{s.error}</span>}
          <span className="faint" style={{ fontSize: 12 }}>O servidor guarda só o cofre cifrado. Sua senha mestra nunca sai deste aparelho.</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" disabled={s.status === 'syncing'} onClick={() => vault.syncNow()}>Sincronizar agora</button>
            <button className="btn-link" style={{ color: 'var(--faint)' }} onClick={async () => {
              if (await ask({ title: 'Sair da conta?', text: 'O cofre continua neste aparelho, mas para de sincronizar com os outros.', confirm: 'Sair da conta', mark: '離' })) { await vault.disableSync(); toast.show('離', 'Saiu da conta'); }
            }}>sair da conta</button>
          </div>
        </>
      ) : (
        <>
          <span className="muted" style={{ fontSize: 13 }}>Use um e-mail e a sua senha mestra para manter este cofre igual no Windows, no Android e na extensão. O servidor só recebe dados cifrados.</span>
          <label className="field"><span>e-mail</span><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></label>
          <label className="field"><span>senha mestra (para confirmar)</span><input className="input mono" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" /></label>
          <p className="err" role="alert">{msg}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-solid" disabled={busy} onClick={() => go('create')}>Criar conta</button>
            <button className="btn" disabled={busy} onClick={() => go('link')}>Entrar em conta existente</button>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- Importar e exportar ---------- */

function ImportExportSection() {
  const vault = useVault();
  const toast = useToast();
  const ask = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [msg, setMsg] = useState('');

  async function fromFile(f: File | undefined) {
    if (!f) return;
    setMsg('');
    try {
      const text = await f.text();
      const folders = vault.data!.folders;
      setPreview(/^\s*[{[]/.test(text) ? importJson(text, folders) : importCsv(text, folders));
    } catch (e) { setMsg((e as Error).message); }
  }
  async function fromQr(files: FileList | null) {
    if (!files?.length) return;
    setMsg('');
    try {
      const all: ImportResult = { items: [], folders: [], source: 'Google Authenticator' };
      for (const f of Array.from(files)) {
        const text = await readQrFromImage(f);
        if (!text) throw new Error(`Não encontrei QR code em ${f.name}.`);
        all.items.push(...importGoogleAuthenticator(text).items);
      }
      setPreview(all);
    } catch (e) { setMsg((e as Error).message); }
  }
  async function confirmImport() {
    if (!preview) return;
    const fresh = dedupe(preview.items, vault.data!.items);
    await vault.update(d => { d.folders.push(...preview.folders); d.items.push(...fresh); });
    toast.show('入', `${fresh.length} item(ns) importado(s)`);
    setPreview(null);
  }
  async function exportPlain(kind: 'csv' | 'json') {
    if (!await ask({ title: 'Exportar sem criptografia?', text: <>O arquivo fica <b>aberto</b>: qualquer pessoa com ele vê todas as suas senhas. Use só para migrar e apague logo depois.</>, confirm: 'Exportar mesmo assim', danger: true, mark: '開' })) return;
    const d = vault.data!;
    const blob = kind === 'csv' ? new Blob([exportCsv(d)], { type: 'text/csv' }) : new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    download(blob, `cofre-exportado-${new Date().toISOString().slice(0, 10)}.${kind}`);
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="brush" style={{ fontSize: 22 }}>Importar e exportar</span>
      {preview ? (
        <>
          <span className="muted" style={{ fontSize: 13 }}>
            <b style={{ color: 'var(--washi)' }}>{preview.items.length}</b> item(ns) de <b style={{ color: 'var(--washi)' }}>{preview.source}</b>
            {' '}({dedupe(preview.items, vault.data!.items).length} novo(s), o resto já existe){preview.folders.length ? ` · ${preview.folders.length} pasta(s) nova(s)` : ''}.
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-solid" onClick={confirmImport}>Importar</button>
            <button className="btn" onClick={() => setPreview(null)}>Cancelar</button>
          </div>
        </>
      ) : (
        <>
          <span className="muted" style={{ fontSize: 13 }}>Traga suas senhas do Bitwarden, Chrome/Edge, 1Password, LastPass ou de um CSV — e os códigos do Google Authenticator (Transferir contas → Exportar → print do QR).</span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => fileRef.current?.click()}>Importar arquivo (.csv / .json)</button>
            <button className="btn" onClick={() => qrRef.current?.click()}>Importar Google Authenticator (QR)</button>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <button className="btn-link" style={{ color: 'var(--faint)' }} onClick={() => exportPlain('csv')}>exportar CSV</button>
            <button className="btn-link" style={{ color: 'var(--faint)' }} onClick={() => exportPlain('json')}>exportar JSON</button>
          </div>
        </>
      )}
      {msg && <p className="err">{msg}</p>}
      <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={e => { fromFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={qrRef} type="file" accept="image/*" multiple hidden onChange={e => { fromQr(e.target.files); e.target.value = ''; }} />
    </section>
  );
}

/* ---------- Pastas ---------- */

function FoldersSection() {
  const vault = useVault();
  const act = useItemActions();
  const d = vault.data!;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="brush" style={{ fontSize: 22 }}>Pastas</span>
      {d.folders.map(f => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>{f.name} <span className="faint mono" style={{ fontSize: 11 }}>{d.items.filter(i => i.folderId === f.id && !i.trashed).length}</span></span>
          <button className="btn-link" onClick={() => act.renameFolder(f)}>renomear</button>
          <button className="btn-link" style={{ color: 'var(--faint)' }} onClick={() => act.deleteFolder(f)}>apagar</button>
        </div>
      ))}
      <button className="btn-link" style={{ alignSelf: 'flex-start' }} onClick={act.addFolder}>+ nova pasta</button>
    </section>
  );
}

/* ---------- Kit de Emergência ---------- */

function KitSection() {
  const vault = useVault();
  const toast = useToast();
  const ask = useConfirm();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  async function make() {
    if (vault.hasKit && !await ask({ title: 'Gerar um Kit novo?', text: 'A chave do Kit anterior deixa de funcionar. Guarde o novo antes de fechar.', confirm: 'Gerar Kit novo', danger: true, mark: '急' })) return;
    setBusy(true);
    try { setKey(await vault.addEmergencyKit()); } finally { setBusy(false); }
  }

  const text = () => ['判子 HANKO — KIT DE EMERGÊNCIA', '', `Conta: ${vault.sync.email || '(só neste aparelho)'}`, `Criado em: ${new Date().toLocaleString('pt-BR')}`, '',
    'CHAVE DE RECUPERAÇÃO:', key, '', 'Com esta chave você recupera o cofre se esquecer a senha mestra. Guarde fora do computador e não compartilhe.'].join('\r\n');

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="brush" style={{ fontSize: 22 }}>Kit de Emergência</span>
      {key ? (
        <>
          <span className="muted" style={{ fontSize: 13 }}>Guarde esta chave agora — ela não será mostrada de novo.</span>
          <div className="kit-key mono">{key}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={() => download(new Blob([text()], { type: 'text/plain' }), 'Hanko-Kit-de-Emergencia.txt')}>Baixar (.txt)</button>
            <button className="btn" onClick={async () => { await copySecret(key, 60); toast.show('写', 'Chave copiada'); }}>Copiar</button>
          </div>
        </>
      ) : (
        <>
          <span className="muted" style={{ fontSize: 13 }}>
            {vault.hasKit ? 'Seu cofre tem um Kit de Emergência. Se perdeu o arquivo, gere um novo (o antigo deixa de valer).'
              : <><span style={{ color: 'var(--red)' }}>Seu cofre ainda não tem Kit de Emergência.</span> Sem ele, esquecer a senha mestra significa perder tudo.</>}
          </span>
          <div><button className={`btn ${vault.hasKit ? '' : 'btn-solid'}`} disabled={busy} onClick={make}>{vault.hasKit ? 'Gerar Kit novo' : 'Gerar meu Kit agora'}</button></div>
        </>
      )}
    </section>
  );
}

/* ---------- 2FA da conta ---------- */

function MfaSection() {
  const toast = useToast();
  const ask = useConfirm();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { cloud.mfaFactor().then(f => setEnabled(!!f)).catch(() => setEnabled(false)); }, []);

  async function start() {
    setMsg(''); setBusy(true);
    try { setEnroll(await cloud.enrollMfa()); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function confirmIt() {
    if (!enroll) return;
    setMsg(''); setBusy(true);
    try { await cloud.confirmEnroll(enroll.factorId, code); setEnabled(true); setEnroll(null); setCode(''); toast.show('護', '2FA da conta ativado'); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function disable() {
    if (!await ask({ title: 'Desativar o 2FA da conta?', text: 'Entrar na conta passa a pedir só o e-mail e a senha mestra.', confirm: 'Desativar', danger: true })) return;
    setBusy(true);
    try { await cloud.disableMfa(); setEnabled(false); toast.show('解', '2FA da conta desativado'); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="brush" style={{ fontSize: 22 }}>2FA da conta</span>
      <span className="muted" style={{ fontSize: 13 }}>Pede um código do app autenticador para entrar na sua conta em aparelhos novos. Use outro app (Google Authenticator, Authy…), não o próprio Hanko.</span>
      {enabled === null ? <span className="faint">verificando…</span> : enabled ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ color: 'var(--washi)' }}>● ativo</span>
          <button className="btn-link" style={{ color: 'var(--faint)' }} disabled={busy} onClick={disable}>desativar</button>
        </div>
      ) : enroll ? (
        <>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <img src={enroll.qr} alt="QR code do 2FA" width={150} height={150} style={{ background: '#fff', padding: 8 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
              <span className="faint" style={{ fontSize: 12 }}>Escaneie o QR code ou digite a chave:</span>
              <span className="mono" style={{ fontSize: 13, wordBreak: 'break-all' }}>{enroll.secret}</span>
            </div>
          </div>
          <span className="faint" style={{ fontSize: 12 }}>Digite o código que apareceu no app:</span>
          <CodeInput value={code} onChange={setCode} autoFocus={false} />
          <div><button className="btn btn-solid" disabled={busy || code.length < 6} onClick={confirmIt}>Ativar 2FA</button></div>
        </>
      ) : (
        <div><button className="btn" disabled={busy} onClick={start}>Ativar 2FA da conta</button></div>
      )}
      {msg && <p className="err">{msg}</p>}
    </section>
  );
}

/* ---------- Ajustes, backup e segurança ---------- */

const SETTINGS_TABS = [
  { id: 'conta', kanji: '連', name: 'Conta e sincronia' },
  { id: 'seguranca', kanji: '守', name: 'Segurança' },
  { id: 'dados', kanji: '庫', name: 'Dados e backup' },
  { id: 'preferencias', kanji: '心', name: 'Preferências' },
  { id: 'extensao', kanji: '拡', name: 'Extensão' }
] as const;

/** Ajustes em abas: página no computador, tela cheia no celular. */
export function SettingsPanel({ initialTab }: { initialTab?: string }) {
  const vault = useVault();
  const data = vault.data!;
  const toast = useToast();
  const ask = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<string>(initialTab || 'conta');
  const [ext, setExt] = useState<ExtensionStatus | null>(null);
  useEffect(() => { extensionStatus().then(setExt); }, []);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);

  async function exportNow() {
    const blob = await vault.exportBackup();
    download(blob, `hanko-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast.show('写', 'Backup cifrado salvo em Downloads');
  }

  async function importNow(f: File | undefined) {
    if (!f || !await ask({ title: 'Restaurar este backup?', text: <>O cofre deste aparelho será <b>substituído</b> pelo do arquivo. Depois use a senha mestra do backup.</>, confirm: 'Substituir', danger: true, hold: true, mark: '復' })) return;
    try { await vault.importBackup(f); toast.show('復', 'Backup carregado. Use a senha mestra dele.'); }
    catch (e) { toast.show('誤', (e as Error).message); }
  }

  async function change() {
    setMsg('');
    if (next.length < 10) return setMsg('A nova senha precisa de pelo menos 10 caracteres.');
    if (next !== next2) return setMsg('As novas senhas não conferem.');
    if (next === cur) return setMsg('A nova senha é igual à atual.');
    setBusy(true);
    try {
      const ok = await vault.changeMaster(cur, next);
      if (!ok) return setMsg('Senha atual incorreta.');
      setCur(''); setNext(''); setNext2('');
      toast.show('改', 'Senha mestra trocada. Faça um novo backup.');
    } catch (e) {
      setMsg(`Não consegui trocar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const set = (fn: (s: typeof data.settings) => void) => vault.update(d => fn(d.settings));
  const Toggle = ({ on, onChange, title, hint }: { on: boolean; onChange(v: boolean): void; title: string; hint: string }) => (
    <label className="toggle-row">
      <span><b>{title}</b><small>{hint}</small></span>
      <input type="checkbox" className="switch" checked={on} onChange={e => onChange(e.target.checked)} />
    </label>
  );

  return (
    <div className="stage-pad settings">
      <header className="stage-head">
        <span className="eyebrow">設 · ajustes</span>
        <h1 className="stage-title">Ajustes</h1>
      </header>
      <div className="set-tabs" role="tablist">
        {SETTINGS_TABS.filter(t => t.id !== 'extensao' || ext?.available).map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`set-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            <span className="set-kanji">{t.kanji}</span>{t.name}
          </button>
        ))}
      </div>

      <div className="set-body" key={tab}>
        {tab === 'conta' && (
          <>
            <div className="set-card"><SyncSection /></div>
            {vault.sync.linked && <div className="set-card"><MfaSection /></div>}
            {vault.sync.linked && <DeleteAccountCard />}
          </>
        )}

        {tab === 'seguranca' && (
          <>
            <div className="set-card"><KitSection /></div>
            <div className="set-card">
              <section className="set-sec">
                <span className="brush">Bloqueio</span>
                <label className="toggle-row">
                  <span><b>Bloquear sozinho após</b><small>sem mexer no app</small></span>
                  <select className="select" value={data.settings.autoLockMinutes} onChange={e => set(s => { s.autoLockMinutes = +e.target.value; })}>
                    {[1, 2, 5, 10, 15, 30].map(m => <option key={m} value={m}>{m} min</option>)}
                  </select>
                </label>
                <Toggle on={data.settings.lockOnHide} onChange={v => set(s => { s.lockOnHide = v; })} title="Bloquear ao minimizar" hint="fecha o cofre assim que a janela é minimizada ou o app vai para segundo plano" />
                <Toggle on={data.settings.privacyBlur} onChange={v => set(s => { s.privacyBlur = v; })} title="Embaçar ao sair da janela" hint="esconde o conteúdo quando você clica em outro programa — contra olhares por cima do ombro" />
                {screenProtectSupported() && (
                  <Toggle on={data.settings.screenProtect} onChange={v => set(s => { s.screenProtect = v; })} title="Bloquear capturas de tela" hint="o Hanko some de prints, gravações e do compartilhamento de tela (Teams, Meet, Discord)" />
                )}
              </section>
            </div>
            <BioCard />
            <div className="set-card">
              <section className="set-sec">
                <span className="brush">Trocar senha mestra</span>
                <label className="field"><span>senha atual</span><input className="input mono" type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" /></label>
                <label className="field"><span>nova senha mestra</span><input className="input mono" type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" /></label>
                <label className="field"><span>confirmar</span><input className="input mono" type="password" value={next2} onChange={e => setNext2(e.target.value)} autoComplete="new-password" /></label>
                <p className="err" role="alert">{msg}</p>
                <div><button className="btn" disabled={busy} onClick={change}>{busy ? 'Trocando…' : 'Trocar senha mestra'}</button></div>
              </section>
            </div>
          </>
        )}

        {tab === 'dados' && (
          <>
            <div className="set-card">
              <section className="set-sec">
                <span className="brush">Cópia de segurança</span>
                <span className="muted">O arquivo sai cifrado com a sua senha mestra, junto com os anexos. Guarde-o num pen drive ou na nuvem.</span>
                <span className="faint mono small">último backup: {data.lastBackup ? new Date(data.lastBackup).toLocaleString('pt-BR') : 'nunca'}</span>
                <div className="row-actions">
                  <button className="btn btn-solid" onClick={exportNow}>Exportar backup</button>
                  <button className="btn" onClick={() => fileRef.current?.click()}>Restaurar</button>
                  <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { importNow(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
              </section>
            </div>
            <div className="set-card"><ImportExportSection /></div>
            <div className="set-card"><FoldersSection /></div>
          </>
        )}

        {tab === 'extensao' && ext && <ExtensionCard status={ext} onChange={setExt} />}

        {tab === 'preferencias' && (
          <div className="set-card">
            <section className="set-sec">
              <span className="brush">Preferências</span>
              <label className="toggle-row">
                <span><b>Limpar o que foi copiado após</b><small>senhas e códigos somem da área de transferência sozinhos</small></span>
                <select className="select" value={data.settings.clipboardSeconds} onChange={e => set(s => { s.clipboardSeconds = +e.target.value; })}>
                  {[10, 20, 30, 60, 120].map(m => <option key={m} value={m}>{m} s</option>)}
                </select>
              </label>
              <Toggle on={data.settings.onlineIcons} onChange={v => set(s => { s.onlineIcons = v; })} title="Buscar ícones dos sites na internet" hint="quando a marca não estiver na biblioteca offline (envia só o domínio ao DuckDuckGo)" />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** Extensão do Chrome/Edge: o app mantém a pasta; a pessoa carrega uma vez e as atualizações chegam sozinhas. */
function ExtensionCard({ status, onChange }: { status: ExtensionStatus; onChange(s: ExtensionStatus): void }) {
  const toast = useToast();
  const [err, setErr] = useState('');
  async function prepare() {
    setErr('');
    try { await extensionInstall(); onChange((await extensionStatus())!); toast.show('拡', 'Pasta da extensão pronta'); }
    catch (e) { setErr((e as Error).message || String(e)); }
  }
  const copyPath = async () => { await navigator.clipboard.writeText(status.path); toast.show('写', 'Caminho da pasta copiado'); };
  return (
    <div className="set-card">
      <section className="set-sec">
        <span className="brush">Extensão do navegador</span>
        <span className="muted">Preenche logins e códigos 2FA no Chrome e no Edge, oferece salvar senhas novas e sugere senhas fortes em cadastros. Atalho: <span className="kbd">Ctrl Shift L</span>.</span>
        {status.installed ? (
          <div className="ext-ok">
            <span className="tag gold">pasta pronta · versão {status.version}</span>
            <span className="faint small">Atualiza sozinha: cada versão nova do Hanko troca os arquivos e a extensão se recarrega.</span>
          </div>
        ) : null}
        <ol className="ext-steps">
          <li><b>Prepare a pasta</b> da extensão neste computador.
            <div className="row-actions"><button className="btn btn-sm btn-solid" onClick={prepare}>{status.installed ? 'Reparar pasta' : 'Preparar pasta'}</button></div>
          </li>
          <li><b>Abra as extensões</b> do navegador e ligue o <b>Modo do desenvolvedor</b> (canto superior direito).
            <div className="row-actions">
              <button className="btn btn-sm" onClick={() => openBrowserExtensions('chrome')}>Abrir no Chrome</button>
              <button className="btn btn-sm" onClick={() => openBrowserExtensions('edge')}>Abrir no Edge</button>
            </div>
          </li>
          <li>Clique em <b>Carregar sem compactação</b> e escolha esta pasta:
            <code className="ext-path">{status.path}</code>
            <div className="row-actions">
              <button className="btn btn-sm" onClick={copyPath}><Icon name="copy" size={13} /> Copiar caminho</button>
              <button className="btn btn-sm" onClick={() => openExtensionFolder()}><Icon name="folder" size={13} /> Mostrar pasta</button>
            </div>
          </li>
        </ol>
        <span className="faint small">Pronto: daqui pra frente você não precisa fazer mais nada. Se já usava a extensão pelo .zip, remova a antiga e carregue esta pasta uma vez.</span>
        {err && <p className="err" role="alert">{err}</p>}
      </section>
    </div>
  );
}

/** Excluir a conta e tudo o que está no servidor. */
function DeleteAccountCard() {
  const vault = useVault();
  const toast = useToast();
  const ask = useConfirm();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function run() {
    setMsg('');
    if (!pw) return setMsg('Digite a senha mestra para confirmar.');
    const ok = await ask({
      title: 'Excluir a conta para sempre?',
      text: <>O cofre cifrado, os anexos e a conta <b>{vault.sync.email}</b> somem do servidor. Os outros aparelhos e a extensão param de sincronizar. Este aparelho continua com o cofre. <b>Não dá para desfazer.</b></>,
      confirm: 'Excluir conta', danger: true, hold: true, mark: '消'
    });
    if (!ok) return;
    setBusy(true);
    try { await vault.deleteAccount(pw); setPw(''); setOpen(false); toast.show('消', 'Conta excluída do servidor'); }
    catch (e) { setMsg(/aal2/i.test((e as Error).message) ? 'Entre de novo com o código 2FA da conta para poder excluir.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="set-card danger-card">
      <section className="set-sec">
        <span className="brush">Excluir conta</span>
        <span className="muted">Apaga a conta e todos os dados dela do servidor. O cofre deste aparelho fica — faça um backup antes, se quiser guardar uma cópia.</span>
        {open ? (
          <>
            <label className="field"><span>senha mestra (para confirmar)</span><input className="input mono" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" /></label>
            <p className="err" role="alert">{msg}</p>
            <div className="row-actions">
              <button className="btn" onClick={() => { setOpen(false); setPw(''); setMsg(''); }}>Cancelar</button>
              <button className="btn danger" disabled={busy} onClick={run}>{busy ? 'Excluindo…' : 'Excluir conta e dados'}</button>
            </div>
          </>
        ) : <div><button className="btn danger" onClick={() => setOpen(true)}>Excluir minha conta…</button></div>}
      </section>
    </div>
  );
}

/** Desbloqueio rápido com Windows Hello ou digital (só neste aparelho). */
function BioCard() {
  const vault = useVault();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (!vault.bio.available) return null;
  async function enable() {
    setMsg('');
    if (!pw) return setMsg('Digite a senha mestra para confirmar.');
    setBusy(true);
    try { await vault.enableBio(pw); setPw(''); toast.show('鍵', `Desbloqueio com ${bioName()} ligado`); }
    catch (e) { const m = (e as Error).message; setMsg(/cancel/i.test(m) ? 'Cancelado.' : m); }
    finally { setBusy(false); }
  }
  return (
    <div className="set-card">
      <section className="set-sec">
        <span className="brush">Desbloqueio rápido</span>
        <span className="muted">Abra o cofre com {bioName()} em vez de digitar a senha mestra. A chave fica guardada pelo sistema, só neste aparelho — nunca vai para a nuvem. A senha mestra continua valendo e é pedida se a biometria mudar.</span>
        {vault.bio.enabled ? (
          <div className="row-actions">
            <span className="tag gold">ligado neste aparelho</span>
            <button className="btn btn-sm" onClick={async () => { await vault.disableBio(); toast.show('鍵', 'Desbloqueio rápido desligado'); }}>Desligar</button>
          </div>
        ) : (
          <>
            <label className="field"><span>senha mestra (para confirmar)</span><input className="input mono" type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enable(); }} autoComplete="current-password" /></label>
            <p className="err" role="alert">{msg}</p>
            <div><button className="btn btn-solid" disabled={busy} onClick={enable}>{busy ? 'Aguardando confirmação…' : `Ligar ${bioName()}`}</button></div>
          </>
        )}
      </section>
    </div>
  );
}

/** Ajustes em janela (usado onde não há página própria). */
export function SettingsDialog({ onClose, initialTab }: { onClose(): void; initialTab?: string }) {
  return (
    <ScrollDialog title="Ajustes" verse="心の備え" onClose={onClose}>
      <SettingsPanel initialTab={initialTab} />
    </ScrollDialog>
  );
}
