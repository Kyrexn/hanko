import { useEffect, useState } from 'react';
import { formatCode, totp } from '../core/totp';
import type { OtpParams } from '../core/types';

/** Relógio que atualiza a cada `ms` (padrão: 1 s). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const cache = new Map<string, string>();

/** Código 2FA atual já formatado ("482 913"); recalcula só quando o período vira. */
export function useTotp(otp: OtpParams | null, now: number): { code: string; left: number; counter: number } | null {
  if (otp?.type === 'hotp') otp = null; // código por contador não muda com o tempo
  const period = otp?.period || 30;
  const counter = Math.floor(now / 1000 / period);
  const key = otp ? `${otp.secret}:${otp.digits}:${otp.algorithm}:${period}:${counter}` : '';
  const [code, setCode] = useState(() => cache.get(key) || '');
  useEffect(() => {
    if (!otp) return;
    const hit = cache.get(key);
    if (hit) { setCode(hit); return; }
    let alive = true;
    totp(otp, counter * period * 1000)
      .then(c => { const f = formatCode(c); cache.set(key, f); if (alive) setCode(f); })
      .catch(() => alive && setCode('erro'));
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!otp) return null;
  return { code: cache.get(key) || code, left: period - Math.floor((now / 1000) % period), counter };
}

/** Bloqueia o cofre após `minutes` sem interação. */
export function useIdleLock(minutes: number, onIdle: () => void) {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(t); t = setTimeout(onIdle, minutes * 60_000); };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    evs.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(t); evs.forEach(e => window.removeEventListener(e, reset)); };
  }, [minutes, onIdle]);
}
