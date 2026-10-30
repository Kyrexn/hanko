import { useMemo, useState } from 'react';
import { breachCount, reusedIds, strength, vaultHealth } from '../core/passwords';
import type { Item } from '../core/types';
import { formatCode, isHotp } from '../core/totp';
import { useItemActions } from './actions';
import { useNow, useTotp } from './hooks';
import { activeItems, ago, greeting, subtitle } from './model';
import { Avatar, Enso, Logo, Seal, useToast } from './ui';
import { CountUp } from './fx';
import { Icon, Ring } from './glyphs';
import { PasswordForge } from './generator';
import { useVault } from './vault';

export type View = 'vault' | 'codes' | 'forge' | 'health' | 'settings';

/* ---------- Código 2FA em cartão ---------- */

export function OtpCard({ item, now, online, onCopy, onOpen, delay = 0 }: {
  item: Item; now: number; online: boolean; onCopy(code: string, it: Item): void; onOpen?(id: string): void; delay?: number;
}) {
  const t = useTotp(item.otp, now);
  const act = useItemActions();
  const [hcode, setHcode] = useState('');
  const urgent = !!t && t.left <= 5;
  const p = t && item.otp ? t.left / item.otp.period : 0;
  if (isHotp(item.otp)) {
    return (
      <div className="otp-card hotp" style={{ animationDelay: `${Math.min(delay, 12) * 0.04}s` }}>
        <button className="otp-card-main" title="Gerar o próximo código e copiar"
          onClick={async () => { const c = await act.nextHotp(item); setHcode(c); onCopy(c, item); }}>
          <span className="otp-card-head">
            <Avatar name={item.name} url={item.url} size={28} online={online} />
            <span className="otp-card-name">{item.name}</span>
            <span className="tag gold">HOTP</span>
          </span>
          <span key={hcode} className="otp-code code-flip otp-card-code">{hcode ? formatCode(hcode) : '··· ···'}</span>
          <span className="otp-card-foot">
            <span>{item.username || subtitle(item) || '—'}</span>
            <span className="mono">{hcode ? 'copiado' : 'tocar para gerar'}</span>
          </span>
        </button>
        {onOpen && <button className="otp-card-open" onClick={() => onOpen(item.id)} title="Abrir item" aria-label={`Abrir ${item.name}`}><Icon name="chevron" size={14} /></button>}
      </div>
    );
  }
  return (
    <div className={`otp-card ${urgent ? 'urgent' : ''}`} style={{ animationDelay: `${Math.min(delay, 12) * 0.04}s` }}>
      <button className="otp-card-main" onClick={() => t && onCopy(t.code.replace(/\s/g, ''), item)} title="Copiar código">
        <span className="otp-card-head">
          <Avatar name={item.name} url={item.url} size={28} online={online} />
          <span className="otp-card-name">{item.name}</span>
          <Ring progress={p} size={24} urgent={urgent} />
        </span>
        <span key={t?.counter} className="otp-code code-flip otp-card-code">{t?.code || '··· ···'}</span>
        <span className="otp-card-foot">
          <span>{item.username || subtitle(item) || '—'}</span>
          <span className="mono">{t ? `${t.left}s` : ''}</span>
        </span>
      </button>
      {onOpen && <button className="otp-card-open" onClick={() => onOpen(item.id)} title="Abrir item" aria-label={`Abrir ${item.name}`}><Icon name="chevron" size={14} /></button>}
    </div>
  );
}

/* ---------- Painel inicial (nenhum item aberto) ---------- */

export function Overview({ onOpen, onNew, onGo, onCopy, onImport }: {
  onOpen(id: string): void; onNew(): void; onGo(v: View): void; onCopy(code: string, it: Item): void; onImport(): void;
}) {
  const vault = useVault();
  const data = vault.data!;
  const now = useNow();
  const active = useMemo(() => activeItems(data), [data]);
  const health = useMemo(() => vaultHealth(active, data.breached), [active, data.breached]);
  const codes = active.filter(i => i.otp).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || a.name.localeCompare(b.name, 'pt-BR'));
  const recent = active.filter(i => i.lastUsed).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).slice(0, 5);
  const g = greeting(new Date(now));
  const issues = health.weak.length + health.reused.length + health.breached.length;
  const backupDue = active.length > 0 && (!data.lastBackup || data.lastChange > data.lastBackup);

  if (!active.length) {
    return (
      <div className="stage-pad overview empty">
        <Enso size={260} progress={null} filterId="rough-empty"><Logo size={96} className="logo-stamp" /></Enso>
        <span className="eyebrow">{g.when}</span>
        <h1 className="stage-title">O cofre está pronto.</h1>
        <p className="muted lead">Guarde a primeira senha ou traga tudo de outro gerenciador. Tudo é cifrado aqui, antes de sair do aparelho.</p>
        <div className="row-actions">
          <button className="btn btn-solid" onClick={onNew}><Icon name="plus" /> Guardar a primeira</button>
          <button className="btn" onClick={onImport}><Icon name="upload" /> Importar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stage-pad overview">
      <header className="stage-head">
        <span className="eyebrow">{g.when}</span>
        <h1 className="stage-title">{g.title}</h1>
      </header>

      {!vault.hasKit && (
        <div className="banner danger">
          <Seal size={30}>急</Seal>
          <span>Seu cofre ainda não tem <b>Kit de Emergência</b>. Sem ele, esquecer a senha mestra significa perder tudo.</span>
          <button className="btn btn-solid btn-sm" onClick={() => onGo('settings')}>Gerar kit</button>
        </div>
      )}
      {vault.hasKit && backupDue && (
        <div className="banner">
          <Seal size={30}>控</Seal>
          <span>{data.lastBackup ? 'Há mudanças sem cópia de segurança.' : 'Você ainda não fez uma cópia de segurança do cofre.'}</span>
          <button className="btn btn-sm" onClick={() => onGo('settings')}>Fazer backup</button>
        </div>
      )}

      <div className="tiles">
        <button className="tile" onClick={() => onGo('vault')}>
          <span className="tile-kanji">蔵</span>
          <span className="tile-num"><CountUp value={active.length} /></span>
          <span className="tile-label">itens guardados</span>
        </button>
        <button className="tile" onClick={() => onGo('codes')}>
          <span className="tile-kanji">符</span>
          <span className="tile-num"><CountUp value={codes.length} /></span>
          <span className="tile-label">códigos 2FA</span>
        </button>
        <button className={`tile ${health.breached.length ? 'alert' : ''}`} onClick={() => onGo('health')}>
          <span className="tile-kanji">診</span>
          <span className="tile-num"><CountUp value={health.score} /><small>/100</small></span>
          <span className="tile-label">{issues ? `${issues} senha(s) para rever` : 'saúde do cofre · sereno'}</span>
        </button>
      </div>

      {codes.length > 0 && (
        <section className="block">
          <div className="block-head">
            <h2>Códigos ao vivo</h2>
            {codes.length > 6 && <button className="link" onClick={() => onGo('codes')}>ver todos ({codes.length}) <Icon name="chevron" size={13} /></button>}
          </div>
          <div className="otp-grid">
            {codes.slice(0, 6).map((it, i) => <OtpCard key={it.id} item={it} now={now} delay={i} online={data.settings.onlineIcons} onCopy={onCopy} onOpen={onOpen} />)}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="block">
          <div className="block-head"><h2>Usados recentemente</h2></div>
          <div className="recent">
            {recent.map(it => (
              <button key={it.id} className="recent-item" onClick={() => onOpen(it.id)}>
                <Avatar name={it.name} url={it.url} size={34} online={data.settings.onlineIcons} />
                <span className="recent-text"><b>{it.name}</b><span>{subtitle(it) || '—'}</span></span>
                <span className="mono faint">{ago(it.lastUsed)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------- Mural de códigos 2FA ---------- */

export function CodesBoard({ onCopy, onOpen, onNew }: { onCopy(code: string, it: Item): void; onOpen(id: string): void; onNew(): void }) {
  const data = useVault().data!;
  const now = useNow();
  const [q, setQ] = useState('');
  const qq = q.trim().toLowerCase();
  const codes = activeItems(data).filter(i => i.otp)
    .filter(i => !qq || `${i.name} ${i.username} ${i.url}`.toLowerCase().includes(qq))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'pt-BR'));
  return (
    <div className="stage-pad">
      <header className="stage-head with-tools">
        <div>
          <span className="eyebrow">符 · autenticação em duas etapas</span>
          <h1 className="stage-title">Códigos</h1>
        </div>
        <label className="field-search compact">
          <Icon name="search" />
          <input placeholder="filtrar códigos" value={q} onChange={e => setQ(e.target.value)} aria-label="Filtrar códigos" />
        </label>
      </header>
      {codes.length ? (
        <div className="otp-grid wide">
          {codes.map((it, i) => <OtpCard key={it.id} item={it} now={now} delay={i} online={data.settings.onlineIcons} onCopy={onCopy} onOpen={onOpen} />)}
        </div>
      ) : (
        <div className="empty-note">
          <span className="empty-kanji">符</span>
          <p>{qq ? 'Nenhum código com esse nome.' : 'Nenhuma conta com 2FA ainda. Ao editar uma conta, cole a chave ou a imagem do QR code.'}</p>
          {!qq && <button className="btn" onClick={onNew}><Icon name="plus" /> Novo item</button>}
        </div>
      )}
    </div>
  );
}

/* ---------- Saúde do cofre ---------- */

/** Confere as senhas no Have I Been Pwned (só 5 caracteres do hash saem do aparelho). */
export function useBreachCheck() {
  const vault = useVault();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  async function run() {
    const logins = activeItems(vault.data!).filter(i => i.kind === 'login' && i.password);
    const found: Record<string, number> = {};
    setBusy(true);
    try {
      for (let k = 0; k < logins.length; k++) {
        setProgress(`verificando ${k + 1} de ${logins.length}…`);
        const n = await breachCount(logins[k].password);
        if (n > 0) found[logins[k].id] = n;
      }
      await vault.update(d => { d.breached = found; d.lastBreachCheck = Date.now(); });
      const c = Object.keys(found).length;
      setProgress(c ? `${c} senha(s) apareceram em vazamentos. Troque-as.` : 'Nenhuma senha apareceu em vazamentos.');
      toast.show(c ? '危' : '安', c ? `${c} senha(s) vazada(s)` : 'Nenhuma senha vazada');
    } catch {
      setProgress('Sem conexão com o serviço de verificação. Tente mais tarde.');
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, progress };
}

export function HealthPage({ onOpen }: { onOpen(id: string): void }) {
  const vault = useVault();
  const data = vault.data!;
  const active = useMemo(() => activeItems(data), [data]);
  const health = useMemo(() => vaultHealth(active, data.breached), [active, data.breached]);
  const reused = useMemo(() => reusedIds(active), [active]);
  const check = useBreachCheck();
  const [tab, setTab] = useState<'breached' | 'weak' | 'reused' | 'tfa'>(health.breached.length ? 'breached' : health.weak.length ? 'weak' : health.reused.length ? 'reused' : 'tfa');
  const lists = { breached: health.breached, weak: health.weak, reused: health.reused, tfa: health.withoutTfa };
  const names = { breached: 'Vazadas', weak: 'Fracas', reused: 'Repetidas', tfa: 'Sem 2FA' };
  const why = (i: Item) => {
    if (tab === 'breached') return `apareceu ${data.breached[i.id]?.toLocaleString('pt-BR')} vez(es) em vazamentos`;
    if (tab === 'weak') return `força ${strength(i.password).label} · ${strength(i.password).bits} bits`;
    if (tab === 'reused') return `mesma senha em ${active.filter(x => x.password === i.password && reused.has(x.id)).length} contas`;
    return 'ative o 2FA no site e guarde a chave aqui';
  };
  const tone = health.score >= 85 ? 'sereno' : health.score >= 60 ? 'atenção' : 'cuidar hoje';
  return (
    <div className="stage-pad">
      <header className="stage-head">
        <span className="eyebrow">診 · diagnóstico</span>
        <h1 className="stage-title">Saúde do cofre</h1>
      </header>
      <div className="health-hero">
        <Enso size={210} progress={health.score / 100} filterId="rough-health">
          <span className="health-score"><CountUp value={health.score} /></span>
          <span className="eyebrow">{tone}</span>
        </Enso>
        <div className="health-side">
          <div className="health-stats">
            {(Object.keys(lists) as (keyof typeof lists)[]).map(k => (
              <button key={k} className={`hstat ${tab === k ? 'on' : ''} ${k === 'breached' && lists[k].length ? 'alert' : ''}`} onClick={() => setTab(k)}>
                <b>{lists[k].length}</b><span>{names[k]}</span>
              </button>
            ))}
          </div>
          <div className="breach-box">
            <span className="muted">Confere as senhas na base pública Have I Been Pwned. Só 5 caracteres de um resumo (hash) de cada senha saem do aparelho — a senha nunca é enviada.</span>
            <div className="row-actions">
              <button className="btn" disabled={check.busy} onClick={check.run}><Icon name="shield" /> {check.busy ? 'Verificando…' : 'Verificar vazamentos'}</button>
              <span className="faint small">{check.progress || (data.lastBreachCheck ? `última verificação: ${new Date(data.lastBreachCheck).toLocaleDateString('pt-BR')}` : 'nunca verificado')}</span>
            </div>
          </div>
        </div>
      </div>
      <section className="block">
        <div className="block-head"><h2>{names[tab]}</h2><span className="faint small">{lists[tab].length} conta(s)</span></div>
        {lists[tab].length ? (
          <div className="recent">
            {lists[tab].map(it => (
              <button key={it.id} className="recent-item" onClick={() => onOpen(it.id)}>
                <Avatar name={it.name} url={it.url} size={34} online={data.settings.onlineIcons} />
                <span className="recent-text"><b>{it.name}</b><span>{why(it)}</span></span>
                <span className="link small">abrir <Icon name="chevron" size={12} /></span>
              </button>
            ))}
          </div>
        ) : <p className="faint">Nada aqui. 安</p>}
      </section>
    </div>
  );
}

/* ---------- Forja de senhas em página ---------- */

export function ForgePage({ onCopy }: { onCopy(p: string): void }) {
  return (
    <div className="stage-pad forge-page">
      <header className="stage-head">
        <span className="eyebrow">鍛 · forja</span>
        <h1 className="stage-title">Gerador de senhas</h1>
        <p className="muted lead">Cada senha é sorteada aqui, com o gerador criptográfico do sistema. Nada é salvo até você usar.</p>
      </header>
      <div className="panel forge-panel"><PasswordForge onCopy={onCopy} /></div>
    </div>
  );
}
