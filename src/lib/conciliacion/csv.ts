/**
 * CONCILIACIÓN — importación de estado de cuenta CSV (PURO, corre en
 * cliente y servidor). Los bancos de Guatemala exportan formatos
 * distintos: separador , o ; o tab, montos "1,234.56" o "1.234,56",
 * negativos con "-" o paréntesis, una columna Monto con signo o dos
 * columnas Débito/Crédito, fechas dd/mm/aaaa o aaaa-mm-dd. El usuario
 * mapea columnas; esto normaliza a la convención del módulo
 * (monto > 0 + tipo Ingreso/Egreso).
 */

import { r2, type TipoMov } from './motor';

export interface TablaCsv { encabezados: string[]; filas: string[][]; separador: string }

export function detectarSeparador(texto: string): string {
  const muestra = texto.split(/\r?\n/).slice(0, 10).join('\n');
  const conteo = (c: string) => (muestra.match(new RegExp(c === '\t' ? '\t' : `\\${c}`, 'g')) ?? []).length;
  return ['\t', ';', ','].sort((a, b) => conteo(b) - conteo(a))[0];
}

/** Parser CSV con comillas ("a, b" y "" escapadas). */
export function parsearCsv(texto: string, separador = detectarSeparador(texto)): TablaCsv {
  const limpio = texto.replace(/^﻿/, '');
  const filas: string[][] = [];
  let fila: string[] = [], campo = '', comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === separador) { fila.push(campo.trim()); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo.trim()); campo = '';
      if (fila.some(c => c !== '')) filas.push(fila);
      fila = [];
    } else campo += ch;
  }
  fila.push(campo.trim());
  if (fila.some(c => c !== '')) filas.push(fila);
  const [encabezados = [], ...resto] = filas;
  return { encabezados, filas: resto, separador };
}

/** "1,234.56" · "1.234,56" · "(150.00)" · "-150" · "Q 1,234.56" → número con signo (NaN si no es monto). */
export function parsearMonto(raw: string): number {
  let s = String(raw ?? '').trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[QqUSD$\s]/g, '');
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  const ultComa = s.lastIndexOf(','), ultPunto = s.lastIndexOf('.');
  if (ultComa > ultPunto) s = s.replace(/\./g, '').replace(',', '.');   // europeo
  else s = s.replace(/,/g, '');                                         // 1,234.56
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return neg ? -n : n;
}

/** dd/mm/aaaa · dd-mm-aaaa · aaaa-mm-dd · dd/mm/aa → 'YYYY-MM-DD' ('' si inválida). */
export function parsearFecha(raw: string): string {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) return '';
    d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return dt.toISOString().slice(0, 10);
}

export interface MapeoColumnas {
  fecha: number;
  descripcion: number;
  referencia: number | null;
  /** Una columna con signo (+ ingreso / − egreso)… */
  monto: number | null;
  /** …o dos columnas: débito (sale) y crédito (entra). */
  debito: number | null;
  credito: number | null;
  /** Si la columna monto viene invertida (algunos bancos: + = cargo). */
  invertirSigno?: boolean;
}

/** Sugerencia de mapeo por nombre de encabezado. */
export function sugerirMapeo(encabezados: string[]): MapeoColumnas {
  const n = encabezados.map(h => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
  const idx = (...pat: RegExp[]) => { const i = n.findIndex(h => pat.some(p => p.test(h))); return i >= 0 ? i : null; };
  const debito = idx(/debito|cargo|retiro|egreso/);
  const credito = idx(/credito|abono|deposito|ingreso/);
  return {
    fecha: idx(/fecha/) ?? 0,
    descripcion: idx(/descrip|concepto|detalle|movimiento/) ?? 1,
    referencia: idx(/refer|documento|no\.?\s*doc|cheque|boleta/),
    monto: debito !== null && credito !== null ? null : idx(/monto|importe|valor/),
    debito: debito !== null && credito !== null ? debito : null,
    credito: debito !== null && credito !== null ? credito : null,
  };
}

export interface MovimientoImportado {
  fila: number;            // 1-based (sin encabezado)
  fecha: string;
  monto: number;           // > 0
  tipo: TipoMov;
  descripcion: string;
  referencia: string;
  error?: string;
}

export function normalizarFilas(tabla: TablaCsv, mapeo: MapeoColumnas): MovimientoImportado[] {
  return tabla.filas.map((f, i) => {
    const fecha = parsearFecha(f[mapeo.fecha] ?? '');
    const descripcion = (f[mapeo.descripcion] ?? '').trim();
    const referencia = mapeo.referencia !== null ? (f[mapeo.referencia] ?? '').trim() : '';
    let neto = NaN;
    if (mapeo.monto !== null) {
      neto = parsearMonto(f[mapeo.monto] ?? '');
      if (mapeo.invertirSigno) neto = -neto;
    } else if (mapeo.debito !== null && mapeo.credito !== null) {
      const deb = parsearMonto(f[mapeo.debito] ?? '');
      const cre = parsearMonto(f[mapeo.credito] ?? '');
      neto = (Number.isNaN(cre) ? 0 : Math.abs(cre)) - (Number.isNaN(deb) ? 0 : Math.abs(deb));
      if (Number.isNaN(deb) && Number.isNaN(cre)) neto = NaN;
    }
    const base = { fila: i + 1, fecha, descripcion, referencia, monto: r2(Math.abs(neto || 0)), tipo: (neto >= 0 ? 'Ingreso' : 'Egreso') as TipoMov };
    if (!fecha) return { ...base, error: 'Fecha inválida' };
    if (Number.isNaN(neto)) return { ...base, error: 'Monto inválido' };
    if (r2(Math.abs(neto)) === 0) return { ...base, error: 'Monto en cero (fila de saldo/encabezado)' };
    return base;
  });
}

/** Clave de duplicado (brief): banco + fecha + monto + referencia. El tipo va incluido: un ingreso y un egreso iguales no son duplicado. */
export function claveDuplicado(bancoId: string, m: { fecha: string; monto: number; referencia: string; tipo: TipoMov }): string {
  return [bancoId, m.fecha, r2(m.monto).toFixed(2), m.tipo, m.referencia.trim().toUpperCase()].join('|');
}
