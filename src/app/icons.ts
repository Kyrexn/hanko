// Ícone automático de cada conta:
// 1º) logo oficial da marca pela biblioteca Simple Icons (offline, livre, mais de 3 mil marcas);
// 2º) favicon do próprio site via DuckDuckGo (opcional, desligável nas configurações);
// 3º) inicial do nome escrita a pincel.

export interface BrandIcon {
  title: string;
  path: string;
  hex: string;
}

let index: Map<string, BrandIcon> | null = null;
let loading: Promise<Map<string, BrandIcon>> | null = null;

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export function loadBrandIndex(): Promise<Map<string, BrandIcon>> {
  if (index) return Promise.resolve(index);
  if (!loading) {
    loading = import('simple-icons').then(mod => {
      const map = new Map<string, BrandIcon>();
      for (const v of Object.values(mod) as unknown[]) {
        const icon = v as { title?: string; slug?: string; path?: string; hex?: string };
        if (!icon || typeof icon.path !== 'string' || !icon.title || !icon.slug) continue;
        const entry = { title: icon.title, path: icon.path, hex: icon.hex || 'E9E4D8' };
        map.set(icon.slug, entry);
        if (!map.has(norm(icon.title))) map.set(norm(icon.title), entry);
      }
      index = map;
      return map;
    });
  }
  return loading;
}

// Domínios que não batem com o nome da marca.
const ALIASES: Record<string, string> = {
  live: 'microsoft', outlook: 'microsoftoutlook', hotmail: 'microsoftoutlook', office: 'microsoftoffice',
  accounts: '', login: '', www: '', app: '', my: '', auth: '', signin: '',
  steampowered: 'steam', nubank: 'nubank', mercadolivre: 'mercadopago', x: 'x', twitter: 'x',
  aws: 'amazonaws', icloud: 'icloud', apple: 'apple', gov: 'govbr'
};

export function domainOf(url: string): string {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function findBrand(map: Map<string, BrandIcon>, name: string, url: string): BrandIcon | null {
  const candidates: string[] = [];
  const n = norm(name);
  if (n) candidates.push(n, n.replace(/(de|da|do)?casa$/, ''));
  const host = domainOf(url);
  if (host) {
    const labels = host.split('.').slice(0, -1).reverse();
    for (const l of labels) {
      const a = l in ALIASES ? ALIASES[l] : l;
      if (a) candidates.push(norm(a));
    }
  }
  for (const c of candidates) {
    const hit = c && map.get(c);
    if (hit) return hit;
  }
  return null;
}

export function faviconUrl(url: string): string | null {
  const host = domainOf(url);
  return host && host.includes('.') ? `https://icons.duckduckgo.com/ip3/${host}.ico` : null;
}
