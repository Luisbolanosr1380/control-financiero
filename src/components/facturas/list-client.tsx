'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q, formatDateDDMMYYYY } from '@/lib/utils';
import { LINES } from '@/lib/mock-data';
import { cargarMasFacturasAction } from '@/app/(app)/facturacion/actions';
import { HelpButton } from '@/components/ayuda/help-button';
import type { Invoice, Customer } from '@/lib/types';
import { predicadoFiltro, type InvoiceLiviano, type FiltroTabFactura, type TopClienteMes } from '@/lib/db/facturas';
import { etiquetaMes } from '@/lib/utils/mes-activo';

// F-034: nueva estructura de tabs. "Por cobrar" es solo EMITIDA (sin PENDIENTE).
// "Cartera total" agrupa EMITIDA + PENDIENTE (todo lo no cobrado). Stark prefiere
// distinguir cartera activa de cobranza normal (Por cobrar) vs proceso interno
// retenido (Pendientes). El tab type coincide con FiltroTabFactura por diseño:
// el server filtra por el mismo identificador.
export const FACTURAS_TABS = ['todas', 'cartera_total', 'por_cobrar', 'vencidas', 'pendientes', 'parciales', 'cobradas', 'anuladas', 'refacturadas'] as const;
export type FacturasTab = FiltroTabFactura;

type Filtrable = { estadoBruto: string; vencida: boolean };

// Predicados de negocio para sub-totales (los tabs en sí pasan por predicadoFiltro).
const esEmitida          = (i: Filtrable) => i.estadoBruto === 'emitida';
const esPendiente        = (i: Filtrable) => i.estadoBruto === 'pendiente';
const esCobradoParcial   = (i: Filtrable) => i.estadoBruto === 'cobrado_parcial';
const esCobranzaActiva   = (i: Filtrable) => esEmitida(i) || esCobradoParcial(i);

const TAB_LABELS: Record<FacturasTab, string> = {
  todas: 'Todas',
  cartera_total: 'Cartera total',
  por_cobrar: 'Por cobrar',
  vencidas: 'Vencidas',
  pendientes: 'Pendientes',
  parciales: 'Parciales',
  cobradas: 'Cobradas',
  anuladas: 'Anuladas',
  refacturadas: 'Refacturadas',
};

/** Sub-totales del tab Por cobrar: por vencer vs vencidas (EMITIDA + COBRADO PARCIAL). */
function PorCobrarSummary({ facturas }: { facturas: { total: number; estadoBruto: string; vencida: boolean }[] }) {
  const porCobrar  = facturas.filter(esCobranzaActiva);
  const vencidas   = porCobrar.filter(i => i.vencida);
  const porVencer  = porCobrar.filter(i => !i.vencida);
  const sumar = (arr: { total: number }[]) => arr.reduce((s, i) => s + i.total, 0);
  return (
    <div className="card" style={{
      margin: '10px 0 14px', padding: '12px 16px',
      background: 'var(--paper-2)', border: '1px solid var(--line-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>
          Por cobrar · <span className="num">{porCobrar.length}</span> facturas · <span className="num">{Q(sumar(porCobrar))}</span>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--olive)' }} />
          <span>Por vencer:</span>
          <span className="num" style={{ marginLeft: 'auto', color: 'var(--ink-2)' }}>
            {porVencer.length} facturas · {Q(sumar(porVencer))}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--wine)' }} />
          <span>Vencidas:</span>
          <span className="num" style={{ marginLeft: 'auto', color: 'var(--wine)', fontWeight: 500 }}>
            {vencidas.length} facturas · {Q(sumar(vencidas))}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Sub-totales del tab Cartera total: EMITIDA + PENDIENTE + COBRADO PARCIAL. */
function CarteraTotalSummary({ facturas }: { facturas: { total: number; estadoBruto: string; vencida: boolean }[] }) {
  const emitidas   = facturas.filter(esEmitida);
  const pendientes = facturas.filter(esPendiente);
  const parciales  = facturas.filter(esCobradoParcial);
  const sumar = (arr: { total: number }[]) => arr.reduce((s, i) => s + i.total, 0);
  const tot = emitidas.length + pendientes.length + parciales.length;
  return (
    <div className="card" style={{
      margin: '10px 0 14px', padding: '12px 16px',
      background: 'var(--paper-2)', border: '1px solid var(--line-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>
          Cartera total · <span className="num">{tot}</span> facturas · <span className="num">{Q(sumar(emitidas) + sumar(pendientes) + sumar(parciales))}</span>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--olive)' }} />
          <span>Por cobrar (emitidas):</span>
          <span className="num" style={{ marginLeft: 'auto', color: 'var(--ink-2)' }}>
            {emitidas.length} · {Q(sumar(emitidas))}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--warn)' }} />
          <span>Pendientes:</span>
          <span className="num" style={{ marginLeft: 'auto', color: 'var(--ink-2)' }}>
            {pendientes.length} · {Q(sumar(pendientes))}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#A85C32' }} />
          <span>Parciales:</span>
          <span className="num" style={{ marginLeft: 'auto', color: 'var(--ink-2)' }}>
            {parciales.length} · {Q(sumar(parciales))}
          </span>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
 * F-BF-002b — TOP CLIENTES DEL MES
 * Card compacta debajo de los tabs. Click en cliente → filtra la tabla
 * (setea el search a su nombre, que ya filtra por noFactura | cliente).
 * ========================================================================= */

function TopClientesCard({
  items, totalMesQ, mesActivo, onPickCliente,
}: {
  items: TopClienteMes[];
  totalMesQ: number;
  mesActivo: string;
  onPickCliente: (nombre: string) => void;
}) {
  const maxMonto = items[0]?.montoQ ?? 0;
  return (
    <div className="card" style={{ marginBottom: 16, padding: '12px 14px' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 500,
          textTransform: 'uppercase', letterSpacing: '0.08em',
          color: 'var(--ink-4)',
        }}>
          Top clientes · {etiquetaMes(mesActivo)}
        </div>
        {totalMesQ > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            Total del mes: <span className="num" style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{Q(totalMesQ)}</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((c, i) => {
          const ancho = maxMonto > 0 ? Math.max(2, (c.montoQ / maxMonto) * 100) : 0;
          return (
            <button
              key={c.custId}
              type="button"
              onClick={() => onPickCliente(c.nombre)}
              title={`${c.numFacturas} factura${c.numFacturas === 1 ? '' : 's'} de ${c.nombre} · click filtra la tabla`}
              style={{
                all: 'unset',
                cursor: 'pointer',
                display: 'grid',
                gridTemplateColumns: '22px minmax(0, 1fr) auto 1fr 56px',
                gap: 10,
                alignItems: 'center',
                padding: '4px 6px',
                borderRadius: 4,
                fontSize: 12.5,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-tint)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ color: 'var(--ink-4)', fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}>
                {i + 1}.
              </span>
              <span style={{
                color: 'var(--ink)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {c.nombreCorto}
              </span>
              <span className="num" style={{ color: 'var(--ink-2)', fontWeight: 500, minWidth: 86, textAlign: 'right' }}>
                {Q(c.montoQ)}
              </span>
              <span style={{
                height: 6,
                background: 'var(--line-3)',
                borderRadius: 3,
                position: 'relative',
                overflow: 'hidden',
              }}>
                <span style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${ancho}%`,
                  background: 'var(--olive)',
                  borderRadius: 3,
                }} />
              </span>
              <span style={{ color: 'var(--ink-3)', fontSize: 11.5, textAlign: 'right' }}>
                {c.porcentaje.toFixed(1)}%
              </span>
            </button>
          );
        })}
        {items.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--ink-4)', textAlign: 'center', padding: 12 }}>
            Sin facturas para {etiquetaMes(mesActivo)}.
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  initialInvoices: Invoice[];
  initialHayMas: boolean;
  initialUltimaFecha: string | null;
  facturasLivianas: InvoiceLiviano[];
  clientes: Customer[];
  initialTab?: FacturasTab;
  ncsActivasAnio?: number;   // F-045
  /** F-BF-002a: mes activo del selector global (YYYY-MM). */
  mesActivo?: string;
  /** F-BF-002b: top clientes del mes — calculado server-side, sin tocar Airtable. */
  topClientes?: TopClienteMes[];
  /** F-BF-002b: facturado total del mes (sin anuladas/refacturadas), denominador del %. */
  totalMesQ?: number;
}

export function FacturasListClient({
  initialInvoices, initialHayMas, initialUltimaFecha, facturasLivianas, clientes,
  initialTab = 'todas', ncsActivasAnio = 0, mesActivo,
  topClientes = [], totalMesQ = 0,
}: Props) {
  const router = useRouter();
  // F-034: el tab manda en URL — el componente se re-monta vía key={tab} cuando
  // cambia, así initialInvoices ya viene del server filtrado por el tab activo.
  const tab: FacturasTab = initialTab;
  const [facturas, setFacturas] = useState<Invoice[]>(initialInvoices);
  const [hayMas, setHayMas] = useState<boolean>(initialHayMas);
  const [ultimaFecha, setUltimaFecha] = useState<string | null>(initialUltimaFecha);
  const [cargandoMas, setCargandoMas] = useState(false);

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const custById = Object.fromEntries(clientes.map(c => [c.id, c]));

  const cambiarTab = (t: FacturasTab) => {
    if (t === tab) return;
    // F-BF-002a: preservar `mes` y demás params al cambiar de tab.
    const params = new URLSearchParams();
    if (t !== 'todas') params.set('tab', t);
    if (mesActivo) params.set('mes', mesActivo);
    const qs = params.toString();
    router.push(qs ? `/facturacion?${qs}` : '/facturacion', { scroll: false });
  };

  // F-033: counts y sumas se computan SIEMPRE sobre el dataset liviano completo
  // (no sobre las facturas paginadas). Así el header refleja el universo real
  // bajo el tab actual, no "lo cargado en pantalla".
  const counts = {
    todas:         facturasLivianas.length,
    cartera_total: facturasLivianas.filter(i => esCobranzaActiva(i) || esPendiente(i)).length,
    por_cobrar:    facturasLivianas.filter(esCobranzaActiva).length,
    vencidas:      facturasLivianas.filter(i => esCobranzaActiva(i) && i.vencida).length,
    pendientes:    facturasLivianas.filter(esPendiente).length,
    parciales:     facturasLivianas.filter(esCobradoParcial).length,
    cobradas:      facturasLivianas.filter(i => i.estadoBruto === 'cobrado').length,
    anuladas:      facturasLivianas.filter(i => i.estadoBruto === 'anulado').length,
    refacturadas:  facturasLivianas.filter(i => i.estadoBruto === 'refacturado').length,
  };

  const cargarMas = async () => {
    if (!ultimaFecha || cargandoMas) return;
    setCargandoMas(true);
    try {
      const res = await cargarMasFacturasAction(ultimaFecha, 50, tab, mesActivo);
      setFacturas(prev => {
        const vistos = new Set(prev.map(i => i.noFactura));
        const nuevos = res.invoices.filter(i => !vistos.has(i.noFactura));
        return [...prev, ...nuevos];
      });
      setHayMas(res.hayMas);
      setUltimaFecha(res.ultimaFecha);
    } finally {
      setCargandoMas(false);
    }
  };

  // F-034: el server ya filtró por el tab activo, así que las filas visibles
  // (`facturas`) son TODAS del tab actual. El search es el único filtro client-side.
  let rows: Invoice[] = facturas;
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(i =>
      i.noFactura.toLowerCase().includes(q) ||
      (custById[i.custId]?.name ?? '').toLowerCase().includes(q)
    );
  }
  const totalSaldo = rows.reduce((s, i) => s + i.balance, 0);

  // F-033: agregado REAL del tab actual (sobre TODAS las facturas, no solo las cargadas).
  // El search también filtra el agregado para coherencia visual cuando el usuario busca.
  let livianasTab = facturasLivianas.filter(predicadoFiltro(tab));
  if (search) {
    const q = search.toLowerCase();
    livianasTab = livianasTab.filter(i =>
      i.noFactura.toLowerCase().includes(q) ||
      (custById[i.custId]?.name ?? '').toLowerCase().includes(q)
    );
  }
  const agregadoTab = {
    cantidad: livianasTab.length,
    suma:     livianasTab.reduce((s, i) => s + i.total, 0),
    // F-034.2: líneas crudas en Airtable. Cuando difiere de `cantidad`, hay
    // multi-línea (una factura SAT con N servicios = N líneas). El header
    // muestra una aclaración para evitar que parezca que faltan datos.
    lineasCrudas: livianasTab.reduce((s, i) => s + i.numLineas, 0),
  };

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Facturación
            <HelpButton tag="modulo-facturacion" />
          </h1>
          <div className="page-subtitle" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
            <span style={{ fontWeight: 500 }}>{TAB_LABELS[tab]}:</span>{' '}
            <span className="num" style={{ fontWeight: 500 }}>{agregadoTab.cantidad}</span> facturas
            {' · '}
            <span className="num" style={{ fontWeight: 500 }}>{Q(agregadoTab.suma)}</span>
          </div>
          {agregadoTab.lineasCrudas > agregadoTab.cantidad && (
            <div className="page-subtitle" style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2, fontStyle: 'italic' }}>
              Algunas facturas tienen múltiples servicios (<span className="num">{agregadoTab.lineasCrudas}</span> servicios facturados en total)
            </div>
          )}
          <div className="page-subtitle" style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>
            Mostrando <span className="num">{rows.length}</span> de <span className="num">{agregadoTab.cantidad}</span>
            {agregadoTab.cantidad > rows.length && <> · faltan <span className="num">{agregadoTab.cantidad - rows.length}</span> por cargar</>}
            {' · '}ordenadas por fecha
          </div>
          {ncsActivasAnio > 0 && (
            <div className="page-subtitle" style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
              + <span className="num" style={{ color: 'var(--wine)' }}>{Q(ncsActivasAnio)}</span> en NCs activas del año reducen el facturado neto. <a href="/notas-credito" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Ver notas de crédito →</a>
            </div>
          )}
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Download size={13} /> Exportar</button>
          <button className="btn btn-secondary"><I.Mail size={13} /> Recordatorios masivos</button>
          <button className="btn btn-primary" onClick={() => router.push('/facturacion/nueva')}>
            <I.Plus size={13} /> Nueva factura <span className="kbd">⌘N</span>
          </button>
        </div>
      </div>

      <div className="tabs">
        {FACTURAS_TABS.map(t => (
          <button key={t} className={'tab' + (tab === t ? ' active' : '')} onClick={() => cambiarTab(t)}>
            {TAB_LABELS[t]}
            <span className="tab-count num">{counts[t]}</span>
          </button>
        ))}
      </div>

      {/* F-BF-002b: Top clientes del mes — siempre visible, refleja el mes activo. */}
      {topClientes.length > 0 && mesActivo && (
        <TopClientesCard
          items={topClientes}
          totalMesQ={totalMesQ}
          mesActivo={mesActivo}
          onPickCliente={(nombre) => setSearch(nombre)}
        />
      )}

      {/* Sub-totales por tab (sobre livianas = universo completo). */}
      {tab === 'por_cobrar'    && <PorCobrarSummary facturas={facturasLivianas} />}
      {tab === 'cartera_total' && <CarteraTotalSummary facturas={facturasLivianas} />}

      <div className="toolbar">
        <div className="toolbar-search">
          <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
          <input placeholder="Factura, cliente, NIT…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
          <span>{rows.length} resultados</span>
          <span style={{ margin: '0 8px', color: 'var(--line-2)' }}>·</span>
          <span className="num">Total: {Q(totalSaldo)}</span>
        </div>
      </div>

      <div className="table-wrap" style={{ borderRadius: '0 0 var(--r-3) var(--r-3)', borderTop: 'none' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} />
              </th>
              <th>Factura</th>
              <th className="num" style={{ width: 110 }}>Fecha</th>
              <th>Cliente</th>
              <th>Centro</th>
              <th className="num">Total</th>
              <th className="num">Saldo</th>
              <th>Aging</th>
              <th>Estado</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} style={{ height: 200, textAlign: 'center', color: 'var(--ink-4)' }}>
                <div style={{ padding: 40 }}>
                  <I.Receipt size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                  <div style={{ fontSize: 13 }}>No hay facturas en esta vista</div>
                </div>
              </td></tr>
            ) : rows.map(inv => {
              const cust = custById[inv.custId];
              const line = LINES[inv.line];
              const agingDays = inv.dueAgo;
              let agingBadge: { cls: string; text: string };
              if (inv.status === 'cobrado')       agingBadge = { cls: 'badge-olive', text: 'Pagada' };
              else if (agingDays > 90)            agingBadge = { cls: 'badge-wine', text: '+90 d' };
              else if (agingDays > 60)            agingBadge = { cls: 'badge-wine', text: `${agingDays} d` };
              else if (agingDays > 30)            agingBadge = { cls: 'badge-warn', text: `${agingDays} d` };
              else if (agingDays > 0)             agingBadge = { cls: 'badge-warn', text: `${agingDays} d` };
              else                                agingBadge = { cls: 'badge-mute', text: `${Math.abs(agingDays)} d` };

              // F-032: badge derivado de estadoBruto + vencida (no del legacy `status`)
              const brutoBadgeMap: Record<string, { cls: string; text: string }> = {
                cobrado:         { cls: 'badge-olive',   text: 'Cobrada' },
                cobrado_parcial: { cls: 'badge-warn',    text: 'Parcial' },
                emitida:         { cls: 'badge-outline', text: 'Emitida' },
                pendiente:       { cls: 'badge-warn',    text: 'Pendiente' },
                anulado:         { cls: 'badge-mute',    text: 'Anulada' },
                refacturado:     { cls: 'badge-mute',    text: 'Refacturada' },
                otro:            { cls: 'badge-mute',    text: '—' },
              };
              const statusBadge = inv.vencida
                ? { cls: 'badge-wine', text: 'Vencida' }
                : brutoBadgeMap[inv.estadoBruto] ?? { cls: 'badge-mute', text: inv.estadoBruto };

              return (
                <tr key={inv.id} className="clickable" onClick={() => router.push(`/facturacion/${inv.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(inv.id)} onChange={() => {
                      const s = new Set(selected);
                      if (s.has(inv.id)) s.delete(inv.id); else s.add(inv.id);
                      setSelected(s);
                    }} />
                  </td>
                  <td className="num cell-strong">
                    {inv.noFactura}
                    {inv.fechaUltimaEdicion && (
                      <span
                        title={`Editada el ${formatDateDDMMYYYY(inv.fechaUltimaEdicion)}${inv.editadoPor ? ` por ${inv.editadoPor}` : ''}`}
                        style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-4)' }}
                      >
                        ✏️
                      </span>
                    )}
                  </td>
                  <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>{formatDateDDMMYYYY(inv.fechaEmision)}</td>
                  <td className="cell-strong">{cust?.short ?? inv.custId ?? '—'}</td>
                  <td>
                    {inv.isMixed ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                        {inv.lineas.map((l, idx) => (
                          <span key={idx} className={'dot ' + LINES[l.line].dot} title={LINES[l.line].name}></span>
                        ))}
                        <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--ink-3)', fontStyle: 'italic' }}>
                          {inv.lineas.length} líneas
                        </span>
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <span className={'dot ' + line.dot}></span>{line.name}
                      </span>
                    )}
                  </td>
                  <td className="num cell-strong">{Q(inv.total)}</td>
                  <td className="num cell-strong">{Q(inv.balance)}</td>
                  <td><span className={'badge ' + agingBadge.cls}>{agingBadge.text}</span></td>
                  <td><span className={'badge ' + statusBadge.cls}>{statusBadge.text}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="modal-close"><I.More size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer: paginación */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        padding: '18px 12px', borderTop: '1px solid var(--line-3)', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          Mostrando <span className="num" style={{ color: 'var(--ink-2)' }}>{rows.length}</span> de <span className="num" style={{ color: 'var(--ink-2)' }}>{agregadoTab.cantidad}</span>
          {agregadoTab.cantidad > rows.length && <> · <span className="num">{agregadoTab.cantidad - rows.length}</span> más por cargar</>}
        </span>
        {hayMas ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={cargarMas}
            disabled={cargandoMas}
            style={{ padding: '6px 14px' }}
          >
            {cargandoMas ? <><I.Refresh size={13} /> Cargando…</> : <><I.ChevDown size={13} /> Cargar 50 más</>}
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" disabled style={{ padding: '6px 14px' }}>
            <I.Check size={13} /> Fin del listado
          </button>
        )}
      </div>
    </div>
  );
}
