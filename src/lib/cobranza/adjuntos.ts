/**
 * CENTRO DE COBROS (033) · reglas puras de los adjuntos (van al navegador y al servidor): tope, tipos aceptados y el
 * tipo real por los primeros bytes (PDF / JPG / PNG / HEIC de la 032, más un correo .eml por sus cabeceras).
 */
import { tipoRealDe, sanearNombre, type MimeFirmado } from '@/lib/detalle-archivo/puro';

export const MAX_BYTES_ADJUNTO = 10 * 1024 * 1024;
export const MAX_ADJUNTOS_EVENTO = 5;
export type MimeAdjunto = MimeFirmado | 'message/rfc822';
export const MIMES_ADJUNTO: readonly MimeAdjunto[] = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'message/rfc822'];
export const ACEPTA_ADJUNTO = '.pdf,.jpg,.jpeg,.png,.heic,.heif,.eml,application/pdf,image/jpeg,image/png,image/heic,message/rfc822';

const latin1 = (b: Uint8Array): string => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

/** Tipo real por los primeros bytes: PDF / imagen (032) o un correo .eml (cabeceras RFC 822 al inicio). */
export function tipoRealAdjunto(cabecera: Uint8Array, nombre: string): MimeAdjunto | null {
  const img = tipoRealDe(cabecera);
  if (img) return img;
  const texto = latin1(cabecera.subarray(0, 512));
  if (/\.eml$/i.test(nombre) && /^(From|Received|Return-Path|MIME-Version|Subject|Date|Message-ID|To|Delivered-To|X-[A-Za-z-]+):/im.test(texto)) return 'message/rfc822';
  return null;
}
export const nombreAdjuntoSaneado = (nombre: string, mime: MimeAdjunto): string => mime === 'message/rfc822' ? `${sanearNombre(nombre, 'application/pdf').replace(/\.pdf$/, '')}.eml` : sanearNombre(nombre, mime);
