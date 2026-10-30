import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { breachCount, strength } from '../core/passwords';
import { formatCode, hotp, otpToText, parseOtp, totp, type ParsedOtp } from '../core/totp';
import {
  cardBrand, emptyCard, emptyIdentity, newItem,
  type Attachment, type CardData, type CustomField, type IdentityData, type Item, type ItemKind
} from '../core/types';
import { KANJI, KIND_LABEL, formatBytes } from './model';
import { readQrFromImage } from './qr';
import { Avatar, copySecret, useConfirm, useToast } from './ui';
import { CatIcon } from './fx';
import { PasswordForge } from './generator';
import { useItemActions } from './actions';
import { cardExpired, hostOf, luhn } from '../core/validate';
import { useVault } from './vault';

/** Editor em forma de pergaminho para criar ou alterar um item. */
export function Editor({ item, onClose }: { item: Item | null; onClose(savedId?: string): void }) {
  const vault = useVault();
  const data = vault.data!;
  const toast = useToast();
  const ask = useConfirm();
  const act = useItemActions();
  // Estável entre renderizações (o id do item novo não pode mudar a cada tecla).
  const [base] = useState(() => item || newItem({ folderId: data.folders[0]?.id || null }));

  const [kind, setKind] = useState(base.kind);
  const [name, setName] = useState(base.name);
  const [url, setUrl] = useState(base.url);
  const [username, setUsername] = useState(base.username);
  const [password, setPassword] = useState(base.password);
  const [showPw, setShowPw] = useState(!item);
  const [otpText, setOtpText] = useState(otpToText(base.otp));
  const [otpPreview, setOtpPreview] = useState('');
  /** Chave pura colada: por tempo (TOTP, o normal) ou por contador (HOTP). Links otpauth:// já dizem o tipo. */
  const [otpMode, setOtpMode] = useState<'totp' | 'hotp'>(base.otp?.type === 'hotp' ? 'hotp' : 'totp');
  const isLink = /^\s*otpauth:/i.test(otpText);
  const readOtp = (): ParsedOtp | null => {
    const p = parseOtp(otpText);
    if (!p || isLink || otpMode === 'totp') return p;
    return { ...p, type: 'hotp', counter: base.otp?.type === 'hotp' ? base.otp.counter || 0 : 0 };
  };
  const [folderId, setFolderId] = useState(base.folderId);
  const [tags, setTags] = useState(base.tags.join(', '));
  const [notes, setNotes] = useState(base.notes);
  const [recoveryCodes, setRecoveryCodes] = useState(base.recoveryCodes);
  const [card, setCard] = useState<CardData>(base.card || emptyCard());
  const [identity, setIdentity] = useState<IdentityData>(base.identity || emptyIdentity());
  const [fields, setFields] = useState<CustomField[]>(base.fields);
  const qrRef = useRef<HTMLInputElement>(null);
  const [closing, setClosing] = useState(false);
  /** Enrola o pergaminho antes de fechar. */
  const finish = (id?: string) => { setClosing(true); setTimeout(() => onClose(id), 300); };
  const [attachments, setAttachments] = useState<Attachment[]>(base.attachments);
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [forge, setForge] = useState(false);
  const [breach, setBreach] = useState<{ pw: string; n: number | null; busy: boolean } | null>(null);
  const [shake, setShake] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  /** Algo mudou desde que abriu? (para não perder digitação ao fechar sem querer) */
  const snapshot = () => JSON.stringify([kind, name, url, username, password, otpText, otpMode, folderId, tags, notes, recoveryCodes, card, identity, fields, attachments.map(a => a.id)]);
  const [initial] = useState(snapshot);
  const dirty = snapshot() !== initial;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.confirm-overlay')) return;
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      // Ctrl+S ou Ctrl+Enter guardam de qualquer campo.
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 's' || e.key === 'Enter')) { e.preventDefault(); formRef.current?.requestSubmit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Mostra o código atual enquanto a pessoa cola a chave 2FA — confirma que a chave está certa.
  useEffect(() => {
    setOtpPreview('');
    if (!otpText.trim()) return;
    let alive = true;
    try {
      const o = readOtp();
      if (!o) return;
      if (isLink) setOtpMode(o.type === 'hotp' ? 'hotp' : 'totp');
      if (!name.trim() && o.issuer) setName(o.issuer);
      if (!username.trim() && o.account) setUsername(o.account);
      (o.type === 'hotp' ? hotp(o) : totp(o)).then(c => alive && setOtpPreview(formatCode(c))).catch(e => alive && setOtpPreview('erro: ' + (e as Error).message));
    } catch (e) {
      setOtpPreview('erro: ' + (e as Error).message);
    }
    return () => { alive = false; };
  }, [otpText, otpMode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (f.size > 20 * 1024 * 1024) { toast.show('誤', `${f.name} passa de 20 MB`); continue; }
      const att = await vault.addFile(f);
      setAttachments(a => [...a, att]);
      setAdded(a => [...a, att.id]);
    }
  }

  async function cancel() {
    if (dirty && !await ask({ title: 'Descartar as alterações?', text: 'O que você digitou neste item ainda não foi guardado.', confirm: 'Descartar', cancel: 'Continuar editando', danger: true, mark: '捨' })) return;
    for (const id of added) await vault.deleteFile(id); // descarta anexos de uma edição cancelada
    finish();
  }

  /** Verifica vazamentos por k-anonimato (só 5 caracteres do hash saem do aparelho). */
  async function checkBreach() {
    if (!password) return;
    setBreach({ pw: password, n: null, busy: true });
    try { setBreach({ pw: password, n: await breachCount(password), busy: false }); }
    catch { setBreach(null); toast.show('誤', 'Sem conexão com o serviço de vazamentos'); }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!name.trim()) { setErr('Dê um nome ao item.'); setShake(s => s + 1); nameRef.current?.focus(); return; }
    if (kind === 'card' && card.number && !luhn(card.number)) {
      if (!await ask({ title: 'Número do cartão parece errado', text: 'Os dígitos não passam na verificação do cartão. Guardar assim mesmo?', confirm: 'Guardar mesmo assim', cancel: 'Corrigir' })) return;
    }
    let otp: Item['otp'] = null;
    try {
      const p = readOtp();
      if (p) {
        await totp(p);
        otp = { secret: p.secret, digits: p.digits, period: p.period, algorithm: p.algorithm, ...(p.type === 'hotp' ? { type: 'hotp' as const, counter: p.counter || 0 } : {}) };
      }
    } catch (ex) {
      return setErr((ex as Error).message);
    }
    setBusy(true);
    const id = base.id;
    await vault.update(d => {
      const now = Date.now();
      const changes: Partial<Item> = {
        kind, name: name.trim(), url: url.trim(), username: username.trim(), password, otp, folderId,
        tags: tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean),
        notes, recoveryCodes, attachments, updated: now,
        card: kind === 'card' ? { ...card, brand: card.brand || cardBrand(card.number) } : null,
        identity: kind === 'identity' ? identity : null,
        fields: fields.filter(f => f.label.trim() || f.value.trim())
      };
      if (breach && breach.pw === password && breach.n !== null) { if (breach.n > 0) d.breached[id] = breach.n; else delete d.breached[id]; }
      const existing = d.items.find(i => i.id === id);
      if (existing) {
        if (existing.password !== password) {
          changes.passwordChanged = now;
          delete d.breached[id];
          // Guarda a senha anterior no histórico (até 10).
          if (existing.password) changes.history = [{ password: existing.password, changed: now }, ...existing.history].slice(0, 10);
        }
        Object.assign(existing, changes);
      } else {
        d.items.push({ ...base, ...changes, created: now, passwordChanged: password ? now : null });
      }
    });
    for (const fid of removed) await vault.deleteFile(fid);
    toast.show('記', item ? 'Alterações guardadas' : 'Item guardado no cofre');
    finish(id);
  }

  /** Manda para a lixeira (dá para restaurar por 30 dias). */
  async function remove() {
    if (!item) return;
    for (const id of added) await vault.deleteFile(id);
    finish();
    await act.trash(item);
  }

  async function scanQr(file: File | undefined) {
    if (!file) return;
    setErr('');
    const text = await readQrFromImage(file);
    if (!text) return setErr('Não encontrei um QR code nessa imagem.');
    if (/^otpauth-migration:/i.test(text)) return setErr('Esse é um QR de exportação do Google Authenticator — use Ajustes → Importar.');
    if (!/^otpauth:/i.test(text)) return setErr('O QR code não é de 2FA (otpauth://).');
    setOtpText(text);
  }

  const setCardField = (k: keyof CardData, v: string) => setCard(c => ({ ...c, [k]: v }));
  const setIdField = (k: keyof IdentityData, v: string) => setIdentity(c => ({ ...c, [k]: v }));
  const kinds: ItemKind[] = ['login', 'card', 'identity', 'note'];

  const s = strength(password);
  const sameHost = (a: string) => hostOf(a) === hostOf(url) && !!hostOf(url);
  const duplicate = kind === 'login' && username.trim()
    ? data.items.find(i => i.id !== base.id && !i.trashed && i.kind === 'login' && sameHost(i.url) && i.username.trim().toLowerCase() === username.trim().toLowerCase())
    : undefined;
  const reusedIn = password ? data.items.filter(i => i.id !== base.id && !i.trashed && i.password === password) : [];
  const expiryBad = kind === 'card' && /^\d{2}\/\d{2}$/.test(card.expiry) && cardExpired(card.expiry);
  const meter = { vazia: 0, fraca: 22, razoavel: 48, boa: 76, excelente: 100 }[s.level];
  const meterColor = s.level === 'fraca' ? 'var(--red)' : s.level === 'razoavel' ? 'var(--amber)' : 'var(--washi-2)';
  const brand = cardBrand(card.number);
  const extrasCount = fields.length + (kind !== 'note' && notes.trim() ? 1 : 0);
  const recCount = attachments.length + (recoveryCodes.trim() ? 1 : 0);
  const num = (i: number) => ['一', '二', '三', '四', '五'][i];
  let sec = kind === 'login' ? 2 : 1;

  return (
    <div className={`overlay ${closing ? 'closing' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) cancel(); }}>
      <form ref={formRef} className="dialog editor" onSubmit={save} aria-label={item ? 'Editar item' : 'Novo item'}>
        <div className="rod" />
        <div className="scroll-paper unroll ed-paper">
          {/* Cabeçalho com prévia ao vivo */}
          <header className="ed-head">
            <Avatar name={name || '?'} url={kind === 'login' ? url : ''} size={52} online={data.settings.onlineIcons} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="label">{item ? 'editar' : 'novo'} · {KIND_LABEL[kind].toLowerCase()}</span>
              <input key={shake} ref={nameRef} className={`ed-name brush ${shake ? 'shake' : ''}`} autoFocus value={name} onChange={e => setName(e.target.value)} aria-label="Nome"
                placeholder={kind === 'card' ? 'Nome do cartão' : kind === 'identity' ? 'Meus documentos' : kind === 'note' ? 'Título da nota' : 'Nome da conta'} />
            </div>
            <button type="button" className="dialog-x" onClick={cancel} aria-label="Fechar">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </header>

          {/* Tipo do item */}
          <div className="ed-kinds" role="tablist">
            {kinds.map(k => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} className={`ed-kind ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
                <CatIcon id={k} />
                <span>{KIND_LABEL[k]}</span>
              </button>
            ))}
          </div>

          {kind === 'login' && (
            <Section n="一" title="Acesso">
              <label className="field"><span>site</span><input className="input" value={url} onChange={e => setUrl(e.target.value)} onBlur={() => { const h = hostOf(url); if (h && h !== url.trim()) setUrl(h); }} placeholder="github.com" inputMode="url" /></label>
              <label className="field"><span>usuário ou e-mail</span><input className="input" value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" />
                {duplicate && <span className="warn-line">Já existe “{duplicate.name}” com este site e usuário — confira para não duplicar.</span>}</label>
              <div className="field">
                <span>senha</span>
                <div className="ed-pw">
                  <input className="input mono" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" aria-label="Senha" />
                  <button type="button" className="ed-tool" onClick={() => setShowPw(v => !v)}>{showPw ? 'ocultar' : 'ver'}</button>
                  <button type="button" className={`ed-tool gen ${forge ? 'on' : ''}`} title="Gerar senha forte" aria-expanded={forge} onClick={() => setForge(f => !f)}>
                    <span className="brush">新</span> gerar
                  </button>
                </div>
                <div className="meter" style={{ marginTop: 6 }}><i style={{ width: `${meter}%`, background: meterColor }} /></div>
                <span className="faint" style={{ fontSize: 11.5 }}>{password ? `força: ${s.label} · ${s.bits} bits` : 'dica: use o gerador para uma senha única'}</span>
                {password && s.tips.slice(0, 2).map(tip => <span key={tip} className="tip-line">{tip}</span>)}
                {reusedIn.length > 0 && <span className="warn-line">Esta senha já é usada em {reusedIn.slice(0, 3).map(i => `“${i.name}”`).join(', ')}{reusedIn.length > 3 ? ` e mais ${reusedIn.length - 3}` : ''}. Senhas repetidas caem juntas num vazamento.</span>}
                {password && (
                  <span className="breach-line">
                    {breach?.pw === password && breach.busy ? <span className="faint">verificando vazamentos…</span>
                      : breach?.pw === password && breach.n !== null ? (breach.n > 0
                        ? <span style={{ color: 'var(--red-hi)' }}>Apareceu {breach.n.toLocaleString('pt-BR')} vez(es) em vazamentos — troque.</span>
                        : <span style={{ color: 'var(--washi-2)' }}>✓ Não aparece em vazamentos conhecidos.</span>)
                      : <button type="button" className="ed-add" onClick={checkBreach}>verificar vazamentos</button>}
                  </span>
                )}
              </div>
              {forge && (
                <div className="forge-inline">
                  <PasswordForge compact onCopy={async p => { await copySecret(p, data.settings.clipboardSeconds); toast.show('写', 'Senha copiada'); }}
                    onUse={p => { setPassword(p); setShowPw(true); setForge(false); setBreach(null); }} />
                </div>
              )}
            </Section>
          )}

          {kind === 'login' && (
            <Section n="二" title="Verificação em duas etapas" badge={otpPreview && !otpPreview.startsWith('erro') ? '2FA ativo' : undefined} defaultOpen={!!otpText}>
              <div className="ed-pw">
                <input className="input mono" value={otpText} onChange={e => setOtpText(e.target.value)} autoComplete="off" placeholder="cole a chave ou o link otpauth://" aria-label="Chave 2FA"
                  onPaste={e => { const f = Array.from(e.clipboardData.files).find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); scanQr(f); } }} />
                <button type="button" className="ed-tool" title="Ler QR code de uma imagem ou print" onClick={() => qrRef.current?.click()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3M21 14v7h-7" /></svg>
                  ler QR
                </button>
              </div>
              <input ref={qrRef} type="file" accept="image/*" hidden onChange={e => { scanQr(e.target.files?.[0]); e.target.value = ''; }} />
              {otpText.trim() && !isLink && (
                <div className="ed-chips" role="radiogroup" aria-label="Tipo do código">
                  <button type="button" className={`ed-chip ${otpMode === 'totp' ? 'on' : ''}`} aria-pressed={otpMode === 'totp'} onClick={() => setOtpMode('totp')}>Por tempo (TOTP) · o normal</button>
                  <button type="button" className={`ed-chip ${otpMode === 'hotp' ? 'on' : ''}`} aria-pressed={otpMode === 'hotp'} onClick={() => setOtpMode('hotp')}>Por contador (HOTP) · alguns bancos</button>
                </div>
              )}
              {otpPreview && !otpPreview.startsWith('erro') ? (
                <div className="ed-otp-live"><span className="faint" style={{ fontSize: 12 }}>{otpMode === 'hotp' ? 'próximo código' : 'código agora'}</span><span key={otpPreview} className="otp-code code-flip" style={{ fontSize: 26, color: 'var(--red)' }}>{otpPreview}</span></div>
              ) : otpPreview ? <span className="err">{otpPreview.slice(6)}</span>
                : <span className="faint" style={{ fontSize: 11.5 }}>tire um print do QR code do site e cole aqui (Ctrl V), ou use “ler QR”.</span>}
            </Section>
          )}

          {kind === 'card' && (
            <Section n="一" title="Cartão">
              <div className="card-face ed-card">
                <span className="label" style={{ letterSpacing: 2 }}>{brand || 'cartão'}</span>
                <span className="mono" style={{ fontSize: 19, letterSpacing: 2 }}>{(card.number.replace(/\D/g, '').padEnd(16, '•').match(/.{1,4}/g) || []).join(' ')}</span>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span className="cell">{card.holder || 'NOME IMPRESSO'}</span><span className="mono">{card.expiry || 'MM/AA'}</span></div>
              </div>
              <label className="field"><span>número do cartão</span><input className="input mono" inputMode="numeric" value={card.number} onChange={e => setCardField('number', e.target.value.replace(/[^\d ]/g, ''))} autoComplete="off" />
                {card.number.replace(/\D/g, '').length >= 13 && (luhn(card.number) ? <span className="tip-line" style={{ color: 'var(--washi-2)' }}>✓ número válido</span> : <span className="warn-line">número não confere — verifique os dígitos</span>)}</label>
              <label className="field"><span>nome impresso</span><input className="input" value={card.holder} onChange={e => setCardField('holder', e.target.value.toUpperCase())} autoComplete="off" /></label>
              <div className="ed-grid3">
                <label className="field"><span>validade</span><input className="input mono" value={card.expiry} maxLength={5} placeholder="MM/AA" onChange={e => setCardField('expiry', e.target.value.replace(/[^\d/]/g, '').replace(/^(\d{2})(\d)/, '$1/$2'))} />{expiryBad && <span className="warn-line">vencido</span>}</label>
                <label className="field"><span>CVV</span><input className="input mono" type="password" value={card.cvv} maxLength={4} onChange={e => setCardField('cvv', e.target.value.replace(/\D/g, ''))} autoComplete="off" /></label>
                <label className="field"><span>senha</span><input className="input mono" type="password" value={card.pin} maxLength={8} onChange={e => setCardField('pin', e.target.value.replace(/\D/g, ''))} autoComplete="off" /></label>
              </div>
            </Section>
          )}

          {kind === 'identity' && (
            <Section n="一" title="Documentos">
              <label className="field"><span>nome completo</span><input className="input" value={identity.fullName} onChange={e => setIdField('fullName', e.target.value)} /></label>
              <div className="ed-grid2">
                <label className="field"><span>CPF</span><input className="input mono" value={identity.cpf} onChange={e => setIdField('cpf', e.target.value)} /></label>
                <label className="field"><span>RG</span><input className="input mono" value={identity.rg} onChange={e => setIdField('rg', e.target.value)} /></label>
                <label className="field"><span>nascimento</span><input className="input" value={identity.birth} onChange={e => setIdField('birth', e.target.value)} placeholder="dd/mm/aaaa" /></label>
                <label className="field"><span>telefone</span><input className="input" value={identity.phone} onChange={e => setIdField('phone', e.target.value)} /></label>
              </div>
              <label className="field"><span>e-mail</span><input className="input" value={identity.email} onChange={e => setIdField('email', e.target.value)} /></label>
              <label className="field"><span>endereço</span><textarea className="input" value={identity.address} onChange={e => setIdField('address', e.target.value)} /></label>
            </Section>
          )}

          {kind === 'note' && (
            <Section n="一" title="Nota">
              <textarea className="input ed-note" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Escreva aqui. Fica cifrada no cofre." aria-label="Nota" />
            </Section>
          )}

          <Section n={num(sec++)} title="Organização">
            <div className="ed-chips">
              <button type="button" className={`ed-chip ${!folderId ? 'on' : ''}`} onClick={() => setFolderId(null)}>sem pasta</button>
              {data.folders.map((f, i) => (
                <button type="button" key={f.id} className={`ed-chip ${folderId === f.id ? 'on' : ''}`} onClick={() => setFolderId(f.id)}>
                  <span className="brush" style={{ color: 'var(--red)' }}>{KANJI[i] || '・'}</span> {f.name}
                </button>
              ))}
            </div>
            <label className="field"><span>etiquetas (separe por vírgula)</span><input className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="banco, estudos" /></label>
          </Section>

          <Section n={num(sec++)} title="Notas e campos extras" badge={extrasCount ? String(extrasCount) : undefined} defaultOpen={extrasCount > 0}>
            {kind !== 'note' && <label className="field"><span>notas</span><textarea className="input" value={notes} onChange={e => setNotes(e.target.value)} /></label>}
            {fields.map(f => (
              <div key={f.id} className="ed-field-row">
                <input className="input" placeholder="nome do campo" value={f.label} onChange={e => setFields(x => x.map(y => y.id === f.id ? { ...y, label: e.target.value } : y))} />
                <input className={`input ${f.hidden ? 'mono' : ''}`} type={f.hidden ? 'password' : 'text'} placeholder="valor" value={f.value}
                  onChange={e => setFields(x => x.map(y => y.id === f.id ? { ...y, value: e.target.value } : y))} autoComplete="off" />
                <button type="button" className={`ed-tool ${f.hidden ? 'gen' : ''}`} title="Marcar como segredo" onClick={() => setFields(x => x.map(y => y.id === f.id ? { ...y, hidden: !y.hidden } : y))}>{f.hidden ? 'secreto' : 'visível'}</button>
                <button type="button" className="ed-tool" aria-label="Remover campo" onClick={() => setFields(x => x.filter(y => y.id !== f.id))}>✕</button>
              </div>
            ))}
            <button type="button" className="ed-add" onClick={() => setFields(x => [...x, { id: crypto.randomUUID(), label: '', value: '', hidden: false }])}>+ adicionar campo</button>
          </Section>

          <Section n={num(sec++)} title="Documentos e recuperação" badge={recCount ? String(recCount) : undefined} defaultOpen={recCount > 0}>
            <label className="field"><span>códigos de recuperação (um por linha)</span><textarea className="input mono" value={recoveryCodes} onChange={e => setRecoveryCodes(e.target.value)} placeholder={'a7f3-k29d\nm4q8-x1zr'} /></label>
            {attachments.map(a => (
              <div key={a.id} className="ed-file">
                <span className="seal" style={{ width: 24, height: 24, fontSize: 12 }}>封</span>
                <span className="cell" style={{ flex: 1 }}>{a.name}</span>
                <span className="mono faint" style={{ fontSize: 11 }}>{formatBytes(a.size)}</span>
                <button type="button" className="ed-tool" onClick={() => { setAttachments(x => x.filter(y => y.id !== a.id)); setRemoved(r => [...r, a.id]); }}>remover</button>
              </div>
            ))}
            <button type="button" className="ed-drop" onClick={() => fileRef.current?.click()}>
              <span className="brush" style={{ fontSize: 22, color: 'var(--red)' }}>封</span>
              <span>anexar PDF, foto de documento ou texto</span>
              <span className="faint" style={{ fontSize: 11.5 }}>cifrado no aparelho antes de sincronizar · até 20 MB</span>
            </button>
            <button type="button" className="ed-tool" style={{ alignSelf: 'flex-start' }} onClick={() => camRef.current?.click()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              fotografar documento
            </button>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            <input ref={fileRef} type="file" multiple hidden accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,image/*" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          </Section>

          <footer className="ed-foot">
            {err && <p className="err" role="alert" style={{ flexBasis: '100%' }}>{err}</p>}
            {item && !item.trashed && <button type="button" className="ed-tool" onClick={remove}>mover para a lixeira</button>}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={cancel}>Cancelar</button>
            <button className="btn btn-solid" disabled={busy} title="Ctrl+S">{busy ? 'guardando…' : item ? 'Guardar alterações' : 'Guardar no cofre'}</button>
          </footer>
        </div>
        <div className="rod" />
      </form>
    </div>
  );
}

/** Seção numerada que abre e fecha (as opcionais começam fechadas para o formulário ficar leve). */
function Section({ n, title, badge, defaultOpen = true, children }: { n: string; title: string; badge?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`ed-sec ${open ? 'open' : ''}`}>
      <button type="button" className="ed-sec-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="brush ed-sec-n">{n}</span>
        <span className="brush" style={{ fontSize: 21, flex: 1, textAlign: 'left' }}>{title}</span>
        {badge && <span className="ed-badge">{badge}</span>}
        <svg className="ed-chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      <div className="ed-sec-body"><div className="ed-sec-inner">{children}</div></div>
    </section>
  );
}
