import { useEffect, useRef, useState } from 'react';
import { generatePassphrase, generatePassword, generatePin, generatedBits, passphraseBits, type PoolName, type PoolSet } from '../core/passwords';

type Mode = 'senha' | 'frase' | 'pin';
interface Prefs { mode: Mode; len: number; sets: PoolSet; words: number; sep: string; caps: boolean; num: boolean; pin: number }

const DEFAULTS: Prefs = { mode: 'senha', len: 20, sets: { lower: true, upper: true, digits: true, symbols: true }, words: 7, sep: '-', caps: true, num: true, pin: 6 };
const KEY = 'hanko-gerador';

// Só as preferências (tamanho, tipos) ficam salvas — nunca as senhas geradas.
function loadPrefs(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; }
}

function make(p: Prefs): string {
  if (p.mode === 'frase') return generatePassphrase(p.words, p.sep, p.caps, p.num);
  if (p.mode === 'pin') return generatePin(p.pin);
  return generatePassword(p.len, p.sets);
}

function bitsOf(p: Prefs): number {
  if (p.mode === 'frase') return passphraseBits(p.words, p.num);
  if (p.mode === 'pin') return Math.round(p.pin * Math.log2(10));
  return generatedBits(p.len, p.sets);
}

/** Tempo médio para adivinhar com 10 bilhões de tentativas por segundo (ataque offline forte). */
export function crackTime(bits: number): string {
  const sec = Math.pow(2, bits - 1) / 1e10;
  if (sec < 1) return 'instantâneo';
  if (sec < 3600) return `${Math.ceil(sec / 60)} min`;
  if (sec < 86400) return `${Math.ceil(sec / 3600)} h`;
  const years = sec / 31557600;
  if (years < 1) return `${Math.ceil(sec / 86400)} dias`;
  if (years < 1000) return `${Math.round(years)} anos`;
  if (years < 1e6) return 'milhares de anos';
  if (years < 1e9) return 'milhões de anos';
  return 'mais que a idade do universo';
}

const SCRAMBLE = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';

/** Senha com cores por tipo de caractere; ao mudar, "decifra" da esquerda para a direita. */
export function ColoredSecret({ value, size = 22 }: { value: string; size?: number }) {
  const [shown, setShown] = useState(value);
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (reduce) { setShown(value); return; }
    let frame = 0;
    const total = 14;
    const id = setInterval(() => {
      frame++;
      const done = Math.floor((frame / total) * value.length);
      setShown(value.split('').map((c, i) => (i < done || c === ' ' ? c : SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)])).join(''));
      if (frame >= total) { clearInterval(id); setShown(value); }
    }, 28);
    return () => clearInterval(id);
  }, [value, reduce]);
  return (
    <span className="secret mono" style={{ fontSize: size }} aria-label={value}>
      {shown.split('').map((c, i) => (
        <span key={i} className={/\d/.test(c) ? 'ch-d' : /[a-z]/i.test(c) ? (/[A-Z]/.test(c) ? 'ch-u' : 'ch-l') : 'ch-s'}>{c}</span>
      ))}
    </span>
  );
}

/**
 * Forja de senhas: usada na janela do gerador e dentro do editor.
 * `onUse` aparece só no editor ("usar esta senha").
 */
export function PasswordForge({ onCopy, onUse, compact = false }: { onCopy(p: string): void; onUse?(p: string): void; compact?: boolean }) {
  const [p, setP] = useState<Prefs>(loadPrefs);
  const [pw, setPw] = useState(() => make(loadPrefs()));
  const [history, setHistory] = useState<string[]>([]);
  const [spin, setSpin] = useState(0);
  const first = useRef(true);

  const update = (patch: Partial<Prefs>) => {
    const next = { ...p, ...patch };
    // Pelo menos um tipo de caractere sempre ligado.
    if (!Object.values(next.sets).some(Boolean)) return;
    setP(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sem armazenamento: só não lembra */ }
  };
  const regen = () => {
    setHistory(h => [pw, ...h.filter(x => x !== pw)].slice(0, 5));
    setPw(make(p));
    setSpin(s => s + 1);
  };
  useEffect(() => { if (first.current) { first.current = false; return; } setPw(make(p)); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  const bits = bitsOf(p);
  const level = bits >= 90 ? 'excelente' : bits >= 64 ? 'boa' : bits >= 45 ? 'razoável' : 'fraca';
  const color = bits >= 64 ? 'var(--gold)' : bits >= 45 ? 'var(--amber)' : 'var(--red)';
  const names: Record<PoolName, string> = { lower: 'a–z', upper: 'A–Z', digits: '0–9', symbols: '!@#' };

  return (
    <div className={`forge ${compact ? 'compact' : ''}`}>
      <div className="seg" role="tablist">
        {([['senha', 'Senha'], ['frase', 'Frase-senha'], ['pin', 'PIN']] as const).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={p.mode === m} className={p.mode === m ? 'on' : ''} onClick={() => update({ mode: m })}>{label}</button>
        ))}
      </div>

      <div className="forge-out">
        <ColoredSecret value={pw} size={compact ? 18 : p.mode === 'frase' ? 19 : 22} />
        <button type="button" className="forge-re" onClick={regen} title="Gerar outra" aria-label="Gerar outra">
          <svg key={spin} className="spin-once" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" /></svg>
        </button>
      </div>

      <div className="forge-meter">
        <div className="meter"><i style={{ width: `${Math.min(100, (bits / 128) * 100)}%`, background: color }} /></div>
        <span className="faint" style={{ fontSize: 12 }}>
          <b style={{ color }}>{level}</b> · {bits} bits · para quebrar: <span style={{ color: 'var(--washi)' }}>{crackTime(bits)}</span>
        </span>
      </div>

      {p.mode === 'senha' && (
        <>
          <label className="slider">
            <span>tamanho</span>
            <input type="range" min={8} max={64} value={p.len} onChange={e => update({ len: +e.target.value })} />
            <b className="mono">{p.len}</b>
          </label>
          <div className="ed-chips">
            {(Object.keys(names) as PoolName[]).map(k => (
              <button key={k} type="button" className={`ed-chip mono ${p.sets[k] ? 'on' : ''}`} aria-pressed={p.sets[k]} onClick={() => update({ sets: { ...p.sets, [k]: !p.sets[k] } })}>{names[k]}</button>
            ))}
          </div>
          <span className="faint" style={{ fontSize: 11.5 }}>sem caracteres que se confundem (l, 1, I, O, 0)</span>
        </>
      )}
      {p.mode === 'frase' && (
        <>
          <label className="slider">
            <span>palavras</span>
            <input type="range" min={4} max={10} value={p.words} onChange={e => update({ words: +e.target.value })} />
            <b className="mono">{p.words}</b>
          </label>
          <div className="ed-chips">
            {[['-', 'hífen'], ['.', 'ponto'], ['_', 'sublinhado'], [' ', 'espaço']].map(([s, label]) => (
              <button key={label} type="button" className={`ed-chip ${p.sep === s ? 'on' : ''}`} onClick={() => update({ sep: s })}>{label}</button>
            ))}
            <button type="button" className={`ed-chip ${p.caps ? 'on' : ''}`} aria-pressed={p.caps} onClick={() => update({ caps: !p.caps })}>Maiúsculas</button>
            <button type="button" className={`ed-chip ${p.num ? 'on' : ''}`} aria-pressed={p.num} onClick={() => update({ num: !p.num })}>+ número</button>
          </div>
        </>
      )}
      {p.mode === 'pin' && (
        <label className="slider">
          <span>dígitos</span>
          <input type="range" min={4} max={12} value={p.pin} onChange={e => update({ pin: +e.target.value })} />
          <b className="mono">{p.pin}</b>
        </label>
      )}

      <div className="forge-actions">
        {onUse && <button type="button" className="btn btn-solid" onClick={() => onUse(pw)}>Usar esta</button>}
        <button type="button" className={`btn ${onUse ? '' : 'btn-solid'}`} onClick={() => onCopy(pw)}>Copiar</button>
      </div>

      {!compact && history.length > 0 && (
        <div className="forge-history">
          <span className="label">anteriores · somem ao fechar</span>
          {history.map(h => (
            <button key={h} type="button" className="forge-old mono" onClick={() => onCopy(h)} title="Copiar">{h}</button>
          ))}
        </div>
      )}
    </div>
  );
}
