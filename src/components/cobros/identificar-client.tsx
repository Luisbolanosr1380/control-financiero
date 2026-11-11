'use client';

/**
 * IDENTIFICAR PAGO · conciliación inversa, SOLO LECTURA. Dado el monto de un depósito, dice qué factura abierta (o qué
 * suma de facturas de un cliente) pudo haberlo pagado comparando contra TRES montos: el total, el saldo (#51) y el
 * NETO CON RETENCIÓN (saldo − retención de IVA esperada según el perfil del cliente; si nunca retuvo, se prueba la tasa
 * general del 15 % y se marca «posible»). «Buscar sobre», la tolerancia y el monto viajan en la URL. La lógica vive en
 * src/lib/cobros/identificar.ts (puro); acá solo la pantalla.
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { usePuede } from '@/components/auth/permisos';
import {
  BASES, ETIQUETA_BASE, PRESETS_TOLERANCIA, calzarClientes, calzarFacturas, enlaceBusquedaFacturas, enlaceRegistrarCobro, estadoDesdeParams, paramsDeEstado, parseMonto, toleranciaDe, toleranciaNetoParaBusqueda,
  type BaseBusqueda, type Coincidencia, type CoincidenciaCliente, type FacturaIdentificable, type PerfilRetencion, type PresetTolerancia,
} from '@/lib/cobros/identificar';

interface Props {
  facturas: FacturaIdentificable[];   // solo abiertas (vivas, no cobradas según la 026, con saldo)
  perfiles: Record<string, PerfilRetencion>;
  cobrosConRetencion: number;
  error?: string;
}

// "exacto" (verde) si dif=0; en el neto, un centavo por línea es redondeo de la retención del cliente y sigue siendo exacto; si no "+Q3.50" / "−Q12"
function DiffBadge({ diff, exacta }: { diff: number; exacta: boolean }) {
  if (Math.abs(diff) < 0.005) return <span style={{ color: 'var(--olive)', fontWeight: 600, fontSize: 12 }} data-diff="0">exacto</span>;
  const sign = diff > 0 ? '+' : '−';
  if (exacta) return <span style={{ color: 'var(--olive)', fontWeight: 600, fontSize: 12 }} data-diff={diff} data-redondeo="1" title={`El cliente redondeó su retención: ${sign}${Q(Math.abs(diff))} de diferencia`}>exacto <span className="num" style={{ fontWeight: 400, color: 'var(--ink-3)' }}>({sign}{Q(Math.abs(diff))} redondeo)</span></span>;
  return <span className="num" style={{ color: 'var(--ink-3)', fontSize: 12 }} data-diff={diff}>{sign}{Q(Math.abs(diff))}</span>;
}

const CLASE_TIPO: Record<Coincidencia['tipo'], string> = { total: 'badge-olive', saldo: 'badge-indigo', neto: 'badge-wine', neto_general: 'badge-mute' };

function CalzaPor({ tipo, etiqueta, posible, title }: { tipo: Coincidencia['tipo']; etiqueta: string; posible: boolean; title?: string }) {
  return <span className={'badge ' + CLASE_TIPO[tipo]} data-calza={tipo} data-posible={posible ? '1' : '0'} title={title ?? etiqueta} style={{ whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.3 }}>{etiqueta}</span>;
}

export function IdentificarClient({ facturas, perfiles, cobrosConRetencion, error }: Props) {
  const sp = useSearchParams();
  const puede = usePuede();
  const inicial = useMemo(() => estadoDesdeParams(k => sp.get(k)), [sp]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [raw, setRaw] = useState(inicial.monto > 0 ? String(inicial.monto) : '');
  const [preset, setPreset] = useState<PresetTolerancia>(inicial.preset);
  const [base, setBase] = useState<BaseBusqueda>(inicial.base);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const monto = useMemo(() => parseMonto(raw), [raw]);
  const tol = toleranciaDe(preset, monto);

  // el estado viaja en la URL (sin recargar la página ni pedirle nada al servidor)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const qs = paramsDeEstado({ monto, preset, base });
    const actual = window.location.search;
    if (qs !== actual) window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs}`);
  }, [monto, preset, base]);

  const facturaMatches = useMemo<Coincidencia[]>(() => calzarFacturas(facturas, perfiles, monto, tol, base), [facturas, perfiles, monto, tol, base]);
  const clienteMatches = useMemo<CoincidenciaCliente[]>(() => calzarClientes(facturas, perfiles, monto, tol, base), [facturas, perfiles, monto, tol, base]);
  const nPerfiles = useMemo(() => Object.values(perfiles).filter(p => p.tasaIva != null || p.tasaIsr != null).length, [perfiles]);

  const toggle = (custId: string) => {
    const s = new Set(expanded);
    if (s.has(custId)) s.delete(custId); else s.add(custId);
    setExpanded(s);
  };

  const hasInput = monto > 0;
  const sinMatches = hasInput && facturaMatches.length === 0 && clienteMatches.length === 0;
  const puedeRegistrar = puede('registrar_cobro');
  const hrefBusqueda = hasInput ? enlaceBusquedaFacturas(monto, base) : '';
  const titleBusqueda = base === 'neto'
    ? `Abre Facturación buscando por saldo pendiente ±${Q(toleranciaNetoParaBusqueda(monto))} (cubre la retención de IVA esperada) entre las pendientes, en todas las facturas`
    : base === 'saldo' ? 'Abre Facturación buscando este monto (±Q1) sobre el saldo pendiente, en todas las facturas'
    : 'Abre Facturación buscando este monto (±Q1) entre las pendientes, en todas las facturas';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Identificar pago</h1>
          <div className="page-subtitle">
            Conciliación inversa · dado el monto de un depósito, sugiere qué factura o cliente pudo haberlo pagado: por el total, por el saldo o por el neto después de la retención de IVA. <strong>Solo lectura.</strong>
          </div>
        </div>
      </div>

      {error && <div className="card" style={{ marginBottom: 16 }}><div className="card-pad" style={{ color: 'var(--wine)', fontSize: 12.5 }} data-error-identificar>{error}</div></div>}

      {/* Entrada: monto + tolerancia + base */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-pad">
          <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 500, marginBottom: 8 }}>
            Monto del depósito
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <span className="currency" style={{ fontSize: 30, color: 'var(--ink-3)', fontWeight: 500 }}>Q</span>
            <input
              autoFocus
              inputMode="decimal"
              placeholder="0.00"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              className="num"
              data-campo="monto"
              style={{
                fontSize: 30, fontWeight: 500, letterSpacing: '-0.02em',
                border: 'none', outline: 'none', background: 'transparent',
                color: 'var(--ink)', width: '100%', maxWidth: 360, padding: 0,
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)', marginRight: 4, minWidth: 82 }}>Tolerancia</span>
            {PRESETS_TOLERANCIA.map(p => (
              <button key={p.key} type="button" className={'btn ' + (preset === p.key ? 'btn-primary' : 'btn-secondary')} style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => setPreset(p.key)} data-tol={p.key} aria-pressed={preset === p.key}>
                {p.label}
              </button>
            ))}
            {hasInput && tol > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-4)' }} className="num">
                rango {Q(monto - tol)} – {Q(monto + tol)}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} data-selector-base>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)', marginRight: 4, minWidth: 82 }}>Buscar sobre</span>
            {BASES.map(b => (
              <button key={b} type="button" className={'btn ' + (base === b ? 'btn-primary' : 'btn-secondary')} style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => setBase(b)} data-sobre={b} aria-pressed={base === b}
                title={b === 'auto' ? 'Compara el total, el saldo y el neto con retención' : b === 'total' ? 'Solo el total de la factura' : b === 'saldo' ? 'Solo el saldo pendiente (total − cobros − NC)' : 'Solo el saldo menos la retención de IVA esperada según el perfil del cliente'}>
                {ETIQUETA_BASE[b]}
              </button>
            ))}
            {hasInput && (
              <Link href={hrefBusqueda} className="btn btn-secondary" style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 12 }} title={titleBusqueda} data-accion="buscar-facturas-monto">
                <I.Search size={12} /> Buscar facturas por este monto
              </Link>
            )}
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-4)' }} data-perfiles={nPerfiles}>
            {facturas.length} facturas abiertas · perfil de retención de {nPerfiles} {nPerfiles === 1 ? 'cliente' : 'clientes'} a partir de {cobrosConRetencion} cobros con retención; si el cliente nunca retuvo se prueba la tasa general del 15 % y se marca «posible».
          </div>
        </div>
      </div>

      {!hasInput && (
        <div className="card"><div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 40, fontSize: 13 }}>
          <I.Search size={26} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>Ingresá un monto para buscar coincidencias.</div>
        </div></div>
      )}

      {sinMatches && (
        <div className="card" data-sin-coincidencias><div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 40, fontSize: 13 }}>
          <I.Alert size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>Ningún match dentro de la tolerancia{base !== 'auto' ? ` buscando sobre ${ETIQUETA_BASE[base].toLowerCase()}` : ''}. Probá ampliarla{base !== 'auto' ? ' o volvé a «Automático»' : ''}.</div>
        </div></div>
      )}

      {hasInput && facturaMatches.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <div className="card-title">Facturas que calzan</div>
            <div className="card-actions">
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }} className="num" data-conteo-facturas={facturaMatches.length}>{facturaMatches.length}</span>
            </div>
          </div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table" data-lista="facturas">
              <thead>
                <tr>
                  <th>Factura</th>
                  <th>Cliente</th>
                  <th className="num">Total</th>
                  <th className="num">Saldo</th>
                  <th className="num">Esperado</th>
                  <th>Calza por</th>
                  <th className="num">Días vencida</th>
                  <th className="num">Diferencia</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {facturaMatches.map(m => {
                  const f = m.factura;
                  const href = enlaceRegistrarCobro(m, monto);
                  const detalle = `Total ${Q(m.montos.total)} · saldo ${Q(m.montos.saldo)} · neto con retención ${Q(m.montos.neto)} (IVA ${Math.round(m.montos.tasaIva * 100)} %: −${Q(m.montos.retIva)}${m.montos.retIsr > 0 ? ` · ISR −${Q(m.montos.retIsr)}` : ''})`;
                  return (
                    <tr key={`${f.id}|${f.noFactura}`} data-factura={f.noFactura} data-tipo={m.tipo} data-esperado={m.esperado}>
                      <td className="num cell-strong">{f.id ? <Link href={`/facturacion/${encodeURIComponent(f.id)}`} title={detalle}>{f.noFactura}</Link> : f.noFactura}</td>
                      <td className="cell-strong">{f.cliente}</td>
                      <td className="num">{Q(m.montos.total)}</td>
                      <td className="num" style={{ color: m.montos.saldo < m.montos.total ? 'var(--ink)' : 'var(--ink-3)' }}>{Q(m.montos.saldo)}</td>
                      <td className="num cell-strong">{Q(m.esperado)}</td>
                      <td><CalzaPor tipo={m.tipo} etiqueta={m.etiqueta} posible={m.posible} title={`${m.etiqueta}${m.posible ? ' · el cliente nunca retuvo' : ''} · ${detalle}`} /></td>
                      <td className="num cell-mute" style={{ color: f.diasVencida > 0 ? 'var(--wine)' : undefined }}>{f.diasVencida > 0 ? `${f.diasVencida} d` : '—'}</td>
                      <td className="num"><DiffBadge diff={m.diff} exacta={m.exacta} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {href && puedeRegistrar && (
                          <Link href={href} className="btn btn-secondary" style={{ padding: '3px 9px', fontSize: 11.5 }} data-accion="registrar-cobro-prellenado"
                            title={`Abre la factura con el cobro prellenado: ${Q(monto)}${m.montos.retIva > 0 && (m.tipo === 'neto' || m.tipo === 'neto_general') ? ` + retención IVA ${Q(m.montos.retIva)}` : ''}${m.montos.retIsr > 0 && (m.tipo === 'neto' || m.tipo === 'neto_general') ? ` + retención ISR ${Q(m.montos.retIsr)}` : ''}`}>
                            <I.Coins size={11} /> Registrar cobro
                          </Link>
                        )}
                        {href && !puedeRegistrar && f.id && (
                          <Link href={`/facturacion/${encodeURIComponent(f.id)}`} className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 11.5 }} data-accion="ver-factura" title={detalle}>Ver factura</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasInput && clienteMatches.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Clientes que calzan</div>
            <div className="card-actions">
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }} className="num" data-conteo-clientes={clienteMatches.length}>{clienteMatches.length}</span>
            </div>
          </div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table" data-lista="clientes">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Cliente</th>
                  <th className="num">Facturas abiertas</th>
                  <th className="num">Suma</th>
                  <th>Calza por</th>
                  <th className="num">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {clienteMatches.map(m => (
                  <FragmentRows key={m.clienteId || m.cliente} m={m} isOpen={expanded.has(m.clienteId)} onToggle={() => toggle(m.clienteId)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRows({ m, isOpen, onToggle }: { m: CoincidenciaCliente; isOpen: boolean; onToggle: () => void }) {
  const esNeto = m.tipo === 'neto' || m.tipo === 'neto_general';
  return (
    <>
      <tr className="clickable" onClick={onToggle} data-cliente={m.clienteId} data-tipo={m.tipo} data-suma={m.suma}>
        <td style={{ color: 'var(--ink-4)' }}>{isOpen ? <I.ChevDown size={14} /> : <I.Chevron size={14} />}</td>
        <td className="cell-strong">{m.cliente}</td>
        <td className="num cell-mute">{m.facturas.length}</td>
        <td className="num cell-strong">{Q(m.suma)}</td>
        <td><CalzaPor tipo={m.tipo} etiqueta={m.etiqueta} posible={m.posible} title={`${m.etiqueta}${m.posible ? ' · el cliente nunca retuvo' : ''}${esNeto ? ` · retención de IVA esperada en total ${Q(m.retIva)}` : ''}`} /></td>
        <td className="num"><DiffBadge diff={m.diff} exacta={m.exacta} /></td>
      </tr>
      {isOpen && m.facturas.map(({ factura: f, montos }) => (
        <tr key={`${f.id}|${f.noFactura}`} style={{ background: 'var(--bg-2)' }} data-factura-cliente={f.noFactura}>
          <td></td>
          <td className="num cell-mute" style={{ paddingLeft: 8 }}>{f.id ? <Link href={`/facturacion/${encodeURIComponent(f.id)}`}>{f.noFactura}</Link> : f.noFactura}</td>
          <td className="cell-mute" style={{ fontSize: 11.5 }}>{f.diasVencida > 0 ? `vencida ${f.diasVencida} d` : 'por vencer'}</td>
          <td className="num cell-mute">{Q(m.tipo === 'total' ? montos.total : m.tipo === 'saldo' ? montos.saldo : montos.neto)}</td>
          <td colSpan={2} className="cell-mute" style={{ fontSize: 11.5 }}>total {Q(montos.total)} · saldo {Q(montos.saldo)} · neto {Q(montos.neto)} (ret. IVA {Q(montos.retIva)})</td>
        </tr>
      ))}
    </>
  );
}
