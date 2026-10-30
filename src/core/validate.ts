// Validações puras usadas no editor (sem interface, testadas em validate.test.ts).

/** Domínio do endereço, sem protocolo, "www." nem caminho ("https://www.github.com/login" → "github.com"). */
export function hostOf(u: string): string {
  const s = u.trim();
  if (!s) return '';
  try { return new URL(/^[a-z][\w+.-]*:\/\//i.test(s) ? s : 'https://' + s).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return s.toLowerCase(); }
}

/** Dígito verificador de cartões (Luhn). */
export function luhn(num: string): boolean {
  const d = num.replace(/\D/g, '');
  if (d.length < 12) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = +d[d.length - 1 - i];
    if (i % 2) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

export function cardExpired(mmYY: string, now = new Date()): boolean {
  const [m, y] = mmYY.split('/').map(Number);
  if (!m || m > 12) return false;
  return 2000 + y < now.getFullYear() || (2000 + y === now.getFullYear() && m < now.getMonth() + 1);
}
