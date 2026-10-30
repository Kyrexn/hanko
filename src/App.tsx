import { useEffect, useRef, useState } from 'react';
import { Gate } from './app/Gate';
import { useIdleLock } from './app/hooks';
import { ConfirmProvider, Glows, Logo, Paper, ToastProvider } from './app/ui';
import { VaultProvider, useVault } from './app/vault';
import { VaultScreen } from './app/VaultScreen';
import { MobileScreen } from './app/MobileScreen';
import { UpdateBanner } from './app/UpdateBanner';
import { Splash, useButtonGlow } from './app/fx';
import { setScreenProtect } from './app/native';

// A proteção contra prints vale também na tela de desbloqueio: lembra a última escolha neste aparelho.
const SCREEN_KEY = 'hanko-tela-protegida';
try { if (localStorage.getItem(SCREEN_KEY) === '1') setScreenProtect(true); } catch { /* sem armazenamento */ }

function Screens() {
  const vault = useVault();
  const prev = useRef(vault.status);
  const [opening, setOpening] = useState(false);

  // Ao desbloquear, deixa o carimbo 開 aparecer por um instante antes de abrir o cofre.
  useEffect(() => {
    if (prev.current === 'locked' && vault.status === 'unlocked') {
      setOpening(true);
      const t = setTimeout(() => setOpening(false), 900);
      prev.current = vault.status;
      return () => clearTimeout(t);
    }
    prev.current = vault.status;
  }, [vault.status]);

  if (vault.status === 'loading') return null;
  const inside = vault.status === 'unlocked' && !opening;
  // A troca entre a entrada e o cofre aparece como tinta se espalhando.
  return (
    <div key={inside ? 'in' : 'gate'} className="screen-in" style={{ height: '100%' }}>
      {inside ? <Unlocked /> : <Gate opening={opening} />}
    </div>
  );
}

function useIsMobile() {
  const q = '(max-width: 760px)';
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

function Unlocked() {
  const vault = useVault();
  const mobile = useIsMobile();
  const { autoLockMinutes, lockOnHide, privacyBlur, screenProtect } = vault.data!.settings;
  useIdleLock(autoLockMinutes, vault.lock);
  const [veiled, setVeiled] = useState(false);

  useEffect(() => {
    setScreenProtect(screenProtect);
    try { localStorage.setItem(SCREEN_KEY, screenProtect ? '1' : '0'); } catch { /* sem armazenamento */ }
  }, [screenProtect]);

  // Bloquear ao minimizar / ir para segundo plano.
  useEffect(() => {
    if (!lockOnHide) return;
    const on = () => { if (document.hidden) vault.lock(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [lockOnHide, vault.lock]);

  // Embaçar quando a janela perde o foco (copiar com o diálogo do sistema aberto também conta).
  useEffect(() => {
    if (!privacyBlur) { setVeiled(false); return; }
    const off = () => setVeiled(true), on = () => setVeiled(false);
    window.addEventListener('blur', off);
    window.addEventListener('focus', on);
    return () => { window.removeEventListener('blur', off); window.removeEventListener('focus', on); };
  }, [privacyBlur]);

  return (
    <div className={`veil-host ${veiled ? 'veiled' : ''}`} style={{ height: '100%' }}>
      {mobile ? <MobileScreen /> : <VaultScreen />}
      {veiled && <div className="veil" aria-hidden="true"><Logo size={64} /><span className="label">protegido · clique para voltar</span></div>}
    </div>
  );
}

export default function App() {
  useButtonGlow();
  return (
    <ToastProvider>
      <ConfirmProvider>
      <VaultProvider>
        <Splash />
        <Glows />
        <Screens />
        <UpdateBanner />
        <Paper />
      </VaultProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
