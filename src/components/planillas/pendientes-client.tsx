'use client';

/**
 * F-038.4 — Vista consolidada cross-periodo de pagos pendientes.
 *
 * Agrupa por período (Aprobada o En pago) y lista a cada empleado pendiente
 * con su monto, días desde aprobación y nivel de alerta. Permite acción
 * rápida inline: registrar pago, diferir o cancelar.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { ModalPagarEmpleado } from './modal-pagar-empleado';
import { ModalDiferirPago } from './modal-diferir-pago';
import { ModalCancelarPago } from './modal-cancelar-pago';
import { BannerDecisionPendientes } from './banner-decision-pendientes';
import type { PagoPendiente, KPIsPagosPendientes, LineaPlanilla, AlertaPendiente } from '@/lib/db/planillas';

interface BancoOption { id: string; nombre: string }

interface Props {
  pendientes: PagoPendiente[];
  kpis: KPIsPagosPendientes;
  bancos: BancoOption[];
}

const ALERTA_BADGE: Record<AlertaPendiente, { cls: string; text: string }> = {
  normal:   { cls: 'badge-outline', text: '⏸ Reciente' },
  amarilla: { cls: 'badge-warn',    text: '⚠ Atención' },
  naranja:  { cls: 'badge-warn',    text: '⚠ Por confirmar' },
  roja:     { cls: 'badge-wine',    text: '🔴 Decidir' },
};

/** Convierte un PagoPendiente al shape mínimo de LineaPlanilla que esperan los modales. */
function lineaParaModal(p: PagoPendiente): LineaPlanilla {
  return {
    id:              p.planillaId,
    periodoId:       p.periodoId,
    empleadoId:      p.empleadoId,
    empleadoNombre:  p.empleadoNombre,
    ordinario: 0, bonificacion: 0, extraordinario: 0, comisiones: 0,
    otrosIngresos: 0, igssLaboral: 0, isr: 0, otrosDescuentos: 0,
    netoPagar:       p.netoAPagar,
    estadoPago:      'Pendiente',
  };
}

export function PendientesClient({ pendientes, kpis, bancos }: Props) {
  const [search, setSearch] = useState('');
  const [filtroDepto, setFiltroDepto] = useState('');
  const [filtroAlerta, setFiltroAlerta] = useState<'todos' | AlertaPendiente>('todos');
  const [filtroPeriodo, setFiltroPeriodo] = useState('');

  const [pagarLinea, setPagarLinea]     = useState<LineaPlanilla | null>(null);
  const [diferirLinea, setDiferirLinea] = useState<LineaPlanilla | null>(null);
  const [cancelarLinea, setCancelarLinea] = useState<LineaPlanilla | null>(null);

  const departamentos = useMemo(
    () => [...new Set(pendientes.map(p => p.departamento).filter(Boolean))].sort(),
    [pendientes],
  );

  const filtrados = useMemo(() => {
    let r = pendientes;
    if (filtroPeriodo) r = r.filter(p => p.periodoId === filtroPeriodo);
    if (filtroDepto)   r = r.filter(p => p.departamento === filtroDepto);
    if (filtroAlerta !== 'todos') r = r.filter(p => p.alerta === filtroAlerta);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(p =>
        p.empleadoNombre.toLowerCase().includes(q) ||
        p.departamento.toLowerCase().includes(q),
      );
    }
    return r;
  }, [pendientes, filtroPeriodo, filtroDepto, filtroAlerta, search]);

  // Agrupar por período (ya están ordenados por días desc dentro de cada grupo).
  const porPeriodo = useMemo(() => {
    const map = new Map<string, { periodoId: string; periodoNombre: string; fechaAprobacion?: string; items: PagoPendiente[] }>();
    for (const p of filtrados) {
      const bucket = map.get(p.periodoId) ?? {
        periodoId: p.periodoId, periodoNombre: p.periodoNombre, fechaAprobacion: p.fechaAprobacion, items: [],
      };
      bucket.items.push(p);
      map.set(p.periodoId, bucket);
    }
    return [...map.values()].sort((a, b) => {
      const da = Math.max(...a.items.map(x => x.diasPendiente));
      const db = Math.max(...b.items.map(x => x.diasPendiente));
      return db - da;
    });
  }, [filtrados]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pagos pendientes a empleados</h1>
          <div className="page-subtitle">
            Empleados con planilla aprobada pero pago no registrado · cross-período
          </div>
        </div>
        <div className="page-actions">
          <Link href="/planillas" className="btn btn-secondary">
            <I.ChevLeft size={13} /> Volver a Planillas
          </Link>
        </div>
      </div>

      {/* F-038.4.bis: banner de decisión arriba de los KPIs si hay 15+ días. */}
      <BannerDecisionPendientes decision={kpis.decisionRequerida} />

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 22 }}>
        <Kpi label="👥 Empleados esperando" value={String(kpis.totalEmpleadosPendientes)} hint={kpis.totalEmpleadosPendientes > 0 ? `prom. ${kpis.promedioDiasPendiente} días` : 'al día'} />
        <Kpi label="💰 Monto total pendiente" value={Q(kpis.montoTotalPendiente)} hint="aún por pagar" alarma={kpis.montoTotalPendiente > 0} />
        <Kpi label="⚠ Amarilla + Naranja" value={String(kpis.alertasAmarillas + kpis.alertasNaranja)} hint={`${kpis.alertasAmarillas} de 5-9d · ${kpis.alertasNaranja} de 10-14d`} alarma={(kpis.alertasAmarillas + kpis.alertasNaranja) > 0} />
        <Kpi label="🔴 Decisión requerida" value={String(kpis.alertasRojas)} hint="15+ días — diferir o esperar" alarma={kpis.alertasRojas > 0} />
      </div>

      {kpis.totalEmpleadosPendientes === 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="card-pad" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-3)' }}>
            <I.Check size={32} style={{ color: 'var(--olive)', opacity: 0.6, marginBottom: 10 }} />
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-2)' }}>Al día con los empleados</div>
            <div style={{ fontSize: 12.5, marginTop: 4 }}>
              No hay planillas aprobadas con pagos pendientes. Cuando aprobés una y aún no la pagues, los empleados aparecerán acá.
            </div>
          </div>
        </div>
      )}

      {kpis.totalEmpleadosPendientes > 0 && (<>
        {/* Filtros */}
        <div className="card" style={{ padding: 0, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={filtroPeriodo} onChange={(e) => setFiltroPeriodo(e.target.value)} style={selectStyle}>
              <option value="">Período (todos)</option>
              {kpis.porPeriodo.map(p => <option key={p.periodoId} value={p.periodoId}>{p.periodoNombre}</option>)}
            </select>
            <select value={filtroDepto} onChange={(e) => setFiltroDepto(e.target.value)} style={selectStyle}>
              <option value="">Departamento (todos)</option>
              {departamentos.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={filtroAlerta} onChange={(e) => setFiltroAlerta(e.target.value as 'todos' | AlertaPendiente)} style={selectStyle}>
              <option value="todos">Alerta (todas)</option>
              <option value="roja">🔴 Decidir (15+ días)</option>
              <option value="naranja">⚠ Naranja (10-14 días)</option>
              <option value="amarilla">⚠ Amarilla (5-9 días)</option>
              <option value="normal">⏸ Normal (&lt;5 días)</option>
            </select>
            <div className="toolbar-search" style={{ marginLeft: 'auto' }}>
              <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
              <input placeholder="Nombre, departamento…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Grupos por período */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {porPeriodo.map(g => {
            const sumaGrupo = g.items.reduce((s, p) => s + p.netoAPagar, 0);
            const maxDias = Math.max(...g.items.map(p => p.diasPendiente));
            return (
              <div key={g.periodoId} className="card" style={{ overflow: 'hidden' }}>
                <div className="card-head" style={{ gap: 12 }}>
                  <div className="card-title">
                    <Link href={`/planillas/${g.periodoId}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {g.periodoNombre}
                    </Link>
                  </div>
                  <div className="card-actions" style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--ink-3)' }}>
                    {g.fechaAprobacion && (
                      <span>Aprobada hace <strong className="num">{maxDias}</strong> día{maxDias === 1 ? '' : 's'}</span>
                    )}
                    <span><strong className="num">{g.items.length}</strong> empleado{g.items.length === 1 ? '' : 's'}</span>
                    <span className="num" style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{Q(sumaGrupo)}</span>
                  </div>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Departamento</th>
                      <th className="num" style={{ width: 120 }}>Neto</th>
                      <th style={{ width: 140 }}>Alerta</th>
                      <th style={{ width: 280 }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map(p => {
                      const a = ALERTA_BADGE[p.alerta];
                      return (
                        <tr key={p.planillaId}>
                          <td className="cell-strong">{p.empleadoNombre}</td>
                          <td className="cell-mute">{p.departamento}</td>
                          <td className="num cell-strong">{Q(p.netoAPagar)}</td>
                          <td>
                            <span className={'badge ' + a.cls}>{a.text}</span>
                            <span style={{ fontSize: 10.5, color: 'var(--ink-4)', marginLeft: 6 }}>{p.diasPendiente}d</span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button className="btn btn-primary" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => setPagarLinea(lineaParaModal(p))}>
                                <I.Bank size={11} /> Pagar
                              </button>
                              <button className="btn btn-secondary" style={{ padding: '3px 9px', fontSize: 11, color: 'var(--wine)' }} onClick={() => setDiferirLinea(lineaParaModal(p))}>
                                <I.Clock size={11} /> Diferir
                              </button>
                              <button className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 11, color: 'var(--ink-3)' }} onClick={() => setCancelarLinea(lineaParaModal(p))}>
                                <I.X size={11} /> Cancelar
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </>)}

      {pagarLinea    && <ModalPagarEmpleado linea={pagarLinea} bancos={bancos} onClose={() => setPagarLinea(null)} />}
      {diferirLinea  && <ModalDiferirPago linea={diferirLinea} onClose={() => setDiferirLinea(null)} />}
      {cancelarLinea && <ModalCancelarPago linea={cancelarLinea} onClose={() => setCancelarLinea(null)} />}
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

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 8px', borderRadius: 4,
  border: '1px solid var(--line-2)', background: 'var(--paper-2)',
  color: 'var(--ink)', fontFamily: 'inherit',
};
