'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q, formatDate } from '@/lib/utils';
import { HelpButton } from '@/components/ayuda/help-button';
import { ModalGenerarPlanilla } from './modal-generar-planilla';
import type { Periodo, EstadoPeriodo } from '@/lib/db/planillas';

interface EmpleadoPreview {
  id: string;
  nombre: string;
  salarioBase: number;
  netoEstimado: number;
}

interface ProximaPlanilla {
  quincena: 1 | 2;
  mes: number;
  anio: number;
  nombre: string;
}

interface Props {
  periodos: Periodo[];
  empleadosActivos: EmpleadoPreview[];
  periodosExistentes: Array<{ quincena: 1 | 2; mes: number; anio: number }>;
  proximaPlanilla: ProximaPlanilla;
}

type EstadoFiltro = 'todos' | EstadoPeriodo;

const MESES_NUM = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function PlanillasListClient({ periodos, empleadosActivos, periodosExistentes, proximaPlanilla }: Props) {
  const router = useRouter();
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>('todos');
  const [anioFiltro, setAnioFiltro]     = useState<string>('');
  const [mesFiltro,  setMesFiltro]      = useState<string>('');
  const [openGenerar, setOpenGenerar]   = useState(false);

  const aniosDisponibles = useMemo(
    () => [...new Set(periodos.map(p => p.anio).filter(a => a > 0))].sort((a, b) => b - a),
    [periodos],
  );

  const filtrados = useMemo(() => {
    let r = periodos;
    if (estadoFiltro !== 'todos') r = r.filter(p => p.estado === estadoFiltro);
    if (anioFiltro)  r = r.filter(p => p.anio === Number(anioFiltro));
    if (mesFiltro)   r = r.filter(p => p.mes === Number(mesFiltro));
    return r;
  }, [periodos, estadoFiltro, anioFiltro, mesFiltro]);

  // KPIs calculados localmente
  const kpis = useMemo(() => {
    const cerradas = periodos.filter(p => p.estado === 'Cerrada');
    const ultimaPagada = [...cerradas].sort((a, b) => {
      if (a.anio !== b.anio) return b.anio - a.anio;
      if (a.mes !== b.mes) return b.mes - a.mes;
      return b.quincena - a.quincena;
    })[0];

    // Diferidos pendientes: períodos En pago (con líneas diferidas pendientes de pagar)
    // Como no tenemos las líneas en el listado, aproximamos por períodos en estado 'En pago' o 'Aprobada'.
    // Para una cifra Q sumable, usamos suma de montos en 'En pago' como proxy.
    const diferidosPendientes = periodos.filter(p => p.estado === 'En pago').length;

    const hoy = new Date();
    const mesActual = hoy.getMonth() + 1;
    const anioActual = hoy.getFullYear();
    const costoMes = periodos
      .filter(p => p.anio === anioActual && p.mes === mesActual)
      .reduce((s, p) => s + p.montoTotal, 0);

    return {
      proxima: proximaPlanilla,
      ultimaPagada,
      diferidosPendientes,
      costoMes,
    };
  }, [periodos, proximaPlanilla]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Planillas quincenales
            <HelpButton tag="modulo-planillas" />
          </h1>
          <div className="page-subtitle">
            <span className="num">{periodos.length}</span> período{periodos.length === 1 ? '' : 's'} registrado{periodos.length === 1 ? '' : 's'} · gestión de quincenas y pagos
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setOpenGenerar(true)}>
            <I.Plus size={13} /> Generar planilla del período
          </button>
        </div>
      </div>

      {/* HERO — 4 KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 22 }}>
        <Kpi
          label="📅 Próxima planilla"
          value={kpis.proxima.nombre}
          hint={`Q${kpis.proxima.quincena} · ${MESES_NUM[kpis.proxima.mes - 1]} ${kpis.proxima.anio}`}
        />
        <Kpi
          label="✓ Última pagada"
          value={kpis.ultimaPagada ? kpis.ultimaPagada.nombre : '—'}
          hint={kpis.ultimaPagada
            ? `Cerrada ${kpis.ultimaPagada.fechaCierre ? formatDate(kpis.ultimaPagada.fechaCierre) : '—'}`
            : 'sin planillas cerradas'}
        />
        <Kpi
          label="⚠️ Diferidos pendientes"
          value={kpis.diferidosPendientes.toString()}
          hint={kpis.diferidosPendientes > 0 ? 'períodos En pago con líneas abiertas' : 'sin períodos en curso'}
          alarma={kpis.diferidosPendientes > 0}
        />
        <Kpi
          label="💰 Costo mes en curso"
          value={Q(kpis.costoMes)}
          hint="suma de planillas del mes actual"
        />
      </div>

      {/* Filtros */}
      <div className="card" style={{ padding: 0, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value as EstadoFiltro)} style={selectStyle}>
            <option value="todos">Estado (todos)</option>
            <option value="Borrador">Borrador</option>
            <option value="Aprobada">Aprobada</option>
            <option value="En pago">En pago</option>
            <option value="Cerrada">Cerrada</option>
          </select>
          <select value={anioFiltro} onChange={(e) => setAnioFiltro(e.target.value)} style={selectStyle}>
            <option value="">Año (todos)</option>
            {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={mesFiltro} onChange={(e) => setMesFiltro(e.target.value)} style={selectStyle}>
            <option value="">Mes (todos)</option>
            {MESES_NUM.map((nombre, i) => (
              <option key={i} value={i + 1}>{nombre}</option>
            ))}
          </select>
          <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
            <span>{filtrados.length} resultado{filtrados.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">{filtrados.length} período{filtrados.length === 1 ? '' : 's'}</div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Período</th>
              <th className="num">Empleados</th>
              <th className="num">Monto total</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr><td colSpan={5} style={{ height: 160, textAlign: 'center', color: 'var(--ink-4)' }}>
                <I.Payroll size={26} style={{ opacity: 0.4, marginBottom: 6 }} />
                <div style={{ fontSize: 13 }}>Sin planillas bajo los filtros actuales</div>
              </td></tr>
            ) : filtrados.map(p => {
              const badge = estadoBadge(p.estado);
              return (
                <tr key={p.id} className="clickable" onClick={() => router.push(`/planillas/${p.id}`)}>
                  <td className="cell-strong">{p.nombre || '—'}</td>
                  <td className="num cell-strong">{p.cantidadEmpleados}</td>
                  <td className="num cell-strong">{Q(p.montoTotal)}</td>
                  <td><span className={'badge ' + badge.cls}>{badge.text}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {p.estado === 'Borrador' && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => router.push(`/planillas/${p.id}`)}
                      >
                        <I.Edit size={12} /> Editar
                      </button>
                    )}
                    {(p.estado === 'Aprobada' || p.estado === 'En pago') && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => router.push(`/planillas/${p.id}`)}
                      >
                        <I.ArrowRight size={12} /> Continuar pago
                      </button>
                    )}
                    {p.estado === 'Cerrada' && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => router.push(`/planillas/${p.id}`)}
                      >
                        <I.Eye size={12} /> Ver
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openGenerar && (
        <ModalGenerarPlanilla
          empleadosActivos={empleadosActivos}
          periodosExistentes={periodosExistentes}
          defaultSugerido={{ quincena: proximaPlanilla.quincena, mes: proximaPlanilla.mes, anio: proximaPlanilla.anio }}
          onClose={() => setOpenGenerar(false)}
        />
      )}
    </div>
  );
}

function estadoBadge(estado: EstadoPeriodo): { cls: string; text: string } {
  switch (estado) {
    case 'Borrador': return { cls: 'badge-outline', text: 'Borrador' };
    case 'Aprobada': return { cls: 'badge-warn',    text: 'Aprobada' };
    case 'En pago':  return { cls: 'badge-warn',    text: 'En pago' };
    case 'Cerrada':  return { cls: 'badge-olive',   text: 'Cerrada' };
    default:         return { cls: 'badge-mute',    text: String(estado) };
  }
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

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 8px', borderRadius: 4,
  border: '1px solid var(--line-2)', background: 'var(--paper-2)',
  color: 'var(--ink)', fontFamily: 'inherit',
};
