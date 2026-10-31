import { useEffect, useState } from 'react';
import { checkForUpdate, type UpdateInfo } from './updates';
import { Icon, Ring } from './glyphs';
import { useToast } from './ui';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const SEEN = 'hanko-versao';
const mb = (n: number) => (n / 1_048_576).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type Dl = { done: number; total: number; version: string };

/**
 * Atualizações sem interromper, com progresso real (bytes baixados de verdade):
 * • Windows: baixa e verifica em segundo plano; depois instala sozinho ao fechar (ou "Reiniciar agora").
 * • Android: um toque baixa o APK oficial e abre o instalador do sistema.
 */
export function UpdateBanner() {
  const toast = useToast();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dl, setDl] = useState<Dl | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const run = () => checkForUpdate().then(i => { if (i) { setInfo(i); setDl(null); } }).catch(() => setDl(null));
    const first = setTimeout(run, 5000); // deixa o app abrir primeiro
    const t = setInterval(run, SIX_HOURS);
    // Windows: progresso real do download em segundo plano.
    let off: (() => void) | undefined;
    if ('__TAURI_INTERNALS__' in window && !/Android/i.test(navigator.userAgent)) {
      import('@tauri-apps/api/event').then(({ listen }) => listen<[number, number, string]>('update-progress', e => {
        const [done, total, version] = e.payload;
        setDl({ done, total, version });
      })).then(u => { off = u; }).catch(() => {});
    }
    return () => { clearTimeout(first); clearInterval(t); off?.(); };
  }, []);

  // "Atualizado para a versão X" na primeira abertura depois de uma atualização.
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()).then(v => {
      let last: string | null = null;
      try { last = localStorage.getItem(SEEN); localStorage.setItem(SEEN, v); } catch { /* sem armazenamento */ }
      if (last && last !== v) setTimeout(() => toast.show('新', `Hanko atualizado para a versão ${v}`), 2500);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden) return null;

  // Baixando em segundo plano (Windows), antes de ficar pronta.
  if (!info && dl) {
    const p = dl.total ? (dl.done / dl.total) * 100 : 0;
    return (
      <div className="update-pill downloading" role="status">
        <span className="update-ring"><Ring progress={p / 100} size={40} stroke={3} /><b>{Math.floor(p)}%</b></span>
        <div className="update-pill-text">
          <b>Baixando o Hanko {dl.version}</b>
          <span>{dl.total ? `${mb(dl.done)} de ${mb(dl.total)} MB · em segundo plano` : 'preparando…'}</span>
          <span className="update-bar"><i style={{ width: `${p}%` }} /></span>
        </div>
        <button className="icon-btn ghost" onClick={() => setHidden(true)} aria-label="Esconder aviso"><Icon name="close" size={14} /></button>
      </div>
    );
  }
  if (!info) return null;

  async function install() {
    setErr('');
    setBusy(true);
    try {
      await info!.install(setPct);
      if (info!.kind === 'android') setHidden(true);
    } catch (e) {
      setErr((e as Error).message || 'Não consegui atualizar agora.');
    } finally {
      setBusy(false);
    }
  }

  const desktop = info.kind === 'desktop';
  const showPct = busy && pct !== null;
  return (
    <div className={`update-pill ${desktop ? 'ready' : ''}`} role="status">
      <span className="update-ring">
        <Ring progress={desktop ? 1 : (pct || 0) / 100} size={40} stroke={3} />
        <b>{showPct ? `${pct}%` : '新'}</b>
      </span>
      <div className="update-pill-text">
        <b>Hanko {info.version} {desktop ? 'pronto' : 'disponível'}</b>
        <span>{err || (desktop ? 'Baixado e verificado. Instala sozinho, em silêncio, quando você fechar o app.'
          : busy ? (pct === null ? 'baixando…' : `baixando… ${pct}%`) : info.notes || 'Um toque baixa e abre o instalador.')}</span>
        {busy && !desktop && <span className="update-bar"><i style={{ width: `${pct || 0}%` }} /></span>}
      </div>
      <button className="btn btn-sm btn-solid" disabled={busy} onClick={install}>{desktop ? 'Reiniciar agora' : busy ? 'Baixando…' : 'Atualizar'}</button>
      <button className="icon-btn ghost" onClick={() => setHidden(true)} aria-label="Fechar aviso"><Icon name="close" size={14} /></button>
    </div>
  );
}
