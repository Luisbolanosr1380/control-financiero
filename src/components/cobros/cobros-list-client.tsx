'use client';

import { useState } from 'react';
import Link from 'next/link';
import { I } from '@/components/common/icons';
import { Q, formatDateDDMMYYYY } from '@/lib/utils';
import { cargarMasCobrosAction } from '@/app/(app)/cobros/actions';
import type { CobroListado } from '@/lib/db/cobros';
import type { Customer } from '@/lib/types';

interface Props {
  initialCobros: CobroListado[];
  initialHayMas: boolean;
  initialUltimaFecha: string | null;
  cobrosCompletos: CobroListado[];
  clientes: Customer[];
}

export function CobrosListClient({ initialCobros, initialHayMas, initialUltimaFecha, cobrosCompletos, clientes }: Props) {
  const [cobros, setCobros] = useState<CobroListado[]>(initialCobros);
  const [hayMas, setHayMas] = useState(initialHayMas);
  const [ultimaFecha, setUltimaFecha] = useState<string | null>(initialUltimaFecha);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [search, setSearch] = useState('');

  const nombreById = new Map(clientes.map(c => [c.id, c.name]));

  const matchSearch = (c: CobroListado, q: string) =>
    c.noFactura.toLowerCase().includes(q)
    || (nombreById.get(c.custId) ?? '').toLowerCase().includes(q)
    || c.referencia.toLowerCase().includes(q);

  const filtrados = search.trim()
    ? cobros.filter(c => matchSearch(c, search.toLowerCase()))
    : cobros;

  // F-033: agregado real bajo filtros, sobre TODOS los cobros (no solo los cargados).
  const completosFiltrados = search.trim()
    ? cobrosCompletos.filter(c => matchSearch(c, search.toLowerCase()))
    : cobrosCompletos;
  const agregado = {
    cantidad: completosFiltrados.length,
    suma:     completosFiltrados.reduce((s, c) => s + c.monto, 0),
  };

  const totalMonto = filtrados.reduce((s, c) => s + c.monto, 0);

  const cargarMas = async () => {
    if (!ultimaFecha || cargandoMas) return;
    setCargandoMas(true);
    try {
      const res = await cargarMasCobrosAction(ultimaFecha, 50);
      setCobros(prev => {
        const vistos = new Set(prev.map(c => c.key));
        const nuevos = res.cobros.filter(c => !vistos.has(c.key));
        return [...prev, ...nuevos];
      });
      setHayMas(res.hayMas);
      setUltimaFecha(res.ultimaFecha);
    } finally {
      setCargandoMas(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cobros y recibos</h1>
          <div className="page-subtitle" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
            <span style={{ fontWeight: 500 }}>Total{search.trim() && ' filtrado'}:</span>{' '}
            <span className="num" style={{ fontWeight: 500 }}>{agregado.cantidad}</span> cobros
            {' · '}
            <span className="num" style={{ fontWeight: 500 }}>{Q(agregado.suma)}</span>
          </div>
          <div className="page-subtitle" style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>
            Mostrando <span className="num">{filtrados.length}</span> de <span className="num">{agregado.cantidad}</span>
            {agregado.cantidad > filtrados.length && <> · faltan <span className="num">{agregado.cantidad - filtrados.length}</span> por cargar</>}
            {' · '}ordenados por fecha
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Download size={13} /> Exportar</button>
          <Link href="/facturacion?tab=por_cobrar" className="btn btn-primary">
            <I.Plus size={13} /> Registrar cobro
          </Link>
        </div>
      </div>

      {/* Aviso: cómo se registra un cobro */}
      <div className="card" style={{ marginBottom: 18, background: 'var(--paper-2)' }}>
        <div className="card-pad" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          <I.Info size={14} style={{ color: 'var(--ink-3)', flexShrink: 0, marginTop: 2 }} />
          <div>
            Los cobros se registran <strong>contra una factura</strong> (cobro total, sin parciales). Tocá <strong>"Registrar cobro"</strong> arriba para ir al listado "Por cobrar" y elegir la factura — desde su detalle se registra el cobro y se marca como Cobrada en una sola operación.
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-search">
          <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
          <input placeholder="Factura, cliente, referencia…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
          <span>{filtrados.length} resultados</span>
          <span style={{ margin: '0 8px', color: 'var(--line-2)' }}>·</span>
          <span className="num">Suma: {Q(totalMonto)}</span>
        </div>
      </div>

      <div className="table-wrap" style={{ borderRadius: '0 0 var(--r-3) var(--r-3)', borderTop: 'none' }}>
        <table className="table" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th className="num" style={{ width: 110 }}>Fecha</th>
              <th className="num" style={{ width: 140 }}>NO. Factura</th>
              <th>Cliente</th>
              <th className="num" style={{ width: 130 }}>Monto</th>
              <th style={{ width: 120 }}>Método</th>
              <th style={{ width: 150 }}>Banco</th>
              <th style={{ width: 130 }}>Referencia</th>
              <th style={{ width: 110 }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr><td colSpan={8} style={{ height: 200, textAlign: 'center', color: 'var(--ink-4)' }}>
                <div style={{ padding: 40 }}>
                  <I.Coins size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                  <div style={{ fontSize: 13 }}>No hay cobros en esta vista</div>
                </div>
              </td></tr>
            ) : filtrados.map(c => {
              const cliente = nombreById.get(c.custId) || c.custId || '—';
              const estadoLow = c.estado.toLowerCase();
              const estadoBadge = estadoLow.includes('conciliado')
                ? { cls: 'badge-olive', text: 'Conciliado' }
                : { cls: 'badge-outline', text: c.estado || 'Pendiente' };
              return (
                <tr key={c.key}>
                  <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>{formatDateDDMMYYYY(c.fechaCobro)}</td>
                  <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>{c.noFactura || '—'}</td>
                  <td className="cell-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cliente}>{cliente}</td>
                  <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>
                    {Q(c.monto)}
                    {c.numLineas > 1 && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic' }}>· {c.numLineas} líneas</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {c.metodo || '—'}
                    {c.tieneRetencion && (
                      <span
                        className="badge badge-warn"
                        style={{ marginLeft: 6, fontSize: 9.5, padding: '1px 6px' }}
                        title={`Incluye retención: IVA Q${c.retencionIVA.toFixed(2)} · ISR Q${c.retencionISR.toFixed(2)}`}
                      >
                        {c.retencionIVA > 0 && c.retencionISR > 0 ? 'Ret. IVA+ISR'
                         : c.retencionIVA > 0 ? 'Ret. IVA'
                         : 'Ret. ISR'}
                      </span>
                    )}
                  </td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.bancoNombre}>{c.bancoNombre}</td>
                  <td className="num cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.referencia}>{c.referencia || '—'}</td>
                  <td><span className={'badge ' + estadoBadge.cls}>{estadoBadge.text}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        padding: '18px 12px', borderTop: '1px solid var(--line-3)', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          Mostrando <span className="num" style={{ color: 'var(--ink-2)' }}>{filtrados.length}</span> de <span className="num" style={{ color: 'var(--ink-2)' }}>{agregado.cantidad}</span>
          {agregado.cantidad > filtrados.length && <> · <span className="num">{agregado.cantidad - filtrados.length}</span> más por cargar</>}
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
