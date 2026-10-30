import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { faviconUrl, findBrand, loadBrandIndex, type BrandIcon } from './icons';

/* ---------- Papel, brilhos e escrituras de fundo ---------- */

export function Paper() {
  return (
    <svg className="paper" aria-hidden="true">
      <filter id="washi"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" /><feColorMatrix type="matrix" values="0 0 0 0 0.92  0 0 0 0 0.9  0 0 0 0 0.85  0 0 0 0.55 0" /></filter>
      <filter id="fiber"><feTurbulence type="fractalNoise" baseFrequency="0.004 0.11" numOctaves="2" seed="9" /><feColorMatrix type="matrix" values="0 0 0 0 0.92  0 0 0 0 0.9  0 0 0 0 0.85  0 0 0 0.35 0" /></filter>
      <rect width="100%" height="100%" filter="url(#washi)" />
      <rect width="100%" height="100%" filter="url(#fiber)" />
    </svg>
  );
}

/** Céu de tinta: nuvens de sumi que flutuam devagar e cinzas que sobem. Só transform/opacity (leve). */
export function Glows() {
  const motes = useState(() => Array.from({ length: 16 }, (_, i) => ({
    left: `${(i * 61) % 100}%`, size: 2 + (i % 3), delay: `${-(i * 2.7) % 24}s`, dur: `${18 + (i % 5) * 4}s`, red: i % 4 === 0
  })))[0];
  return (
    <div className="sky" aria-hidden="true">
      <i className="shippo" /><i className="cloud c1" /><i className="cloud c2" /><i className="cloud c3" />
      {motes.map((m, i) => (
        <i key={i} className={`mote ${m.red ? 'red' : ''}`} style={{ left: m.left, width: m.size, height: m.size, animationDelay: m.delay, animationDuration: m.dur }} />
      ))}
    </div>
  );
}

const VERSES = ['心を静めて鍵を守る', '秘密は紙と墨に宿る', '一期一会', '七転び八起き', '静かなる守り'];

export function Sutra({ style, count = VERSES.length }: { style?: CSSProperties; count?: number }) {
  return (
    <div className="sutra drift" aria-hidden="true" style={style}>
      {VERSES.slice(0, count).map((v, i) => <span key={v} className="breath" style={{ animationDelay: `${i * 1.4}s` }}>{v}</span>)}
    </div>
  );
}

/** A marca: o carimbo hanko vermelho com o ensō e a fechadura (mesmo desenho do ícone do app). */
export function Logo({ size, className = '', style }: { size: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`logo ${className}`} width={size} height={size} viewBox="200 200 624 624" style={style} aria-label="Hanko" role="img">
      <defs>
        <filter id="logo-stone" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="11" /><feDisplacementMap in="SourceGraphic" scale="5" /></filter>
        <filter id="logo-brush" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed="4" /><feDisplacementMap in="SourceGraphic" scale="6" /></filter>
      </defs>
      <g transform="rotate(-5 512 512)">
        <rect x="212" y="212" width="600" height="600" rx="54" fill="#C8372D" filter="url(#logo-stone)" />
        <rect x="252" y="252" width="520" height="520" rx="34" fill="none" stroke="#F6F1E7" strokeWidth="10" opacity=".85" />
        <path className="logo-enso" pathLength={1} filter="url(#logo-brush)" d="M528 318 C 628 316, 706 396, 700 500 C 694 604, 612 676, 508 672 C 410 668, 330 594, 332 498 C 334 420, 382 356, 452 330" fill="none" stroke="#F6F1E7" strokeWidth="44" strokeLinecap="round" />
        <circle cx="515" cy="472" r="52" fill="#F6F1E7" />
        <path d="M493 500 L 537 500 L 556 612 Q 515 628 474 612 Z" fill="#F6F1E7" />
      </g>
    </svg>
  );
}

/* ---------- Traços de pincel ---------- */

export function BrushLine({ width = 150, color = 'var(--line-strong)', late = true, className }: { width?: number | string; color?: string; late?: boolean; className?: string }) {
  return (
    <svg className={className} width={width} height="7" viewBox="0 0 300 7" preserveAspectRatio="none" aria-hidden="true">
      <path className={late ? 'draw-late' : undefined} pathLength={1} d="M2 5 C 80 1, 190 7, 298 3" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Círculo zen pintado a pincel, com o arco vermelho do tempo restante. */
export function Enso({ size, progress, children, filterId, urgent = false }: { size: number; progress: number | null; children: ReactNode; filterId: string; urgent?: boolean }) {
  return (
    <div className={`enso ${urgent ? 'urgent' : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 300 300" aria-hidden="true">
        <defs>
          <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="4" />
            <feDisplacementMap in="SourceGraphic" scale="7" />
          </filter>
        </defs>
        <g filter={`url(#${filterId})`}>
          <path className="draw" pathLength={1} d="M156 26 C 226 26, 278 84, 273 156 C 268 228, 208 276, 144 273 C 80 270, 28 218, 29 150 C 30 96, 64 50, 116 33" fill="none" stroke="var(--enso, var(--washi))" strokeWidth="19" strokeLinecap="round" opacity=".9" />
          <path className="draw" pathLength={1} d="M160 36 C 222 38, 266 90, 262 154 C 258 218, 206 262, 146 262 C 88 262, 40 216, 40 152 C 40 106, 68 64, 112 46" fill="none" stroke="var(--ink)" strokeWidth="2.4" strokeDasharray="0.04 0.02 0.09 0.015 0.03 0.03" opacity=".75" />
        </g>
        <circle className="enso-orbit" cx="150" cy="150" r="100" fill="none" stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="1 7" />
        {progress !== null && (
          <circle className="arc" cx="150" cy="150" r="100" pathLength={100} fill="none" stroke="var(--red)" strokeWidth="3" strokeLinecap="round" strokeDasharray="100" strokeDashoffset={100 * (1 - progress)} transform="rotate(-90 150 150)" />
        )}
      </svg>
      <div className="enso-center">{children}</div>
    </div>
  );
}

/** Tamanho de fonte para um código caber em `width` px sem quebrar (DM Mono ≈ 0,66 em por caractere com o espaçamento). */
export function fitCode(code: string, width: number, max: number): number {
  return Math.max(14, Math.min(max, Math.floor(width / (code.length * 0.66))));
}

export function Seal({ size, children, className = 'stamp-in', style }: { size: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  return <span className={`seal ${className}`} style={{ width: size, height: size, fontSize: size * 0.46, ...style }}>{children}</span>;
}

/* ---------- Ícone da conta ---------- */

export function Avatar({ name, url, size = 32, on = false, online }: { name: string; url: string; size?: number; on?: boolean; online: boolean }) {
  const [brand, setBrand] = useState<BrandIcon | null>(null);
  const [imgOk, setImgOk] = useState(true);
  useEffect(() => {
    let alive = true;
    loadBrandIndex().then(m => alive && setBrand(findBrand(m, name, url))).catch(() => {});
    return () => { alive = false; };
  }, [name, url]);
  useEffect(() => setImgOk(true), [url]);
  const fav = online ? faviconUrl(url) : null;
  return (
    <span className={`avatar ${on ? 'on' : ''}`} style={{ width: size, height: size }} title={brand?.title}>
      {brand ? (
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" aria-hidden="true"><path d={brand.path} fill="currentColor" /></svg>
      ) : fav && imgOk ? (
        <img src={fav} alt="" onError={() => setImgOk(false)} referrerPolicy="no-referrer" />
      ) : (
        <span className="brush" style={{ fontSize: size * 0.48 }}>{(name.trim()[0] || '?').toUpperCase()}</span>
      )}
    </span>
  );
}

/* ---------- Aviso com carimbo + cópia segura ---------- */

interface ToastAction { label: string; run(): void }
interface ToastApi { show(mark: string, text: string, action?: ToastAction): void }
const ToastCtx = createContext<ToastApi>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ id: number; mark: string; text: string; action?: ToastAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((mark: string, text: string, action?: ToastAction) => {
    clearTimeout(timer.current);
    const ms = action ? 6000 : 2200; // com "Desfazer" o aviso fica mais tempo
    setT({ id: Date.now(), mark, text, action });
    timer.current = setTimeout(() => setT(null), ms);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      {t && (
        <div className={`toast ${t.action ? 'with-action' : ''}`} key={t.id} role="status">
          <Seal size={36} style={{ animationDelay: '0s' }}>{t.mark}</Seal>
          <span>{t.text}</span>
          {t.action && (
            <button className="toast-action" onClick={() => { clearTimeout(timer.current); setT(null); t.action!.run(); }}>{t.action.label}</button>
          )}
          {t.action && <i className="toast-timer" />}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/* ---------- Confirmação própria (no lugar do confirm() do navegador) ---------- */

export interface ConfirmOptions {
  title: string;
  text: ReactNode;
  confirm?: string;
  cancel?: string;
  /** Ação perigosa: botão vermelho. */
  danger?: boolean;
  /** Irreversível: precisa segurar o botão por um instante (evita clique acidental). */
  hold?: boolean;
  mark?: string;
}
type Ask = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmCtx = createContext<Ask>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

/** Pergunta com campo de texto (no lugar do prompt() do navegador). Devolve null se cancelar. */
export interface PromptOptions { title: string; text?: ReactNode; value?: string; placeholder?: string; confirm?: string; mark?: string }
type AskText = (o: PromptOptions) => Promise<string | null>;
const PromptCtx = createContext<AskText>(async () => null);
export const usePrompt = () => useContext(PromptCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(ConfirmOptions & { input?: PromptOptions; resolve(v: boolean): void }) | null>(null);
  const [closing, setClosing] = useState(false);
  const [text, setText] = useState('');
  const textRef = useRef('');
  textRef.current = text;
  const ask = useCallback<Ask>(o => new Promise(resolve => { setClosing(false); setReq({ ...o, resolve }); }), []);
  const askText = useCallback<AskText>(o => new Promise(resolve => {
    setClosing(false);
    setText(o.value || '');
    setReq({ title: o.title, text: o.text, confirm: o.confirm || 'Salvar', mark: o.mark || '名', input: o, resolve: ok => resolve(ok && textRef.current.trim() ? textRef.current.trim() : null) });
  }), []);
  const done = (v: boolean) => {
    if (!req || closing) return;
    if (v && req.input && !text.trim()) return;
    setClosing(true);
    setTimeout(() => { req.resolve(v); setReq(null); }, 220);
  };
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
      // Enter num botão aciona o próprio botão (Enter no "Cancelar" focado não pode confirmar).
      if (e.key === 'Enter' && !req.hold && !(document.activeElement instanceof HTMLButtonElement)) { e.preventDefault(); done(true); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  return (
    <ConfirmCtx.Provider value={ask}>
    <PromptCtx.Provider value={askText}>
      {children}
      {req && (
        <div className={`overlay confirm-overlay ${closing ? 'closing' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) done(false); }}>
          <div className={`confirm ${req.danger ? 'danger' : ''}`} role="alertdialog" aria-label={req.title}>
            <Seal size={44}>{req.mark || (req.danger ? '危' : '問')}</Seal>
            <span className="brush" style={{ fontSize: 23, lineHeight: 1.25 }}>{req.title}</span>
            {req.text && <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>{req.text}</div>}
            {req.input && (
              <input className="input confirm-input" value={text} placeholder={req.input.placeholder} maxLength={60} autoFocus
                onChange={e => setText(e.target.value)} aria-label={req.title} />
            )}
            <div className="confirm-actions">
              <button className="btn" onClick={() => done(false)} autoFocus={!req.input}>{req.cancel || 'Cancelar'}</button>
              {req.hold
                ? <HoldButton label={req.confirm || 'Confirmar'} onDone={() => done(true)} />
                : <button className={`btn ${req.danger ? 'btn-red' : 'btn-solid'}`} onClick={() => done(true)}>{req.confirm || 'Confirmar'}</button>}
            </div>
          </div>
        </div>
      )}
    </PromptCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

/** Botão de "segurar para confirmar": a tinta vermelha enche o botão; soltar antes cancela. */
export function HoldButton({ label, onDone, ms = 1200 }: { label: string; onDone(): void; ms?: number }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const start = () => { setHolding(true); timer.current = setTimeout(() => { setHolding(false); onDone(); }, ms); };
  const stop = () => { clearTimeout(timer.current); setHolding(false); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button className={`btn hold-btn ${holding ? 'holding' : ''}`} style={{ ['--hold' as string]: `${ms}ms` }}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } }}
      onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') stop(); }}>
      <i className="hold-fill" />
      <span>{holding ? 'segure…' : `${label} · segure`}</span>
    </button>
  );
}

export const useToast = () => useContext(ToastCtx);

let clipTimer: ReturnType<typeof setTimeout> | undefined;

/** No app do Windows a cópia passa pelo sistema marcada como "fora do histórico (Win+V) e da nuvem". */
async function writeClip(text: string) {
  if ('__TAURI_INTERNALS__' in window && /Windows/i.test(navigator.userAgent)) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('copy_secret', { text });
      return;
    } catch { /* cai para a cópia comum */ }
  }
  await navigator.clipboard.writeText(text);
}

/** Copia e limpa a área de transferência depois de `seconds` (se ainda tiver o mesmo conteúdo). */
export async function copySecret(text: string, seconds: number) {
  await writeClip(text);
  clearTimeout(clipTimer);
  clipTimer = setTimeout(async () => {
    try { if ((await navigator.clipboard.readText()) === text) await writeClip(''); }
    catch { writeClip('').catch(() => {}); }
  }, seconds * 1000);
}
