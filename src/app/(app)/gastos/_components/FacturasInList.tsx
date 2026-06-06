'use client';

/**
 * F-049 — Listado de FACTURAS_IN recientes con filtros + modal de detalle.
 *
 * La data viene precargada del server component (page.tsx). El client component
 * solo filtra/ordena en memoria — el volumen esperado (cientos por año) lo
 * aguanta sin paginación.
 */

import { useMemo, useState } from 'react';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { formatearFecha, formatearFechaConHora } from '@/lib/utils/fechas';
import { HelpButton } from '@/components/ayuda/help-button';
import type { FacturaIn } from '@/lib/db/facturas-in';

interface Props {
  facturas: FacturaIn[];
}

const ESTATUS_BADGE: Record<string, { cls: string; text: string }> = {
  Pendiente: { cls: 'badge-warn',    text: 'Pendiente' },
  Validada:  { cls: 'badge-olive',   text: 'Validada' },
  Anulada:   { cls: 'badge-wine',    text: 'Anulada' },
};

export function FacturasInList({ facturas }: Props) {
  const [estatus, setEstatus] = useState<string>('');
  const [subidoPor, setSubidoPor] = useState<string>('');
  const [search, setSearch] = useState('');
  const [seleccionada, setSeleccionada] = useState<FacturaIn | null>(null);

  const subidores = useMemo(
    () => [...new Set(facturas.map(f => f.subidoPor).filter(Boolean))].sort(),
    [facturas],
  );

  const filtradas = useMemo(() => {
    let r = facturas;
    if (estatus)   r = r.filter(f => f.estatus === estatus);
    if (subidoPor) r = r.filter(f => f.subidoPor === subidoPor);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(f =>
        f.proveedorNombre.toLowerCase().includes(q) ||
        f.proveedorNit.toLowerCase().includes(q) ||
        f.numero.toLowerCase().includes(q),
      );
    }
    return r;
  }, [facturas, estatus, subidoPor, search]);

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Facturas en bandeja
          <HelpButton tag="factura-in-list" />
        </div>
        <div className="card-actions">
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {filtradas.length} de {facturas.length}
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--line-3)' }}>
        <select value={estatus} onChange={(e) => setEstatus(e.target.value)} style={selectStyle}>
          <option value="">Estatus (todos)</option>
          <option value="Pendiente">Pendiente</option>
          <option value="Validada">Validada</option>
          <option value="Anulada">Anulada</option>
        </select>
        <select value={subidoPor} onChange={(e) => setSubidoPor(e.target.value)} style={selectStyle}>
          <option value="">Subido por (todos)</option>
          {subidores.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="toolbar-search" style={{ marginLeft: 'auto' }}>
          <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
          <input
            placeholder="Proveedor, NIT o número…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {facturas.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📭</div>
          <div style={{ fontSize: 14, color: 'var(--ink-2)', fontWeight: 500 }}>
            No hay facturas todavía
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>
            Arriba podés subir tu primera factura.
          </div>
        </div>
      ) : filtradas.length === 0 ? (
        <div style={{ padding: 36, textAlign: 'center', fontSize: 12.5, color: 'var(--ink-4)' }}>
          Sin resultados bajo los filtros actuales.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Proveedor</th>
              <th>Fecha emisión</th>
              <th className="num">Total</th>
              <th>Estatus</th>
              <th>Archivo</th>
              <th>Subido por</th>
              <th>Subido el</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map(f => {
              const badge = ESTATUS_BADGE[f.estatus] ?? { cls: 'badge-mute', text: f.estatus };
              return (
                <tr key={f.id} className="clickable" onClick={() => setSeleccionada(f)}>
                  <td className="cell-strong">{f.proveedorNombre || '—'}</td>
                  <td className="cell-mute" style={{ whiteSpace: 'nowrap' }}>{f.fechaEmision ? formatearFecha(f.fechaEmision) : '—'}</td>
                  <td className="num cell-strong">{Q(f.total)}</td>
                  <td><span className={'badge ' + badge.cls} style={{ fontSize: 10 }}>{badge.text}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {f.archivoUrl ? (
                      <a href={f.archivoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 11, textDecoration: 'none' }}>
                        📄 Descargar
                      </a>
                    ) : <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>—</span>}
                  </td>
                  <td className="cell-mute" style={{ fontSize: 11 }}>{f.subidoPor || '—'}</td>
                  <td className="cell-mute" style={{ fontSize: 11 }}>{f.fechaSubida ? formatearFechaConHora(f.fechaSubida) : '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => setSeleccionada(f)}
                    >
                      Ver
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {seleccionada && (
        <FacturaInDetalle factura={seleccionada} onClose={() => setSeleccionada(null)} />
      )}
    </div>
  );
}

function FacturaInDetalle({ factura, onClose }: { factura: FacturaIn; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 96vw)', maxHeight: '90vh', overflow: 'auto',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {factura.proveedorNombre || 'Factura sin proveedor identificado'}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} title="Cerrar">
            <I.X size={14} />
          </button>
        </div>

        <div style={{ padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
            <Campo label="NIT" valor={factura.proveedorNit} />
            <Campo label="Tipo doc" valor={factura.tipoDoc} />
            <Campo label="Serie / Número" valor={`${factura.serie || '—'} / ${factura.numero || '—'}`} />
            <Campo label="Fecha emisión" valor={factura.fechaEmision ? formatearFecha(factura.fechaEmision) : '—'} />
            <Campo label="Subtotal" valor={Q(factura.subtotal)} />
            <Campo label="IVA" valor={Q(factura.iva)} />
            <Campo label="Total" valor={Q(factura.total)} strong />
            <Campo label="Moneda" valor={factura.moneda} />
            <Campo label="País" valor={factura.pais} />
            <Campo label="Fuente" valor={factura.fuente} />
            <Campo label="Estatus" valor={factura.estatus} />
            <Campo label="Subido por" valor={factura.subidoPor} />
          </div>

          {factura.archivoUrl && (
            <div style={{ marginBottom: 14 }}>
              <a href={factura.archivoUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: 12 }}>
                📄 Descargar PDF original
              </a>
            </div>
          )}

          {factura.textoOcr && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Texto OCR ({factura.textoOcr.length.toLocaleString()} chars)
              </div>
              <pre style={{
                fontSize: 11, color: 'var(--ink-2)', background: 'var(--paper-2)',
                border: '1px solid var(--line-3)', borderRadius: 4, padding: 10,
                maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap',
                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              }}>
                {factura.textoOcr}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Campo({ label, valor, strong }: { label: string; valor: string; strong?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: strong ? 14 : 13, fontWeight: strong ? 500 : 400, color: strong ? 'var(--ink)' : 'var(--ink-2)', marginTop: 2 }}>
        {valor || '—'}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 8px', borderRadius: 4,
  border: '1px solid var(--line-2)', background: 'var(--paper-2)',
  color: 'var(--ink)', fontFamily: 'inherit',
};
