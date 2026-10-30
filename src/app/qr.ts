import jsQR from 'jsqr';

/** Lê um QR code de uma imagem (arquivo, foto ou print colado). Tudo no aparelho. */
export async function readQrFromImage(file: Blob): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  // Tenta no tamanho original e reduzido (prints grandes às vezes leem melhor menores).
  for (const scale of [1, 0.5, 0.25]) {
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const r = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (r?.data) return r.data;
  }
  return null;
}
