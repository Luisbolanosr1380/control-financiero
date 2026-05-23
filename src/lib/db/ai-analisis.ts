// ============================================================
// Persistencia y costos de análisis AI
// Tabla ANALISIS_AI en Airtable.
// ============================================================

import { airtable, TABLES } from './airtable';

/** Precios públicos Gemini 2.5 Flash (uso interactivo, USD por millón de tokens). */
export const PRECIOS = {
  inputPorM:  0.30,
  outputPorM: 2.50,
} as const;

/** Tipo de cambio aproximado USD→GTQ. Constante, marcado como aproximado en UI. */
export const TC_APROX = 7.7;

const FAI = {
  FECHA:    'Fecha_Generacion',
  TEXTO:    'Texto',
  MODELO:   'Modelo',
  TOK_IN:   'Tokens_Input',
  TOK_OUT:  'Tokens_Output',
  DURACION: 'Duracion_seg',
  COSTO:    'Costo_USD',
} as const;

export function calcularCostoUSD(tokensInput: number, tokensOutput: number): number {
  return (tokensInput / 1e6) * PRECIOS.inputPorM + (tokensOutput / 1e6) * PRECIOS.outputPorM;
}

export interface AnalisisRegistro {
  id: string;
  fecha: string;          // ISO
  texto: string;
  modelo: string;
  tokensInput: number;
  tokensOutput: number;
  duracionSeg: number;
  costoUSD: number;
}

export interface GuardarAnalisisInput {
  texto: string;
  modelo: string;
  tokensInput: number;
  tokensOutput: number;
  duracionSeg: number;
}

export async function guardarAnalisis(input: GuardarAnalisisInput): Promise<AnalisisRegistro> {
  if (!airtable) throw new Error('Airtable no está configurado.');
  const costoUSD = calcularCostoUSD(input.tokensInput, input.tokensOutput);
  const fecha = new Date().toISOString();
  const [created] = await airtable(TABLES.ANALISIS_AI).create([{
    fields: {
      [FAI.FECHA]:    fecha,
      [FAI.TEXTO]:    input.texto,
      [FAI.MODELO]:   input.modelo,
      [FAI.TOK_IN]:   input.tokensInput,
      [FAI.TOK_OUT]:  input.tokensOutput,
      [FAI.DURACION]: input.duracionSeg,
      [FAI.COSTO]:    costoUSD,
    },
  }]);
  return {
    id:           created.id,
    fecha,
    texto:        input.texto,
    modelo:       input.modelo,
    tokensInput:  input.tokensInput,
    tokensOutput: input.tokensOutput,
    duracionSeg:  input.duracionSeg,
    costoUSD,
  };
}

function recordToAnalisis(r: { id: string; fields: Record<string, unknown> }): AnalisisRegistro {
  return {
    id:           r.id,
    fecha:        String(r.fields[FAI.FECHA] ?? ''),
    texto:        String(r.fields[FAI.TEXTO] ?? ''),
    modelo:       String(r.fields[FAI.MODELO] ?? ''),
    tokensInput:  Number(r.fields[FAI.TOK_IN] ?? 0),
    tokensOutput: Number(r.fields[FAI.TOK_OUT] ?? 0),
    duracionSeg:  Number(r.fields[FAI.DURACION] ?? 0),
    costoUSD:     Number(r.fields[FAI.COSTO] ?? 0),
  };
}

export async function getUltimoAnalisis(): Promise<AnalisisRegistro | null> {
  if (!airtable) return null;
  try {
    const records = await airtable(TABLES.ANALISIS_AI)
      .select({ sort: [{ field: FAI.FECHA, direction: 'desc' }], maxRecords: 1 })
      .all();
    return records[0] ? recordToAnalisis({ id: records[0].id, fields: records[0].fields }) : null;
  } catch (err) {
    console.error('Error leyendo último análisis AI:', err);
    return null;
  }
}

export async function getHistorialAnalisis(limit = 20): Promise<AnalisisRegistro[]> {
  if (!airtable) return [];
  try {
    const records = await airtable(TABLES.ANALISIS_AI)
      .select({ sort: [{ field: FAI.FECHA, direction: 'desc' }], maxRecords: limit })
      .all();
    return records.map(r => recordToAnalisis({ id: r.id, fields: r.fields }));
  } catch (err) {
    console.error('Error leyendo historial AI:', err);
    return [];
  }
}

export interface CostoAcumulado {
  totalUSD: number;
  esteMesUSD: number;
  cantidad: number;
}

export async function getCostoAcumulado(): Promise<CostoAcumulado> {
  if (!airtable) return { totalUSD: 0, esteMesUSD: 0, cantidad: 0 };
  try {
    const records = await airtable(TABLES.ANALISIS_AI)
      .select({ fields: [FAI.FECHA, FAI.COSTO], maxRecords: 1000 })
      .all();

    const ahora = new Date();
    const mesActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    let totalUSD = 0, esteMesUSD = 0;
    for (const r of records) {
      const costo = Number(r.fields[FAI.COSTO] ?? 0);
      totalUSD += costo;
      const fecha = String(r.fields[FAI.FECHA] ?? '');
      if (fecha.startsWith(mesActual)) esteMesUSD += costo;
    }
    return { totalUSD, esteMesUSD, cantidad: records.length };
  } catch (err) {
    console.error('Error calculando costo acumulado AI:', err);
    return { totalUSD: 0, esteMesUSD: 0, cantidad: 0 };
  }
}
