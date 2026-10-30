import { useEffect, useState } from 'react';
import { checkForUpdate, type UpdateInfo } from './updates';
import { Icon } from './glyphs';
import { Seal, useToast } from './ui';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const SEEN = 'hanko-versao';

/**
 * Atualizações sem interromper:
 * • Windows: a versão nova já vem baixada e verificada; um aviso discreto diz que ela instala sozinha ao fechar.
 * • Android: um toque baixa o APK e abre o instalador do sistema.
 * Depois de atualizar, um aviso curto confirma a versão nova.
 */
export function UpdateBanner() {
  const toast = useToast();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const run = () => checkForUpdate().then(i => { if (i) { setInfo(i); setHidden(false); } }).catch(() => {});
    const first = setTimeout(run, 5000); // deixa o app abrir primeiro
    const t = setInterval(run, SIX_HOURS);
    return () => { clearTimeout(first); clearInterval(t); };
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

  if (!info || hidden) return null;

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
  return (
    <div className="update-pill" role="status">
      <Seal size={30} style={{ fontSize: 15, animationDelay: '0s' }}>新</Seal>
      <div className="update-pill-text">
        <b>Hanko {info.version} {desktop ? 'pronto' : 'disponível'}</b>
        <span>{err || (desktop ? 'Instala sozinho, em silêncio, quando você fechar o app.'
          : busy ? (pct === null ? 'baixando…' : `baixando… ${pct}%`) : info.notes || 'Toque para baixar e instalar.')}</span>
      </div>
      <button className="btn btn-sm" disabled={busy} onClick={install}>{desktop ? 'Reiniciar agora' : busy ? 'Baixando…' : 'Atualizar'}</button>
      <button className="icon-btn ghost" onClick={() => setHidden(true)} aria-label="Fechar aviso"><Icon name="close" size={14} /></button>
    </div>
  );
}
