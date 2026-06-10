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
import { ModalRevisionFactura } from './ModalRevisionFactura';
import type { FacturaIn } from '@/lib/db/facturas-in';

interface Props {
  facturas: FacturaIn[];
}

const ESTATUS_BADGE: Record<string, { cls: string; text: string }> = {
  Pendiente: { cls: 'badge-warn',    text: 'Pendiente' },
  Aprobada:  { cls: 'badge-olive',   text: 'Aprobada' },
  Validada:  { cls: 'badge-olive',   text: 'Validada' },   // legacy F-049
  Anulada:   { cls: 'badge-wine',    text: 'Anulada' },
};

export function FacturasInList({ facturas }: Props) {
  // F-050: tab default Pendiente (lo que requiere acción).
  const [estatus, setEstatus] = useState<string>('Pendiente');
  const [subidoPor, setSubidoPor] = useState<string>('');
  const [soloBajaConfianza, setSoloBajaConfianza] = useState(false);
  const [search, setSearch] = useState('');
  const [seleccionada, setSeleccionada] = useState<FacturaIn | null>(null);
  const [revisando, setRevisando] = useState<FacturaIn | null>(null);

  // F-050: contador para el header.
  const contadores = useMemo(() => {
    const ahora = new Date();
    const inicioMes = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    return {
      pendientes: facturas.filter(f => f.estatus === 'Pendiente').length,
      aprobadasMes: facturas.filter(f =>
        (f.estatus === 'Aprobada' || f.estatus === 'Validada') &&
        (f.fechaSubida || '').slice(0, 7) === inicioMes,
      ).length,
    };
  }, [facturas]);

  const subidores = useMemo(
    () => [...new Set(facturas.map(f => f.subidoPor).filter(Boolean))].sort(),
    [facturas],
  );

  const filtradas = useMemo(() => {
    let r = facturas;
    if (estatus)   r = r.filter(f => f.estatus === estatus);
    if (subidoPor) r = r.filter(f => f.subidoPor === subidoPor);
    if (soloBajaConfianza) {
      r = r.filter(f => typeof f.confianzaExtraccion === 'number' && f.confianzaExtraccion < 0.8);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(f =>
        f.proveedorNombre.toLowerCase().includes(q) ||
        f.proveedorNit.toLowerCase().includes(q) ||
        f.numero.toLowerCase().includes(q),
      );
    }
    return r;
  }, [facturas, estatus, subidoPor, soloBajaConfianza, search]);

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Facturas en bandeja
          <HelpButton tag="factura-in-list" />
        </div>
        <div className="card-actions">
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            <strong style={{ color: contadores.pendientes > 0 ? 'var(--wine)' : 'var(--olive)' }}>
              {contadores.pendientes}
            </strong> pendiente{contadores.pendientes === 1 ? '' : 's'} de revisión
            {' · '}
            <strong>{contadores.aprobadasMes}</strong> aprobada{contadores.aprobadasMes === 1 ? '' : 's'} este mes
            {' · '}
            {filtradas.length} de {facturas.length} bajo filtros
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--line-3)' }}>
        <select value={estatus} onChange={(e) => setEstatus(e.target.value)} style={selectStyle}>
          <option value="">Estatus (todos)</option>
          <option value="Pendiente">Pendiente</option>
          <option value="Aprobada">Aprobada</option>
          <option value="Anulada">Anulada</option>
        </select>
        <select value={subidoPor} onChange={(e) => setSubidoPor(e.target.value)} style={selectStyle}>
          <option value="">Subido por (todos)</option>
          {subidores.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
          <input
            type="checkbox"
            checked={soloBajaConfianza}
            onChange={(e) => setSoloBajaConfianza(e.target.checked)}
          />
          Solo baja confianza (&lt;0.8)
        </label>
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
              <th>Confianza</th>
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
                  <td><ConfianzaBadge confianza={f.confianzaExtraccion} normalizadoOk={f.datosNormalizadosOk} /></td>
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
                    <AccionPorFila factura={f} onRevisar={() => setRevisando(f)} onVerDetalle={() => setSeleccionada(f)} />
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
      {revisando && (
        <ModalRevisionFactura factura={revisando} onClose={() => setRevisando(null)} />
      )}
    </div>
  );
}

/**
 * F-050: el botón por fila depende del estatus.
 *  - Pendiente → "Revisar" abre ModalRevisionFactura (decisiones + crea GASTO).
 *  - Aprobada  → ofrece "Ver detalle" del FACTURA_IN (el gasto vinculado vive
 *                en /gastos/[gastoId] cuando esa vista exista — F-051 lo cubre).
 *  - Anulada   → muestra motivo (tooltip) y "Ver detalle".
 */
function AccionPorFila({ factura, onRevisar, onVerDetalle }: { factura: FacturaIn; onRevisar: () => void; onVerDetalle: () => void }) {
  if (factura.estatus === 'Pendiente') {
    return (
      <button
        type="button"
        className="btn btn-primary"
        style={{ fontSize: 11, padding: '3px 10px' }}
        onClick={onRevisar}
      >
        Revisar
      </button>
    );
  }
  if (factura.estatus === 'Anulada') {
    let motivo = '';
    if (factura.datosNormalizados) {
      try {
        const blob = JSON.parse(factura.datosNormalizados) as { anulado?: { motivo?: string; por?: string; fecha?: string } };
        motivo = blob.anulado?.motivo ?? '';
      } catch { /* no-op */ }
    }
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <span title={motivo || 'Sin motivo registrado'} style={{ fontSize: 11, color: 'var(--wine)', fontStyle: 'italic' }}>
          {motivo ? `Anulada · ${motivo.slice(0, 40)}${motivo.length > 40 ? '…' : ''}` : 'Anulada'}
        </span>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={onVerDetalle}>Ver</button>
      </span>
    );
  }
  // Aprobada / Validada
  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{ fontSize: 11, padding: '2px 8px' }}
      onClick={onVerDetalle}
    >
      Ver detalle
    </button>
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

          <MetadataExtraccion factura={factura} />

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

/**
 * F-049.2: badge de confianza autorreportada por Gemini. Verde >= 0.9,
 * amber 0.7-0.9, wine <0.7. Muestra "—" si no hay (records previos a F-049.2).
 */
function ConfianzaBadge({ confianza, normalizadoOk }: { confianza?: number; normalizadoOk?: boolean }) {
  if (typeof confianza !== 'number') {
    return <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>—</span>;
  }
  const cls = confianza >= 0.9 ? 'badge-olive' : confianza >= 0.7 ? 'badge-warn' : 'badge-wine';
  const text = confianza >= 0.9 ? 'Alta' : confianza >= 0.7 ? 'Media' : 'Baja';
  return (
    <span
      className={'badge ' + cls}
      style={{ fontSize: 10 }}
      title={`Confianza ${confianza.toFixed(2)} · cross-check ${normalizadoOk ? 'OK ✓' : 'con discrepancias'}`}
    >
      {text} {(confianza * 100).toFixed(0)}%
    </span>
  );
}

interface ValidacionCruzadaSerializada {
  total_match?: boolean;
  nit_match?: boolean;
  fecha_match?: boolean;
  serie_match?: boolean;
  numero_match?: boolean;
  notas?: string[];
}

interface DatosNormalizadosBlob {
  confianza?: number;
  notas?: string;
  validacion_cruzada?: ValidacionCruzadaSerializada;
  extraido_con?: string;
  tokens_input?: number;
  tokens_output?: number;
}

/** Sección de metadata en el modal de detalle. F-049.2. */
function MetadataExtraccion({ factura }: { factura: FacturaIn }) {
  let blob: DatosNormalizadosBlob | null = null;
  if (factura.datosNormalizados) {
    try { blob = JSON.parse(factura.datosNormalizados); }
    catch { blob = null; }
  }

  if (!blob && typeof factura.confianzaExtraccion !== 'number') return null;

  const v = blob?.validacion_cruzada;
  const matchKey = (label: string, ok: boolean | undefined) => (
    <span style={{ fontSize: 11, color: ok ? 'var(--olive)' : 'var(--wine)', marginRight: 8 }}>
      {ok ? '✓' : '✗'} {label}
    </span>
  );

  return (
    <div style={{
      padding: 12, marginBottom: 14,
      background: 'var(--paper-2)', border: '1px solid var(--line-3)', borderRadius: 4,
    }}>
      <div style={{ fontSize: 11, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        Metadata de extracción
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <ConfianzaBadge confianza={factura.confianzaExtraccion} normalizadoOk={factura.datosNormalizadosOk} />
        {blob?.extraido_con && (
          <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
            modelo: <code>{blob.extraido_con}</code>
          </span>
        )}
        {blob?.tokens_input != null && blob?.tokens_output != null && (
          <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
            tokens: {blob.tokens_input} in / {blob.tokens_output} out
          </span>
        )}
      </div>
      {v && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--ink-4)', marginBottom: 4 }}>Cross-check con parser regex:</div>
          <div>
            {matchKey('Total', v.total_match)}
            {matchKey('NIT', v.nit_match)}
            {matchKey('Fecha', v.fecha_match)}
            {matchKey('Serie', v.serie_match)}
            {matchKey('Número', v.numero_match)}
          </div>
        </div>
      )}
      {v?.notas && v.notas.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--wine)', lineHeight: 1.5 }}>
          {v.notas.map((n, i) => <div key={i}>⚠ {n}</div>)}
        </div>
      )}
      {blob?.notas && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontStyle: 'italic', marginTop: 6, lineHeight: 1.5 }}>
          Nota Gemini: {blob.notas}
        </div>
      )}
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
