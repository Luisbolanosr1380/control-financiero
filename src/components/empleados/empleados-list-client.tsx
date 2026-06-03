'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { ModalEmpleadoForm } from './modal-empleado-form';
import type { Empleado, KPIsPlanilla } from '@/lib/db/empleados';

interface Props {
  empleados: Empleado[];
  kpis: KPIsPlanilla;
  centros: Array<{ id: string; nombre: string }>;
}

export function EmpleadosListClient({ empleados, kpis, centros }: Props) {
  const router = useRouter();
  const [statusFiltro, setStatusFiltro]   = useState<'todos' | 'ACTIVO' | 'INACTIVO'>('todos');
  const [departamento, setDepartamento]   = useState('');
  const [centroId, setCentroId]           = useState('');
  const [search, setSearch]               = useState('');
  const [soloConPendientes, setSoloPend]  = useState(false);
  const [openCrear, setOpenCrear]         = useState(false);

  const departamentos = useMemo(
    () => [...new Set(empleados.map(e => e.departamento).filter(Boolean))].sort(),
    [empleados],
  );

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
          <h1 className="page-title">Empleados</h1>
          <div className="page-subtitle">
            <span className="num">{kpis.numActivos}</span> activos · <span className="num">{kpis.numInactivos}</span> inactivos · planilla y prestaciones acumuladas
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
