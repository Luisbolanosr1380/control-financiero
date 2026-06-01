// ============================================================
// Tracking de uso de AI (Auros + análisis) — F-030 parte D
//
// Tabla USO_AUROS en Airtable es la fuente de verdad para los límites.
// NO usar memoria del runtime: Vercel reinicia y los Server Actions
// pueden correr en instancias distintas.
// ============================================================

import { airtable, USE_MOCK, TABLES } from './airtable';
import { getRolUsuario, type Role } from '@/lib/auth/allowlist';
import { mesReferencia } from '@/lib/auth/permissions';

export type TipoUso = 'chat' | 'analisis_semanal' | 'analisis_manual';

export interface RegistrarUsoInput {
  email: string;
  tipo: TipoUso;
  tokensIn: number;
  tokensOut: number;
  costoUsd: number;
  durSeg: number;
  queryPreview?: string;
}

/** Registra un uso de AI. Silencioso si Airtable falla (no debe romper la consulta). */
export async function registrarUsoAuros(input: RegistrarUsoInput): Promise<void> {
  if (USE_MOCK || !airtable) return;
  try {
    type AField = string | number | undefined;
    const now = new Date();
    const fields: Record<string, AField> = {
      email:          input.email.toLowerCase().trim(),
      fecha:          now.toISOString(),
      mes_referencia: mesReferencia(now),
      tipo:           input.tipo,
      tokens_input:   Math.round(input.tokensIn),
      tokens_output:  Math.round(input.tokensOut),
      costo_usd:      Number(input.costoUsd.toFixed(6)),
      duracion_seg:   Number(input.durSeg.toFixed(2)),
    };
    if (input.queryPreview) fields.query_preview = input.queryPreview.slice(0, 100);
    await airtable(TABLES.USO_AUROS).create(fields);
  } catch (err) {
    console.error('Error registrando uso de AI:', err instanceof Error ? err.message : err);
  }
}

/**
 * Cuántas consultas `chat` hizo un usuario en el mes dado (default actual).
 * Las llamadas a analisis_manual/semanal NO cuentan contra el límite de chat.
 */
export async function getConsumoMensual(email: string, mes?: string): Promise<number> {
  if (USE_MOCK || !airtable) return 0;
  try {
    const mesRef = mes ?? mesReferencia(new Date());
    const e = email.toLowerCase().trim().replace(/"/g, '\\"');
    const records = await airtable(TABLES.USO_AUROS)
      .select({
        filterByFormula: `AND({email}="${e}", {mes_referencia}="${mesRef}", {tipo}="chat")`,
        fields: ['email'],
        maxRecords: 5000,
      })
      .all();
    return records.length;
  } catch (err) {
    console.error('Error obteniendo consumo mensual:', err);
    return 0;
  }
}

export interface ResumenUsuarioMes {
  email: string;
  rol: Role | null;
  consultas: number;          // # chats
  analisisManual: number;     // # análisis manual
  costoTotalUsd: number;      // suma de todo
  ultimoUso: string | null;   // ISO datetime del último uso
  tokensInput: number;
  tokensOutput: number;
}

/**
 * Resumen del mes por usuario (todos los usuarios que tuvieron actividad).
 * Para la pantalla /admin/usuarios.
 */
export async function getResumenUsoMensual(mes?: string): Promise<ResumenUsuarioMes[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const mesRef = mes ?? mesReferencia(new Date());
    const records = await airtable(TABLES.USO_AUROS)
      .select({
        filterByFormula: `{mes_referencia}="${mesRef}"`,
        fields: ['email', 'fecha', 'tipo', 'tokens_input', 'tokens_output', 'costo_usd'],
        maxRecords: 10000,
      })
      .all();

    const m = new Map<string, ResumenUsuarioMes>();
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const email = String(f.email ?? '').toLowerCase();
      if (!email) continue;
      const tipo = (f.tipo as { name?: string } | string | null);
      const tipoName = typeof tipo === 'object' && tipo ? tipo.name : (typeof tipo === 'string' ? tipo : '');
      const fechaIso = String(f.fecha ?? '');

      const e = m.get(email) ?? {
        email,
        rol: getRolUsuario(email),
        consultas: 0,
        analisisManual: 0,
        costoTotalUsd: 0,
        ultimoUso: null,
        tokensInput: 0,
        tokensOutput: 0,
      };
      if (tipoName === 'chat')            e.consultas += 1;
      if (tipoName === 'analisis_manual') e.analisisManual += 1;
      e.costoTotalUsd += Number(f.costo_usd ?? 0);
      e.tokensInput   += Number(f.tokens_input ?? 0);
      e.tokensOutput  += Number(f.tokens_output ?? 0);
      if (!e.ultimoUso || fechaIso > e.ultimoUso) e.ultimoUso = fechaIso;
      m.set(email, e);
    }
    return [...m.values()].sort((a, b) => b.consultas - a.consultas);
  } catch (err) {
    console.error('Error obteniendo resumen mensual:', err);
    return [];
  }
}

/** Total del mes (costo + consultas) para el KPI superior de /admin. */
export interface TotalesMes {
  costoTotalUsd: number;
  consultasChat: number;
  analisisManual: number;
  analisisSemanal: number;
  diasTranscurridos: number;
  diasMes: number;
  costoProyectadoUsd: number;     // regla de tres: costoActual / diasTranscurridos * diasMes
}

export async function getTotalesMes(mes?: string): Promise<TotalesMes> {
  const empty: TotalesMes = {
    costoTotalUsd: 0, consultasChat: 0, analisisManual: 0, analisisSemanal: 0,
    diasTranscurridos: 0, diasMes: 0, costoProyectadoUsd: 0,
  };
  if (USE_MOCK || !airtable) return empty;
  try {
    const now = new Date();
    const mesRef = mes ?? mesReferencia(now);
    const records = await airtable(TABLES.USO_AUROS)
      .select({
        filterByFormula: `{mes_referencia}="${mesRef}"`,
        fields: ['tipo', 'costo_usd'],
        maxRecords: 10000,
      })
      .all();
    let costo = 0, chat = 0, man = 0, sem = 0;
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const tipo = f.tipo as { name?: string } | string | null;
      const tipoName = typeof tipo === 'object' && tipo ? tipo.name : (typeof tipo === 'string' ? tipo : '');
      costo += Number(f.costo_usd ?? 0);
      if (tipoName === 'chat')             chat += 1;
      if (tipoName === 'analisis_manual')  man  += 1;
      if (tipoName === 'analisis_semanal') sem  += 1;
    }
    // Proyección lineal solo si el mes consultado es el actual
    const mesActual = mesReferencia(now);
    const diasMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const diasTranscurridos = mesRef === mesActual ? now.getDate() : diasMes;
    const proyectado = diasTranscurridos > 0 ? (costo / diasTranscurridos) * diasMes : 0;
    return {
      costoTotalUsd: costo,
      consultasChat: chat,
      analisisManual: man,
      analisisSemanal: sem,
      diasTranscurridos,
      diasMes,
      costoProyectadoUsd: proyectado,
    };
  } catch (err) {
    console.error('Error obteniendo totales mes:', err);
    return empty;
  }
}
