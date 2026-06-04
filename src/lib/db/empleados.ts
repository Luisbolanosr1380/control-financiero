/**
 * F-037 — Empleados (módulo planilla, Fase 1).
 *
 * Lee EMPLEADOS de Airtable, hidrata con cálculos de antigüedad, provisiones
 * acumuladas y referencias a DEUDAS con Tipo_Documento='Salario Pendiente'.
 *
 * Integración con módulo de Deudas (Salarios Pendientes):
 *  - Cuando un empleado no recibe su quincena, se difiere como una deuda de tipo
 *    "Salario Pendiente" contra un ACREEDOR auto-generado del propio empleado.
 *  - El ACREEDOR se crea bajo demanda (opción A): la primera vez que el empleado
 *    tiene deuda salarial. Se guarda el link en EMPLEADOS.Acreedor_Vinculado para
 *    reusar después.
 */

import { airtable, USE_MOCK, TABLES } from './airtable';
import { getCentrosCosto } from './centros';
import { getBancos } from './bancos';
import { getDeudas, type Deuda } from './deudas';
import {
  calcularAntiguedad,
  calcularProvisionesAcumuladas,
  type Antiguedad,
  type ProvisionesAcumuladas,
} from '../calculos/planilla';

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ============================================================
 * Tipos públicos
 * ============================================================ */

export type StatusEmpleado = 'ACTIVO' | 'INACTIVO' | 'DESPIDO' | 'RENUNCIA' | 'ABANDONO DE LABORES';

export interface SalariosPendientes {
  total: number;
  cantidad: number;
  deudaIds: string[];
}

export interface Empleado {
  id: string;
  nombre: string;
  numeroDocumento?: string;
  status: StatusEmpleado;
  fechaIngreso: string;
  fechaSalida?: string;
  motivoSalida?: string;
  sede?: string;
  idPuesto?: string;
  departamento: string;
  tipoContrato?: string;
  centroCostoId?: string;
  centroCostoNombre?: string;

  salarioBase: number;
  bonificacionIncentivo: number;
  bonoVariable: number;
  salarioMensual: number;          // de la fórmula Salario Mensual

  igssPatronal: number;
  provisionBono14: number;
  provisionAguinaldo: number;
  provisionVacaciones: number;
  provisionIndemnizacion: number;
  costoTotalMensual: number;       // Salario Total (fórmula)
  costoXHora: number;

  bancoId?: string;
  bancoNombre?: string;
  cuentaBancaria?: string;

  acreedorVinculadoId?: string;
  antiguedad: Antiguedad;
  provisionesAcumuladas: ProvisionesAcumuladas;
  salariosPendientes: SalariosPendientes;

  tieneDatosCompletos: boolean;
  alertas: string[];
}

export interface EmpleadosFiltros {
  status?: StatusEmpleado | 'todos';
  departamento?: string;
  centroCostoId?: string;
  search?: string;
  conSalariosPendientes?: boolean;
}

/* ============================================================
 * Campos Airtable (escritura + lectura)
 * ============================================================ */

const FE = {
  NOMBRE:       'NOMBRE',
  CENTRO_COSTO: 'CENTROS_COSTO',
  NO_DOC:       'No_DOCUMENTO',
  STATUS:       'STATUS_LABORANDO',
  FECHA_ING:    'FECHA_INGRESO',
  SEDE:         'SEDE',
  ID_PUESTO:    'ID_PUESTO',
  DEPTO:        'DEPARTAMENTO',
  BANCO:        'BANCO',
  CUENTA:       'CUENTA_BANCARIA',
  SALARIO:      'Salario Actual',
  BONIFICACION: 'Bonificacion',
  BONO_VAR:     'Bono Variable',
  SAL_MENSUAL:  'Salario Mensual',
  IGSS_PAT:     'Cuota Patronal (IGSS) -12.67%',
  BONO_14:      'Bono 14 - 8.33%',
  AGUINALDO:    'Aguinaldo - 8.33%',
  VACACIONES:   'Vacaciones - 4.17%',
  INDEM:        'Indemnizacion -9.72%',
  SAL_TOTAL:    'Salario Total',
  COSTO_HORA:   'Costo x Hora',
  TIPO_CONT:    'TIPO DE CONTRATO',
  // F-037 nuevos
  FECHA_SAL:    'Fecha_Salida',
  MOTIVO_SAL:   'Motivo_Salida',
  ACREEDOR_VIN: 'Acreedor_Vinculado',
} as const;

const arrFirst = (v: unknown): string => Array.isArray(v) ? String(v[0] ?? '') : '';
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function statusFromAirtable(v: unknown): StatusEmpleado {
  const s = String(v ?? '').toUpperCase().trim();
  if (s === 'ACTIVO' || s === 'INACTIVO' || s === 'DESPIDO' || s === 'RENUNCIA' || s === 'ABANDONO DE LABORES') {
    return s as StatusEmpleado;
  }
  return 'INACTIVO';
}

function esActivo(s: StatusEmpleado): boolean {
  return s === 'ACTIVO';
}

/* ============================================================
 * Lectura
 * ============================================================ */

export async function getEmpleados(filtros: EmpleadosFiltros = {}): Promise<Empleado[]> {
  if (USE_MOCK || !airtable) return [];

  try {
    const [recs, centros, bancos, deudas] = await Promise.all([
      airtable(TABLES.EMPLEADOS).select().all(),
      getCentrosCosto(),
      getBancos(),
      getDeudas(),
    ]);

    const ccNombrePorId = new Map(centros.map(c => [c.id, c.nombre]));
    const bancoNombrePorId = new Map(bancos.map(b => [b.id, b.nombreCuenta || b.banco || b.id]));

    // Mapeo: acreedorId → deudas activas de Salario Pendiente
    const deudasPorAcreedor = new Map<string, Deuda[]>();
    for (const d of deudas) {
      if (d.tipoDocumento !== 'Salario Pendiente') continue;
      if (/liquidada/i.test(d.estadoDeuda))         continue;     // ya pagada, no cuenta
      const list = deudasPorAcreedor.get(d.acreedorId) ?? [];
      list.push(d);
      deudasPorAcreedor.set(d.acreedorId, list);
    }

    const empleados: Empleado[] = recs.map(r => {
      const f = r.fields as Record<string, unknown>;
      const nombre = String(f[FE.NOMBRE] ?? '').trim();
      const ccId  = arrFirst(f[FE.CENTRO_COSTO]);
      const status = statusFromAirtable(f[FE.STATUS]);
      const fechaIngreso = String(f[FE.FECHA_ING] ?? '');
      const salarioBase  = num(f[FE.SALARIO]);
      const salarioMensual = num(f[FE.SAL_MENSUAL]);
      const acreedorVinculadoId = arrFirst(f[FE.ACREEDOR_VIN]) || undefined;
      const bancoId  = arrFirst(f[FE.BANCO]);

      const antiguedad = calcularAntiguedad(fechaIngreso, new Date());
      const provisionesAcumuladas = esActivo(status) && salarioMensual > 0 && fechaIngreso
        ? calcularProvisionesAcumuladas({ fechaIngreso, salarioMensual, salarioBase }, new Date())
        : { bono14: 0, aguinaldo: 0, vacaciones: { diasAcumulados: 0, valorMonetario: 0 }, indemnizacionPotencial: 0, totalPasivoLaboral: 0 };

      // Salarios pendientes desde DEUDAS
      const deudasSal = acreedorVinculadoId ? (deudasPorAcreedor.get(acreedorVinculadoId) ?? []) : [];
      const salariosPendientes: SalariosPendientes = {
        total:    round2(deudasSal.reduce((s, d) => s + d.saldoPendiente, 0)),
        cantidad: deudasSal.length,
        deudaIds: deudasSal.map(d => d.id),
      };

      // Datos completos / alertas
      const alertas: string[] = [];
      if (!salarioBase)                      alertas.push('Sin salario base');
      if (!fechaIngreso)                     alertas.push('Sin fecha de ingreso');
      if (!bancoId)                          alertas.push('Sin banco asignado');
      if (esActivo(status) && !String(f[FE.CUENTA] ?? '').trim()) alertas.push('Sin cuenta bancaria');
      const tieneDatosCompletos = alertas.length === 0;

      return {
        id: r.id,
        nombre,
        numeroDocumento: num(f[FE.NO_DOC]) > 0 ? String(num(f[FE.NO_DOC])) : undefined,
        status,
        fechaIngreso,
        fechaSalida:    String(f[FE.FECHA_SAL] ?? '') || undefined,
        motivoSalida:   String(f[FE.MOTIVO_SAL] ?? '') || undefined,
        sede:           Array.isArray(f[FE.SEDE]) ? (f[FE.SEDE] as string[]).join(', ') : undefined,
        idPuesto:       String(f[FE.ID_PUESTO] ?? '') || undefined,
        departamento:   String(f[FE.DEPTO] ?? '') || 'Sin departamento',
        tipoContrato:   String(f[FE.TIPO_CONT] ?? '') || undefined,
        centroCostoId:  ccId || undefined,
        centroCostoNombre: ccId ? ccNombrePorId.get(ccId) : undefined,

        salarioBase,
        bonificacionIncentivo: num(f[FE.BONIFICACION]),
        bonoVariable:          num(f[FE.BONO_VAR]),
        salarioMensual,

        igssPatronal:           num(f[FE.IGSS_PAT]),
        provisionBono14:        num(f[FE.BONO_14]),
        provisionAguinaldo:     num(f[FE.AGUINALDO]),
        provisionVacaciones:    num(f[FE.VACACIONES]),
        provisionIndemnizacion: num(f[FE.INDEM]),
        costoTotalMensual:      num(f[FE.SAL_TOTAL]),
        costoXHora:             num(f[FE.COSTO_HORA]),

        bancoId:      bancoId || undefined,
        bancoNombre:  bancoId ? bancoNombrePorId.get(bancoId) : undefined,
        cuentaBancaria: String(f[FE.CUENTA] ?? '') || undefined,

        acreedorVinculadoId,
        antiguedad,
        provisionesAcumuladas,
        salariosPendientes,
        tieneDatosCompletos,
        alertas,
      };
    });

    // Filtros
    let r = empleados;
    if (filtros.status && filtros.status !== 'todos') r = r.filter(e => e.status === filtros.status);
    if (filtros.departamento)                          r = r.filter(e => e.departamento === filtros.departamento);
    if (filtros.centroCostoId)                         r = r.filter(e => e.centroCostoId === filtros.centroCostoId);
    if (filtros.conSalariosPendientes)                 r = r.filter(e => e.salariosPendientes.cantidad > 0);
    if (filtros.search?.trim()) {
      const q = filtros.search.toLowerCase();
      r = r.filter(e =>
        e.nombre.toLowerCase().includes(q) ||
        (e.numeroDocumento ?? '').toLowerCase().includes(q) ||
        e.departamento.toLowerCase().includes(q),
      );
    }

    // Orden: activos primero, luego por nombre
    r.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ACTIVO' ? -1 : 1;
      return a.nombre.localeCompare(b.nombre);
    });
    return r;
  } catch (err) {
    console.error('Error fetching empleados:', err);
    return [];
  }
}

export async function getEmpleadoPorId(id: string): Promise<Empleado | null> {
  const todos = await getEmpleados();
  return todos.find(e => e.id === id) ?? null;
}

/* ============================================================
 * KPIs agregados (para hero del listado)
 * ============================================================ */

export interface KPIsPlanilla {
  numActivos: number;
  numInactivos: number;
  numSinDatos: number;
  costoMensualTotal: number;        // suma costoTotalMensual de activos

  pasivoLaboral: {
    bono14: number;
    aguinaldo: number;
    vacaciones: number;
    indemnizacionPotencial: number;
    salariosPendientes: number;
    total: number;
  };
  salariosPendientesEmpleadosAfectados: number;
  proximoBono14Q: number;           // proyección estimada del próximo pago (julio)
}

export async function getKPIsPlanilla(): Promise<KPIsPlanilla> {
  const empleados = await getEmpleados();
  const activos = empleados.filter(e => esActivo(e.status));

  const costoMensualTotal = round2(activos.reduce((s, e) => s + e.costoTotalMensual, 0));

  const sumProv = activos.reduce(
    (acc, e) => ({
      bono14:        acc.bono14 + e.provisionesAcumuladas.bono14,
      aguinaldo:     acc.aguinaldo + e.provisionesAcumuladas.aguinaldo,
      vacaciones:    acc.vacaciones + e.provisionesAcumuladas.vacaciones.valorMonetario,
      indemnizacion: acc.indemnizacion + e.provisionesAcumuladas.indemnizacionPotencial,
    }),
    { bono14: 0, aguinaldo: 0, vacaciones: 0, indemnizacion: 0 },
  );

  const salariosPendientes = round2(empleados.reduce((s, e) => s + e.salariosPendientes.total, 0));
  const empleadosAfectados = empleados.filter(e => e.salariosPendientes.cantidad > 0).length;

  // Proyección próximo Bono 14: 1 salario base × empleados activos con > 1 año.
  // Aproximación simple para mostrar al CFO; cálculo exacto se hará al ejecutar la nómina.
  const proximoBono14Q = round2(activos.reduce((s, e) => s + (e.antiguedad.totalDias >= 365 ? e.salarioBase : (e.salarioBase * e.antiguedad.totalDias) / 365), 0));

  return {
    numActivos:   activos.length,
    numInactivos: empleados.length - activos.length,
    numSinDatos:  empleados.filter(e => !e.tieneDatosCompletos && esActivo(e.status)).length,
    costoMensualTotal,
    pasivoLaboral: {
      bono14:                 round2(sumProv.bono14),
      aguinaldo:              round2(sumProv.aguinaldo),
      vacaciones:             round2(sumProv.vacaciones),
      indemnizacionPotencial: round2(sumProv.indemnizacion),
      salariosPendientes,
      total:                  round2(sumProv.bono14 + sumProv.aguinaldo + sumProv.vacaciones + sumProv.indemnizacion + salariosPendientes),
    },
    salariosPendientesEmpleadosAfectados: empleadosAfectados,
    proximoBono14Q,
  };
}

/* ============================================================
 * F-042 — Vista por centro de costo + resumen consolidado de pendientes
 * ============================================================ */

export interface CentroCostoPlanillaItem {
  centroCostoId: string;
  centroCostoNombre: string;
  cantidadEmpleados: number;
  salariosBase: number;             // suma de Salario Mensual (base + bonif + bono var)
  prestaciones: number;             // IGSS patronal + Bono14 + Aguinaldo + Vac + Indem
  costoTotalMensual: number;        // Salario Total (fórmula Airtable)
  costoTotalAnual: number;          // *12
  porcentajePrestaciones: number;   // (prestaciones / salariosBase) * 100
}

export interface PlanillaPorCentroCosto {
  centrosCosto: CentroCostoPlanillaItem[];
  totalEmpleados: number;
  totalCostoMensual: number;
  totalCostoAnual: number;
}

const SIN_CC_ID = '__sin_cc__';

export async function getPlanillaPorCentroCosto(): Promise<PlanillaPorCentroCosto> {
  const empleados = await getEmpleados();
  const activos = empleados.filter(e => esActivo(e.status));

  const grupos = new Map<string, {
    id: string;
    nombre: string;
    cantidadEmpleados: number;
    salariosBase: number;
    prestaciones: number;
    costoTotalMensual: number;
  }>();

  for (const e of activos) {
    const id = e.centroCostoId ?? SIN_CC_ID;
    const nombre = e.centroCostoNombre ?? 'Sin centro asignado';
    const prest =
      e.igssPatronal +
      e.provisionBono14 +
      e.provisionAguinaldo +
      e.provisionVacaciones +
      e.provisionIndemnizacion;
    const g = grupos.get(id) ?? { id, nombre, cantidadEmpleados: 0, salariosBase: 0, prestaciones: 0, costoTotalMensual: 0 };
    g.cantidadEmpleados += 1;
    g.salariosBase += e.salarioMensual;
    g.prestaciones += prest;
    g.costoTotalMensual += e.costoTotalMensual;
    grupos.set(id, g);
  }

  const items: CentroCostoPlanillaItem[] = [...grupos.values()]
    .map(g => ({
      centroCostoId: g.id,
      centroCostoNombre: g.nombre,
      cantidadEmpleados: g.cantidadEmpleados,
      salariosBase: round2(g.salariosBase),
      prestaciones: round2(g.prestaciones),
      costoTotalMensual: round2(g.costoTotalMensual),
      costoTotalAnual: round2(g.costoTotalMensual * 12),
      porcentajePrestaciones: g.salariosBase > 0 ? round2((g.prestaciones / g.salariosBase) * 100) : 0,
    }))
    .sort((a, b) => b.costoTotalMensual - a.costoTotalMensual);

  const totalCostoMensual = round2(items.reduce((s, i) => s + i.costoTotalMensual, 0));
  return {
    centrosCosto: items,
    totalEmpleados: activos.length,
    totalCostoMensual,
    totalCostoAnual: round2(totalCostoMensual * 12),
  };
}

export interface PendientePlanillaItem {
  empleadoId: string;
  empleadoNombre: string;
  departamento: string;
  centroCosto: string;
  periodoNombre: string;
  netoAPagar: number;
  diasPendiente: number;
  alerta: 'normal' | 'amarilla' | 'naranja' | 'roja';
  planillaId: string;
}

export interface DiferidoItem {
  empleadoId: string;
  empleadoNombre: string;
  departamento: string;
  centroCosto: string;
  deudaId: string;
  monto: number;
  fechaDiferimiento: string;
  diasEnMora: number;
}

export interface ResumenSalariosPendientesConsolidado {
  pendientesPlanilla: {
    cantidad: number;
    montoTotal: number;
    empleados: PendientePlanillaItem[];
  };
  diferidos: {
    cantidad: number;
    montoTotal: number;
    empleados: DiferidoItem[];
  };
  totalConsolidado: number;
}

export async function getResumenSalariosPendientesConsolidado(): Promise<ResumenSalariosPendientesConsolidado> {
  // F-042: import dinámico de planillas para evitar ciclo a nivel de módulo
  // (planillas.ts ya importa getEmpleados desde acá).
  const planillasModule = await import('./planillas');
  const [pendientes, empleados, deudas] = await Promise.all([
    planillasModule.getPagosPendientes(),
    getEmpleados({ status: 'todos' }),
    getDeudas(),
  ]);

  const empById = new Map(empleados.map(e => [e.id, e]));
  const empByAcreedor = new Map<string, Empleado>();
  for (const e of empleados) if (e.acreedorVinculadoId) empByAcreedor.set(e.acreedorVinculadoId, e);

  // PENDIENTES: planilla aprobada sin pago registrado
  const pendienteItems: PendientePlanillaItem[] = pendientes.map(p => {
    const emp = empById.get(p.empleadoId);
    return {
      empleadoId: p.empleadoId,
      empleadoNombre: p.empleadoNombre,
      departamento: p.departamento,
      centroCosto: emp?.centroCostoNombre ?? 'Sin centro asignado',
      periodoNombre: p.periodoNombre,
      netoAPagar: p.netoAPagar,
      diasPendiente: p.diasPendiente,
      alerta: p.alerta,
      planillaId: p.planillaId,
    };
  });
  const pendienteMontoTotal = round2(pendienteItems.reduce((s, p) => s + p.netoAPagar, 0));

  // DIFERIDOS: deudas formales Tipo_Documento = 'Salario Pendiente' con saldo > 0
  const diferidoItems: DiferidoItem[] = [];
  for (const d of deudas) {
    if (d.tipoDocumento !== 'Salario Pendiente') continue;
    if (d.saldoPendiente <= 0.01) continue;
    const emp = empByAcreedor.get(d.acreedorId);
    diferidoItems.push({
      empleadoId: emp?.id ?? '',
      empleadoNombre: emp?.nombre ?? d.acreedorNombre,
      departamento: emp?.departamento ?? 'Sin departamento',
      centroCosto: emp?.centroCostoNombre ?? d.centroCostoNombre ?? 'Sin centro asignado',
      deudaId: d.id,
      monto: d.saldoPendiente,
      fechaDiferimiento: d.fechaEmision,
      diasEnMora: d.diasEnMora,
    });
  }
  diferidoItems.sort((a, b) => b.diasEnMora - a.diasEnMora);
  const diferidoMontoTotal = round2(diferidoItems.reduce((s, d) => s + d.monto, 0));

  return {
    pendientesPlanilla: {
      cantidad: pendienteItems.length,
      montoTotal: pendienteMontoTotal,
      empleados: pendienteItems,
    },
    diferidos: {
      cantidad: diferidoItems.length,
      montoTotal: diferidoMontoTotal,
      empleados: diferidoItems,
    },
    totalConsolidado: round2(pendienteMontoTotal + diferidoMontoTotal),
  };
}

/* ============================================================
 * CRUD (crear/editar/dar de baja)
 * ============================================================ */

export interface CrearEmpleadoInput {
  nombre: string;
  numeroDocumento?: string;
  fechaIngreso: string;
  departamento?: string;
  centroCostoId?: string;
  sede?: string;
  idPuesto?: string;
  tipoContrato?: string;
  salarioBase: number;
  bonificacionIncentivo?: number;
  bonoVariable?: number;
  bancoId?: string;
  cuentaBancaria?: string;
}

export interface EditarEmpleadoInput extends Partial<CrearEmpleadoInput> {
  status?: StatusEmpleado;
}

export type EmpleadoMutationResult =
  | { ok: true; empleadoId: string; mensaje: string }
  | { ok: false; error: string };

export async function crearEmpleado(input: CrearEmpleadoInput): Promise<EmpleadoMutationResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  const nombre = (input.nombre ?? '').trim();
  if (!nombre)              return { ok: false, error: 'Nombre es requerido.' };
  if (!input.fechaIngreso)  return { ok: false, error: 'Fecha de ingreso es requerida.' };
  if (!(input.salarioBase > 0)) return { ok: false, error: 'Salario base debe ser mayor a 0.' };

  try {
    type AField = string | number | string[] | undefined;
    const fields: Record<string, AField> = {
      [FE.NOMBRE]:       nombre,
      [FE.FECHA_ING]:    input.fechaIngreso,
      [FE.STATUS]:       'ACTIVO',
      [FE.SALARIO]:      input.salarioBase,
    };
    if (input.numeroDocumento)        fields[FE.NO_DOC]       = Number(input.numeroDocumento);
    if (input.departamento)           fields[FE.DEPTO]        = input.departamento;
    if (input.centroCostoId)          fields[FE.CENTRO_COSTO] = [input.centroCostoId];
    if (input.idPuesto)               fields[FE.ID_PUESTO]    = input.idPuesto;
    if (input.tipoContrato)           fields[FE.TIPO_CONT]    = input.tipoContrato;
    if (input.bonificacionIncentivo)  fields[FE.BONIFICACION] = input.bonificacionIncentivo;
    if (input.bonoVariable)           fields[FE.BONO_VAR]     = input.bonoVariable;
    if (input.bancoId)                fields[FE.BANCO]        = input.bancoId;
    if (input.cuentaBancaria)         fields[FE.CUENTA]       = input.cuentaBancaria;

    const created = await airtable(TABLES.EMPLEADOS).create(fields);
    return { ok: true, empleadoId: created.id, mensaje: `Empleado ${nombre} creado.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function editarEmpleado(id: string, input: EditarEmpleadoInput): Promise<EmpleadoMutationResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  try {
    type AField = string | number | string[] | undefined;
    const fields: Record<string, AField> = {};
    if (input.nombre?.trim())          fields[FE.NOMBRE]       = input.nombre.trim();
    if (input.fechaIngreso)            fields[FE.FECHA_ING]    = input.fechaIngreso;
    if (input.status)                  fields[FE.STATUS]       = input.status;
    if (typeof input.salarioBase === 'number') fields[FE.SALARIO] = input.salarioBase;
    if (input.numeroDocumento)         fields[FE.NO_DOC]       = Number(input.numeroDocumento);
    if (input.departamento)            fields[FE.DEPTO]        = input.departamento;
    if (input.centroCostoId)           fields[FE.CENTRO_COSTO] = [input.centroCostoId];
    if (input.idPuesto)                fields[FE.ID_PUESTO]    = input.idPuesto;
    if (input.tipoContrato)            fields[FE.TIPO_CONT]    = input.tipoContrato;
    if (typeof input.bonificacionIncentivo === 'number') fields[FE.BONIFICACION] = input.bonificacionIncentivo;
    if (typeof input.bonoVariable === 'number')           fields[FE.BONO_VAR]     = input.bonoVariable;
    if (input.bancoId)                 fields[FE.BANCO]        = input.bancoId;
    if (input.cuentaBancaria)          fields[FE.CUENTA]       = input.cuentaBancaria;

    if (Object.keys(fields).length === 0) return { ok: false, error: 'Sin cambios.' };

    await airtable(TABLES.EMPLEADOS).update([{ id, fields }]);
    return { ok: true, empleadoId: id, mensaje: 'Empleado actualizado.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Dar de baja: cambia STATUS_LABORANDO a INACTIVO (o al motivo específico
 * DESPIDO/RENUNCIA si querés mantener registro). Guarda Fecha_Salida y
 * Motivo_Salida. NO calcula liquidación — eso lo muestra el modal antes
 * de confirmar.
 */
export async function darDeBajaEmpleado(
  id: string,
  fechaSalida: string,
  motivoSalida: string,
  nuevoStatus: StatusEmpleado = 'INACTIVO',
): Promise<EmpleadoMutationResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (!fechaSalida) return { ok: false, error: 'Fecha de salida es requerida.' };
  if (!motivoSalida?.trim()) return { ok: false, error: 'Motivo de salida es requerido.' };
  try {
    await airtable(TABLES.EMPLEADOS).update([{
      id,
      fields: {
        [FE.STATUS]:     nuevoStatus,
        [FE.FECHA_SAL]:  fechaSalida,
        [FE.MOTIVO_SAL]: motivoSalida.trim(),
      },
    }]);
    return { ok: true, empleadoId: id, mensaje: 'Empleado dado de baja.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ============================================================
 * Integración con módulo de Deudas
 * ============================================================ */

/**
 * Devuelve el acreedorId vinculado al empleado. Si no existe, lo crea con
 * Tipo_Acreedor='Empleado' y vincula el ID al empleado (Acreedor_Vinculado).
 */
export async function obtenerOCrearAcreedorEmpleado(empleadoId: string): Promise<{ ok: true; acreedorId: string; creado: boolean } | { ok: false; error: string }> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  try {
    const empleado = await getEmpleadoPorId(empleadoId);
    if (!empleado) return { ok: false, error: 'Empleado no encontrado.' };

    if (empleado.acreedorVinculadoId) {
      return { ok: true, acreedorId: empleado.acreedorVinculadoId, creado: false };
    }

    // Crear acreedor directo en Airtable (saltamos crearAcreedor() porque
    // hace validación de duplicado sobre todos los acreedores y eso es
    // costoso para una operación que se hace pocas veces. Aquí confiamos
    // en el nombre del empleado).
    type AField = string | number | boolean | string[] | undefined;
    const acFields: Record<string, AField> = {
      'Acreedor_Nombre_Legal': empleado.nombre,
      'Tipo_Acreedor':         'Empleado',
      'Es_Parte_Relacionada':  false,
      'Moneda':                'Q',
      'Estatus':               'Activo',
      'Notas':                 `Acreedor auto-generado para empleado ${empleado.nombre} — F-037.`,
    };
    const createdAc = await airtable(TABLES.ACREEDORES).create(acFields);
    const acreedorId = createdAc.id;

    // Vincular en EMPLEADOS.Acreedor_Vinculado
    await airtable(TABLES.EMPLEADOS).update([{
      id: empleadoId,
      fields: { [FE.ACREEDOR_VIN]: [acreedorId] },
    }]);

    return { ok: true, acreedorId, creado: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface CrearDeudaSalarialResult {
  ok: boolean;
  deudaId?: string;
  acreedorId?: string;
  acreedorCreado?: boolean;
  mensaje?: string;
  error?: string;
}

/**
 * Crea una deuda salarial diferida para un empleado.
 *
 *  - Obtiene/crea el acreedor del empleado.
 *  - Crea record en DEUDAS con Tipo_Documento='Salario Pendiente'.
 *  - Estado: Pendiente (Estado_Deuda quedará como Vigente por la fórmula
 *    de Airtable).
 *  - Saldo_Pendiente sale solo via formula (Monto_GTQ - Total_Pagado).
 */
export async function crearDeudaSalarioPendiente(
  empleadoId: string,
  monto: number,
  fechaQuincena: string,
  notas?: string,
): Promise<CrearDeudaSalarialResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (!(monto > 0)) return { ok: false, error: 'El monto debe ser mayor a 0.' };
  if (!fechaQuincena) return { ok: false, error: 'Fecha de la quincena requerida.' };

  const acRes = await obtenerOCrearAcreedorEmpleado(empleadoId);
  if (!acRes.ok) return { ok: false, error: acRes.error };

  const empleado = await getEmpleadoPorId(empleadoId);
  if (!empleado) return { ok: false, error: 'Empleado no encontrado.' };

  try {
    type AField = string | number | boolean | string[] | undefined;
    const nombreDeuda = `Quincena diferida ${fechaQuincena} · ${empleado.nombre}`;
    const fields: Record<string, AField> = {
      'Acreedor':                 [acRes.acreedorId],
      'Nombre_Deuda / Código':    nombreDeuda,
      'Tipo_Documento':           'Salario Pendiente',
      'Estado':                   'Pendiente',
      'Fecha_Emision':            fechaQuincena,
      'Moneda':                   'GTQ',
      'Tipo_Cambio':              1,
      'Monto_Original':           monto,
    };
    if (empleado.centroCostoId)  fields['Centro_Costo'] = [empleado.centroCostoId];
    if (notas?.trim())           fields['Notas']        = notas.trim();

    const created = await airtable(TABLES.DEUDAS).create(fields);
    return {
      ok: true,
      deudaId: created.id,
      acreedorId: acRes.acreedorId,
      acreedorCreado: acRes.creado,
      mensaje: `Deuda salarial creada (Q${monto.toFixed(2)}) — ${empleado.nombre}.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
