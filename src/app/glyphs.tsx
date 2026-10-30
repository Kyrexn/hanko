import type { CSSProperties } from 'react';

/** Ícones de traço fino, no mesmo peso dos ícones de categoria. */
const PATHS: Record<string, string> = {
  copy: 'M9 9h10v11H9zM15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z',
  eyeOff: 'M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1M9.9 9.9a2.8 2.8 0 0 0 4.2 4.2',
  edit: 'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.2 1 5.8L12 17l-5.2 2.7 1-5.8-4.3-4.2 5.9-.9z',
  close: 'M5 5l14 14M19 5L5 19',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8',
  plus: 'M12 5v14M5 12h14',
  lock: 'M6 10.5h12v10H6zM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3',
  back: 'M15 5l-7 7 7 7',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5',
  folder: 'M3 6.5h6.5l2 2.5H21v10H3z',
  shield: 'M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevron: 'M9 6l6 6-6 6',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 13.5l5-5 5 5M5 4h14',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2',
  sync: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4'
};

export function Icon({ name, size = 16, style, className }: { name: keyof typeof PATHS | string; size?: number; style?: CSSProperties; className?: string }) {
  return (
    <svg className={`ico ${className || ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      <path d={PATHS[name] || PATHS.dots} />
    </svg>
  );
}

/** Anel de contagem regressiva do código 2FA (cheio = código novo). */
export function Ring({ progress, size = 22, stroke = 2, urgent = false }: { progress: number; size?: number; stroke?: number; urgent?: boolean }) {
  const r = size / 2 - stroke;
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      <circle className="arc" cx={size / 2} cy={size / 2} r={r} pathLength={100} fill="none" stroke={urgent ? 'var(--red)' : 'var(--gold)'}
        strokeWidth={stroke} strokeLinecap="round" strokeDasharray="100" strokeDashoffset={100 * (1 - progress)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}
