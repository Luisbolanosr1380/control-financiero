'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { formatearFecha } from '@/lib/utils/fechas';
import type { ProyeccionFlujo, EventoFlujo, DiaFlujo } from '@/lib/flujo/types';
import type { ObligacionRecurrente } from '@/lib/flujo/obligaciones';
import { ModalObligacionForm } from './modal-obligacion-form';
import { toggleActivoObligacion } from '@/app/(app)/flujo/_actions/obligaciones';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';

interface Props {
  proyeccion: ProyeccionFlujo;
  obligaciones: ObligacionRecurrente[];
  saldoSugerido: number;
  saldoSugeridoCuentas: number;
}

type Tab = 'timeline' | 'recurrentes';

const SALDO_KEY = 'fc.flujo.saldo-manual';

export function FlujoClient({ proyeccion, obligaciones, saldoSugerido, saldoSugeridoCuentas }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>('timeline');
  const [saldoInput, setSaldoInput] = useState<string>('');
  const [editandoSaldo, setEditandoSaldo] = useState(false);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editandoObligacion, setEditandoObligacion] = useState<ObligacionRecurrente | null>(null);

  // F-051: cargar saldo manual desde localStorage al montar y propagar a URL.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(SALDO_KEY);
    if (stored && Number.isFinite(Number(stored))) {
      setSaldoInput(stored);
    }
  }, []);

  const aplicarHorizonte = (dias: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set('horizonte', String(dias));
    startTransition(() => router.push(url.pathname + '?' + url.searchParams.toString()));
  };

  const aplicarSaldo = (valor: string) => {
    const n = Number(valor);
    if (!Number.isFinite(n)) return;
    window.localStorage.setItem(SALDO_KEY, String(n));
    const url = new URL(window.location.href);
    url.searchParams.set('saldo', String(n));
    startTransition(() => router.push(url.pathname + '?' + url.searchParams.toString()));
  };

  const usarSugerido = () => {
    window.localStorage.removeItem(SALDO_KEY);
    setSaldoInput('');
    const url = new URL(window.location.href);
    url.searchParams.delete('saldo');
    startTransition(() => router.push(url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '')));
  };

  const onTogglePausa = async (id: string) => {
    const r = await toggleActivoObligacion(id);
    if (!r.ok) alert(`Error: ${r.error}`);
    else startTransition(() => router.refresh());
  };

  return (
    <div className="page-wrap">
      <header className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Centro de Pagos</h1>
          <p className="page-sub" style={{ marginTop: 4 }}>
            Compromisos próximos vs efectivo proyectado · horizonte {proyeccion.horizonteDias} días
          </p>
        </div>
      </header>

      <HeaderKpis
        proyeccion={proyeccion}
        saldoInput={saldoInput}
        editando={editandoSaldo}
        setSaldoInput={setSaldoInput}
        setEditando={setEditandoSaldo}
        onSaldoCambiado={aplicarSaldo}
        onUsarSugerido={usarSugerido}
        saldoSugerido={saldoSugerido}
        saldoSugeridoCuentas={saldoSugeridoCuentas}
        onHorizonte={aplicarHorizonte}
      />

      <div className="tabs" style={{ marginTop: 24, display: 'flex', gap: 8, borderBottom: '1px solid var(--ink-1)' }}>
        <TabButton activo={tab === 'timeline'} onClick={() => setTab('timeline')}>
          Timeline ({proyeccion.dias.length} días con eventos)
        </TabButton>
        <TabButton activo={tab === 'recurrentes'} onClick={() => setTab('recurrentes')}>
          Recurrentes ({obligaciones.length})
        </TabButton>
      </div>

      <div style={{ marginTop: 16 }}>
        {tab === 'timeline' && <TimelineSection proyeccion={proyeccion} />}
        {tab === 'recurrentes' && (
          <RecurrentesSection
            obligaciones={obligaciones}
            onNueva={() => { setEditandoObligacion(null); setModalAbierto(true); }}
            onEditar={(o) => { setEditandoObligacion(o); setModalAbierto(true); }}
            onTogglePausa={onTogglePausa}
          />
        )}
      </div>

      {modalAbierto && (
        <ModalObligacionForm
          obligacion={editandoObligacion}
          onCerrar={() => setModalAbierto(false)}
          onGuardado={() => {
            setModalAbierto(false);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

/* =========================================================================
 * HEADER KPIs
 * ========================================================================= */

interface HeaderKpisProps {
  proyeccion: ProyeccionFlujo;
  saldoInput: string;
  editando: boolean;
  setSaldoInput: (s: string) => void;
  setEditando: (b: boolean) => void;
  onSaldoCambiado: (s: string) => void;
  onUsarSugerido: () => void;
  saldoSugerido: number;
  saldoSugeridoCuentas: number;
  onHorizonte: (d: number) => void;
}

function HeaderKpis({
  proyeccion, saldoInput, editando, setSaldoInput, setEditando,
  onSaldoCambiado, onUsarSugerido, saldoSugerido, saldoSugeridoCuentas, onHorizonte,
}: HeaderKpisProps) {
  const neto = proyeccion.totalIngresos - proyeccion.totalEgresos;
  const punto = proyeccion.puntoCritico;
  return (
    <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      <div className="card">
        <div className="kpi-label">Saldo actual</div>
        {editando ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
            <input
              type="number"
              value={saldoInput}
              onChange={(e) => setSaldoInput(e.target.value)}
              onBlur={() => { onSaldoCambiado(saldoInput); setEditando(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { onSaldoCambiado(saldoInput); setEditando(false); } }}
              autoFocus
              className="input"
              style={{ width: '100%' }}
              placeholder="Q saldo manual"
            />
          </div>
        ) : (
          <button className="kpi-value" onClick={() => setEditando(true)} style={{ all: 'unset', cursor: 'pointer', fontSize: 22, fontWeight: 600, marginTop: 4, display: 'block' }}>
            {Q(proyeccion.saldoInicial)}
          </button>
        )}
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
          {saldoSugeridoCuentas > 0
            ? <>Sugerido: <button onClick={onUsarSugerido} style={{ all: 'unset', cursor: 'pointer', color: 'var(--indigo)', textDecoration: 'underline' }}>{Q(saldoSugerido)}</button> ({saldoSugeridoCuentas} cuentas Q)</>
            : 'Sin saldo sugerido disponible'}
        </div>
      </div>

      <div className="card">
        <div className="kpi-label">Egresos próximos</div>
        <div className="kpi-value" style={{ color: 'var(--wine)' }}>−{Q(proyeccion.totalEgresos)}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{proyeccion.horizonteDias} días</div>
      </div>

      <div className="card">
        <div className="kpi-label">Ingresos esperados</div>
        <div className="kpi-value" style={{ color: 'var(--olive)' }}>+{Q(proyeccion.totalIngresos)}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Neto: {neto >= 0 ? '+' : '−'}{Q(Math.abs(neto))}</div>
      </div>

      <div className="card">
        <div className="kpi-label">Punto crítico</div>
        {punto ? (
          <>
            <div className="kpi-value" style={{ color: punto.seraNegativo ? 'var(--wine)' : 'var(--ink)' }}>
              {Q(punto.saldoProyectado)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{formatearFecha(punto.fecha, "EEE d 'de' MMM")}</div>
            {punto.seraNegativo && (
              <div style={{ fontSize: 11, color: 'var(--wine)', fontWeight: 600, marginTop: 4 }}>
                ⚠ Te faltarían {Q(Math.abs(punto.saldoProyectado))}
              </div>
            )}
          </>
        ) : (
          <div className="kpi-value" style={{ color: 'var(--ink-3)' }}>—</div>
        )}
      </div>

      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Horizonte:</span>
        {[30, 60, 90].map(d => (
          <button
            key={d}
            onClick={() => onHorizonte(d)}
            className={'pill' + (proyeccion.horizonteDias === d ? ' active' : '')}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              border: '1px solid var(--ink-1)',
              borderRadius: 6,
              cursor: 'pointer',
              background: proyeccion.horizonteDias === d ? 'var(--ink)' : 'transparent',
              color: proyeccion.horizonteDias === d ? 'var(--paper)' : 'var(--ink)',
            }}
          >
            {d}d
          </button>
        ))}
      </div>
    </div>
  );
}

/* =========================================================================
 * TIMELINE
 * ========================================================================= */

function TimelineSection({ proyeccion }: { proyeccion: ProyeccionFlujo }) {
  if (proyeccion.dias.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
        Sin eventos en el horizonte. Si nada parece estar registrado, revisá obligaciones recurrentes, CxP de gastos y deudas activas.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {proyeccion.dias.map(d => <DiaCard key={d.fecha} dia={d} />)}
    </div>
  );
}

function DiaCard({ dia }: { dia: DiaFlujo }) {
  const saldoNeg = dia.saldoProyectado < 0;
  return (
    <div
      className="card"
      style={{
        background: saldoNeg ? 'rgba(180, 60, 60, 0.06)' : undefined,
        borderColor: saldoNeg ? 'var(--wine)' : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>{formatearFecha(dia.fecha, "EEE d 'de' MMM yyyy")}</div>
        <div style={{ fontSize: 12, color: saldoNeg ? 'var(--wine)' : 'var(--ink-3)' }}>
          saldo proyectado: <span style={{ fontWeight: 600 }}>{Q(dia.saldoProyectado)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {dia.eventos.map((ev, i) => <EventoRow key={i} ev={ev} />)}
      </div>
      <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--ink-1)', fontSize: 12, color: 'var(--ink-3)' }}>
        neto del día:{' '}
        <span style={{
          fontWeight: 600,
          color: dia.neto >= 0 ? 'var(--olive)' : 'var(--wine)',
        }}>
          {dia.neto >= 0 ? '+' : '−'}{Q(Math.abs(dia.neto))}
        </span>
      </div>
    </div>
  );
}

const PRIORIDAD_DOT: Record<string, string> = {
  'Crítica': 'var(--wine)',
  'Alta': 'var(--amber)',
  'Media': 'var(--ink-3)',
  'Baja': 'var(--ink-2)',
};

function EventoRow({ ev }: { ev: EventoFlujo }) {
  const esIngreso = ev.tipo === 'ingreso';
  const color = esIngreso ? 'var(--olive)' : PRIORIDAD_DOT[ev.prioridad] || 'var(--ink-3)';
  const linkHref = hrefDeEvento(ev);
  const contenido = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ev.descripcion}
          {ev.esEstimado && <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 6 }}>(est.)</span>}
          {ev.fechaAjustada && <span style={{ fontSize: 11, color: 'var(--amber)', marginLeft: 6 }}>(fecha ajustada)</span>}
        </span>
      </div>
      <div style={{
        fontWeight: 600,
        color: esIngreso ? 'var(--olive)' : 'var(--wine)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {esIngreso ? '+' : '−'}{Q(ev.monto)}
      </div>
    </div>
  );
  return linkHref ? (
    <Link href={linkHref} style={{ textDecoration: 'none', color: 'inherit' }}>{contenido}</Link>
  ) : contenido;
}

function hrefDeEvento(ev: EventoFlujo): string | null {
  if (!ev.linkId) return null;
  switch (ev.linkTipo) {
    case 'gasto':           return `/gastos`;
    case 'deuda':           return `/deudas/${ev.linkId}`;
    case 'factura_cliente': return `/facturacion`;
    case 'obligacion':      return null;  // sin vista detalle, se edita desde el tab
    case 'planilla':        return `/planillas`;
    default:                return null;
  }
}

/* =========================================================================
 * TAB Recurrentes
 * ========================================================================= */

interface RecurrentesProps {
  obligaciones: ObligacionRecurrente[];
  onNueva: () => void;
  onEditar: (o: ObligacionRecurrente) => void;
  onTogglePausa: (id: string) => void;
}

function RecurrentesSection({ obligaciones, onNueva, onEditar, onTogglePausa }: RecurrentesProps) {
  const hoy = useMemo(() => obtenerFechaHoyGuatemala(), []);
  const totalMensual = useMemo(
    () => obligaciones
      .filter(o => o.activo && !esFinalizada(o, hoy))
      .reduce((s, o) => s + o.montoEstimado * factorMensual(o.frecuencia), 0),
    [obligaciones, hoy],
  );
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          Total mensual estimado (activas):{' '}
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{Q(totalMensual)}</span>
        </div>
        <button onClick={onNueva} className="btn-primary" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 6, border: 'none',
          background: 'var(--ink)', color: 'var(--paper)', cursor: 'pointer', fontSize: 13,
        }}>
          <I.Plus size={14} /> Nueva obligación
        </button>
      </div>
      {obligaciones.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 24, color: 'var(--ink-3)' }}>
          No hay obligaciones recurrentes todavía. Agregá la primera con el botón de arriba.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ink-1)', background: 'var(--paper-2, #fafafa)' }}>
                <Th>Nombre</Th>
                <Th>Tipo</Th>
                <Th align="right">Monto</Th>
                <Th align="center">Día</Th>
                <Th>Frecuencia</Th>
                <Th>Prioridad</Th>
                <Th>Vigencia</Th>
                <Th align="center">Activo</Th>
                <Th align="right">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {obligaciones.map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--ink-1)' }}>
                  <Td><span style={{ fontWeight: 500 }}>{o.nombre}</span></Td>
                  <Td>{o.tipo}</Td>
                  <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{Q(o.montoEstimado)}</Td>
                  <Td align="center">{o.diaPago}</Td>
                  <Td>{o.frecuencia}</Td>
                  <Td>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: 11,
                      background: PRIORIDAD_DOT[o.prioridad] || 'var(--ink-2)',
                      color: 'var(--paper)',
                    }}>
                      {o.prioridad}
                    </span>
                  </Td>
                  <Td>
                    <VigenciaBadge o={o} hoy={hoy} />
                  </Td>
                  <Td align="center">
                    <button
                      onClick={() => onTogglePausa(o.id)}
                      style={{
                        all: 'unset', cursor: 'pointer',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        background: o.activo ? 'var(--olive)' : 'var(--ink-2)',
                        color: 'var(--paper)',
                      }}
                    >
                      {o.activo ? 'Activa' : 'Pausada'}
                    </button>
                  </Td>
                  <Td align="right">
                    <button
                      onClick={() => onEditar(o)}
                      style={{ all: 'unset', cursor: 'pointer', color: 'var(--indigo)', fontSize: 12 }}
                    >
                      Editar
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function factorMensual(f: ObligacionRecurrente['frecuencia']): number {
  switch (f) {
    case 'Quincenal':  return 2;
    case 'Mensual':    return 1;
    case 'Bimestral':  return 0.5;
    case 'Trimestral': return 1 / 3;
    case 'Anual':      return 1 / 12;
    default:           return 1;
  }
}

function TabButton({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: activo ? 600 : 400,
        color: activo ? 'var(--ink)' : 'var(--ink-3)',
        borderBottom: activo ? '2px solid var(--ink)' : '2px solid transparent',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th style={{
      padding: '10px 12px',
      textAlign: align ?? 'left',
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      color: 'var(--ink-3)',
      letterSpacing: 0.4,
    }}>
      {children}
    </th>
  );
}

function Td({ children, align, style }: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; style?: React.CSSProperties }) {
  return (
    <td style={{
      padding: '10px 12px',
      textAlign: align ?? 'left',
      fontSize: 13,
      ...style,
    }}>
      {children}
    </td>
  );
}

/* =========================================================================
 * F-051.2 — Vigencia helpers
 * Comparamos strings YYYY-MM-DD (lección F-041) para evitar shift UTC.
 * ========================================================================= */

function esFinalizada(o: ObligacionRecurrente, hoy: string): boolean {
  return !!o.fechaFin && o.fechaFin < hoy;
}

function diasEntreISO(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split('-').map(Number);
  const [y2, m2, d2] = hasta.split('-').map(Number);
  const a = new Date(y1, m1 - 1, d1).getTime();
  const b = new Date(y2, m2 - 1, d2).getTime();
  return Math.round((b - a) / 86_400_000);
}

function VigenciaBadge({ o, hoy }: { o: ObligacionRecurrente; hoy: string }) {
  // Finalizada: fechaFin ya pasó.
  if (o.fechaFin && o.fechaFin < hoy) {
    return (
      <span style={badgeBase('var(--ink-2)', 'var(--paper)')}>
        Finalizada
      </span>
    );
  }
  // No inicia aún: fechaInicio en el futuro.
  if (o.fechaInicio && o.fechaInicio > hoy) {
    return (
      <span style={badgeBase('var(--ink-2)', 'var(--paper)')} title={`Inicia ${formatearFecha(o.fechaInicio, 'dd/MM/yyyy')}`}>
        Inicia {formatearFecha(o.fechaInicio, 'dd/MM')}
      </span>
    );
  }
  // Vence pronto: fechaFin a < 60 días.
  if (o.fechaFin) {
    const dias = diasEntreISO(hoy, o.fechaFin);
    if (dias >= 0 && dias < 60) {
      return (
        <span style={badgeBase('var(--amber)', 'var(--ink)')} title={`En ${dias} día${dias === 1 ? '' : 's'}`}>
          Termina {formatearFecha(o.fechaFin, 'dd/MM')}
        </span>
      );
    }
  }
  return <span style={{ color: 'var(--ink-3)' }}>—</span>;
}

function badgeBase(bg: string, color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 11,
    background: bg,
    color,
    whiteSpace: 'nowrap',
  };
}
