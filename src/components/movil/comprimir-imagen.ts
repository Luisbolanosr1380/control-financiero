/**
 * Achica una foto del teléfono antes de subirla (navegador). Una foto de
 * cámara pesa 3–8 MB; una función de Vercel acepta hasta 4.5 MB por request
 * y con señal débil cada MB cuenta. 2000 px de lado mayor en JPEG 0.82 deja
 * la factura legible (también para la lectura automática) en ~300–800 KB.
 * PDFs y archivos que no son imagen pasan sin tocar.
 */
export const LADO_MAX_PX = 2000;
export const CALIDAD_JPEG = 0.82;

export async function comprimirImagen(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const escala = Math.min(1, LADO_MAX_PX / Math.max(bmp.width, bmp.height));
    if (escala === 1 && file.type === 'image/jpeg' && file.size < 1_500_000) { bmp.close(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close(); return file; }
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', CALIDAD_JPEG));
    if (!blob || blob.size >= file.size) return file;
    const base = (file.name || 'foto').replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;   // HEIC u otro formato que el navegador no decodifica: se sube tal cual
  }
}
