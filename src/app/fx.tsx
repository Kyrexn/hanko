import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Enso, Logo } from './ui';

/** Tela de abertura: o ensō se pinta e o nome Hanko aparece em tinta; some sozinha. */
export function Splash() {
  const [gone, setGone] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGone(true), 2200); return () => clearTimeout(t); }, []);
  if (gone) return null;
  return (
    <div className="splash" aria-hidden="true">
      <div className="splash-mark">
        <Enso size={240} progress={null} filterId="rough-splash"><Logo size={104} className="logo-stamp" style={{ animationDelay: '.55s' }} /></Enso>
        <span className="word">Hanko</span>
      </div>
    </div>
  );
}

/** Fecha com a animação de enrolar antes de desmontar. */
export function useClosing(onClose: () => void, ms = 320): [boolean, () => void] {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    timer.current = setTimeout(onClose, ms);
  }, [closing, onClose, ms]);
  return [closing, close];
}

/** Número que conta até o valor (a nota de saúde do cofre). */
export function CountUp({ value, ms = 900 }: { value: number; ms?: number }) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setN(Math.round(a + (value - a) * eased));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{n}</>;
}

/** Brilho que segue o mouse nos botões principais. */
export function useButtonGlow() {
  useEffect(() => {
    const on = (e: PointerEvent) => {
      const b = (e.target as HTMLElement | null)?.closest?.('.btn-solid') as HTMLElement | null;
      if (!b) return;
      const r = b.getBoundingClientRect();
      b.style.setProperty('--x', `${e.clientX - r.left}px`);
      b.style.setProperty('--y', `${e.clientY - r.top}px`);
    };
    window.addEventListener('pointermove', on, { passive: true });
    return () => window.removeEventListener('pointermove', on);
  }, []);
}

/** Lista de navegação com uma mancha de tinta que desliza até o item ativo (`data-id` em cada filho). */
export function InkList({ active, children }: { active: string | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = active ? ref.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(active)}"]`) : null;
    const top = el?.offsetTop ?? -1, height = el?.offsetHeight ?? 0;
    setPos(p => (el ? (p && p.top === top && p.height === height ? p : { top, height }) : null));
  });
  return (
    <div ref={ref} className="ink-list">
      <span className="ink-pill" style={pos ? { transform: `translateY(${pos.top}px)`, height: pos.height, opacity: 1 } : { opacity: 0 }} aria-hidden="true" />
      {children}
    </div>
  );
}

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

/** Ícones de traço fino (pincel) para as categorias. */
export function CatIcon({ id }: { id: string }) {
  const paths: Record<string, JSX.Element> = {
    all: <><rect x="3" y="3" width="7" height="7" rx="1.5" {...P} /><rect x="14" y="3" width="7" height="7" rx="1.5" {...P} /><rect x="3" y="14" width="7" height="7" rx="1.5" {...P} /><rect x="14" y="14" width="7" height="7" rx="1.5" {...P} /></>,
    fav: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.2 1 5.8L12 17l-5.2 2.7 1-5.8-4.3-4.2 5.9-.9z" {...P} />,
    login: <><circle cx="8" cy="12" r="4" {...P} /><path d="M12 12h9M18 12v3M21 12v2" {...P} /></>,
    tfa: <><circle cx="12" cy="12" r="8.5" {...P} /><path d="M12 7.5V12l3 2" {...P} /></>,
    card: <><rect x="2.5" y="5.5" width="19" height="13" rx="2" {...P} /><path d="M2.5 10h19M6 15h4" {...P} /></>,
    identity: <><circle cx="12" cy="8.5" r="3.5" {...P} /><path d="M5 20c1.3-3.6 4-5.3 7-5.3s5.7 1.7 7 5.3" {...P} /></>,
    note: <><path d="M6 3h9l4 4v14H6z" {...P} /><path d="M9 12h7M9 16h5" {...P} /></>,
    rec: <><rect x="3" y="5.5" width="18" height="13" rx="1.5" {...P} /><path d="M3 7l9 6 9-6" {...P} /></>,
    review: <><path d="M12 3.5l9.5 16.5h-19z" {...P} /><path d="M12 10v4.5M12 17.2v.3" {...P} /></>,
    trash: <><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" {...P} /></>
  };
  return <svg className="cat-ico" viewBox="0 0 24 24" aria-hidden="true">{paths[id] || paths.all}</svg>;
}
