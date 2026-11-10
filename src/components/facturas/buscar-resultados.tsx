'use client';

/**
 * BUSCAR FACTURAS POR MONTO · chip con la interpretación, panel «Más filtros» y tabla de resultados.
 * Los criterios viajan en la URL (se comparten y no se pierden al volver); el servidor busca sobre TODAS las
 * facturas (page.tsx → buscarFacturas). Exporta a CSV lo que se ve.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q, formatDateDDMMYYYY } from '@/lib/utils';
import { csvEscape } from '@/lib/facturacion/reporte-csv';
import { CRITERIOS_VACIOS, ETIQUETA_ESTADO_BUSQUEDA, ETIQUETA_SOBRE, TOLERANCIA_DEFAULT, describirCriterios, paramsDeCriterios, type CriteriosBusqueda, type EstadoBusqueda, type SobreMonto } from '@/lib/facturacion/buscar-monto';
import type { FacturaBuscada, ResultadoBusqueda } from '@/lib/db/facturas-buscar';

const BADGE: Record<FacturaBuscada['estado'], { cls: string; text: string }> = {
  cobrada: { cls: 'badge-olive', text: 'Pagada' }, parcial: { cls: 'badge-warn', text: 'Parcial' }, pendiente: { cls: 'badge-warn', text: 'Pendiente' },
  emitida: { cls: 'badge-outline', text: 'Emitida' }, anulada: { cls: 'badge-mute', text: 'Anulada' }, refacturada: { cls: 'badge-mute', text: 'Refacturada' }, otro: { cls: 'badge-mute', text: '—' },
};

/** Navega a /facturacion con los criterios (conserva tab y mes del listado). */
export function useIrABusqueda() {
  const router = useRouter();
  const sp = useSearchParams();
  return (c: CriteriosBusqueda | null) => {
    const base = new URLSearchParams(sp?.toString() ?? '');
    const qs = paramsDeCriterios(c ?? CRITERIOS_VACIOS, base);
    router.push(`/facturacion${qs}`, { scroll: false });
  };
}

/** Chip con la interpretación de la búsqueda y la ✕ para quitarla. */
export function ChipBusqueda({ criterios }: { criterios: CriteriosBusqueda }) {
  const ir = useIrABusqueda();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '8px 0' }} data-chip-busqueda>
      <span className="badge badge-outline" style={{ fontSize: 12, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <I.Search size={12} /> <span data-chip-texto>{describirCriterios(criterios)}</span>
        <button type="button" className="modal-close" onClick={() => ir(null)} aria-label="Quitar la búsqueda" title="Quitar la búsqueda" style={{ padding: 0, lineHeight: 1 }} data-accion="quitar-busqueda"><I.X size={12} /></button>
      </span>
      <span className="cell-mute" style={{ fontSize: 11.5 }}>busca en todas las facturas, de cualquier mes</span>
    </div>
  );
}

/** Panel «Más filtros»: monto exacto o rango, sobre qué monto, estado y fechas de emisión. */
export function FiltrosBusqueda({ criterios, onCerrar }: { criterios: CriteriosBusqueda; onCerrar: () => void }) {
  const ir = useIrABusqueda();
  const [modo, setModo] = useState<'exacto' | 'rango'>(criterios.monto !== undefined || (criterios.desde === undefined && criterios.hasta === undefined) ? 'exacto' : 'rango');
  const [monto, setMonto] = useState(criterios.monto !== undefined ? String(criterios.monto) : '');
  const [tol, setTol] = useState(String(criterios.tol ?? TOLERANCIA_DEFAULT));
  const [desde, setDesde] = useState(criterios.desde !== undefined ? String(criterios.desde) : '');
  const [hasta, setHasta] = useState(criterios.hasta !== undefined ? String(criterios.hasta) : '');
  const [sobre, setSobre] = useState<SobreMonto>(criterios.sobre);
  const [estado, setEstado] = useState<EstadoBusqueda>(criterios.estado);
  const [edesde, setEdesde] = useState(criterios.emisionDesde ?? '');
  const [ehasta, setEhasta] = useState(criterios.emisionHasta ?? '');
  const [texto, setTexto] = useState(criterios.texto ?? '');
  const num = (s: string) => { const v = Number(s.replace(/,/g, '').replace(/^q/i, '')); return s.trim() && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : undefined; };
  const buscar = () => {
    const c: CriteriosBusqueda = { sobre, estado, emisionDesde: edesde || undefined, emisionHasta: ehasta || undefined, texto: texto.trim() || undefined };
    if (modo === 'exacto') { c.monto = num(monto); c.tol = num(tol) ?? TOLERANCIA_DEFAULT; }
    else { c.desde = num(desde); c.hasta = num(hasta); }
    ir(c);
  };
  return (
    <div className="card" style={{ margin: '8px 0 12px' }} data-filtros-busqueda>
      <div className="card-head"><div className="card-title">Más filtros</div><div className="card-actions"><button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCerrar}>Cerrar</button></div></div>
      <div className="card-pad" style={{ display: 'grid', gap: 10, fontSize: 13 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }} role="radiogroup" aria-label="Tipo de monto">
          <button type="button" className={'btn ' + (modo === 'exacto' ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setModo('exacto')} data-modo="exacto">Monto exacto</button>
          <button type="button" className={'btn ' + (modo === 'rango' ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setModo('rango')} data-modo="rango">Rango</button>
        </div>
        {modo === 'exacto' ? (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 4 }}>Monto <input className="input num" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} placeholder="9,450.00" aria-label="Monto" data-campo="monto" /></label>
            <label style={{ display: 'grid', gap: 4 }}>Tolerancia ± <input className="input num" inputMode="decimal" value={tol} onChange={e => setTol(e.target.value)} aria-label="Tolerancia" data-campo="tol" /></label>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 4 }}>De <input className="input num" inputMode="decimal" value={desde} onChange={e => setDesde(e.target.value)} placeholder="8,000" aria-label="Monto desde" data-campo="desde" /></label>
            <label style={{ display: 'grid', gap: 4 }}>Hasta <input className="input num" inputMode="decimal" value={hasta} onChange={e => setHasta(e.target.value)} placeholder="10,000" aria-label="Monto hasta" data-campo="hasta" /></label>
          </div>
        )}
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <label style={{ display: 'grid', gap: 4 }}>Sobre qué monto
            <select className="input" value={sobre} onChange={e => setSobre(e.target.value as SobreMonto)} aria-label="Sobre qué monto" data-campo="sobre">{(Object.keys(ETIQUETA_SOBRE) as SobreMonto[]).map(k => <option key={k} value={k}>{ETIQUETA_SOBRE[k]}</option>)}</select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>Estado
            <select className="input" value={estado} onChange={e => setEstado(e.target.value as EstadoBusqueda)} aria-label="Estado" data-campo="estado">{(Object.keys(ETIQUETA_ESTADO_BUSQUEDA) as EstadoBusqueda[]).map(k => <option key={k} value={k}>{ETIQUETA_ESTADO_BUSQUEDA[k]}</option>)}</select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>Emisión desde <input className="input" type="date" value={edesde} onChange={e => setEdesde(e.target.value)} aria-label="Emisión desde" data-campo="edesde" /></label>
          <label style={{ display: 'grid', gap: 4 }}>Emisión hasta <input className="input" type="date" value={ehasta} onChange={e => setEhasta(e.target.value)} aria-label="Emisión hasta" data-campo="ehasta" /></label>
          <label style={{ display: 'grid', gap: 4 }}>Cliente, NIT o factura <input className="input" value={texto} onChange={e => setTexto(e.target.value)} aria-label="Cliente, NIT o número de factura" data-campo="texto" /></label>
        </div>
        <div className="cell-mute" style={{ fontSize: 11.5 }}>«Pagadas» usa la regla única de factura cobrada (todas sus líneas vivas cobradas). Sin fechas se busca en todas las facturas, de cualquier mes.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={() => ir(null)}>Limpiar</button>
          <button type="button" className="btn btn-primary" onClick={buscar} data-accion="buscar"><I.Search size={13} /> Buscar</button>
        </div>
      </div>
    </div>
  );
}

function exportarCsv(r: ResultadoBusqueda, c: CriteriosBusqueda) {
  const L: string[] = [['Factura', 'Fecha', 'Cliente', 'NIT', 'Total con IVA', 'Subtotal', 'Cobrado', 'Saldo', 'Estado', 'Fecha de cobro', 'Líneas', c.monto !== undefined ? 'Diferencia' : ''].filter(Boolean).map(csvEscape).join(',')];
  for (const f of r.filas) L.push([f.noFactura, f.fechaEmision, f.clienteNombre, f.nit, f.total.toFixed(2), f.subtotal.toFixed(2), f.cobrado.toFixed(2), f.saldo.toFixed(2), BADGE[f.estado].text, f.fechaCobro ?? '', String(f.lineas), ...(c.monto !== undefined ? [(f.diff ?? 0).toFixed(2)] : [])].map(csvEscape).join(','));
  L.push(['TOTAL', '', `${r.cantidad} facturas`, '', r.suma.toFixed(2), '', '', r.sumaSaldo.toFixed(2)].map(csvEscape).join(','));
  const blob = new Blob(['﻿' + L.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `facturas_busqueda_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/** Tabla de resultados con totales al pie y CSV. */
export function ResultadosBusqueda({ resultado, criterios }: { resultado: ResultadoBusqueda; criterios: CriteriosBusqueda }) {
  const router = useRouter();
  const r = resultado;
  return (
    <div className="card" data-resultados-busqueda={r.cantidad}>
      <div className="card-head">
        <div className="card-title">Resultados · <span className="num">{r.cantidad}</span> {r.cantidad === 1 ? 'factura' : 'facturas'}</div>
        <div className="card-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="cell-mute" style={{ fontSize: 11.5 }}>{criterios.monto !== undefined ? 'ordenadas por cercanía al monto' : 'ordenadas por fecha'}{r.limitado ? ` · se muestran ${r.filas.length}` : ''}</span>
          <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => exportarCsv(r, criterios)} disabled={r.filas.length === 0} data-accion="exportar-csv"><I.Download size={13} /> CSV</button>
        </div>
      </div>
      {r.error && <div className="card-pad" style={{ color: 'var(--wine)' }} role="alert">{r.error}</div>}
      <div className="table-scroll">
        <table className="table" data-lista="busqueda">
          <thead><tr><th>Factura</th><th className="num">Fecha</th><th>Cliente</th><th className="num">NIT</th><th className="num">Total con IVA</th><th className="num">Cobrado</th><th className="num">Saldo</th><th>Estado</th><th className="num">Fecha de cobro</th>{criterios.monto !== undefined && <th className="num">Dif.</th>}<th style={{ width: 40 }}></th></tr></thead>
          <tbody>
            {r.filas.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>Ninguna factura coincide. Probá con más tolerancia, un rango o «todas».</td></tr>}
            {r.filas.map(f => (
              <tr key={f.id + f.estado} className="clickable" style={{ cursor: 'pointer' }} onClick={() => router.push(`/facturacion/${f.id}`)} data-factura={f.noFactura} data-estado-fila={f.estado}>
                <td className="num cell-strong">{f.noFactura}{f.lineas > 1 && <span className="cell-mute" style={{ fontSize: 11, marginLeft: 6 }} title={`${f.lineas} líneas sumadas`}>×{f.lineas}</span>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{formatDateDDMMYYYY(f.fechaEmision)}</td>
                <td className="cell-strong">{f.clienteNombre || <span className="cell-mute">—</span>}</td>
                <td className="num" style={{ fontSize: 12 }}>{f.nit || '—'}</td>
                <td className="num cell-strong" data-total={f.total}>{Q(f.total)}</td>
                <td className="num" data-cobrado={f.cobrado}>{f.cobrado ? Q(f.cobrado) : <span className="cell-mute">—</span>}</td>
                <td className="num cell-strong" data-saldo={f.saldo}>{f.estado === 'anulada' || f.estado === 'refacturada' ? <span className="cell-mute">—</span> : Q(f.saldo)}</td>
                <td><span className={'badge ' + BADGE[f.estado].cls}>{BADGE[f.estado].text}</span></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{f.fechaCobro ? formatDateDDMMYYYY(f.fechaCobro) : <span className="cell-mute">—</span>}</td>
                {criterios.monto !== undefined && <td className="num" style={{ color: f.diff === 0 ? 'var(--olive)' : 'var(--ink-3)' }}>{f.diff === 0 ? 'exacto' : `${(f.diff ?? 0) > 0 ? '+' : '−'}${Q(Math.abs(f.diff ?? 0))}`}</td>}
                <td onClick={e => e.stopPropagation()}><Link href={`/facturacion/${f.id}`} className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} title="Abrir la factura" data-accion="abrir-factura"><I.ArrowRight size={12} /></Link></td>
              </tr>
            ))}
          </tbody>
          {r.filas.length > 0 && (
            <tfoot><tr style={{ background: 'var(--bg-2)' }} data-totales-busqueda>
              <td colSpan={4} className="cell-strong">{r.cantidad} {r.cantidad === 1 ? 'factura' : 'facturas'}{r.limitado ? ` (se muestran ${r.filas.length})` : ''}</td>
              <td className="num cell-strong" data-suma={r.suma}>{Q(r.suma)}</td><td></td><td className="num cell-strong" data-suma-saldo={r.sumaSaldo}>{Q(r.sumaSaldo)}</td><td colSpan={criterios.monto !== undefined ? 4 : 3}></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
