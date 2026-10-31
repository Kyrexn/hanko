// Plugin do Vite que deixa as fontes enxutas (o instalador do Windows precisa caber em 50 MB):
// • só o formato woff2 (o WebView2 e o WebView do Android usam esse; o .woff antigo nunca é baixado);
// • das fontes japonesas, só os blocos que têm algum ideograma realmente escrito no código do app.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Todos os caracteres não latinos usados nos arquivos de `dirs` (ideogramas, kana etc.). */
function usedChars(dirs: string[]): Set<number> {
  const out = new Set<number>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css|html)$/.test(name)) for (const ch of readFileSync(p, 'utf8')) { const cp = ch.codePointAt(0)!; if (cp > 0x2e7f) out.add(cp); }
    }
  };
  dirs.forEach(walk);
  return out;
}

function inRange(range: string, used: Set<number>): boolean {
  return range.split(',').some(part => {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-').map(x => parseInt(x, 16));
    const hi = b ?? a;
    if (hi < 0x2e80) return true; // blocos latinos e de pontuação ficam sempre
    for (const cp of used) if (cp >= a && cp <= hi) return true;
    return false;
  });
}

export function fontSubset(srcDirs: string[]): Plugin {
  let used: Set<number>;
  return {
    name: 'hanko-font-subset',
    enforce: 'pre',
    buildStart() { used = usedChars(srcDirs); },
    transform(code, id) {
      if (!/@fontsource[\\/].+\.css$/.test(id)) return null;
      used ??= usedChars(srcDirs);
      const blocks = code.split(/(?=\/\*[^*]*\*\/\s*@font-face)|(?=@font-face)/);
      const kept = blocks.filter(b => {
        if (!b.includes('@font-face')) return true;
        const range = (b.match(/unicode-range:\s*([^;]+);/) || [])[1];
        return !range || inRange(range, used);
      }).map(b => b.replace(/,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g, ''));
      return { code: kept.join(''), map: null };
    }
  };
}
