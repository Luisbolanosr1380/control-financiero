'use client';

/**
 * F-038 — Detalle de planilla por período.
 *
 * UI condicional por estado del período:
 *   - Borrador → KPIs + tabla EDITABLE + botón Aprobar planilla.
 *   - Aprobada | En pago → KPIs + tabla pagable (Registrar pago / Diferir por línea).
 *   - Cerrada → KPIs + tabla solo lectura con histórico de pagos y diferimientos.
 *
 * Las ediciones inline disparan `ajustarLineaAction` en blur. Si la action
 * devuelve `{ ok:true }` no mostramos toast (silencioso, UX limpia). Solo se
 * notifica con `toast.error` en fallos.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { ajustarLineaAction } from '@/app/(app)/planillas/actions';
import { ModalAprobarPlanilla } from './modal-aprobar-planilla';
import { ModalPagarEmpleado } from './modal-pagar-empleado';
import { ModalDiferirPago } from './modal-diferir-pago';
import { ModalCancelarPago } from './modal-cancelar-pago';
import { ModalAgregarDescuento } from './modal-agregar-descuento';
import type { LineaPlanilla, Periodo, EstadoPeriodo, EstadoPagoLinea } from '@/lib/db/planillas';
import type { AjustesQuincena, DescuentoQuincena } from '@/lib/calculos/planilla-calc';

interface BancoOption {
  id: string;
  nombre: string;
}

interface Props {
  periodo: Periodo;
  lineas: LineaPlanilla[];
  igssPatronalEstimado: number;
  bancos: BancoOption[];
}

interface LineaUI extends LineaPlanilla {
  descuentos: DescuentoQuincena[];
}

const ESTADO_BADGE: Record<EstadoPeriodo, { cls: string; text: string }> = {
  Borrador: { cls: 'badge-outline', text: 'Borrador' },
  Aprobada: { cls: 'badge-warn',    text: 'Aprobada' },
  'En pago':{ cls: 'badge-warn',    text: 'En pago' },
  Cerrada:  { cls: 'badge-olive',   text: 'Cerrada' },
};

const ESTADO_PAGO_BADGE: Record<EstadoPagoLinea, { cls: string; text: string }> = {
  Pendiente: { cls: 'badge-outline', text: 'Pendiente' },
  Pagado:    { cls: 'badge-olive',   text: 'Pagado' },
  Diferido:  { cls: 'badge-wine',    text: 'Diferido' },
  Cancelado: { cls: 'badge-mute',    text: 'Cancelado' },   // F-038.4
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

function formatFecha(s: string | undefined): string {
  if (!s || s === 'SIN-FECHA') return '—';
  const d = s.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return s;
  return `${day}/${m}/${y}`;
}

export function PlanillaDetalleClient({ periodo, lineas, igssPatronalEstimado, bancos }: Props) {
  const router = useRouter();
  const [aprobarOpen, setAprobarOpen] = useState(false);
  const [pagarLinea, setPagarLinea]   = useState<LineaPlanilla | null>(null);
  const [diferirLinea, setDiferirLinea] = useState<LineaPlanilla | null>(null);
  const [cancelarLinea, setCancelarLinea] = useState<LineaPlanilla | null>(null);   // F-038.4
  const [descuentoLineaId, setDescuentoLineaId] = useState<string | null>(null);
  // F-038.4: filtro de estado de pago en la tabla.
  const [filtroEstadoPago, setFiltroEstadoPago] = useState<'todos' | EstadoPagoLinea>('todos');
  // estado local de líneas para soportar edición inline + descuentos no persistidos en el server.
  const [lineasUI, setLineasUI] = useState<LineaUI[]>(() =>
    lineas.map(l => ({ ...l, descuentos: [] })),
  );
  // resaltado breve cuando un ajuste se persiste.
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});

  // Sincronizamos cuando cambia el server snapshot (router.refresh()).
  useEffect(() => {
    setLineasUI(prev => lineas.map(l => {
      const previo = prev.find(p => p.id === l.id);
      return { ...l, descuentos: previo?.descuentos ?? [] };
    }));
  }, [lineas]);

  const totales = useMemo(() => {
    const total       = lineasUI.length;
    const pagadas     = lineasUI.filter(l => l.estadoPago === 'Pagado').length;
    const diferidas   = lineasUI.filter(l => l.estadoPago === 'Diferido').length;
    const canceladas  = lineasUI.filter(l => l.estadoPago === 'Cancelado').length;   // F-038.4
    const pendientes  = total - pagadas - diferidas - canceladas;
    const montoTotal  = round2(lineasUI.reduce((s, l) => s + l.netoPagar, 0));
    const igssLaboral = round2(lineasUI.reduce((s, l) => s + l.igssLaboral, 0));
    const isrTotal    = round2(lineasUI.reduce((s, l) => s + l.isr, 0));
    return { total, pagadas, diferidas, canceladas, pendientes, montoTotal, igssLaboral, isrTotal };
  }, [lineasUI]);

  const badge = ESTADO_BADGE[periodo.estado];
  const fechaSugerida = periodo.fechaFin;

  const aplicarAjuste = async (linea: LineaUI, ajustes: AjustesQuincena) => {
    setSavingIds(s => ({ ...s, [linea.id]: true }));
    try {
      const res = await ajustarLineaAction(linea.id, ajustes);
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudo actualizar la línea.');
        // revertir refresh para traer estado real.
        router.refresh();
      } else {
        // Silencioso. Solo refrescamos para traer monto recalculado.
        router.refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red');
      router.refresh();
    } finally {
      setSavingIds(s => {
        const next = { ...s };
        delete next[linea.id];
        return next;
      });
    }
  };

  /** Construye AjustesQuincena con todo el estado UI actual de la línea (no solo el cambio). */
  const ajustesDeLinea = (linea: LineaUI): AjustesQuincena => ({
    extraordinario: linea.extraordinario,
    bonoKPI:        linea.comisiones,
    otrosIngresos:  linea.otrosIngresos,
    descuentos:     linea.descuentos.length > 0 ? linea.descuentos : undefined,
  });

  const onChangeBonoKPI = (linea: LineaUI, valor: number) => {
    setLineasUI(prev => prev.map(l => l.id === linea.id ? { ...l, comisiones: valor } : l));
  };
  const onBlurBonoKPI = (linea: LineaUI, valor: number) => {
    if (round2(valor) === round2(linea.comisiones)) return;
    void aplicarAjuste({ ...linea, comisiones: valor }, { ...ajustesDeLinea(linea), bonoKPI: valor });
  };

  const onChangeIGSS = (linea: LineaUI, valor: number) => {
    setLineasUI(prev => prev.map(l => l.id === linea.id ? { ...l, igssLaboral: valor } : l));
  };
  const onBlurIGSS = (linea: LineaUI, valor: number) => {
    // IGSS y ISR no se ajustan manualmente desde la UI editable: el server los recalcula
    // siempre desde salarioBase + bonoKPI. Si el usuario fuerza un override visual,
    // el server lo sobrescribe; igualmente disparamos el recálculo para mantener consistencia.
    if (round2(valor) === round2(linea.igssLaboral)) return;
    void aplicarAjuste(linea, ajustesDeLinea(linea));
  };

  const onChangeISR = (linea: LineaUI, valor: number) => {
    setLineasUI(prev => prev.map(l => l.id === linea.id ? { ...l, isr: valor } : l));
  };
  const onBlurISR = (linea: LineaUI, valor: number) => {
    if (round2(valor) === round2(linea.isr)) return;
    void aplicarAjuste(linea, ajustesDeLinea(linea));
  };

  const onAgregarDescuento = (lineaId: string, desc: DescuentoQuincena) => {
    setLineasUI(prev => prev.map(l => {
      if (l.id !== lineaId) return l;
      const descuentos = [...l.descuentos, desc];
      const nuevoTotal = round2(descuentos.reduce((s, d) => s + (d.monto || 0), 0));
      return { ...l, descuentos, otrosDescuentos: nuevoTotal };
    }));
    const linea = lineasUI.find(l => l.id === lineaId);
    if (!linea) return;
    const nuevaUI: LineaUI = {
      ...linea,
      descuentos: [...linea.descuentos, desc],
    };
    void aplicarAjuste(nuevaUI, ajustesDeLinea(nuevaUI));
  };

  const removerDescuento = (lineaId: string, idx: number) => {
    setLineasUI(prev => prev.map(l => {
      if (l.id !== lineaId) return l;
      const descuentos = l.descuentos.filter((_, i) => i !== idx);
      const nuevoTotal = round2(descuentos.reduce((s, d) => s + (d.monto || 0), 0));
      return { ...l, descuentos, otrosDescuentos: nuevoTotal };
    }));
    const linea = lineasUI.find(l => l.id === lineaId);
    if (!linea) return;
    const nuevaUI: LineaUI = {
      ...linea,
      descuentos: linea.descuentos.filter((_, i) => i !== idx),
    };
    void aplicarAjuste(nuevaUI, ajustesDeLinea(nuevaUI));
  };

  const esBorrador = periodo.estado === 'Borrador';
  const esPagable  = periodo.estado === 'Aprobada' || periodo.estado === 'En pago';
  const esCerrada  = periodo.estado === 'Cerrada';

  return (
    <div className="page">
      {/* ============================================================
       *  CABECERA
       * ============================================================ */}
      <div className="page-header">
        <div>
          <div style={{ marginBottom: 6 }}>
            <Link href="/planillas" className="btn btn-ghost" style={{ padding: '3px 8px' }}>
              <I.ChevLeft size={13} /> Volver al listado
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ fontSize: 24 }}>{periodo.nombre}</h1>
            <span className={'badge ' + badge.cls} style={{ fontSize: 11.5, padding: '3px 10px' }}>{badge.text}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {formatFecha(periodo.fechaInicio)} → {formatFecha(periodo.fechaFin)}
            </span>
          </div>
          <div className="page-subtitle" style={{ marginTop: 6 }}>
            {esBorrador && (
              <>Fecha sugerida de pago: <span className="num">{formatFecha(fechaSugerida)}</span></>
            )}
            {esPagable && periodo.fechaAprobacion && (
              <>Aprobada por <strong>{periodo.aprobadoPor ?? '—'}</strong> el <span className="num">{formatFecha(periodo.fechaAprobacion)}</span></>
            )}
            {esCerrada && (
              <>Cerrada por <strong>{periodo.pagadoPor ?? '—'}</strong> el <span className="num">{formatFecha(periodo.fechaCierre)}</span></>
            )}
          </div>
        </div>
        <div className="page-actions">
          {esBorrador && (
            <button className="btn btn-primary" onClick={() => setAprobarOpen(true)} disabled={lineasUI.length === 0}>
              <I.Check size={13} /> Aprobar planilla
            </button>
          )}
        </div>
      </div>

      {/* ============================================================
       *  KPIs
       * ============================================================ */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 22 }}>
        <Kpi label="Empleados" value={String(totales.total)} />
        <Kpi label={esBorrador ? 'Monto total estimado' : 'Monto total'} value={Q(totales.montoTotal)} hint="Neto a pagar" />
        <Kpi label="IGSS Laboral" value={Q(totales.igssLaboral)} hint="4.83% sobre ordinario" />
        <Kpi label="ISR retenido" value={Q(totales.isrTotal)} hint="Proyección anual / 24" />
        <Kpi label="IGSS Patronal" value={Q(igssPatronalEstimado)} hint="12.67% sobre ordinario (estimado)" />
      </div>

      {/* Progress bar para Aprobada / En pago */}
      {esPagable && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                Avance de pagos
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 12.5 }}>
                <span><strong className="num">{totales.pagadas}</strong>/<span className="num">{totales.total}</span> pagados</span>
                {totales.diferidas > 0 && (
                  <span style={{ color: 'var(--wine)' }}>
                    <strong className="num">{totales.diferidas}</strong> diferido{totales.diferidas === 1 ? '' : 's'}
                  </span>
                )}
                {totales.canceladas > 0 && (
                  <span style={{ color: 'var(--ink-4)' }}>
                    <strong className="num">{totales.canceladas}</strong> cancelado{totales.canceladas === 1 ? '' : 's'}
                  </span>
                )}
                {totales.pendientes > 0 && (
                  <span style={{ color: 'var(--ink-3)' }}>
                    <strong className="num">{totales.pendientes}</strong> pendiente{totales.pendientes === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>
            <div style={{ height: 6, background: 'var(--line-3)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
              <div style={{
                width: `${totales.total > 0 ? (totales.pagadas / totales.total) * 100 : 0}%`,
                background: 'var(--olive)', height: '100%', transition: 'width 0.3s',
              }} />
              <div style={{
                width: `${totales.total > 0 ? (totales.diferidas / totales.total) * 100 : 0}%`,
                background: 'var(--wine)', height: '100%', transition: 'width 0.3s',
              }} />
              <div style={{
                width: `${totales.total > 0 ? (totales.canceladas / totales.total) * 100 : 0}%`,
                background: 'var(--ink-4)', height: '100%', transition: 'width 0.3s',
              }} />
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
       *  TABLA
       * ============================================================ */}
      {esBorrador && (
        <TablaEditable
          lineas={lineasUI}
          savingIds={savingIds}
          onChangeBonoKPI={onChangeBonoKPI}
          onBlurBonoKPI={onBlurBonoKPI}
          onChangeIGSS={onChangeIGSS}
          onBlurIGSS={onBlurIGSS}
          onChangeISR={onChangeISR}
          onBlurISR={onBlurISR}
          onAgregarDescuento={(id) => setDescuentoLineaId(id)}
          onRemoverDescuento={removerDescuento}
        />
      )}

      {esPagable && (
        <TablaPagable
          lineas={lineasUI}
          fechaAprobacion={periodo.fechaAprobacion}
          filtro={filtroEstadoPago}
          onFiltroChange={setFiltroEstadoPago}
          onPagar={(l) => setPagarLinea(l)}
          onDiferir={(l) => setDiferirLinea(l)}
          onCancelar={(l) => setCancelarLinea(l)}
        />
      )}

      {esCerrada && (
        <TablaCerrada lineas={lineasUI} />
      )}

      {/* Sección "Diferimientos del período" para Cerrada */}
      {esCerrada && lineasUI.some(l => l.estadoPago === 'Diferido') && (
        <div className="card" style={{ marginBottom: 22, marginTop: 22 }}>
          <div className="card-head">
            <div className="card-title">Diferimientos del período</div>
            <div className="card-actions">
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                {lineasUI.filter(l => l.estadoPago === 'Diferido').length} deuda(s) salarial(es) generada(s)
              </span>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th className="num">Monto diferido</th>
                <th>Notas</th>
                <th style={{ width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {lineasUI.filter(l => l.estadoPago === 'Diferido').map(l => (
                <tr key={l.id}>
                  <td>{l.empleadoNombre}</td>
                  <td className="num cell-strong" style={{ color: 'var(--wine)' }}>{Q(l.netoPagar)}</td>
                  <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }} title={l.notas}>{l.notas || '—'}</td>
                  <td>
                    {l.deudaVinculadaId ? (
                      <Link href={`/deudas/${l.deudaVinculadaId}`} className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }}>
                        Ver deuda →
                      </Link>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Botón inferior Volver para Borrador */}
      {esBorrador && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <Link href="/planillas" className="btn btn-secondary">
            <I.ChevLeft size={13} /> Volver
          </Link>
          <button className="btn btn-primary" onClick={() => setAprobarOpen(true)} disabled={lineasUI.length === 0}>
            <I.Check size={13} /> Aprobar planilla
          </button>
        </div>
      )}

      {/* ============================================================
       *  MODALES
       * ============================================================ */}
      {aprobarOpen && (
        <ModalAprobarPlanilla periodo={periodo} onClose={() => setAprobarOpen(false)} />
      )}
      {pagarLinea && (
        <ModalPagarEmpleado linea={pagarLinea} bancos={bancos} onClose={() => setPagarLinea(null)} />
      )}
      {diferirLinea && (
        <ModalDiferirPago linea={diferirLinea} onClose={() => setDiferirLinea(null)} />
      )}
      {cancelarLinea && (
        <ModalCancelarPago linea={cancelarLinea} onClose={() => setCancelarLinea(null)} />
      )}
      {descuentoLineaId && (
        <ModalAgregarDescuento
          onClose={() => setDescuentoLineaId(null)}
          onSubmit={(desc) => onAgregarDescuento(descuentoLineaId, desc)}
        />
      )}
    </div>
  );
}

/* ============================================================
 *  Sub-componentes: tablas por estado
 * ============================================================ */

interface TablaEditableProps {
  lineas: LineaUI[];
  savingIds: Record<string, boolean>;
  onChangeBonoKPI: (linea: LineaUI, valor: number) => void;
  onBlurBonoKPI: (linea: LineaUI, valor: number) => void;
  onChangeIGSS: (linea: LineaUI, valor: number) => void;
  onBlurIGSS: (linea: LineaUI, valor: number) => void;
  onChangeISR: (linea: LineaUI, valor: number) => void;
  onBlurISR: (linea: LineaUI, valor: number) => void;
  onAgregarDescuento: (lineaId: string) => void;
  onRemoverDescuento: (lineaId: string, idx: number) => void;
}

function TablaEditable({
  lineas, savingIds,
  onChangeBonoKPI, onBlurBonoKPI,
  onChangeIGSS, onBlurIGSS,
  onChangeISR, onBlurISR,
  onAgregarDescuento, onRemoverDescuento,
}: TablaEditableProps) {
  if (lineas.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-pad" style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
          Esta planilla no tiene líneas generadas todavía.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">
        <div className="card-title">Líneas de planilla · editable</div>
        <div className="card-actions">
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{lineas.length} empleado(s) · blur guarda el cambio</span>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Empleado</th>
            <th className="num">Ordinario</th>
            <th className="num">Bonif.</th>
            <th className="num" style={{ width: 110 }}>Bono KPI</th>
            <th className="num" style={{ width: 110 }}>IGSS</th>
            <th className="num" style={{ width: 110 }}>ISR</th>
            <th style={{ minWidth: 180 }}>Otros desc.</th>
            <th className="num">Neto a pagar</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map(l => {
            const saving = !!savingIds[l.id];
            return (
              <tr key={l.id} style={{ background: saving ? '#FBF7E6' : undefined }}>
                <td className="cell-strong">{l.empleadoNombre || '—'}</td>
                <td className="num">{Q(l.ordinario)}</td>
                <td className="num">{Q(l.bonificacion)}</td>
                <td className="num">
                  <CeldaNumeroEditable
                    valor={l.comisiones}
                    onChange={(v) => onChangeBonoKPI(l, v)}
                    onBlur={(v) => onBlurBonoKPI(l, v)}
                  />
                </td>
                <td className="num">
                  <CeldaNumeroEditable
                    valor={l.igssLaboral}
                    onChange={(v) => onChangeIGSS(l, v)}
                    onBlur={(v) => onBlurIGSS(l, v)}
                  />
                </td>
                <td className="num">
                  <CeldaNumeroEditable
                    valor={l.isr}
                    onChange={(v) => onChangeISR(l, v)}
                    onBlur={(v) => onBlurISR(l, v)}
                  />
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {l.descuentos.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11.5, color: 'var(--ink-3)' }}>
                        {l.descuentos.map((d, i) => (
                          <li key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ flex: 1 }}>
                              {d.tipo}
                              {d.descripcion ? <span style={{ color: 'var(--ink-4)' }}> · {d.descripcion}</span> : null}
                            </span>
                            <span className="num">{Q(d.monto)}</span>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: '0 4px', fontSize: 10 }}
                              onClick={() => onRemoverDescuento(l.id, i)}
                              title="Quitar"
                            >
                              <I.X size={11} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '2px 6px', fontSize: 11, alignSelf: 'flex-start' }}
                      onClick={() => onAgregarDescuento(l.id)}
                    >
                      <I.Plus size={11} /> Agregar descuento
                    </button>
                  </div>
                </td>
                <td className="num cell-strong">{Q(l.netoPagar)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface CeldaProps {
  valor: number;
  onChange: (v: number) => void;
  onBlur: (v: number) => void;
}

/** Input numérico inline con focus discreto. */
function CeldaNumeroEditable({ valor, onChange, onBlur }: CeldaProps) {
  const [texto, setTexto] = useState<string>(valor.toFixed(2));
  // si cambia el valor desde fuera (refresh), sincronizamos.
  useEffect(() => { setTexto(valor.toFixed(2)); }, [valor]);
  return (
    <input
      type="text"
      inputMode="decimal"
      className="num"
      value={texto}
      onChange={(e) => {
        const t = e.target.value;
        setTexto(t);
        const n = parseFloat(t.replace(/[^\d.-]/g, ''));
        if (Number.isFinite(n)) onChange(round2(n));
      }}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        const n = parseFloat(e.currentTarget.value.replace(/[^\d.-]/g, ''));
        const final = Number.isFinite(n) ? round2(n) : 0;
        setTexto(final.toFixed(2));
        onBlur(final);
      }}
      style={{
        width: '100%', textAlign: 'right',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 4,
        padding: '4px 6px',
        fontSize: 12.5,
        color: 'var(--ink)',
        outline: 'none',
        fontFamily: 'inherit',
      }}
      onFocusCapture={(e) => {
        e.currentTarget.style.borderColor = 'var(--olive)';
        e.currentTarget.style.background = 'var(--paper-2)';
      }}
      onBlurCapture={(e) => {
        e.currentTarget.style.borderColor = 'transparent';
        e.currentTarget.style.background = 'transparent';
      }}
    />
  );
}

interface TablaPagableProps {
  lineas: LineaUI[];
  fechaAprobacion?: string;       // F-038.4
  filtro: 'todos' | EstadoPagoLinea;
  onFiltroChange: (v: 'todos' | EstadoPagoLinea) => void;
  onPagar: (linea: LineaPlanilla) => void;
  onDiferir: (linea: LineaPlanilla) => void;
  onCancelar: (linea: LineaPlanilla) => void;   // F-038.4
}

function diasDesde(iso?: string): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function TablaPagable({ lineas, fechaAprobacion, filtro, onFiltroChange, onPagar, onDiferir, onCancelar }: TablaPagableProps) {
  const visibles = filtro === 'todos' ? lineas : lineas.filter(l => l.estadoPago === filtro);
  const diasPendiente = diasDesde(fechaAprobacion);

  if (lineas.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-pad" style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
          Esta planilla no tiene líneas.
        </div>
      </div>
    );
  }

  // Conteos por estado para los tabs.
  const c = {
    todos:     lineas.length,
    Pendiente: lineas.filter(l => l.estadoPago === 'Pendiente').length,
    Pagado:    lineas.filter(l => l.estadoPago === 'Pagado').length,
    Diferido:  lineas.filter(l => l.estadoPago === 'Diferido').length,
    Cancelado: lineas.filter(l => l.estadoPago === 'Cancelado').length,
  };

  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">
        <div className="card-title">Pagos por empleado</div>
        <div className="card-actions">
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {visibles.length}/{lineas.length} líneas
          </span>
        </div>
      </div>

      {/* F-038.4: filtros tab por estado de pago. */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 14px', borderBottom: '1px solid var(--line-3)', flexWrap: 'wrap' }}>
        {(['todos', 'Pendiente', 'Pagado', 'Diferido', 'Cancelado'] as const).map(opt => (
          <button
            key={opt}
            type="button"
            className={'tab' + (filtro === opt ? ' active' : '')}
            onClick={() => onFiltroChange(opt)}
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            {opt === 'todos' ? 'Todos' : opt}
            <span className="tab-count num">{c[opt]}</span>
          </button>
        ))}
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Empleado</th>
            <th className="num">Neto a pagar</th>
            <th>Estado pago</th>
            <th>Detalle</th>
            <th style={{ width: 240 }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map(l => {
            const badge = ESTADO_PAGO_BADGE[l.estadoPago];
            // F-038.4.bis: 4 niveles. 15+ ya pide Decidir.
            const alertaInfo: { cls: string; text: string } | null =
              l.estadoPago !== 'Pendiente' ? null
              : diasPendiente >= 15 ? { cls: 'badge-wine',    text: `🔴 ${diasPendiente}d · Decidir` }
              : diasPendiente >= 10 ? { cls: 'badge-warn',    text: `⚠ ${diasPendiente}d` }
              : diasPendiente >= 5  ? { cls: 'badge-warn',    text: `⚠ ${diasPendiente}d` }
              : null;
            const alertaCls = alertaInfo?.cls ?? null;
            return (
              <tr key={l.id}>
                <td className="cell-strong">{l.empleadoNombre || '—'}</td>
                <td className="num cell-strong">{Q(l.netoPagar)}</td>
                <td>
                  <span className={'badge ' + badge.cls}>{badge.text}</span>
                  {alertaInfo && (
                    <span className={'badge ' + alertaInfo.cls} style={{ marginLeft: 4, fontSize: 9.5, padding: '1px 6px' }} title={`Pendiente hace ${diasPendiente} días`}>
                      {alertaInfo.text}
                    </span>
                  )}
                </td>
                <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }} title={l.notas}>
                  {l.estadoPago === 'Pagado' && l.fechaPago && (
                    <>Pagado <span className="num">{formatFecha(l.fechaPago)}</span></>
                  )}
                  {l.estadoPago === 'Diferido' && (
                    <>Diferido · {l.notas || 'sin nota'}</>
                  )}
                  {l.estadoPago === 'Cancelado' && (
                    <>Cancelado · {l.motivoCancelacion || l.notas || 'sin motivo'}</>
                  )}
                  {l.estadoPago === 'Pendiente' && (
                    <span style={{ color: 'var(--ink-4)' }}>—</span>
                  )}
                </td>
                <td>
                  {l.estadoPago === 'Pendiente' ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-primary" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => onPagar(l)}>
                        <I.Bank size={11} /> Pagar
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '3px 9px', fontSize: 11, color: 'var(--wine)' }} onClick={() => onDiferir(l)}>
                        <I.Clock size={11} /> Diferir
                      </button>
                      <button className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 11, color: 'var(--ink-3)' }} onClick={() => onCancelar(l)} title="Cancelar (sin deuda)">
                        <I.X size={11} /> Cancelar
                      </button>
                    </div>
                  ) : l.estadoPago === 'Diferido' && l.deudaVinculadaId ? (
                    <Link href={`/deudas/${l.deudaVinculadaId}`} className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }}>
                      Ver deuda →
                    </Link>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TablaCerrada({ lineas }: { lineas: LineaUI[] }) {
  if (lineas.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-pad" style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
          Esta planilla no tiene líneas.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">
        <div className="card-title">Líneas del período · cerradas</div>
        <div className="card-actions">
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{lineas.length} línea(s)</span>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Empleado</th>
            <th className="num">Neto pagado</th>
            <th>Estado</th>
            <th className="num" style={{ width: 110 }}>Fecha pago</th>
            <th>Detalle</th>
            <th style={{ width: 120 }}></th>
          </tr>
        </thead>
        <tbody>
          {lineas.map(l => {
            const badge = ESTADO_PAGO_BADGE[l.estadoPago];
            return (
              <tr key={l.id}>
                <td className="cell-strong">{l.empleadoNombre || '—'}</td>
                <td className="num cell-strong">{Q(l.netoPagar)}</td>
                <td><span className={'badge ' + badge.cls}>{badge.text}</span></td>
                <td className="num">{l.fechaPago ? formatFecha(l.fechaPago) : '—'}</td>
                <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }} title={l.notas}>
                  {l.notas || '—'}
                </td>
                <td>
                  {l.estadoPago === 'Diferido' && l.deudaVinculadaId ? (
                    <Link href={`/deudas/${l.deudaVinculadaId}`} className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }}>
                      Ver deuda →
                    </Link>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-delta"><span className="vs">{hint}</span></div>}
    </div>
  );
}
