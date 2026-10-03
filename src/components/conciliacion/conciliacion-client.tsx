'use client';

/**
 * CONCILIACIÓN BANCARIA — pantalla (escritorio).
 * Izquierda: movimientos del banco sin conciliar. Derecha: documentos del
 * sistema sin conciliar, con las sugerencias del movimiento elegido.
 * Arriba: panel de cuadre (banco vs libros, partidas en tránsito).
 * Los botones siguen al rol (usePuede); el servidor revalida cada acción.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { usePuede } from '@/components/auth/permisos';
import { PeriodoSelector, etiquetaArchivo, type RangoPeriodo } from '@/components/common/periodo-selector';
import { csvEscape } from '@/lib/facturacion/reporte-csv';
import { r2, signo, type DocBanco, type Movimiento, type Sugerencia } from '@/lib/conciliacion/motor';
import type { BancoConciliacion, CuentaOpcion, DatosConciliacion } from '@/lib/db/conciliacion';
import {
  borrarMovimientoAction, conciliarAction, contabilizarMovimientoAction, deshacerConciliacionAction,
} from '@/app/(app)/conciliacion/actions';
import { ModalNuevoMovimiento } from './modal-nuevo-movimiento';
import { ModalImportarCsv } from './modal-importar-csv';

interface Props {
  datos: DatosConciliacion;
  bancos: BancoConciliacion[];
  cuentas: CuentaOpcion[];
  desde: string;
  hasta: string;
}

const CONF_BADGE: Record<Sugerencia['confianza'], { cls: string; label: string }> = {
  alta: { cls: 'badge-olive', label: 'Alta' },
  media: { cls: 'badge-warn', label: 'Media' },
  baja: { cls: 'badge-outline', label: 'Baja' },
};
const TIPO_DOC: Record<DocBanco['tipo'], string> = { cobro: 'Cobro', pago: 'Pago', gasto: 'Gasto' };

const fmtFecha = (f: string) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—');

export function ConciliacionClient({ datos, bancos, cuentas, desde, hasta }: Props) {
  const router = useRouter();
  const puede = usePuede();
  const puedeConciliar = puede('conciliar');
  const puedeCargar = puede('registrar_movimiento');
  const banco = datos.banco;

  const [tab, setTab] = useState<'pendientes' | 'conciliados'>('pendientes');
  const [movSel, setMovSel] = useState<string | null>(null);
  const [docsSel, setDocsSel] = useState<Set<string>>(new Set());
  const [cuentaAjuste, setCuentaAjuste] = useState<string>(() =>
    cuentas.find(c => /comisiones bancarias/i.test(c.nombre))?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'nuevo' | 'csv' | null>(null);
  const [saldoEstado, setSaldoEstado] = useState('');
  const [verDetalle, setVerDetalle] = useState(false);

  const navegar = (p: { banco?: string; desde?: string; hasta?: string }) => {
    const q = new URLSearchParams({ banco: p.banco ?? banco?.id ?? '', desde: p.desde ?? desde, hasta: p.hasta ?? hasta });
    setMovSel(null); setDocsSel(new Set());
    router.push(`/conciliacion?${q.toString()}`);
  };

  const movsPend = datos.movimientos.filter(m => !m.conciliado);
  const docsPend = datos.docs.filter(d => !d.conciliado);
  const mov = movsPend.find(m => m.id === movSel) ?? null;
  const sugs = mov ? datos.sugerencias[mov.id] ?? [] : [];
  const sugDe = useMemo(() => {
    const m = new Map<string, Sugerencia>();
    for (const s of sugs) for (const k of s.docKeys) if (!m.has(k) || m.get(k)!.score < s.score) m.set(k, s);
    return m;
  }, [sugs]);

  // Documentos visibles: del sentido del movimiento elegido; sugeridos primero.
  const docsVisibles = useMemo(() => {
    const base = mov ? docsPend.filter(d => (mov.tipo === 'Ingreso' ? d.tipo === 'cobro' : d.tipo !== 'cobro')) : docsPend;
    return [...base].sort((a, b) => (sugDe.get(b.key)?.score ?? 0) - (sugDe.get(a.key)?.score ?? 0) || a.fecha.localeCompare(b.fecha));
  }, [docsPend, mov, sugDe]);

  const totalSel = r2(docsPend.filter(d => docsSel.has(d.key)).reduce((s, d) => s + d.monto, 0));
  const dif = mov ? r2(mov.monto - totalSel) : 0;
  const hayDif = Math.abs(dif) > 0.01;

  const correr = async (fn: () => Promise<{ ok: true; mensaje: string } | { ok: false; error: string }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) { toast.success(r.mensaje); setMovSel(null); setDocsSel(new Set()); router.refresh(); }
      else toast.error(r.error);
    } finally { setBusy(false); }
  };

  const conciliar = () => mov && correr(() => conciliarAction({
    movimientoId: mov.id, docKeys: [...docsSel],
    ajuste: hayDif ? { cuentaId: cuentaAjuste, descripcion: `Ajuste conciliación ${banco?.nombre} · ${mov.descripcion}`.slice(0, 200) } : null,
  }));
  const contabilizar = () => mov && correr(() => contabilizarMovimientoAction({ movimientoId: mov.id, cuentaId: cuentaAjuste, descripcion: mov.descripcion }));
  const deshacer = (m: Movimiento) => {
    const motivo = window.prompt(`Motivo para deshacer la conciliación de ${Q(m.monto)} (${fmtFecha(m.fecha)}):`);
    if (motivo === null) return;
    correr(() => deshacerConciliacionAction(m.id, motivo));
  };
  const borrar = (m: Movimiento) => {
    if (!window.confirm(`¿Borrar el movimiento ${m.tipo.toLowerCase()} de ${Q(m.monto)} del ${fmtFecha(m.fecha)}? Solo si se cargó por error.`)) return;
    correr(() => borrarMovimientoAction(m.id));
  };

  const exportar = () => {
    if (!banco || !datos.cuadre) return;
    const c = datos.cuadre;
    const L = (...x: Array<string | number>) => x.map(csvEscape).join(',');
    const lineas = [
      L('Conciliación bancaria', banco.nombre), L('Período', desde, hasta), '',
      L('Saldo inicial', c.saldoInicial.toFixed(2), c.fechaSaldoInicial ?? 'sin fecha'),
      L('Movimientos del período (banco)', c.movimientosPeriodo.toFixed(2)),
      L('Saldo según banco', c.saldoBanco.toFixed(2)),
      L('Saldo según libros', c.saldoLibros.toFixed(2)),
      L('Diferencia', c.diferencia.toFixed(2)),
      L('Estado', c.estado), '',
      L('MOVIMIENTOS DEL BANCO SIN DOCUMENTO'), L('Fecha', 'Tipo', 'Monto', 'Descripción', 'Referencia'),
      ...c.movimientosPendientes.map(m => L(m.fecha, m.tipo, m.monto.toFixed(2), m.descripcion, m.referencia)), '',
      L('DOCUMENTOS SIN MOVIMIENTO (EN TRÁNSITO)'), L('Fecha', 'Tipo', 'Monto', 'Descripción', 'Referencia'),
      ...c.documentosPendientes.map(d => L(d.fecha, TIPO_DOC[d.tipo], d.monto.toFixed(2), d.descripcion, d.referencia)), '',
      L('CONCILIADOS EN EL PERÍODO'), L('Fecha', 'Tipo', 'Monto banco', 'Documentos', 'Sin documento (asiento)'),
      ...datos.conciliados.map(x => L(x.movimiento.fecha, x.movimiento.tipo, x.movimiento.monto.toFixed(2),
        x.docs.map(d => `${TIPO_DOC[d.tipo]} ${d.monto.toFixed(2)} ${d.descripcion}`).join(' | ') || '—',
        r2(x.movimiento.monto - x.movimiento.aplicado).toFixed(2))),
    ];
    const blob = new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `conciliacion_${banco.nombre.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${etiquetaArchivo(desde, hasta)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const rango: RangoPeriodo = { desde, hasta, preset: null };
  const c = datos.cuadre;
  const saldoEstadoNum = Number(saldoEstado.replace(/[^\d.-]/g, ''));
  const estadoChip = c && {
    cuadrado: { txt: '🟢 Cuadrado', color: 'var(--olive)' },
    pendientes: { txt: '🟡 Cuadra con partidas pendientes', color: 'var(--warn)' },
    descuadrado: { txt: '🔴 Descuadrado', color: 'var(--wine)' },
  }[c.estado];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Conciliación bancaria</h1>
          <div className="page-subtitle">Movimientos reales del banco contra cobros, pagos y gastos del sistema.</div>
        </div>
        <div className="page-actions">
          {puedeCargar && banco && <button className="btn btn-secondary" onClick={() => setModal('nuevo')}><I.Plus size={13} /> Movimiento</button>}
          {puedeCargar && banco && <button className="btn btn-secondary" onClick={() => setModal('csv')}><I.Paperclip size={13} /> Importar estado de cuenta</button>}
          {banco && c && <button className="btn btn-secondary" onClick={exportar}><I.Download size={13} /> Exportar</button>}
        </div>
      </div>

      {!datos.disponible && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }}>
          <div className="card-pad" style={{ fontSize: 13 }}>Falta aplicar la migración <strong>009_conciliacion_bancaria</strong> en esta base.</div>
        </div>
      )}

      {datos.disponible && !banco && (
        <div className="card"><div className="card-pad" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          No hay bancos activos. Creá uno en Admin → Catálogos (con su cuenta contable y saldo inicial).
        </div></div>
      )}

      {banco && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-pad" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="input" style={{ width: 240 }} value={banco.id} onChange={e => navegar({ banco: e.target.value })}>
                {bancos.map(b => <option key={b.id} value={b.id}>{b.nombre} · {b.moneda}</option>)}
              </select>
              <PeriodoSelector value={rango} onChange={r => navegar({ desde: r.desde || desde, hasta: r.hasta || hasta })}
                presets={['este_mes', 'mes_anterior', 'trimestre', 'este_anio']} />
            </div>
          </div>

          {/* Panel de cuadre */}
          {c && (
            <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${estadoChip?.color}` }}>
              <div className="card-head">
                <div className="card-title">Cuadre al {fmtFecha(c.hasta)}</div>
                <span style={{ fontSize: 13, fontWeight: 600, color: estadoChip?.color }}>{estadoChip?.txt}</span>
                <div className="card-actions">
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setVerDetalle(v => !v)}>{verDetalle ? 'Ocultar' : 'Ver'} detalle</button>
                </div>
              </div>
              <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                <div className="kpi"><div className="kpi-label">Saldo inicial</div><div className="kpi-value" style={{ fontSize: 18 }}>{Q(c.saldoInicial)}</div><div className="kpi-delta"><span className="vs">{c.fechaSaldoInicial ? `al ${fmtFecha(c.fechaSaldoInicial)}` : 'sin fecha de saldo inicial'}</span></div></div>
                <div className="kpi"><div className="kpi-label">+ Movimientos del banco</div><div className="kpi-value" style={{ fontSize: 18 }}>{Q(c.movimientosPeriodo)}</div></div>
                <div className="kpi"><div className="kpi-label">= Saldo según banco</div><div className="kpi-value" style={{ fontSize: 18 }}>{Q(c.saldoBanco)}</div></div>
                <div className="kpi"><div className="kpi-label">Saldo según libros</div><div className="kpi-value" style={{ fontSize: 18 }}>{Q(c.saldoLibros)}</div><div className="kpi-delta"><span className="vs">inicial + cobros − pagos − gastos ± sin documento</span></div></div>
                <div className="kpi"><div className="kpi-label">Diferencia</div><div className="kpi-value" style={{ fontSize: 18, color: Math.abs(c.diferencia) > 0.01 ? 'var(--wine)' : 'var(--olive)' }}>{Q(c.diferencia)}</div></div>
              </div>
              {verDetalle && (
                <div className="card-pad" style={{ borderTop: '1px solid var(--line-3)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, fontSize: 12.5 }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Movimientos del banco sin documento · {c.movimientosPendientes.length}</div>
                    {c.movimientosPendientes.map(m => (
                      <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', cursor: 'pointer' }} onClick={() => { setTab('pendientes'); setMovSel(m.id); setDocsSel(new Set()); }}>
                        <span>{fmtFecha(m.fecha)} · {m.descripcion}</span><span className="num">{Q(signo(m.tipo, m.monto))}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Documentos sin movimiento (en tránsito) · {c.documentosPendientes.length}</div>
                    {c.documentosPendientes.map(d => (
                      <div key={d.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>{fmtFecha(d.fecha)} · {d.descripcion}</span><span className="num">{Q(d.tipo === 'cobro' ? d.monto : -d.monto)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ gridColumn: '1 / -1', color: 'var(--ink-3)' }}>
                    Explicado por partidas en tránsito: <strong className="num">{Q(c.explicado)}</strong>
                    {Math.abs(c.noExplicado) > 0.01 && <> · <span style={{ color: 'var(--wine)' }}>No explicado (cruces de período): {Q(c.noExplicado)}</span></>}
                  </div>
                  <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>Saldo final del estado de cuenta:</span>
                    <input className="input num" style={{ width: 160 }} placeholder="Q 0.00" value={saldoEstado} onChange={e => setSaldoEstado(e.target.value)} />
                    {saldoEstado.trim() && Number.isFinite(saldoEstadoNum) && (
                      Math.abs(saldoEstadoNum - c.saldoBanco) <= 0.01
                        ? <span style={{ color: 'var(--olive)' }}>✓ Los movimientos cargados coinciden con el estado de cuenta</span>
                        : <span style={{ color: 'var(--wine)' }}>✗ Faltan o sobran movimientos: diferencia {Q(r2(saldoEstadoNum - c.saldoBanco))}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="tabs" style={{ marginBottom: 12 }}>
            <button className={'tab' + (tab === 'pendientes' ? ' active' : '')} onClick={() => setTab('pendientes')}>Por conciliar ({movsPend.length} / {docsPend.length})</button>
            <button className={'tab' + (tab === 'conciliados' ? ' active' : '')} onClick={() => setTab('conciliados')}>Conciliados en el período ({datos.conciliados.length})</button>
          </div>

          {tab === 'pendientes' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
                {/* Movimientos */}
                <div className="card">
                  <div className="card-head"><div className="card-title">Movimientos del banco sin conciliar</div></div>
                  <table className="table">
                    <thead><tr><th style={{ width: 90 }}>Fecha</th><th>Descripción</th><th className="num" style={{ width: 120 }}>Monto</th><th style={{ width: 34 }}></th></tr></thead>
                    <tbody>
                      {movsPend.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--ink-4)' }}>Sin movimientos pendientes.</td></tr>}
                      {movsPend.map(m => {
                        const tieneSug = (datos.sugerencias[m.id] ?? []).length > 0;
                        return (
                          <tr key={m.id} className="clickable" onClick={() => { setMovSel(m.id === movSel ? null : m.id); setDocsSel(new Set()); }}
                            style={{ background: m.id === movSel ? 'var(--olive-bg)' : undefined }}>
                            <td className="num">{fmtFecha(m.fecha)}</td>
                            <td>
                              <div style={{ fontSize: 12.5 }}>{m.descripcion}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{m.referencia || '—'}{m.origen === 'csv' ? ' · estado de cuenta' : ''}{tieneSug ? ' · ✨ con sugerencias' : ''}</div>
                            </td>
                            <td className="num cell-strong" style={{ color: m.tipo === 'Ingreso' ? 'var(--olive)' : 'var(--wine)' }}>{m.tipo === 'Ingreso' ? '+' : '−'}{Q(m.monto)}</td>
                            <td onClick={e => e.stopPropagation()}>
                              {puedeConciliar && <button className="btn btn-ghost" style={{ padding: 2 }} title="Borrar (cargado por error)" onClick={() => borrar(m)}><I.Trash size={12} /></button>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Documentos */}
                <div className="card">
                  <div className="card-head">
                    <div className="card-title">{mov ? `Documentos para ${mov.tipo === 'Ingreso' ? 'el ingreso' : 'el egreso'} de ${Q(mov.monto)}` : 'Documentos del sistema sin conciliar'}</div>
                  </div>
                  {mov && sugs.length > 0 && (
                    <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line-3)', display: 'grid', gap: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sugerencias</div>
                      {sugs.slice(0, 4).map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                          <span className={'badge ' + CONF_BADGE[s.confianza].cls}>{CONF_BADGE[s.confianza].label}</span>
                          <span style={{ flex: 1 }}>{s.motivo}</span>
                          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setDocsSel(new Set(s.docKeys))}>Seleccionar</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <table className="table">
                    <thead><tr><th style={{ width: 30 }}></th><th style={{ width: 90 }}>Fecha</th><th>Documento</th><th className="num" style={{ width: 120 }}>Monto</th></tr></thead>
                    <tbody>
                      {docsVisibles.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--ink-4)' }}>Sin documentos pendientes{mov ? ' de este sentido' : ''}.</td></tr>}
                      {docsVisibles.map(d => {
                        const s = sugDe.get(d.key);
                        return (
                          <tr key={d.key} style={{ background: docsSel.has(d.key) ? 'var(--olive-bg)' : s ? 'rgba(212, 160, 23, 0.06)' : undefined }}>
                            <td><input type="checkbox" disabled={!mov} checked={docsSel.has(d.key)} onChange={() => setDocsSel(prev => { const n = new Set(prev); if (n.has(d.key)) n.delete(d.key); else n.add(d.key); return n; })} /></td>
                            <td className="num">{fmtFecha(d.fecha)}</td>
                            <td>
                              <div style={{ fontSize: 12.5 }}>{d.descripcion}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                                {TIPO_DOC[d.tipo]}{d.registros.length > 1 ? ` · ${d.registros.length} registros` : ''}{d.referencia ? ` · ${d.referencia}` : ''}
                                {s && <span className={'badge ' + CONF_BADGE[s.confianza].cls} style={{ marginLeft: 6, fontSize: 9.5 }}>{CONF_BADGE[s.confianza].label}</span>}
                              </div>
                            </td>
                            <td className="num cell-strong">{Q(d.monto)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Barra de acción */}
              {mov && (
                <div className="card" style={{ position: 'sticky', bottom: 12, marginTop: 14, borderColor: 'var(--line-2)', boxShadow: '0 6px 20px rgba(0,0,0,0.08)' }}>
                  <div className="card-pad" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                    <span>Movimiento <strong className="num">{Q(mov.monto)}</strong></span>
                    <span>Documentos <strong className="num">{Q(totalSel)}</strong> ({docsSel.size})</span>
                    <span style={{ color: hayDif && docsSel.size ? 'var(--wine)' : 'var(--olive)' }}>Diferencia <strong className="num">{Q(dif)}</strong></span>
                    {puedeConciliar ? (
                      <>
                        {(hayDif || docsSel.size === 0) && (
                          <select className="input" style={{ width: 280 }} value={cuentaAjuste} onChange={e => setCuentaAjuste(e.target.value)}
                            title={docsSel.size ? 'Cuenta de la partida de ajuste por la diferencia' : 'Cuenta contrapartida para contabilizar el movimiento sin documento'}>
                            <option value="">— Cuenta {docsSel.size ? 'del ajuste' : 'contrapartida'} —</option>
                            {cuentas.map(cu => <option key={cu.id} value={cu.id}>{cu.codigo} · {cu.nombre}</option>)}
                          </select>
                        )}
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                          {docsSel.size === 0 ? (
                            <button className="btn btn-secondary" disabled={busy || !cuentaAjuste} onClick={contabilizar}
                              title="Comisión, intereses, ND/NC del banco: genera su asiento (única vía en que la conciliación crea asiento)">
                              Contabilizar sin documento
                            </button>
                          ) : (
                            <button className="btn btn-primary" disabled={busy || (hayDif && !cuentaAjuste)} onClick={conciliar}>
                              {busy ? 'Conciliando…' : hayDif ? `Conciliar con ajuste de ${Q(Math.abs(dif))}` : 'Conciliar'}
                            </button>
                          )}
                        </span>
                      </>
                    ) : (
                      <span style={{ marginLeft: 'auto', color: 'var(--ink-3)', fontSize: 12 }}>🔒 Solo un Contador o Admin puede conciliar o contabilizar.</span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'conciliados' && (
            <div className="card">
              <table className="table">
                <thead><tr><th style={{ width: 90 }}>Fecha</th><th>Movimiento</th><th className="num" style={{ width: 120 }}>Monto</th><th>Documentos</th><th style={{ width: 110 }}></th></tr></thead>
                <tbody>
                  {datos.conciliados.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--ink-4)' }}>Nada conciliado en el período.</td></tr>}
                  {datos.conciliados.map(({ movimiento: m, docs }) => {
                    const sinDoc = r2(m.monto - m.aplicado);
                    return (
                      <tr key={m.id}>
                        <td className="num">{fmtFecha(m.fecha)}</td>
                        <td><div style={{ fontSize: 12.5 }}>{m.descripcion}</div><div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{m.referencia || '—'}</div></td>
                        <td className="num cell-strong" style={{ color: m.tipo === 'Ingreso' ? 'var(--olive)' : 'var(--wine)' }}>{m.tipo === 'Ingreso' ? '+' : '−'}{Q(m.monto)}</td>
                        <td style={{ fontSize: 12 }}>
                          {docs.map(d => <div key={d.key}>{TIPO_DOC[d.tipo]} · {d.descripcion} · <span className="num">{Q(d.monto)}</span></div>)}
                          {sinDoc > 0.01 && <div style={{ color: 'var(--ink-3)' }}>{docs.length ? 'Ajuste' : 'Contabilizado sin documento'} · <span className="num">{Q(sinDoc)}</span></div>}
                        </td>
                        <td>{puedeConciliar && <button className="btn btn-ghost" style={{ fontSize: 11.5, color: 'var(--wine)' }} disabled={busy} onClick={() => deshacer(m)}>Deshacer</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {modal === 'nuevo' && banco && <ModalNuevoMovimiento banco={banco} onClose={() => setModal(null)} onListo={() => { setModal(null); router.refresh(); }} />}
      {modal === 'csv' && banco && <ModalImportarCsv banco={banco} onClose={() => setModal(null)} onListo={() => { setModal(null); router.refresh(); }} />}
    </div>
  );
}
