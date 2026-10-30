// Atualizações: o manifesto e os instaladores ficam na área pública "updates" do Supabase.
// • Windows: baixa e confere a assinatura em segundo plano; instala em silêncio quando o Hanko fecha.
// • Android: avisa e abre o download do APK novo (o Android sempre pede confirmação para instalar).

const SUPABASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const UPDATES_BASE = SUPABASE ? `${SUPABASE}/storage/v1/object/public/updates` : '';

export interface MobileManifest {
  android?: { version: string; url: string; notes?: string };
  extension?: { version: string; url: string; notes?: string };
}

export interface UpdateInfo {
  version: string;
  notes: string;
  /** 'desktop': já baixada e verificada — instala ao fechar (ou agora, reiniciando). */
  kind: 'desktop' | 'android';
  install(onProgress: (pct: number | null) => void): Promise<void>;
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const isAndroid = () => /Android/i.test(navigator.userAgent);

/** "0.10.1" > "0.9.3" */
export function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split('.').map(n => parseInt(n, 10) || 0);
  const b = current.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

export async function fetchMobileManifest(): Promise<MobileManifest | null> {
  if (!UPDATES_BASE) return null;
  const res = await fetch(`${UPDATES_BASE}/mobile.json?t=${Date.now()}`, { cache: 'no-store' });
  return res.ok ? (res.json() as Promise<MobileManifest>) : null;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri() || !UPDATES_BASE) return null;

  if (isAndroid()) {
    const [{ getVersion }, { openUrl }, m] = await Promise.all([
      import('@tauri-apps/api/app'), import('@tauri-apps/plugin-opener'), fetchMobileManifest()
    ]);
    const current = await getVersion();
    if (!m?.android || !isNewer(m.android.version, current)) return null;
    const a = m.android;
    return {
      version: a.version, notes: a.notes || '', kind: 'android',
      install: async onProgress => {
        const { androidInstallUpdate } = await import('./native');
        if (!(await androidInstallUpdate(a.url, onProgress))) await openUrl(a.url); // versões antigas: abre o download
      }
    };
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const ready = await invoke<{ version: string; notes: string } | null>('update_prepare');
  if (!ready) return null;
  return {
    version: ready.version,
    notes: ready.notes,
    kind: 'desktop',
    async install(onProgress) {
      onProgress(100);
      await invoke('update_apply_now');
    }
  };
}
