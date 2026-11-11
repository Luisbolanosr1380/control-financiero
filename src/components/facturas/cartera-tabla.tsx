'use client';

/**
 * SEGUIMIENTO DE COBRO A LA VISTA · la tabla de las pestañas de cartera de Facturación (Cartera total, Por cobrar,
 * Vencidas, Pendientes, Parciales): TODAS las facturas abiertas de todos los meses (como Cobros → Pendientes), del más
 * viejo sin pagar al más nuevo, con la columna «Cobranza» (badge + última nota), chips de filtro rápido y el KPI
 * «Promesas de esta semana». El orden y el filtro viajan en la URL (`orden`, `dir`, `cob`). Pie con cantidad y saldo. CSV.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q, formatDateDDMMYYYY } from '@/lib/utils';
import { csvEscape } from '@/lib/facturacion/reporte-csv';
import { coincideCliente } from '@/lib/clientes/buscar';
import { ETIQUETA_FILTRO_COBRANZA, FILTROS_COBRANZA, ordenarCartera, textoNota, type FiltroCobranza, type OrdenCartera } from '@/lib/cobranza/seguimiento';
import { ETIQUETA_ESTADO_BASE, ETIQUETA_MODIFICADOR, textoEstado } from '@/lib/cobranza/estado';
import type { FilaCartera } from '@/lib/db/cobranza-facturas';
import type { Customer } from '@/lib/types';

interface Props {
  filas: FilaCartera[]; hoy: string; orden: OrdenCartera; dir: 'asc' | 'desc'; filtro: FiltroCobranza | null;
  kpiPromesas: { n: number; monto: number }; conteoFiltros: Record<FiltroCobranza, number>;
  /** filtro local del buscador (vista previa mientras se escribe) */ search: string; clientes: Customer[]; error?: string;
}

const ESTADO_TXT: Record<string, { cls: string; text: string }> = { emitida: { cls: 'badge-outline', text: 'Emitida' }, pendiente: { cls: 'badge-warn', text: 'Pendiente' }, cobrado_parcial: { cls: 'badge-warn', text: 'Parcial' } };

export function CarteraTabla({ filas, hoy, orden, dir, filtro, kpiPromesas, conteoFiltros, search, clientes, error }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [mes, setMes] = useState('');
  const custById = useMemo(() => new Map(clientes.map(c => [c.id, c])), [clientes]);
  const meses = useMemo(() => [...new Set(filas.map(f => f.mesEmision).filter(Boolean))].sort().reverse(), [filas]);

  const ir = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(sp?.toString() ?? '');
    for (const [k, v] of Object.entries(cambios)) { if (v === null || v === '') p.delete(k); else p.set(k, v); }
    const qs = p.toString();
    router.push(`/facturacion${qs ? `?${qs}` : ''}`, { scroll: false });
  };
  const onSort = (k: OrdenCartera) => {
    if (k === orden) ir({ orden: k, dir: dir === 'desc' ? 'asc' : 'desc' });
    else ir({ orden: k === 'dias' ? null : k, dir: k === 'cliente' || k === 'factura' || k === 'emision' || k === 'vence' ? 'asc' : null });
  };
  const flecha = (k: OrdenCartera) => (orden === k ? (dir === 'asc' ? ' ↑' : ' ↓') : '');
  const th = (k: OrdenCartera, label: string, num = false, extra?: CSSProperties) => (
    <th className={num ? 'num' : undefined} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...extra }} onClick={() => onSort(k)} title="Ordenar" data-orden={k} aria-sort={orden === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>{label}{flecha(k)}</th>
  );

  const visibles = useMemo(() => {
    let rows = filas;
    if (search.trim()) rows = rows.filter(f => { const c = custById.get(f.custId); return f.noFactura.toLowerCase().includes(search.toLowerCase()) || coincideCliente({ id: f.custId, name: c?.name ?? f.cliente, nit: c?.nit, razonSocial: c?.razonSocial, nombreComercial: c?.nombreComercial, aliases: c?.aliases }, search); });
    if (mes) rows = rows.filter(f => f.mesEmision === mes);
    return ordenarCartera(rows, orden, dir);
  }, [filas, search, mes, orden, dir, custById]);
  const saldo = visibles.reduce((s, f) => s + f.saldo, 0);

  const exportarCsv = () => {
    const L = [['Factura', 'Cliente', 'Emisión', 'Vence', 'Días vencida', 'Total', 'Saldo', 'Cobranza', 'Última nota', 'Promesa', 'Próximo seguimiento', 'Estado'].map(csvEscape).join(',')];
    for (const f of visibles) { const s = f.seguimiento; L.push([f.noFactura, f.cliente, f.fechaEmision, f.fechaVencimiento, f.diasVencidos > 0 ? String(f.diasVencidos) : '', f.total.toFixed(2), f.saldo.toFixed(2), s.badges.map(b => b.texto).join(' · '), s.ultimaNota ? textoNota(s.ultimaNota, hoy, 1000).completa : '', s.promesa ? `${s.promesa.fecha}${s.promesa.monto ? ` ${s.promesa.monto.toFixed(2)}` : ''} (${s.promesa.estado})` : '', s.proximoSeguimiento ?? '', textoEstado(s.estado)].map(csvEscape).join(',')); }
    L.push(['TOTAL', `${visibles.length} facturas`, '', '', '', '', saldo.toFixed(2)].map(csvEscape).join(','));
    const blob = new Blob(['﻿' + L.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cartera_${hoy}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div data-cartera={visibles.length}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 10px' }} data-chips-cobranza>
        <span className="cell-mute" style={{ fontSize: 11.5 }}>Cobranza:</span>
        {FILTROS_COBRANZA.map(f => (
          <button key={f} type="button" className={'badge ' + (filtro === f ? 'badge-olive' : 'badge-outline')} style={{ cursor: 'pointer', fontSize: 11.5, padding: '4px 10px', border: filtro === f ? undefined : '1px solid var(--line-2)' }} onClick={() => ir({ cob: filtro === f ? null : f })} data-chip-cobranza={f} aria-pressed={filtro === f} title={filtro === f ? 'Quitar el filtro' : `Ver solo ${ETIQUETA_FILTRO_COBRANZA[f].toLowerCase()}`}>
            {ETIQUETA_FILTRO_COBRANZA[f]} <span className="num" style={{ opacity: .8 }}>{conteoFiltros[f]}</span>
          </button>
        ))}
        {filtro && <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: '2px 8px' }} onClick={() => ir({ cob: null })} data-accion="quitar-chip-cobranza"><I.X size={11} /> Quitar</button>}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }} data-kpi-promesas-semana={kpiPromesas.n}>
          Promesas de esta semana: <span className="num" style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{kpiPromesas.n}</span> · <span className="num" style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{Q(kpiPromesas.monto)}</span>
        </span>
      </div>
      {error && <div className="card-pad" style={{ color: 'var(--wine)', fontSize: 12 }} role="alert">La columna Cobranza no se pudo cargar: {error}</div>}
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8, borderBottom: 'none' }}>
        <select className="input num" style={{ width: 'auto' }} value={mes} onChange={e => setMes(e.target.value)} aria-label="Mes de emisión" data-campo="mes-cartera">
          <option value="">Todos los meses</option>
          {meses.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="cell-mute" style={{ fontSize: 11.5 }}>{orden === 'dias' && dir === 'desc' ? 'del más viejo sin pagar al más nuevo' : 'orden personalizado'} · clic en un encabezado para ordenar</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{visibles.length} facturas · <span className="num" style={{ fontWeight: 500 }}>{Q(saldo)}</span></span>
          <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={exportarCsv} disabled={visibles.length === 0} data-accion="exportar-csv-cartera"><I.Download size={13} /> CSV</button>
        </div>
      </div>
      <div className="table-wrap" style={{ borderRadius: '0 0 var(--r-3) var(--r-3)', borderTop: 'none', overflowX: 'auto' }}>
        <table className="table" data-lista="cartera">
          <thead>
            <tr>
              {th('factura', 'Factura')}
              {th('cliente', 'Cliente')}
              {th('emision', 'Emisión', true)}
              {th('vence', 'Vence', true)}
              {th('dias', 'Días vencida', true)}
              {th('total', 'Total', true)}
              {th('saldo', 'Saldo', true)}
              {th('cobranza', 'Cobranza', false, { minWidth: 220 })}
              {th('estado', 'Estado')}
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr><td colSpan={10} style={{ height: 140, textAlign: 'center', color: 'var(--ink-4)' }}><div style={{ padding: 36, fontSize: 13 }}>{filtro ? `Ninguna factura en «${ETIQUETA_FILTRO_COBRANZA[filtro]}».` : 'No hay facturas en esta vista.'}</div></td></tr>
            ) : visibles.map(f => {
              const s = f.seguimiento; const nota = s.ultimaNota ? textoNota(s.ultimaNota, hoy) : null;
              const est = ESTADO_TXT[f.estadoBruto] ?? { cls: 'badge-mute', text: f.estadoBruto };
              return (
                // clave por id + número: en HIT hay líneas sin airtable_id (id nulo) y una clave repetida deja filas fantasma al reordenar
                <tr key={`${f.id ?? ''}|${f.noFactura}`} className={f.id ? 'clickable' : undefined} onClick={f.id ? () => router.push(`/facturacion/${f.id}`) : undefined} data-factura={f.noFactura} data-badge={s.badge?.clave ?? ''} data-dias={f.diasVencidos}>
                  <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>{f.noFactura}{f.cedida && <span className="badge" style={{ marginLeft: 6, color: '#6d28d9', background: 'rgba(124, 58, 237, 0.10)', fontSize: 10 }} title={`Cedida a factoraje: ${f.cedida.financiador}`}>Cedida</span>}</td>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.cliente}>{custById.get(f.custId)?.short ?? f.cliente}</td>
                  <td className="num cell-mute" style={{ whiteSpace: 'nowrap' }}>{formatDateDDMMYYYY(f.fechaEmision)}</td>
                  <td className="num cell-mute" style={{ whiteSpace: 'nowrap' }}>{f.fechaVencimiento ? formatDateDDMMYYYY(f.fechaVencimiento) : '—'}</td>
                  <td className="num" style={{ color: f.diasVencidos > 0 ? 'var(--wine)' : 'var(--ink-3)', fontWeight: f.diasVencidos > 60 ? 600 : 400 }}>{f.diasVencidos > 0 ? f.diasVencidos : '—'}</td>
                  <td className="num cell-mute" style={{ whiteSpace: 'nowrap' }}>{Q(f.total)}</td>
                  <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }} data-saldo={f.saldo}>{Q(f.saldo)}</td>
                  <td data-cobranza>
                    {s.badge ? <span className={'badge ' + s.badge.cls} title={s.badges.map(b => b.texto).join(' · ')} data-badge-texto>{s.badge.texto}</span> : <span className="cell-mute" style={{ fontSize: 11.5 }} title={textoEstado(s.estado)}>—</span>}
                    {s.badges.length > 1 && <span className="cell-mute" style={{ fontSize: 10.5, marginLeft: 6 }}>+{s.badges.length - 1}</span>}
                    {nota && <div className="cell-mute" style={{ fontSize: 11, marginTop: 3, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nota.completa} data-nota>{nota.corta}</div>}
                  </td>
                  <td><span className={'badge ' + (s.estado.estado === 'vencida' ? 'badge-wine' : est.cls)} title={[ETIQUETA_ESTADO_BASE[s.estado.estado], ...s.estado.modificadores.map(m => ETIQUETA_MODIFICADOR[m])].join(' · ')}>{s.estado.estado === 'vencida' ? 'Vencida' : est.text}</span></td>
                  <td onClick={e => e.stopPropagation()}>{f.id ? <Link href={`/facturacion/${f.id}`} className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} title="Abrir la factura" data-accion="abrir-factura"><I.ArrowRight size={12} /></Link> : <span className="cell-mute" title="Esta línea no tiene id de app: no se puede abrir">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
          {visibles.length > 0 && (
            <tfoot><tr style={{ background: 'var(--bg-2)' }} data-totales-cartera>
              <td colSpan={6} className="cell-strong">{visibles.length} {visibles.length === 1 ? 'factura' : 'facturas'}{mes ? ` · ${mes}` : ' · todos los meses'}</td>
              <td className="num cell-strong" data-suma-saldo={Math.round(saldo * 100) / 100}>{Q(saldo)}</td>
              <td colSpan={3}></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
