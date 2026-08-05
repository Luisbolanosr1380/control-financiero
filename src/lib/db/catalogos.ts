// ============================================================
// FIX-CLIENTES-ALTA (revisión ampliada): altas de catálogos que
// solo existían en la interfaz de Airtable — bancos, centros de
// costo y cuentas contables. Sin esto, al desconectar Airtable no
// habría dónde crear una cuenta bancaria nueva, una línea de
// negocio o una cuenta del plan contable.
//
// Igual que el alta de clientes: nunca hubo rama legacy (se hacía
// a mano en Airtable), así que escriben SOLO a Supabase, gateadas
// por writeSource('sistema').
// ============================================================

import { writeSource } from '../config/data-source';
import { insertar } from '../supabase/writes';
import { fetchAll, supabase } from '../supabase/client';

type Resultado =
  | { ok: true; id: string; mensaje: string }
  | { ok: false; error: string };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function requiereSupabase(): { ok: false; error: string } | null {
  if (writeSource('sistema') !== 'supabase') {
    return { ok: false, error: 'Las altas de catálogo requieren el backend Supabase.' };
  }
  return null;
}

// ── Bancos ──────────────────────────────────────────────────

export interface CrearBancoInput {
  nombreCuenta: string;            // requerido — cómo la llama la operación ("BANCO BANRURAL")
  banco: string;                   // requerido — nombre institucional ("BANCO DESARROLLO RURAL")
  numeroCuenta?: string;
  moneda?: 'GTQ' | 'USD';          // default GTQ
  saldoInicial?: number;
  fechaSaldoInicial?: string;      // YYYY-MM-DD
  cuentaContableId?: string;       // airtable_id de la cuenta del plan (1-1-1-x)
}

export async function crearBanco(input: CrearBancoInput): Promise<Resultado> {
  const gate = requiereSupabase();
  if (gate) return gate;
  const nombreCuenta = (input.nombreCuenta ?? '').trim();
  const banco = (input.banco ?? '').trim();
  if (!nombreCuenta) return { ok: false, error: 'El nombre de la cuenta es requerido.' };
  if (!banco)        return { ok: false, error: 'El banco es requerido.' };

  try {
    const existentes = await fetchAll<{ airtable_id: string; nombre_cuenta: string | null }>('bancos', { select: 'airtable_id, nombre_cuenta' });
    const dup = existentes.find(b => norm(String(b.nombre_cuenta ?? '')) === norm(nombreCuenta));
    if (dup) return { ok: false, error: `Ya existe una cuenta bancaria "${dup.nombre_cuenta}".` };

    let cuentaUuid: string | null = null;
    if (input.cuentaContableId?.trim()) {
      const { uuidRequerido } = await import('../supabase/writes');
      cuentaUuid = await uuidRequerido('cuentas', input.cuentaContableId.trim(), 'crearBanco.cuentaContable');
    }
    const res = await insertar('bancos', {
      nombre_cuenta: nombreCuenta,
      banco,
      numero_cuenta: input.numeroCuenta?.trim() || null,
      moneda: input.moneda === 'USD' ? 'USD' : 'GTQ',
      saldo_inicial: input.saldoInicial ?? 0,
      fecha_saldo_inicial: input.fechaSaldoInicial || null,
      cuenta_contable_id: cuentaUuid,
      activo: true,
    });
    return { ok: true, id: res.airtable_id, mensaje: `Cuenta bancaria "${nombreCuenta}" creada.` };
  } catch (err) {
    return { ok: false, error: `No se pudo crear el banco: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── Centros de costo ────────────────────────────────────────

export const NATURALEZAS_CC = ['Recurrente', 'Por proyecto'] as const;

export interface CrearCentroCostoInput {
  nombre: string;                                   // requerido
  naturaleza?: (typeof NATURALEZAS_CC)[number];     // clasifica retención de clientes
  codigoCc?: string;
  observaciones?: string;
}

export async function crearCentroCosto(input: CrearCentroCostoInput): Promise<Resultado> {
  const gate = requiereSupabase();
  if (gate) return gate;
  const nombre = (input.nombre ?? '').trim();
  if (!nombre) return { ok: false, error: 'El nombre del centro de costo es requerido.' };

  try {
    const existentes = await fetchAll<{ airtable_id: string; nombre: string | null }>('centros_costo', { select: 'airtable_id, nombre' });
    const dup = existentes.find(c => norm(String(c.nombre ?? '')) === norm(nombre));
    if (dup) return { ok: false, error: `Ya existe un centro de costo "${dup.nombre}".` };

    const res = await insertar('centros_costo', {
      nombre,
      naturaleza: input.naturaleza ?? null,
      codigo_cc: input.codigoCc?.trim() || null,
      observaciones: input.observaciones?.trim() || null,
      activo: true,
    });
    return { ok: true, id: res.airtable_id, mensaje: `Centro de costo "${nombre}" creado.` };
  } catch (err) {
    return { ok: false, error: `No se pudo crear el centro de costo: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── Cuentas contables ───────────────────────────────────────

export interface CrearCuentaContableInput {
  codigoPath: string;              // requerido — "1-1-1-5"; el padre ("1-1-1") debe existir
  nombre: string;                  // requerido
  descripcion?: string;
}

export async function crearCuentaContable(input: CrearCuentaContableInput): Promise<Resultado> {
  const gate = requiereSupabase();
  if (gate) return gate;
  const nombre = (input.nombre ?? '').trim();
  const codigo = (input.codigoPath ?? '').trim();
  if (!nombre) return { ok: false, error: 'El nombre de la cuenta es requerido.' };
  if (!/^\d+(-\d+)*$/.test(codigo)) {
    return { ok: false, error: `Código "${codigo}" inválido — formato jerárquico con guiones, ej. 1-1-1-5.` };
  }

  try {
    const sb = supabase();
    if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
    const filas = await fetchAll<{ id: string; codigo_path: string | null; numero_orden: number | null }>(
      'cuentas', { select: 'id, codigo_path, numero_orden' },
    );
    if (filas.some(c => c.codigo_path === codigo)) {
      return { ok: false, error: `Ya existe una cuenta con el código ${codigo}.` };
    }

    const segmentos = codigo.split('-');
    const nivel = segmentos.length;
    const parentPath = nivel > 1 ? segmentos.slice(0, -1).join('-') : null;
    let parentId: string | null = null;
    if (parentPath) {
      const parent = filas.find(c => c.codigo_path === parentPath);
      if (!parent) return { ok: false, error: `La cuenta padre ${parentPath} no existe — creala primero.` };
      parentId = parent.id;
    }
    // numero_orden: después del último hermano (la UI de reportes ordena por él).
    const hermanos = filas.filter(c => {
      const p = String(c.codigo_path ?? '');
      return parentPath ? p.startsWith(`${parentPath}-`) && p.split('-').length === nivel : p.split('-').length === 1;
    });
    const numeroOrden = Math.max(0, ...hermanos.map(h => Number(h.numero_orden ?? 0))) + 10;

    const res = await insertar('cuentas', {
      codigo_path: codigo,
      nombre,
      nivel,
      parent_path: parentPath,
      parent_id: parentId,
      numero_orden: numeroOrden,
      descripcion: input.descripcion?.trim() || null,
      activo: true,
    });
    return { ok: true, id: res.airtable_id, mensaje: `Cuenta ${codigo} · "${nombre}" creada.` };
  } catch (err) {
    return { ok: false, error: `No se pudo crear la cuenta: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── Lecturas de apoyo para los formularios ──────────────────

export interface CatalogoResumen {
  bancos:  Array<{ id: string; nombre: string; banco: string; moneda: string; activo: boolean }>;
  centros: Array<{ id: string; nombre: string; naturaleza: string; activo: boolean }>;
  cuentas: Array<{ id: string; codigo: string; nombre: string; nivel: number }>;
}

export async function getCatalogos(): Promise<CatalogoResumen> {
  const [bancos, centros, cuentas] = await Promise.all([
    fetchAll<{ airtable_id: string; nombre_cuenta: string | null; banco: string | null; moneda: string | null; activo: boolean | null }>(
      'bancos', { select: 'airtable_id, nombre_cuenta, banco, moneda, activo' }),
    fetchAll<{ airtable_id: string; nombre: string | null; naturaleza: string | null; activo: boolean | null }>(
      'centros_costo', { select: 'airtable_id, nombre, naturaleza, activo' }),
    fetchAll<{ airtable_id: string; codigo_path: string | null; nombre: string | null; nivel: number | null }>(
      'cuentas', { select: 'airtable_id, codigo_path, nombre, nivel' }),
  ]);
  const segs = (c: string) => c.split('-').map(Number);
  return {
    bancos: bancos.map(b => ({ id: b.airtable_id, nombre: String(b.nombre_cuenta ?? ''), banco: String(b.banco ?? ''), moneda: String(b.moneda ?? 'GTQ'), activo: b.activo === true }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    centros: centros.map(c => ({ id: c.airtable_id, nombre: String(c.nombre ?? ''), naturaleza: String(c.naturaleza ?? ''), activo: c.activo === true }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    cuentas: cuentas.map(c => ({ id: c.airtable_id, codigo: String(c.codigo_path ?? ''), nombre: String(c.nombre ?? ''), nivel: Number(c.nivel ?? 0) }))
      .sort((a, b) => {
        const x = segs(a.codigo), y = segs(b.codigo);
        for (let i = 0; i < Math.max(x.length, y.length); i++) {
          const d = (x[i] ?? -1) - (y[i] ?? -1);
          if (d !== 0) return d;
        }
        return 0;
      }),
  };
}
