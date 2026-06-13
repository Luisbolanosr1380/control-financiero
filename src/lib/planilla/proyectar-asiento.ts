/**
 * F-056 — Proyección del asiento de planilla multi-empresa.
 *
 * Función PURA (sin IO) que toma las líneas de un período y la empresa
 * empleadora de cada empleado, y devuelve la composición DÉBITO del
 * asiento de planilla:
 *
 *  · Líneas Golden Talent (incl. legacy sin campo) → agregadas como
 *    "gasto de nómina Golden". No se separa por centro de costo acá —
 *    el generador real (cuando exista) decidirá cómo desagregar.
 *  · Líneas HIT / Poligrafy / BYDSA → 1 partida Dr CxC Intercompany por
 *    empresa, usando las cuentas hardcodeadas en CXC_INTERCOMPANY.
 *
 * El CRÉDITO (Cr Banco / Cr Por Pagar) no se modela acá: depende del
 * flujo de pago real y se conoce línea por línea cuando se registran
 * los pagos. Esta función solo proyecta el lado del débito que CAMBIA
 * con la presencia de empleados no-Golden.
 *
 * Usos:
 *  · Banner del modal /planillas (texto del desglose pre-generación).
 *  · Futuro generador real de ASIENTO/PARTIDAS de planilla.
 *  · Tests + tools de Auros sobre composición esperada del asiento.
 *
 * Lo que NO hace este módulo (queda explícitamente fuera):
 *  · Escribir a Airtable (genera ASIENTO/PARTIDAS).
 *  · La RECLASIFICACIÓN cuando se emite la factura intercompany
 *    (Dr CxC Cliente / Cr 1-1-3-3-x) — requiere decisión contable.
 *  · Reportes de saldos vivos de CxC intercompany.
 */

import {
  CXC_INTERCOMPANY,
  type EmpresaIntercompany,
} from '@/lib/contabilidad/cuentas-sistema';
import {
  normalizarEmpresa,
  esGolden,
  type EmpresaEmpleadora,
} from '@/lib/empleados/empresa';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Datos mínimos de una línea de planilla para proyectar el asiento. */
export interface LineaPlanillaProyeccion {
  empleadoId: string;
  netoPagar: number;
  centroCostoId?: string;
}

/** Datos mínimos del empleado: empresaEmpleadora puede venir vacía → Golden. */
export interface EmpleadoEmpresa {
  id: string;
  empresaEmpleadora?: EmpresaEmpleadora | string;
}

export type TipoPartidaDebito = 'gasto_nomina_golden' | 'cxc_intercompany';

export interface PartidaDebitoProyectada {
  tipo: TipoPartidaDebito;
  /** Solo set para cxc_intercompany — el gasto Golden se desagrega por CC en el generador final. */
  cuentaContableId?: string;
  cuentaCodigo?: string;
  empresa?: EmpresaIntercompany;
  /** Monto en GTQ del débito (siempre positivo). */
  montoQ: number;
  numEmpleados: number;
  descripcion: string;
}

export interface DesgloseEmpresa {
  empresa: EmpresaEmpleadora;
  totalQ: number;
  numEmpleados: number;
  /** Solo para no-Golden: la cuenta CxC a usar. */
  cuentaContableId?: string;
  cuentaCodigo?: string;
}

export interface AsientoPlanillaProyectado {
  /** Suma de netoPagar de TODAS las líneas (Golden + no-Golden). */
  totalNetoQ: number;
  /** Resumen por empresa (incluye Golden y cada intercompany con líneas). */
  porEmpresa: DesgloseEmpresa[];
  /** Partidas DÉBITO listas para insertar en PARTIDAS (cuando exista el generador). */
  partidas: PartidaDebitoProyectada[];
  /** Empresas sin cuenta CxC mapeada (futuro caso: nueva empresa hermana). */
  empresasSinCuenta: EmpresaEmpleadora[];
}

export interface ProyectarAsientoInput {
  periodoNombre: string;
  lineas: LineaPlanillaProyeccion[];
  empleados: EmpleadoEmpresa[];
}

/**
 * Devuelve la cuenta CxC para una empresa empleadora, o undefined si no
 * hay mapping definido (caso: empresa nueva no incluida en CXC_INTERCOMPANY).
 */
export function cuentaCxCDeEmpresa(empresa: EmpresaEmpleadora): {
  recordId: string;
  codigo: string;
  empresa: EmpresaIntercompany;
} | undefined {
  if (empresa === 'Golden Talent') return undefined;
  const conf = (CXC_INTERCOMPANY as Record<string, typeof CXC_INTERCOMPANY[EmpresaIntercompany]>)[empresa];
  return conf ? { recordId: conf.recordId, codigo: conf.codigo, empresa: conf.empresa } : undefined;
}

export function proyectarAsientoPlanilla(input: ProyectarAsientoInput): AsientoPlanillaProyectado {
  const empresaPorEmpleado = new Map<string, EmpresaEmpleadora>(
    input.empleados.map(e => [e.id, normalizarEmpresa(e.empresaEmpleadora)]),
  );

  // Agregar por empresa.
  const agg = new Map<EmpresaEmpleadora, { totalQ: number; numEmpleados: number }>();
  let totalNetoQ = 0;
  for (const l of input.lineas) {
    const emp = empresaPorEmpleado.get(l.empleadoId) ?? 'Golden Talent';
    const b = agg.get(emp) ?? { totalQ: 0, numEmpleados: 0 };
    b.totalQ      += l.netoPagar;
    b.numEmpleados += 1;
    agg.set(emp, b);
    totalNetoQ += l.netoPagar;
  }

  // Resumen por empresa.
  const porEmpresa: DesgloseEmpresa[] = [];
  const empresasSinCuenta: EmpresaEmpleadora[] = [];
  for (const [empresa, v] of agg) {
    if (esGolden(empresa)) {
      porEmpresa.push({ empresa, totalQ: round2(v.totalQ), numEmpleados: v.numEmpleados });
    } else {
      const cuenta = cuentaCxCDeEmpresa(empresa);
      if (!cuenta) empresasSinCuenta.push(empresa);
      porEmpresa.push({
        empresa,
        totalQ: round2(v.totalQ),
        numEmpleados: v.numEmpleados,
        cuentaContableId: cuenta?.recordId,
        cuentaCodigo:     cuenta?.codigo,
      });
    }
  }
  // Orden estable: Golden primero, luego intercompany por orden alfabético.
  porEmpresa.sort((a, b) => {
    const ga = esGolden(a.empresa) ? 0 : 1;
    const gb = esGolden(b.empresa) ? 0 : 1;
    if (ga !== gb) return ga - gb;
    return a.empresa.localeCompare(b.empresa);
  });

  // Partidas DÉBITO proyectadas.
  const partidas: PartidaDebitoProyectada[] = [];
  for (const d of porEmpresa) {
    if (d.totalQ <= 0) continue;
    if (esGolden(d.empresa)) {
      partidas.push({
        tipo: 'gasto_nomina_golden',
        montoQ: d.totalQ,
        numEmpleados: d.numEmpleados,
        descripcion: `Gasto nómina Golden — ${input.periodoNombre} (${d.numEmpleados} ${d.numEmpleados === 1 ? 'empleado' : 'empleados'})`,
      });
    } else if (d.cuentaContableId) {
      partidas.push({
        tipo: 'cxc_intercompany',
        cuentaContableId: d.cuentaContableId,
        cuentaCodigo: d.cuentaCodigo,
        empresa: d.empresa as EmpresaIntercompany,
        montoQ: d.totalQ,
        numEmpleados: d.numEmpleados,
        descripcion: `Quincena ${input.periodoNombre} por cuenta de ${d.empresa} — ${d.numEmpleados} ${d.numEmpleados === 1 ? 'empleado' : 'empleados'}`,
      });
    }
    // Sin cuenta CxC mapeada: se reporta en empresasSinCuenta pero NO se
    // crea partida (el generador real debe bloquear el flujo si esto pasa).
  }

  return {
    totalNetoQ: round2(totalNetoQ),
    porEmpresa,
    partidas,
    empresasSinCuenta,
  };
}
