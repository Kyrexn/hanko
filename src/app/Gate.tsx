import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { strength } from '../core/passwords';
import { download } from './model';
import { BrushLine, Enso, Logo, Seal, Sutra, copySecret, useConfirm, useToast } from './ui';
import { bioName } from './native';
import { useVault } from './vault';

type Screen =
  | 'welcome' | 'unlock' | 'local'
  | 'reg-account' | 'reg-password' | 'reg-verify' | 'kit'
  | 'login' | 'login-mfa'
  | 'forgot-email' | 'forgot-code' | 'forgot-mfa' | 'forgot-reset' | 'forgot-local';

/* ---------- Freio contra tentativas ---------- */

/**
 * Depois de 3 senhas erradas, cada nova tentativa espera mais (5 s, 10 s, 20 s… até 5 min).
 * Fica salvo no aparelho, então fechar e abrir o app não zera a espera.
 * (A proteção de verdade é o PBKDF2 de 600 mil rodadas; isto atrapalha quem tenta à mão.)
 */
/** Pedir a biometria sozinha só na primeira tela de desbloqueio depois de abrir o app (não logo após bloquear). */
let bioAutoTried = false;

const failures = {
  key: 'hanko-tentativas',
  read(): { n: number; until: number } {
    try { return { n: 0, until: 0, ...JSON.parse(localStorage.getItem(this.key) || '{}') }; } catch { return { n: 0, until: 0 }; }
  },
  remaining(): number { return Math.max(0, Math.ceil((this.read().until - Date.now()) / 1000)); },
  fail(): { wait: number; left: number } {
    const n = this.read().n + 1;
    const wait = n >= 3 ? Math.min(300, 5 * 2 ** (n - 3)) : 0;
    try { localStorage.setItem(this.key, JSON.stringify({ n, until: Date.now() + wait * 1000 })); } catch { /* sem armazenamento */ }
    return { wait, left: Math.max(0, 3 - n) };
  },
  reset() { try { localStorage.removeItem(this.key); } catch { /* sem armazenamento */ } }
};

/* ---------- Peças ---------- */

function StrengthMeter({ value }: { value: string }) {
  const s = strength(value);
  const pct = { vazia: 0, fraca: 22, razoavel: 48, boa: 76, excelente: 100 }[s.level];
  const color = s.level === 'fraca' ? 'var(--red)' : s.level === 'razoavel' ? 'var(--amber)' : 'var(--washi-2)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="meter"><i style={{ width: `${pct}%`, background: color }} /></div>
      <span className="faint" style={{ fontSize: 12 }}>{value ? `força: ${s.label} · ${s.bits} bits` : 'use uma frase longa que só você saiba'}</span>
    </div>
  );
}

/** Seis caixas para códigos de verificação; aceita colar o código inteiro. */
export function CodeInput({ value, onChange, autoFocus = true }: { value: string; onChange(v: string): void; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  const set = (i: number, d: string) => {
    const next = digits.map((c, j) => (j === i ? d : c)).join('').replace(/\s+$/, '');
    onChange(next.replace(/ /g, ''));
  };
  return (
    <div className="code-boxes" onPaste={e => {
      const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      if (t) { e.preventDefault(); onChange(t); refs.current[Math.min(t.length, 5)]?.focus(); }
    }}>
      {digits.map((c, i) => (
        <input key={i} ref={el => { refs.current[i] = el; }} className="code-box mono" inputMode="numeric" maxLength={1} autoFocus={autoFocus && i === 0}
          aria-label={`dígito ${i + 1}`} value={c.trim()}
          onChange={e => { const d = e.target.value.replace(/\D/g, '').slice(-1); set(i, d); if (d) refs.current[i + 1]?.focus(); }}
          onKeyDown={e => { if (e.key === 'Backspace' && !c.trim()) refs.current[i - 1]?.focus(); }} />
      ))}
    </div>
  );
}

function Steps({ at }: { at: number }) {
  const names = ['Conta', 'Senha mestra', 'E-mail', 'Kit'];
  return (
    <div className="steps">
      {names.map((n, i) => (
        <span key={n} className={i === at ? 'on' : i < at ? 'done' : ''}>
          <span className="brush">{['一', '二', '三', '四'][i]}</span> {n}
        </span>
      ))}
    </div>
  );
}

function Card({ title, sub, children, onSubmit }: { title: string; sub?: ReactNode; children: ReactNode; onSubmit?(e: FormEvent): void }) {
  return (
    <form className="auth-card" onSubmit={e => { e.preventDefault(); onSubmit?.(e); }}>
      <div className="rod" />
      <div className="scroll-paper unroll" style={{ gap: 14 }}>
        <span className="brush ink-in" style={{ fontSize: 29, lineHeight: 1.2 }}>{title}</span>
        {sub && <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.65 }}>{sub}</div>}
        {children}
      </div>
      <div className="rod" />
    </form>
  );
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="field"><span>{label}</span>{children}</label>;

/* ---------- Telas de entrada ---------- */

export function Gate({ opening: openingProp = false }: { opening?: boolean }) {
  const vault = useVault();
  const toast = useToast();
  const ask = useConfirm();
  const hasCloud = vault.sync.available;
  const [screen, setScreen] = useState<Screen>(vault.status === 'locked' ? 'unlock' : 'welcome');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(vault.sync.email || '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [ack, setAck] = useState(false);
  const [code, setCode] = useState('');
  const [rk, setRk] = useState('');
  const [kitSaved, setKitSaved] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [lockWait, setLockWait] = useState(() => failures.remaining());
  useEffect(() => { if (!lockWait) return; const t = setTimeout(() => setLockWait(failures.remaining()), 1000); return () => clearTimeout(t); }, [lockWait]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (vault.status === 'locked' && screen === 'welcome') setScreen('unlock'); }, [vault.status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function quickUnlock() {
    setErr('');
    setBusy(true);
    try {
      const r = await vault.unlockBio();
      if (r === 'ok') { failures.reset(); setOpening(true); }
      else if (r === 'invalid') setErr(`O desbloqueio rápido precisa ser reativado (a chave do cofre ou a biometria mudou). Use a senha mestra e ligue de novo em Ajustes.`);
    } catch (e) {
      setErr((e as Error).message || 'Não consegui usar a biometria.');
    } finally { setBusy(false); }
  }
  useEffect(() => {
    if (screen !== 'unlock' || !vault.bio.enabled || bioAutoTried || vault.status !== 'locked') return;
    bioAutoTried = true;
    const t = setTimeout(quickUnlock, 450);
    return () => clearTimeout(t);
  }, [screen, vault.bio.enabled, vault.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!cooldown) return; const t = setTimeout(() => setCooldown(c => c - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  const go = (s: Screen) => { setErr(''); setCode(''); setScreen(s); };
  async function run(fn: () => Promise<void>) {
    setErr('');
    setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message || 'Algo deu errado.'); } finally { setBusy(false); }
  }
  const checkNewPassword = () => {
    if (pw.length < 10) throw new Error('A senha mestra precisa de pelo menos 10 caracteres.');
    if (['fraca'].includes(strength(pw).level)) throw new Error('Essa senha é fraca demais para proteger tudo. Use uma frase mais longa.');
    if (pw !== pw2) throw new Error('As senhas não conferem.');
  };

  async function restore(file: File | undefined) {
    if (!file) return;
    if (vault.status === 'locked' && !await ask({ title: 'Restaurar este backup?', text: <>O cofre deste aparelho será <b>substituído</b> pelo do arquivo.</>, confirm: 'Substituir', danger: true, hold: true, mark: '復' })) return;
    await run(async () => { await vault.importBackup(file); toast.show('復', 'Backup carregado. Use a senha mestra dele.'); setScreen('unlock'); });
  }

  const kitText = () => [
    '判子 HANKO — KIT DE EMERGÊNCIA', '',
    `Conta: ${email || '(só neste aparelho)'}`, `Criado em: ${new Date().toLocaleString('pt-BR')}`, '',
    'CHAVE DE RECUPERAÇÃO:', rk, '',
    'Com esta chave você recupera o cofre se esquecer a senha mestra.',
    'Guarde impresso ou num pen drive, longe do computador. Quem tiver esta chave',
    'e acesso ao seu e-mail consegue abrir o cofre: não compartilhe com ninguém.'
  ].join('\r\n');

  const busyLabel = (t: string) => (busy ? 'aguarde…' : t);
  const showOpening = opening || openingProp;

  let card: ReactNode;
  switch (screen) {
    case 'welcome':
      card = (
        <Card title="Selado. Só você abre." sub="Senhas, códigos 2FA e documentos de recuperação, cifrados no seu aparelho e sincronizados entre Windows, Android e Chrome.">
          {hasCloud && <button type="button" className="btn btn-solid" onClick={() => go('reg-account')}>Criar minha conta</button>}
          {hasCloud && <button type="button" className="btn" onClick={() => go('login')}>Já tenho conta — entrar</button>}
          <BrushLine width="100%" />
          <button type="button" className="btn-quiet" style={{ alignSelf: 'center' }} onClick={() => go('local')}>usar só neste aparelho, sem conta</button>
          <button type="button" className="btn-quiet" style={{ alignSelf: 'center' }} onClick={() => fileRef.current?.click()}>restaurar de um arquivo de backup</button>
        </Card>
      );
      break;

    case 'reg-account':
      card = (
        <Card title="Criar conta" sub={<><Steps at={0} />Sua conta serve para sincronizar os aparelhos. O servidor nunca vê suas senhas.</>}
          onSubmit={() => run(async () => {
            if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error('Informe um e-mail válido.');
            go('reg-password');
          })}>
          <Field label="como quer ser chamado"><input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus autoComplete="name" /></Field>
          <Field label="e-mail"><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></Field>
          <p className="err" role="alert">{err}</p>
          <button className="btn btn-solid">Continuar</button>
          <button type="button" className="btn-quiet" style={{ alignSelf: 'center' }} onClick={() => go('welcome')}>voltar</button>
        </Card>
      );
      break;

    case 'reg-password':
      card = (
        <Card title="Senha mestra" sub={<><Steps at={1} />É a única senha que você vai precisar lembrar. Ela abre o cofre e nunca sai deste aparelho.</>}
          onSubmit={() => run(async () => {
            checkNewPassword();
            if (!ack) throw new Error('Confirme que entendeu o aviso.');
            const r = await vault.register(name, email, pw);
            setRk(r.recoveryKey);
            go(r.needsCode ? 'reg-verify' : 'kit');
            if (r.needsCode) setCooldown(60);
          })}>
          <Field label="senha mestra"><input className="input mono" type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus autoComplete="new-password" style={{ letterSpacing: 2 }} /></Field>
          <StrengthMeter value={pw} />
          <Field label="repita a senha mestra"><input className="input mono" type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" style={{ letterSpacing: 2 }} /></Field>
          <label className="check"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
            <span>Entendo que, se eu esquecer a senha mestra, só o <b>Kit de Emergência</b> (próximo passo) recupera o cofre.</span></label>
          <p className="err" role="alert">{err}</p>
          <button className="btn btn-solid" disabled={busy}>{busyLabel('Criar conta')}</button>
          <button type="button" className="btn-quiet" style={{ alignSelf: 'center' }} onClick={() => go('reg-account')}>voltar</button>
        </Card>
      );
      break;

    case 'reg-verify':
      card = (
        <Card title="Confirme seu e-mail" sub={<><Steps at={2} />Enviamos um código de 6 dígitos para <b style={{ color: 'var(--washi)' }}>{email}</b>.</>}
          onSubmit={() => run(async () => { if (code.length < 6) throw new Error('Digite os 6 dígitos.'); await vault.verifySignup(code); go('kit'); })}>
          <CodeInput value={code} onChange={setCode} />
          <p className="err" role="alert">{err}</p>
          <button className="btn btn-solid" disabled={busy}>{busyLabel('Confirmar')}</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn-quiet" disabled={cooldown > 0} onClick={() => run(async () => { await vault.resendSignup(); setCooldown(60); toast.show('送', 'Código reenviado'); })}>
              {cooldown ? `reenviar em ${cooldown}s` : 'reenviar código'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => run(async () => { await vault.verifySignupLink(); go('kit'); })}>o e-mail veio com link — já confirmei</button>
          </div>
        </Card>
      );
      break;

    case 'kit':
      card = (
        <Card title="Kit de Emergência" sub={<><Steps at={3} />Se esquecer a senha mestra, esta chave é o <b>único</b> jeito de recuperar o cofre. Guarde fora do computador.</>}
          onSubmit={() => { if (kitSaved) vault.enter(); }}>
          <div className="kit-key mono">{rk}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn" style={{ flex: 1 }} onClick={() => { download(new Blob([kitText()], { type: 'text/plain' }), 'Hanko-Kit-de-Emergencia.txt'); setKitSaved(true); }}>Baixar Kit (.txt)</button>
            <button type="button" className="btn" style={{ flex: 1 }} onClick={async () => { await copySecret(rk, 60); toast.show('写', 'Chave copiada'); }}>Copiar chave</button>
          </div>
          <label className="check"><input type="checkbox" checked={kitSaved} onChange={e => setKitSaved(e.target.checked)} /><span>Guardei meu Kit de Emergência num lugar seguro.</span></label>
          <button className="btn btn-solid" disabled={!kitSaved}>Abrir meu cofre</button>
        </Card>
      );
      break;

    case 'login':
      card = (
        <Card title="Entrar" sub="Use o e-mail da conta e a sua senha mestra. O cofre chega cifrado e só abre aqui."
          onSubmit={() => run(async () => {
            if (!email.includes('@') || !pw) throw new Error('Informe o e-mail e a senha mestra.');
            const r = await vault.login(email, pw);
            if (r === 'mfa') go('login-mfa'); else setOpening(true);
          })}>
          <Field label="e-mail"><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus autoComplete="username" /></Field>
          <Field label="senha mestra"><input className="input mono" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" style={{ letterSpacing: 2 }} /></Field>
          <p className="err" role="alert">{err}</p>
          <button className="btn btn-solid" disabled={busy}>{busyLabel('Entrar')}</button>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" className="btn-quiet" onClick={() => go('forgot-email')}>esqueci a senha mestra</button>
            <button type="button" className="btn-quiet" onClick={() => go('reg-account')}>criar conta</button>
          </div>
        </Card>
      );
      break;

    case 'login-mfa':
    case 'forgot-mfa':
      card = (
        <Card title="Código 2FA da conta" sub="Abra o seu app autenticador e digite o código de 6 dígitos da conta Hanko."
          onSubmit={() => run(async () => {
            if (code.length < 6) throw new Error('Digite os 6 dígitos.');
            if (screen === 'login-mfa') { await vault.loginMfa(code); setOpening(true); }
            else { await vault.recoverMfa(code); go('forgot-reset'); }
          })}>
          <CodeInput value={code} onChange={setCode} />
          <p className="err" role="alert">{err}</p>
          <button className="btn btn-solid" disabled={busy}>{busyLabel('Verificar')}</button>
        </Card>
      );
      break;

    case 'forgot-email':
      card = (
        <Card title="Esqueci a senha mestra" sub="Por segurança, ninguém — nem nós — consegue ver sua senha. Com o código do e-mail e o seu Kit de Emergência você cria uma senha mestra nova."
          onSubmit={() => run(async () => {
            if (!email.includes('@')) throw new Error('Informe o e-mail da conta.');
            await vault.recoverRequest(email);
            setCooldown(60);
            go('forgot-code');
          })}>
          <Field label="e-mail da conta"><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus /></Field>
          <p className="err" role="alert">{err}</p>
          <button className="btn btn-solid" disabled={busy}>{busyLabel('Enviar código')}</button>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" className="btn-quiet" onClick={() => go(vault.status === 'locked' ? 'unlock' : 'login')}>voltar</button>
            {vault.status === 'locked' && <button type="button" className="btn-quiet" onClick={() => go('forgot-local')}>recuperar só neste aparelho</button>}
          </div>
        </Card>
      );
      break;

    case 'forgot-code':
      card = (
        <Card title="Código do e-mail" sub={<>Digite o código enviado para <b style={{ color: 'var(--washi)' }}>{email}</b>.</>}
          onSubmit={() => run(async () => {
            if (code.length < 6) throw new Error('Digite os 6 dígitos.');
            const r = await vault.recoverVerify(email, code);
            go(r === 'mfa' ? 'forgot-mfa' : 'forgot-reset');
          })}>
          <CodeInput value={code} onChange={setCode} />
          <p className="err" role="alert">{err}</p>
          <button className="btn btn-solid" disabled={busy}>{busyLabel('Confirmar')}</button>
          <button type="button" className="btn-quiet" disabled={cooldown > 0} style={{ alignSelf: 'center' }}
            onClick={() => run(async () => { await vault.recoverRequest(email); setCooldown(60); toast.show('送', 'Código reenviado'); })}>
            {cooldown ? `reenviar em ${cooldown}s` : 'reenviar código'}
          </button>
        </Card>
      );
      break;

    case 'forgot-reset':
    case 'forgot-local':
      card = (
        <Card title="Nova senha mestra" sub="Digite a chave do seu Kit de Emergência e escolha a senha mestra nova."
          onSubmit={() => run(async () => {
            if (!rk.trim()) throw new Error('Digite a chave do Kit de Emergência.');
            checkNewPassword();
            if (screen === 'forgot-reset') await vault.recoverFinish(email, rk, pw);
            else await vault.recoverLocal(rk, pw);
            toast.show('改', 'Senha mestra trocada');
            vault.enter();
          })}>
          <Field label="chave do Kit de Emergência"><input className="input mono" value={rk} onChange={e => setRk(e.target.value.toUpperCase())} autoFocus placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" /></Field>
          <Field label="nova senha mestra"><input className="input mono" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" style={{ letterSpacing: 2 }} /></Field>
          <StrengthMeter value={pw} />
          <Field label="repita a nova senha"><input className="input mono" type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" style={{ letterSpacing: 2 }} /></Field>
          <p className="err" role="alert">{err}</p>
          <button className="btn btn-solid" disabled={busy}>{busyLabel('Salvar e abrir')}</button>
        </Card>
      );
      break;

    case 'local':
      card = (
        <Card title="Hanko só neste aparelho" sub="Sem conta e sem sincronização. Você pode criar a conta depois, nos ajustes."
          onSubmit={() => run(async () => { checkNewPassword(); await vault.create(pw); })}>
          <Field label="senha mestra"><input className="input mono" type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus autoComplete="new-password" style={{ letterSpacing: 2 }} /></Field>
          <StrengthMeter value={pw} />
          <Field label="repita a senha mestra"><input className="input mono" type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" style={{ letterSpacing: 2 }} /></Field>
          <p className="err" role="alert">{err}</p>
          <button className="btn btn-solid" disabled={busy}>{busyLabel('Criar o cofre')}</button>
          <button type="button" className="btn-quiet" style={{ alignSelf: 'center' }} onClick={() => go('welcome')}>voltar</button>
        </Card>
      );
      break;

    case 'unlock':
    default:
      card = (
        <Card title="Escreva a senha mestra" sub={vault.sync.email ? <>Conta <b style={{ color: 'var(--washi)' }}>{vault.sync.email}</b></> : 'Hanko deste aparelho'}
          onSubmit={() => run(async () => {
            if (!pw || lockWait > 0) return;
            const ok = await vault.unlock(pw);
            if (!ok) {
              await new Promise(r => setTimeout(r, 500));
              const f = failures.fail();
              setLockWait(f.wait);
              throw new Error(f.wait ? `Senha incorreta. Por segurança, aguarde ${f.wait} s para tentar de novo.` : `Senha incorreta.${f.left <= 2 ? ` Mais ${f.left} tentativa(s) antes de uma pausa.` : ''}`);
            }
            failures.reset();
            setOpening(true);
          })}>
          <Field label="senha mestra"><input className="input mono" type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus autoComplete="current-password" style={{ letterSpacing: 3 }} /></Field>
          <p className="err" role="alert">{err}</p>
          <button className="btn btn-solid" disabled={busy || lockWait > 0}>{busy ? 'abrindo…' : lockWait > 0 ? `aguarde ${lockWait} s` : '開く · abrir'}</button>
          {vault.bio.enabled && (
            <button type="button" className="btn bio-btn" disabled={busy} onClick={quickUnlock}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M12 11v3.5M8.5 9.5a3.5 3.5 0 0 1 7 0V14a7 7 0 0 1-1.2 3.9M5.5 12V9.5a6.5 6.5 0 0 1 13 0v1M8.5 13v1.5a9 9 0 0 1-1.5 5M12 18.5V20" /></svg>
              Usar {bioName()}
            </button>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn-quiet" onClick={() => go(vault.sync.linked ? 'forgot-email' : 'forgot-local')}>esqueci a senha mestra</button>
            <button type="button" className="btn-quiet" onClick={() => fileRef.current?.click()}>restaurar backup</button>
          </div>
        </Card>
      );
  }

  return (
    <div className="auth">
      <section className="auth-brand">
        <Sutra count={2} style={{ position: 'absolute', left: 28, top: 36 }} />
        <Enso size={260} progress={showOpening ? 1 : null} filterId="rough-gate">
          {showOpening ? <Seal size={96}>開</Seal> : <Logo size={118} className="logo-stamp" />}
        </Enso>
        <span className="wordmark ink-in">Hanko</span>
        <span className="label" style={{ letterSpacing: 6 }}>判子 · selado, só você abre</span>
        <span className="muted auth-tagline">Cifrado no aparelho · conhecimento zero · 2FA</span>
      </section>
      {/* key: cada tela nova desenrola de novo o pergaminho */}
      <section className="auth-form"><div key={screen} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>{card}</div></section>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { restore(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
