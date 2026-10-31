// Site do Hanko: downloads sempre na versão publicada (lidos dos manifestos de atualização),
// botão principal para o sistema de quem visita e a miniatura do app "viva".
const UPDATES = 'https://kldvivevydcbjhveqibf.supabase.co/storage/v1/object/public/updates';

/* ---------- Folhas de ouro caindo ---------- */
(() => {
  const host = document.getElementById('leaves');
  if (!host || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < 16; i++) {
    const l = document.createElement('i');
    l.className = 'leaf' + (i % 4 === 0 ? ' red' : '');
    l.style.left = `${(i * 61) % 100}%`;
    l.style.animationDuration = `${18 + (i % 5) * 5}s`;
    l.style.animationDelay = `${-((i * 2.9) % 24)}s`;
    host.append(l);
  }
})();

/* ---------- Downloads ao vivo ---------- */
const mb = n => `${(n / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}00a0MB`;
const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

async function size(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const n = Number(r.headers.get('content-length'));
    return n > 0 ? mb(n) : '';
  } catch { return ''; }
}

function setLink(kind, url) {
  document.querySelectorAll(`[data-href="${kind}"]`).forEach(a => { a.href = url; a.setAttribute('download', ''); });
}

async function loadDownloads() {
  try {
    const [latest, mobile] = await Promise.all([
      fetch(`${UPDATES}/latest.json`, { cache: 'no-store' }).then(r => r.json()),
      fetch(`${UPDATES}/mobile.json`, { cache: 'no-store' }).then(r => r.json())
    ]);
    const win = latest.platforms?.['windows-x86_64']?.url;
    const items = {
      windows: win && { version: latest.version, url: win, date: latest.pub_date },
      android: mobile.android && { ...mobile.android, date: latest.pub_date },
      extension: mobile.extension && { ...mobile.extension, date: latest.pub_date }
    };
    for (const [kind, it] of Object.entries(items)) {
      const meta = document.querySelector(`[data-meta="${kind}"]`);
      if (!it) { if (meta) meta.textContent = 'em breve'; continue; }
      setLink(kind, it.url);
      if (meta) meta.textContent = `versão ${it.version}${it.date ? ` · ${fmtDate(it.date)}` : ''}`;
      size(it.url).then(s => { if (s && meta) meta.textContent += ` · ${s}`; });
    }
    document.getElementById('hero-ver').textContent = `versão ${latest.version} · publicada em ${fmtDate(latest.pub_date)}`;
    primary(items);
  } catch {
    document.querySelectorAll('.dl-meta').forEach(m => { m.textContent = 'não consegui buscar a versão agora — tente recarregar'; });
  }
}

/* Botão principal: Windows ou Android conforme o aparelho de quem visita. */
function primary(items) {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'android' : /Windows/i.test(ua) ? 'windows' : null;
  const btn = document.getElementById('primary');
  if (!os || !items[os]) return;
  document.getElementById(os === 'android' ? 'dl-android' : 'dl-windows')?.classList.add('here');
  btn.href = items[os].url;
  btn.setAttribute('download', '');
  document.getElementById('primary-k').textContent = os === 'android' ? '携' : '窓';
  document.getElementById('primary-label').textContent = os === 'android' ? 'Baixar para Android' : 'Baixar para Windows';
  document.getElementById('primary-sub').textContent = `versão ${items[os].version} · grátis`;
}

/* ---------- Miniatura: código 2FA de mentira, girando como no app ---------- */
(() => {
  const code = document.getElementById('mock-code'), left = document.getElementById('mock-left'), arc = document.getElementById('mock-arc');
  if (!code) return;
  const fresh = () => { const n = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); code.textContent = `${n.slice(0, 3)} ${n.slice(3)}`; };
  const tick = () => {
    const s = 30 - (Math.floor(Date.now() / 1000) % 30);
    left.textContent = s;
    arc.setAttribute('stroke-dashoffset', String(100 - (s / 30) * 100));
    arc.setAttribute('stroke', s <= 5 ? '#E0533F' : '#C9A45C');
    if (s === 30) fresh();
  };
  fresh(); tick(); setInterval(tick, 1000);
})();

/* ---------- Seções aparecem ao rolar ---------- */
(() => {
  const els = document.querySelectorAll('.section > *, .feat, .dl, .flow li');
  if (!('IntersectionObserver' in window)) return;
  els.forEach(e => e.classList.add('reveal'));
  const io = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.12 });
  els.forEach((e, i) => { e.style.transitionDelay = `${(i % 4) * 60}ms`; io.observe(e); });
})();

loadDownloads();
