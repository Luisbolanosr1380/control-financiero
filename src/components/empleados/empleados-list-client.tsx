'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { HelpButton } from '@/components/ayuda/help-button';
import { ModalEmpleadoForm } from './modal-empleado-form';
import type {
  Empleado,
  KPIsPlanilla,
  PlanillaPorCentroCosto,
  ResumenSalariosPendientesConsolidado,
} from '@/lib/db/empleados';

interface Props {
  empleados: Empleado[];
  kpis: KPIsPlanilla;
  centros: Array<{ id: string; nombre: string }>;
  planillaPorCC: PlanillaPorCentroCosto;
  resumenPendientes: ResumenSalariosPendientesConsolidado;
}

// F-042 paleta para barras CC — alineada con tokens del sistema.
// F-042.1: usaba 'var(--warn)' pero ese token no existe globalmente — un
// var() sin resolver dentro de conic-gradient invalida el gradiente entero
// y el donut quedaba transparente. Se reemplaza por 'var(--amber)' (que sí
// existe en globals.css con el mismo intent visual) y se agregan dos
// tokens de línea de negocio para diversificar la paleta cuando hay >4 CCs.
const CC_COLORS = ['var(--olive)', 'var(--wine)', 'var(--amber)', 'var(--indigo)', 'var(--ink-2)', 'var(--ink-4)'];

type DonutModo = 'departamento' | 'centro_costo';
const DONUT_KEY = 'fc.empleados.donut-modo';

export function EmpleadosListClient({ empleados, kpis, centros, planillaPorCC, resumenPendientes }: Props) {
  const router = useRouter();
  const [statusFiltro, setStatusFiltro]   = useState<'todos' | 'ACTIVO' | 'INACTIVO'>('todos');
  const [departamento, setDepartamento]   = useState('');
  const [centroId, setCentroId]           = useState('');
  const [search, setSearch]               = useState('');
  const [soloConPendientes, setSoloPend]  = useState(false);
  const [openCrear, setOpenCrear]         = useState(false);

  // F-042 PARTE D: toggle de donut Departamento vs Centro de Costo. Default CC
  // porque para el CFO es la vista útil (margen por línea = facturación CC / planilla CC).
  const [donutModo, setDonutModo] = useState<DonutModo>('centro_costo');
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(DONUT_KEY) : null;
    if (stored === 'departamento' || stored === 'centro_costo') setDonutModo(stored);
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(DONUT_KEY, donutModo);
  }, [donutModo]);

  const departamentos = useMemo(
    () => [...new Set(empleados.map(e => e.departamento).filter(Boolean))].sort(),
    [empleados],
  );

  // F-042: agregados para el donut por departamento (los del CC ya vienen del server).
  const costoPorDepartamento = useMemo(() => {
    const m = new Map<string, { nombre: string; cantidadEmpleados: number; costoTotalMensual: number }>();
    for (const e of empleados.filter(e => e.status === 'ACTIVO')) {
      const k = e.departamento || 'Sin departamento';
      const g = m.get(k) ?? { nombre: k, cantidadEmpleados: 0, costoTotalMensual: 0 };
      g.cantidadEmpleados += 1;
      g.costoTotalMensual += e.costoTotalMensual;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.costoTotalMensual - a.costoTotalMensual);
  }, [empleados]);

  const filtrados = useMemo(() => {
    let r = empleados;
    if (statusFiltro !== 'todos') {
      r = statusFiltro === 'ACTIVO'
        ? r.filter(e => e.status === 'ACTIVO')
        : r.filter(e => e.status !== 'ACTIVO');
    }
    if (departamento) r = r.filter(e => e.departamento === departamento);
    if (centroId)     r = r.filter(e => e.centroCostoId === centroId);
    if (soloConPendientes) r = r.filter(e => e.salariosPendientes.cantidad > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(e =>
        e.nombre.toLowerCase().includes(q) ||
        (e.numeroDocumento ?? '').toLowerCase().includes(q) ||
        e.departamento.toLowerCase().includes(q),
      );
    }
    return r;
  }, [empleados, statusFiltro, departamento, centroId, soloConPendientes, search]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Empleados
            <HelpButton tag="modulo-empleados" />
          </h1>
          <div className="page-subtitle">
            <span className="num">{kpis.numActivos}</span> activos · <span className="num">{kpis.numInactivos}</span> inactivos · planilla y prestaciones acumuladas
            {resumenPendientes.totalConsolidado === 0 && (
              <span className="badge badge-olive" style={{ marginLeft: 10, fontSize: 10 }}>✓ Salarios al día</span>
            )}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setOpenCrear(true)}>
            <I.Plus size={13} /> Nuevo empleado
          </button>
        </div>
      </div>

      {/* HERO — 6 KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 22 }}>
        <Kpi label="👥 Plantilla" value={`${kpis.numActivos} activos`} hint={`${kpis.numInactivos} inactivos`} />
        <Kpi label="💰 Costo mensual" value={Q(kpis.costoMensualTotal)} hint="con prestaciones e IGSS patronal" />
        <Kpi label="📊 Pasivo laboral" value={Q(kpis.pasivoLaboral.total)} hint="provisiones acumuladas + salarios pendientes" />
        <Kpi
          label="⚠️ Salarios pendientes"
          value={Q(kpis.pasivoLaboral.salariosPendientes)}
          hint={kpis.salariosPendientesEmpleadosAfectados > 0
            ? `${kpis.salariosPendientesEmpleadosAfectados} empleado${kpis.salariosPendientesEmpleadosAfectados === 1 ? '' : 's'} con quincenas diferidas`
            : 'sin salarios diferidos'}
          alarma={kpis.pasivoLaboral.salariosPendientes > 0}
        />
        <Kpi label="📅 Próximo Bono 14" value={Q(kpis.proximoBono14Q)} hint="proyección aprox. al pago de julio" />
        <Kpi
          label="⚠️ Empleados sin datos"
          value={kpis.numSinDatos.toString()}
          hint={kpis.numSinDatos > 0 ? 'falta banco/cuenta/salario' : 'todos completos ✓'}
          alarma={kpis.numSinDatos > 0}
        />
      </div>

      {/* F-042 PARTE B — Salarios pendientes (consolidado) */}
      <SalariosPendientesSection resumen={resumenPendientes} />

      {/* F-042 PARTE C — Planilla por Centro de Costo */}
      <PlanillaPorCentroCostoSection data={planillaPorCC} />

      {/* F-042 PARTE D — Donut con toggle Departamento / Centro de Costo */}
      <CostoDonutSection
        modo={donutModo}
        onChangeModo={setDonutModo}
        porDepartamento={costoPorDepartamento}
        porCC={planillaPorCC}
      />

      {/* Desglose pasivo laboral */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Pasivo laboral acumulado (al día)</div>
          <div className="card-actions">
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              Lo que la empresa le debe HOY a los empleados activos si tuviera que liquidar
            </span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderTop: '1px solid var(--line-3)' }}>
          <DesgloseCell label="Bono 14"        valor={kpis.pasivoLaboral.bono14} />
          <DesgloseCell label="Aguinaldo"      valor={kpis.pasivoLaboral.aguinaldo} />
          <DesgloseCell label="Vacaciones"     valor={kpis.pasivoLaboral.vacaciones} />
          <DesgloseCell label="Indemnización potencial" valor={kpis.pasivoLaboral.indemnizacionPotencial} />
          <DesgloseCell label="Salarios pendientes" valor={kpis.pasivoLaboral.salariosPendientes} highlight={kpis.pasivoLaboral.salariosPendientes > 0} />
        </div>
      </div>

      {/* Filtros */}
      <div className="card" style={{ padding: 0, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value as typeof statusFiltro)} style={selectStyle}>
            <option value="todos">Status (todos)</option>
            <option value="ACTIVO">Activos</option>
            <option value="INACTIVO">Inactivos</option>
          </select>
          <select value={departamento} onChange={(e) => setDepartamento(e.target.value)} style={selectStyle}>
            <option value="">Departamento (todos)</option>
            {departamentos.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={centroId} onChange={(e) => setCentroId(e.target.value)} style={selectStyle}>
            <option value="">Centro (todos)</option>
            {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-3)' }}>
            <input type="checkbox" checked={soloConPendientes} onChange={(e) => setSoloPend(e.target.checked)} />
            Con salarios pendientes
          </label>
          <div className="toolbar-search" style={{ marginLeft: 'auto' }}>
            <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
            <input placeholder="Nombre, DPI, departamento…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">{filtrados.length} empleado{filtrados.length === 1 ? '' : 's'}</div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Departamento</th>
              <th>Antigüedad</th>
              <th className="num">Salario mensual</th>
              <th className="num">Costo total</th>
              <th className="num">Indemnización potencial</th>
              <th className="num">Salarios pendientes</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr><td colSpan={8} style={{ height: 160, textAlign: 'center', color: 'var(--ink-4)' }}>
                <I.Users size={26} style={{ opacity: 0.4, marginBottom: 6 }} />
                <div style={{ fontSize: 13 }}>Sin empleados bajo los filtros actuales</div>
              </td></tr>
            ) : filtrados.map(e => {
              const tieneAlerta = !e.tieneDatosCompletos && e.status === 'ACTIVO';
              const inactivo    = e.status !== 'ACTIVO';
              return (
                <tr key={e.id} className="clickable" onClick={() => router.push(`/empleados/${e.id}`)} style={{ opacity: inactivo ? 0.6 : 1 }}>
                  <td className="cell-strong">{e.nombre}</td>
                  <td className="cell-mute">{e.departamento}</td>
                  <td className="cell-mute" style={{ whiteSpace: 'nowrap' }}>{e.antiguedad.textoLegible}</td>
                  <td className="num cell-strong">{Q(e.salarioMensual)}</td>
                  <td className="num cell-strong">{Q(e.costoTotalMensual)}</td>
                  <td className="num">{Q(e.provisionesAcumuladas.indemnizacionPotencial)}</td>
                  <td className="num" style={{ color: e.salariosPendientes.total > 0 ? 'var(--wine)' : 'var(--ink-4)', fontWeight: e.salariosPendientes.total > 0 ? 500 : 400 }}>
                    {e.salariosPendientes.total > 0
                      ? <>{Q(e.salariosPendientes.total)} <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>· {e.salariosPendientes.cantidad}</span></>
                      : '—'}
                  </td>
                  <td>
                    {inactivo ? (
                      <span className="badge badge-mute">{e.status}</span>
                    ) : tieneAlerta ? (
                      <span className="badge badge-warn" title={e.alertas.join(' · ')}>⚠️ Datos incompletos</span>
                    ) : (
                      <span className="badge badge-olive">✓ Completo</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openCrear && (
        <ModalEmpleadoForm modo="crear" centros={centros} departamentos={departamentos} onClose={() => setOpenCrear(false)} />
      )}
    </div>
  );
}

function Kpi({ label, value, hint, alarma }: { label: string; value: string; hint?: string; alarma?: boolean }) {
  return (
    <div className="kpi" style={alarma ? { borderColor: 'var(--wine)' } : undefined}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: alarma ? 'var(--wine)' : 'var(--ink)' }}>{value}</div>
      {hint && <div className="kpi-delta"><span className="vs">{hint}</span></div>}
    </div>
  );
}

function DesgloseCell({ label, valor, highlight }: { label: string; valor: number; highlight?: boolean }) {
  return (
    <div style={{ padding: '14px 18px', borderRight: '1px solid var(--line-3)' }}>
      <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 500, color: highlight ? 'var(--wine)' : 'var(--ink)' }}>{Q(valor)}</div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 8px', borderRadius: 4,
  border: '1px solid var(--line-2)', background: 'var(--paper-2)',
  color: 'var(--ink)', fontFamily: 'inherit',
};

/* ============================================================
 * F-042 PARTE B — Salarios pendientes (Pendientes + Diferidos)
 * ============================================================ */

function SalariosPendientesSection({ resumen }: { resumen: ResumenSalariosPendientesConsolidado }) {
  // Si no hay nada, no ocupamos pantalla (badge "Al día" ya está en el subtitle).
  if (resumen.totalConsolidado === 0) return null;

  const { pendientesPlanilla, diferidos, totalConsolidado } = resumen;

  // Conteo de alertas en pendientes para el bullet de arriba del monto.
  const alertaCounts = pendientesPlanilla.empleados.reduce(
    (acc, e) => {
      if (e.alerta === 'amarilla') acc.amarillas += 1;
      else if (e.alerta === 'naranja') acc.naranjas += 1;
      else if (e.alerta === 'roja') acc.rojas += 1;
      return acc;
    },
    { amarillas: 0, naranjas: 0, rojas: 0 },
  );
  const hayAlertas = alertaCounts.amarillas + alertaCounts.naranjas + alertaCounts.rojas > 0;

  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">
        <div className="card-title">💰 Salarios pendientes</div>
        <div className="card-actions">
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            Total consolidado: <span className="num" style={{ color: 'var(--ink)', fontWeight: 500 }}>{Q(totalConsolidado)}</span>
          </span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', borderTop: '1px solid var(--line-3)' }}>
        {/* Pendientes de pago */}
        <div style={{ padding: '16px 20px', borderRight: '1px solid var(--line-3)' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>
            ⏸ Pendientes de pago
          </div>
          {pendientesPlanilla.cantidad === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-4)', padding: '8px 0' }}>Sin pendientes — todas las planillas aprobadas ya pagadas.</div>
          ) : (
            <>
              {hayAlertas && (
                <div style={{ fontSize: 10, color: 'var(--ink-4)', marginBottom: 4 }}>
                  {alertaCounts.amarillas > 0 && <span style={{ marginRight: 8 }}>⚠ {alertaCounts.amarillas} amarilla{alertaCounts.amarillas === 1 ? '' : 's'}</span>}
                  {alertaCounts.naranjas > 0 && <span style={{ marginRight: 8, color: 'var(--amber)' }}>🟠 {alertaCounts.naranjas} naranja{alertaCounts.naranjas === 1 ? '' : 's'}</span>}
                  {alertaCounts.rojas > 0 && <span style={{ color: 'var(--wine)' }}>🔴 {alertaCounts.rojas} roja{alertaCounts.rojas === 1 ? '' : 's'}</span>}
                </div>
              )}
              <div className="num" style={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)' }}>
                {Q(pendientesPlanilla.montoTotal)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                {pendientesPlanilla.cantidad} empleado{pendientesPlanilla.cantidad === 1 ? '' : 's'} · planilla{pendientesPlanilla.cantidad === 1 ? '' : 's'} aprobada{pendientesPlanilla.cantidad === 1 ? '' : 's'} sin pagar
              </div>
              <Link href="/planillas/pendientes" style={{ display: 'inline-block', marginTop: 10, fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                Ver detalle →
              </Link>
            </>
          )}
        </div>
        {/* Diferidos */}
        <div style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>
            ⚠ Diferidos a deuda
          </div>
          {diferidos.cantidad === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-4)', padding: '8px 0' }}>Sin diferimientos formales activos.</div>
          ) : (
            <>
              <div className="num" style={{ fontSize: 22, fontWeight: 500, color: 'var(--wine)' }}>
                {Q(diferidos.montoTotal)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                {diferidos.cantidad} empleado{diferidos.cantidad === 1 ? '' : 's'} · ya en /deudas como deuda formal
              </div>
              <Link href="/deudas?categoria=empleados" style={{ display: 'inline-block', marginTop: 10, fontSize: 11, color: 'var(--wine)', textDecoration: 'none' }}>
                Ver en deudas →
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * F-042 PARTE C — Planilla por Centro de Costo
 * ============================================================ */

function PlanillaPorCentroCostoSection({ data }: { data: PlanillaPorCentroCosto }) {
  if (data.centrosCosto.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">
        <div className="card-title">🏢 Planilla por Centro de Costo</div>
        <div className="card-actions">
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            Total mensual: <span className="num" style={{ color: 'var(--ink)', fontWeight: 500 }}>{Q(data.totalCostoMensual)}</span>
            {' · '}
            <span className="num">{data.totalEmpleados}</span> empleado{data.totalEmpleados === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', padding: 14, gap: 12 }}>
        {data.centrosCosto.map((cc, idx) => {
          const pct = data.totalCostoMensual > 0
            ? (cc.costoTotalMensual / data.totalCostoMensual) * 100
            : 0;
          const isSinCC = cc.centroCostoId === '__sin_cc__';
          return (
            <div
              key={cc.centroCostoId}
              style={{
                padding: 14,
                borderRadius: 6,
                background: 'var(--paper-2)',
                border: isSinCC ? '1px solid var(--wine)' : '1px solid var(--line-3)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
                  {isSinCC && <span style={{ marginRight: 4, color: 'var(--wine)' }}>⚠</span>}
                  {cc.centroCostoNombre}
                </div>
                <div style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                  {cc.cantidadEmpleados} emp.
                </div>
              </div>
              <div className="num" style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>
                {Q(cc.costoTotalMensual)}<span style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 400 }}> /mes</span>
              </div>
              <div className="num" style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 8 }}>
                {Q(cc.costoTotalAnual)} /año
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{pct.toFixed(1)}% del total</span>
                <div style={{ flex: 1, height: 4, background: 'var(--line-3)', borderRadius: 2, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.min(100, pct)}%`,
                      height: '100%',
                      background: CC_COLORS[idx % CC_COLORS.length],
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
 * F-042 PARTE D — Donut con toggle Departamento / Centro de Costo
 * ============================================================ */

interface DonutItem { nombre: string; cantidadEmpleados: number; costoTotalMensual: number }

function CostoDonutSection({
  modo,
  onChangeModo,
  porDepartamento,
  porCC,
}: {
  modo: DonutModo;
  onChangeModo: (m: DonutModo) => void;
  porDepartamento: DonutItem[];
  porCC: PlanillaPorCentroCosto;
}) {
  const items: DonutItem[] = modo === 'departamento'
    ? porDepartamento
    : porCC.centrosCosto.map(c => ({
        nombre: c.centroCostoNombre,
        cantidadEmpleados: c.cantidadEmpleados,
        costoTotalMensual: c.costoTotalMensual,
      }));
  const total = items.reduce((s, i) => s + i.costoTotalMensual, 0);
  if (total === 0) return null;

  // Construcción de segmentos de donut con conic-gradient.
  let acumPct = 0;
  const stops: string[] = [];
  const leyenda = items.map((it, idx) => {
    const pct = (it.costoTotalMensual / total) * 100;
    const color = CC_COLORS[idx % CC_COLORS.length];
    const desde = acumPct;
    acumPct += pct;
    stops.push(`${color} ${desde}% ${acumPct}%`);
    return { nombre: it.nombre, cantidadEmpleados: it.cantidadEmpleados, monto: it.costoTotalMensual, pct, color };
  });
  const conic = `conic-gradient(${stops.join(', ')})`;

  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">
        <div className="card-title">Composición del costo mensual</div>
        <div className="card-actions" style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="btn"
            onClick={() => onChangeModo('departamento')}
            style={{
              fontSize: 11, padding: '4px 10px',
              background: modo === 'departamento' ? 'var(--ink)' : 'transparent',
              color:      modo === 'departamento' ? 'var(--paper)' : 'var(--ink-3)',
              border: '1px solid var(--line-2)',
            }}
          >
            Por Departamento
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onChangeModo('centro_costo')}
            style={{
              fontSize: 11, padding: '4px 10px',
              background: modo === 'centro_costo' ? 'var(--ink)' : 'transparent',
              color:      modo === 'centro_costo' ? 'var(--paper)' : 'var(--ink-3)',
              border: '1px solid var(--line-2)',
            }}
          >
            Por Centro de Costo
          </button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 24, padding: 18, alignItems: 'center' }}>
        {/* Donut */}
        <div style={{ position: 'relative', width: 160, height: 160, margin: '0 auto' }}>
          <div
            style={{
              width: 160, height: 160, borderRadius: '50%',
              background: conic,
            }}
          />
          <div
            style={{
              position: 'absolute', top: 28, left: 28,
              width: 104, height: 104, borderRadius: '50%',
              background: 'var(--paper)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 500 }}>{Q(total)}</div>
            <div style={{ fontSize: 9, color: 'var(--ink-4)' }}>/mes</div>
          </div>
        </div>
        {/* Leyenda */}
        <div>
          {leyenda.map(l => (
            <div key={l.nombre} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line-3)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>{l.nombre}</span>
              <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{l.cantidadEmpleados} emp.</span>
              <span className="num" style={{ fontSize: 12, color: 'var(--ink-2)', minWidth: 80, textAlign: 'right' }}>{Q(l.monto)}</span>
              <span className="num" style={{ fontSize: 10, color: 'var(--ink-4)', minWidth: 40, textAlign: 'right' }}>{l.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
