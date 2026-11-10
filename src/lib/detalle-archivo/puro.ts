/**
 * DETALLE FIRMADO EN PAPEL (032) · reglas puras del archivo (van al navegador de Finanzas y al servidor).
 *
 * El cliente imprime el detalle, lo firma y lo devuelve escaneado o en foto: ese papel es el respaldo de la aprobación
 * y vive en el bucket PRIVADO `detalles-firmados` (nombres de candidatos + firma del cliente: nunca una URL pública).
 * El tipo real se decide por los primeros bytes (magic), nunca por la extensión ni por lo que diga el navegador.
 */
import type { EstadoDetalle } from '@/lib/facturacion-agenda/detalle';

export const BUCKET_FIRMADOS = 'detalles-firmados';
export const MAX_BYTES_ARCHIVO = 15 * 1024 * 1024;   // 15 MB por archivo
export const MAX_ARCHIVOS_FIRMADO = 5;               // varias hojas en fotos separadas
export const SEGUNDOS_URL_FIRMADA = 300;             // 5 minutos
export type MimeFirmado = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/heic';
export const MIMES_FIRMADO: readonly MimeFirmado[] = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'];
export const ACEPTA_INPUT = '.pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif';
export const ETIQUETA_MIME: Record<MimeFirmado, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/heic': 'HEIC' };

/** Tipo real por los primeros bytes: PDF, JPG, PNG o HEIC (foto de iPhone). null = no es PDF ni imagen aceptada. */
export function tipoRealDe(cabecera: Uint8Array): MimeFirmado | null {
  const b = cabecera;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'application/pdf';   // %PDF-
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {   // ....ftyp<brand>
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif'].includes(brand)) return 'image/heic';
  }
  return null;
}

/** Nombre de archivo saneado para el path del bucket (sin tildes, espacios ni caracteres raros; con extensión coherente). */
export function sanearNombre(nombre: string, mime: MimeFirmado): string {
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'heic';
  const base = String(nombre || 'detalle-firmado').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[.-]+|[.-]+$/g, '').slice(0, 80) || 'detalle-firmado';
  return `${base}.${ext}`;
}

/** En qué estados se puede subir el papel firmado (a veces llega después de facturar). */
export const puedeSubirFirmadoEn = (estado: EstadoDetalle): boolean => ['enviada', 'con_observaciones', 'aprobada', 'facturada'].includes(estado);
/** En qué estados la subida ofrece «y marcar como aprobado» (canal papel; revoca el link vigente). */
export const puedeAprobarEnPapelEn = (estado: EstadoDetalle): boolean => estado === 'enviada' || estado === 'con_observaciones';

export interface MetaFirmado { firmadoPor: string; firmadoCargo: string; firmadoFecha: string; notas: string }

/** Valida los campos del formulario: firmado por obligatorio, fecha YYYY-MM-DD (hoy por defecto), topes de largo. */
export function validarMetaFirmado(input: Partial<MetaFirmado> | null | undefined, hoy: string): { ok: true; meta: MetaFirmado } | { ok: false; error: string } {
  const firmadoPor = String(input?.firmadoPor ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (firmadoPor.length < 2) return { ok: false, error: 'Indicá quién firmó el detalle (nombre del lado del cliente).' };
  const firmadoFecha = String(input?.firmadoFecha ?? '').trim() || hoy;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firmadoFecha) || Number.isNaN(Date.parse(firmadoFecha))) return { ok: false, error: 'La fecha de firma no es válida.' };
  if (firmadoFecha > hoy) return { ok: false, error: 'La fecha de firma no puede ser futura.' };
  return { ok: true, meta: { firmadoPor, firmadoCargo: String(input?.firmadoCargo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200), firmadoFecha, notas: String(input?.notas ?? '').trim().slice(0, 1000) } };
}

/** Valida lo que el navegador declara de cada archivo ANTES de pedir las URL de subida (el tipo real se revalida al confirmar). */
export function validarArchivosDeclarados(archivos: ReadonlyArray<{ nombre: string; bytes: number; mime: string }>, yaVigentes: number): { ok: true } | { ok: false; error: string } {
  if (!archivos.length) return { ok: false, error: 'Elegí al menos un archivo (PDF o foto).' };
  if (archivos.length + yaVigentes > MAX_ARCHIVOS_FIRMADO) return { ok: false, error: `Hasta ${MAX_ARCHIVOS_FIRMADO} archivos por detalle (ya hay ${yaVigentes}).` };
  for (const a of archivos) {
    if (!(a.bytes > 0)) return { ok: false, error: `"${a.nombre}" está vacío.` };
    if (a.bytes > MAX_BYTES_ARCHIVO) return { ok: false, error: `"${a.nombre}" pesa más de 15 MB.` };
    if (!(MIMES_FIRMADO as readonly string[]).includes(a.mime)) return { ok: false, error: `"${a.nombre}" no es PDF ni imagen (JPG, PNG o HEIC).` };
  }
  return { ok: true };
}

export const esImagen = (mime: string): boolean => mime.startsWith('image/');
export const formatearBytes = (n: number): string => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
