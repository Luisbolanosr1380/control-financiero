/**
 * F-047 — Generación de PDF de boleta de pago.
 *
 * Recibe el ID de una línea de planilla en estado "Pagado", arma un PDF
 * autocontenido (sin assets externos requeridos hoy) y devuelve el Buffer
 * para que el caller decida si guardarlo en Airtable o servirlo al browser.
 *
 * Stack: pdf-lib (Node 20+, sin deps nativas — ok para serverless Vercel).
 *
 * Layout (US Letter portrait, márgenes 50pt):
 *  1. Header: "GOLDEN TALENT GUATEMALA" + "BOLETA DE PAGO" + período + fecha gen.
 *  2. Datos empresa (NIT, dirección).
 *  3. Datos empleado (nombre, DPI, puesto, depto, CC, fecha ingreso, banco/cuenta).
 *  4. Tabla ingresos.
 *  5. Tabla descuentos.
 *  6. Neto a pagar destacado.
 *  7. Info pago (fecha, banco, método).
 *  8. Firmas (líneas para firma física; embebida si Firma_Digital existe).
 *  9. Disclaimer legal.
 * 10. Metadata: generado el / por / id corto.
 *
 * Firma digital: si el empleado tiene Firma_Digital en Airtable, se descarga
 * el PNG/JPG y se embebe sobre la línea de firma. Si no, queda vacía para
 * firma manual. Es fail-soft — un download fallido no detiene la generación.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { getEmpleadoPorId } from '@/lib/db/empleados';
import { getPeriodoPorId } from '@/lib/db/planillas';
import { formatearFechaLarga, formatearFechaConHora } from '@/lib/utils/fechas';
import { EMPRESA } from './empresa';
import type { LineaPlanilla, Periodo } from '@/lib/db/planillas';
import type { Empleado } from '@/lib/db/empleados';

const PT = 1;
const PAGE_W = 612;             // US Letter ancho en pt
const PAGE_H = 792;             // US Letter alto en pt
const MARGIN = 50 * PT;
const LINE = 14 * PT;
const COLOR_INK    = rgb(0.055, 0.165, 0.141);    // var(--ink) ≈ #0E2A24
const COLOR_INK_2  = rgb(0.102, 0.231, 0.200);    // ink-2
const COLOR_INK_3  = rgb(0.290, 0.353, 0.325);    // ink-3
const COLOR_INK_4  = rgb(0.478, 0.522, 0.498);    // ink-4
const COLOR_LINE   = rgb(0.788, 0.745, 0.620);    // line-2
const COLOR_OLIVE  = rgb(0.353, 0.416, 0.180);    // accent verde
const COLOR_WINE   = rgb(0.541, 0.165, 0.165);    // wine
const COLOR_PAPER2 = rgb(0.973, 0.949, 0.886);    // paper-2

interface BoletaContext {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  cursor: { y: number };
}

const Q = (n: number) => `Q${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function tituloPeriodo(p: Periodo): string {
  return `${p.quincena === 1 ? 'Primera' : 'Segunda'} quincena de ${MESES[p.mes - 1]} ${p.anio}`;
}

function dibujarLinea(ctx: BoletaContext, y: number, color = COLOR_LINE, grosor = 0.5) {
  ctx.page.drawLine({
    start: { x: MARGIN, y },
    end:   { x: PAGE_W - MARGIN, y },
    thickness: grosor,
    color,
  });
}

function dibujarTexto(ctx: BoletaContext, texto: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
  ctx.page.drawText(texto, {
    x, y,
    size: opts.size ?? 9,
    font: opts.bold ? ctx.bold : ctx.font,
    color: opts.color ?? COLOR_INK,
  });
}

/* ============================================================
 * Secciones del PDF
 * ============================================================ */

function dibujarHeader(ctx: BoletaContext, periodo: Periodo) {
  const yTop = PAGE_H - MARGIN;

  // "GOLDEN TALENT GUATEMALA" como bloque de marca textual (placeholder de logo).
  dibujarTexto(ctx, 'GOLDEN TALENT GUATEMALA', MARGIN, yTop - 8, { size: 14, bold: true, color: COLOR_OLIVE });
  dibujarTexto(ctx, EMPRESA.razonSocial, MARGIN, yTop - 22, { size: 8, color: COLOR_INK_3 });
  dibujarTexto(ctx, `NIT: ${EMPRESA.nit} · ${EMPRESA.direccion}`, MARGIN, yTop - 33, { size: 8, color: COLOR_INK_4 });

  // Bloque derecho — título de la boleta + período.
  const xRight = PAGE_W - MARGIN;
  const titulo = 'BOLETA DE PAGO';
  const tituloW = ctx.bold.widthOfTextAtSize(titulo, 13);
  dibujarTexto(ctx, titulo, xRight - tituloW, yTop - 8, { size: 13, bold: true });

  const subtitulo = tituloPeriodo(periodo);
  const subW = ctx.font.widthOfTextAtSize(subtitulo, 9);
  dibujarTexto(ctx, subtitulo, xRight - subW, yTop - 22, { size: 9, color: COLOR_INK_2 });

  const gen = `Generada ${formatearFechaConHora(new Date())}`;
  const genW = ctx.font.widthOfTextAtSize(gen, 7);
  dibujarTexto(ctx, gen, xRight - genW, yTop - 33, { size: 7, color: COLOR_INK_4 });

  dibujarLinea(ctx, yTop - 44);
  ctx.cursor.y = yTop - 60;
}

function dibujarDatosEmpleado(ctx: BoletaContext, emp: Empleado) {
  dibujarTexto(ctx, 'DATOS DEL EMPLEADO', MARGIN, ctx.cursor.y, { size: 8, bold: true, color: COLOR_INK_4 });
  ctx.cursor.y -= LINE;

  const col1X = MARGIN;
  const col2X = MARGIN + (PAGE_W - MARGIN * 2) / 2;

  const filas: Array<[string, string, string, string]> = [
    ['Nombre',        emp.nombre || '—',
     'DPI',           emp.numeroDocumento || '—'],
    ['Puesto',        emp.idPuesto || '—',
     'Departamento',  emp.departamento || '—'],
    ['Centro Costo',  emp.centroCostoNombre || '—',
     'Fecha ingreso', emp.fechaIngreso ? formatearFechaLarga(emp.fechaIngreso) : '—'],
    ['Banco',         emp.bancoNombre || '—',
     'Cuenta',        emp.cuentaBancaria || '—'],
  ];

  for (const [k1, v1, k2, v2] of filas) {
    dibujarTexto(ctx, k1, col1X,         ctx.cursor.y, { size: 7.5, color: COLOR_INK_4 });
    dibujarTexto(ctx, v1, col1X + 65,    ctx.cursor.y, { size: 9 });
    dibujarTexto(ctx, k2, col2X,         ctx.cursor.y, { size: 7.5, color: COLOR_INK_4 });
    dibujarTexto(ctx, v2, col2X + 65,    ctx.cursor.y, { size: 9 });
    ctx.cursor.y -= LINE;
  }
  ctx.cursor.y -= 6;
  dibujarLinea(ctx, ctx.cursor.y);
  ctx.cursor.y -= 16;
}

function dibujarTabla(ctx: BoletaContext, titulo: string, filas: Array<[string, number]>, total: number, x: number, width: number) {
  const yStart = ctx.cursor.y;
  dibujarTexto(ctx, titulo, x, yStart, { size: 8, bold: true, color: COLOR_INK_4 });
  let y = yStart - LINE;

  // Fila de header de tabla
  dibujarTexto(ctx, 'Concepto', x, y, { size: 7.5, bold: true, color: COLOR_INK_3 });
  const montoHeader = 'Monto';
  const montoHeaderW = ctx.bold.widthOfTextAtSize(montoHeader, 7.5);
  dibujarTexto(ctx, montoHeader, x + width - montoHeaderW, y, { size: 7.5, bold: true, color: COLOR_INK_3 });
  y -= 4;
  ctx.page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.4, color: COLOR_LINE });
  y -= 10;

  for (const [concepto, monto] of filas) {
    if (monto === 0) continue;
    dibujarTexto(ctx, concepto, x, y, { size: 9 });
    const m = Q(monto);
    const mw = ctx.font.widthOfTextAtSize(m, 9);
    dibujarTexto(ctx, m, x + width - mw, y, { size: 9 });
    y -= LINE;
  }

  // Total
  y -= 2;
  ctx.page.drawLine({ start: { x, y: y + 6 }, end: { x: x + width, y: y + 6 }, thickness: 0.4, color: COLOR_LINE });
  const totalLabel = 'TOTAL';
  dibujarTexto(ctx, totalLabel, x, y, { size: 8.5, bold: true });
  const tot = Q(total);
  const totW = ctx.bold.widthOfTextAtSize(tot, 8.5);
  dibujarTexto(ctx, tot, x + width - totW, y, { size: 8.5, bold: true });

  return y - 10;   // y final del bloque
}

function dibujarIngresosYDescuentos(ctx: BoletaContext, linea: LineaPlanilla) {
  const colGap = 24;
  const colW = (PAGE_W - MARGIN * 2 - colGap) / 2;

  const ingresos: Array<[string, number]> = [
    ['Salario ordinario',  linea.ordinario],
    ['Bonificación',       linea.bonificacion],
    ['Extraordinario',     linea.extraordinario],
    ['Comisiones',         linea.comisiones],
    ['Otros ingresos',     linea.otrosIngresos],
  ];
  const totalIngresos = ingresos.reduce((s, [, m]) => s + m, 0);

  const descuentos: Array<[string, number]> = [
    ['IGSS laboral',       linea.igssLaboral],
    ['ISR',                linea.isr],
    ['Otros descuentos',   linea.otrosDescuentos],
  ];
  const totalDescuentos = descuentos.reduce((s, [, m]) => s + m, 0);

  const yInicio = ctx.cursor.y;
  const yFinIng = dibujarTabla(ctx, 'INGRESOS',    ingresos,   totalIngresos,   MARGIN,           colW);
  // Restablecer el cursor a yInicio para la segunda columna
  ctx.cursor.y = yInicio;
  const yFinDes = dibujarTabla(ctx, 'DESCUENTOS', descuentos, totalDescuentos, MARGIN + colW + colGap, colW);

  ctx.cursor.y = Math.min(yFinIng, yFinDes) - 12;
}

function dibujarNeto(ctx: BoletaContext, linea: LineaPlanilla) {
  const y = ctx.cursor.y;
  const h = 36;
  const x = MARGIN;
  const w = PAGE_W - MARGIN * 2;
  ctx.page.drawRectangle({
    x, y: y - h, width: w, height: h,
    color: COLOR_PAPER2,
    borderColor: COLOR_OLIVE,
    borderWidth: 1,
  });
  dibujarTexto(ctx, 'NETO A PAGAR', x + 16, y - 14, { size: 9, bold: true, color: COLOR_INK_4 });
  const monto = Q(linea.netoPagar);
  const montoW = ctx.bold.widthOfTextAtSize(monto, 18);
  dibujarTexto(ctx, monto, x + w - 16 - montoW, y - 24, { size: 18, bold: true, color: COLOR_OLIVE });
  ctx.cursor.y = y - h - 18;
}

function dibujarInfoPago(ctx: BoletaContext, linea: LineaPlanilla, empleado: Empleado) {
  dibujarTexto(ctx, 'INFORMACIÓN DEL PAGO', MARGIN, ctx.cursor.y, { size: 8, bold: true, color: COLOR_INK_4 });
  ctx.cursor.y -= LINE;

  const filas: Array<[string, string]> = [
    ['Fecha de pago',  linea.fechaPago ? formatearFechaLarga(linea.fechaPago) : '—'],
    ['Banco / cuenta', empleado.bancoNombre ? `${empleado.bancoNombre} · ${empleado.cuentaBancaria ?? ''}` : '—'],
    ['Estado',         linea.estadoPago],
  ];
  for (const [k, v] of filas) {
    dibujarTexto(ctx, k, MARGIN, ctx.cursor.y, { size: 7.5, color: COLOR_INK_4 });
    dibujarTexto(ctx, v, MARGIN + 95, ctx.cursor.y, { size: 9 });
    ctx.cursor.y -= LINE;
  }
  ctx.cursor.y -= 8;
}

async function dibujarFirmas(ctx: BoletaContext, empleado: Empleado, firmaUrl: string | undefined) {
  const y = ctx.cursor.y - 14;
  const colW = (PAGE_W - MARGIN * 2 - 40) / 2;
  const firmaLineY = y - 28;

  // Embed de firma del empleado (si existe)
  if (firmaUrl) {
    try {
      const resp = await fetch(firmaUrl);
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        const mime = resp.headers.get('content-type') ?? '';
        const img = mime.includes('jpeg') || mime.includes('jpg')
          ? await ctx.doc.embedJpg(buf)
          : await ctx.doc.embedPng(buf);
        const maxH = 30;
        const ratio = img.height > 0 ? img.width / img.height : 1;
        const h = Math.min(maxH, img.height);
        const w = h * ratio;
        ctx.page.drawImage(img, {
          x: MARGIN + (colW - w) / 2,
          y: firmaLineY + 4,
          width: w,
          height: h,
        });
      }
    } catch {
      // Fail-soft: una firma rota no detiene la generación.
    }
  }

  // Línea + label empleado
  ctx.page.drawLine({ start: { x: MARGIN, y: firmaLineY }, end: { x: MARGIN + colW, y: firmaLineY }, thickness: 0.5, color: COLOR_INK_3 });
  dibujarTexto(ctx, 'Firma del empleado', MARGIN, firmaLineY - 12, { size: 8, color: COLOR_INK_3 });
  dibujarTexto(ctx, empleado.nombre, MARGIN, firmaLineY - 22, { size: 7, color: COLOR_INK_4 });

  // Línea + label autorizada
  const xAut = MARGIN + colW + 40;
  ctx.page.drawLine({ start: { x: xAut, y: firmaLineY }, end: { x: xAut + colW, y: firmaLineY }, thickness: 0.5, color: COLOR_INK_3 });
  dibujarTexto(ctx, 'Firma autorizada', xAut, firmaLineY - 12, { size: 8, color: COLOR_INK_3 });
  dibujarTexto(ctx, EMPRESA.razonSocial, xAut, firmaLineY - 22, { size: 7, color: COLOR_INK_4 });

  ctx.cursor.y = firmaLineY - 36;
}

function dibujarPie(ctx: BoletaContext, lineaId: string, generadoPor: string) {
  const yDisc = MARGIN + 50;
  // Caja del disclaimer
  const padX = 8;
  // Word-wrap manual del disclaimer.
  const maxW = PAGE_W - MARGIN * 2 - padX * 2;
  const palabras = EMPRESA.textoLegal.split(' ');
  const lineas: string[] = [];
  let actual = '';
  for (const w of palabras) {
    const test = actual ? `${actual} ${w}` : w;
    if (ctx.font.widthOfTextAtSize(test, 7) > maxW) {
      if (actual) lineas.push(actual);
      actual = w;
    } else {
      actual = test;
    }
  }
  if (actual) lineas.push(actual);
  for (let i = 0; i < lineas.length; i++) {
    dibujarTexto(ctx, lineas[i], MARGIN + padX, yDisc + (lineas.length - i - 1) * 9, { size: 7, color: COLOR_INK_3 });
  }

  // Metadata pie
  const yMeta = MARGIN + 18;
  dibujarTexto(ctx, `Boleta generada por ${generadoPor} · ID interno: ${lineaId.slice(-8)}`, MARGIN, yMeta, { size: 6, color: COLOR_INK_4 });
}

/* ============================================================
 * Función pública
 * ============================================================ */

export interface GenerarBoletaResult {
  ok: boolean;
  pdf?: Buffer;
  empleadoNombre?: string;
  periodoNombre?: string;
  /** FIX-FIRMA: true si la boleta salió con la firma digital embebida. */
  conFirma?: boolean;
  error?: string;
}

export async function generarBoletaPago(lineaId: string, generadoPor: string): Promise<GenerarBoletaResult> {
  let resultadoConFirma = false;
  try {
    // Buscar la línea por ID — getPeriodoPorId no acepta lineaId, así que
    // recorremos: traemos todos los períodos hasta encontrar la línea.
    const { getPeriodos, getLineasPlanilla } = await import('@/lib/db/planillas');
    const periodos = await getPeriodos({ estado: 'todos' });
    let lineaEncontrada: LineaPlanilla | null = null;
    let periodoEncontrado: Periodo | null = null;
    for (const p of periodos) {
      const lineas = await getLineasPlanilla(p.id);
      const l = lineas.find(x => x.id === lineaId);
      if (l) { lineaEncontrada = l; periodoEncontrado = p; break; }
    }
    if (!lineaEncontrada || !periodoEncontrado) {
      return { ok: false, error: 'Línea de planilla no encontrada.' };
    }
    if (lineaEncontrada.estadoPago !== 'Pagado') {
      return { ok: false, error: `No se genera boleta para una línea en estado "${lineaEncontrada.estadoPago}". Solo Pagadas.` };
    }

    const empleado = await getEmpleadoPorId(lineaEncontrada.empleadoId);
    if (!empleado) return { ok: false, error: 'Empleado no encontrado.' };

    // Firma digital (opcional; el download sigue fail-soft).
    const firmaUrl = await obtenerFirmaUrl(empleado.id);
    resultadoConFirma = !!firmaUrl;

    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    doc.setTitle(`Boleta ${empleado.nombre} ${periodoEncontrado.nombre}`);
    doc.setAuthor(EMPRESA.razonSocial);
    doc.setSubject('Boleta de pago');

    const ctx: BoletaContext = { doc, page, font, bold, cursor: { y: PAGE_H - MARGIN } };

    dibujarHeader(ctx, periodoEncontrado);
    dibujarDatosEmpleado(ctx, empleado);
    dibujarIngresosYDescuentos(ctx, lineaEncontrada);
    dibujarNeto(ctx, lineaEncontrada);
    dibujarInfoPago(ctx, lineaEncontrada, empleado);
    await dibujarFirmas(ctx, empleado, firmaUrl);
    dibujarPie(ctx, lineaId, generadoPor);

    const pdfBytes = await doc.save();
    return {
      ok: true,
      pdf: Buffer.from(pdfBytes),
      empleadoNombre: empleado.nombre,
      periodoNombre: periodoEncontrado.nombre,
      conFirma: resultadoConFirma,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Lee la URL de la firma digital del empleado. FIX-FIRMA: en modo Supabase
 *  viene de empleados.firma_digital_url (Storage — URL estable, comprobante
 *  legal). El fail-soft queda SOLO para el download de la imagen, no para
 *  la fuente. */
async function obtenerFirmaUrl(empleadoId: string): Promise<string | undefined> {
  const { dataSource } = await import('@/lib/config/data-source');
  if (dataSource('empleados') === 'supabase') {
    const { supabase } = await import('@/lib/supabase/client');
    const sb = supabase();
    if (!sb) return undefined;
    const { data, error } = await sb.from('empleados')
      .select('firma_digital_url').eq('airtable_id', empleadoId).limit(1);
    if (error) {
      console.warn('FIX-FIRMA: lectura de firma falló:', error.message);
      return undefined;
    }
    return (data?.[0] as { firma_digital_url?: string | null } | undefined)?.firma_digital_url ?? undefined;
  }
  try {
    const { airtable, TABLES } = await import('@/lib/db/airtable');
    if (!airtable) return undefined;
    const r = await airtable(TABLES.EMPLEADOS).find(empleadoId);
    const att = r.fields['Firma_Digital'] as Array<{ url?: string }> | undefined;
    return att?.[0]?.url;
  } catch {
    return undefined;
  }
}

/** Sugiere un filename estandarizado para la boleta. */
export function nombreArchivoBoleta(empleadoNombre: string, periodoNombre: string): string {
  const empNorm = empleadoNombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_');
  return `boleta-${empNorm}-${periodoNombre}.pdf`;
}

/** Use a string color reference para diferenciar visualmente — re-export para tests futuros. */
export const PALETTE = { COLOR_INK, COLOR_OLIVE, COLOR_WINE };
