'use client';

/**
 * PAQUETES PREPAGADOS (034) · detalle de un paquete: encabezado (cliente, estado, usadas / total, remanente y su valor,
 * factura del anticipo, vencimiento), acciones (PDF «Estado del paquete», CSV, confirmar la aplicación retroactiva,
 * enlazar la factura, extender el vencimiento, cerrar con motivo), las líneas y, por línea, las pruebas descontadas
 * (persona, solicitante, fecha de resultado, resultado, expediente) y las reversiones con su motivo.
 */
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { usePuede } from '@/components/auth/permisos';
import { NOMBRE_SERVICIO, resultadoLegible } from '@/lib/facturacion-agenda/situacion';
import { BADGE_ESTADO, ETIQUETA_ESTADO, csvDetalle, diasParaVencer, estadoEfectivo, etiquetaLinea, textoUsadas, totalRemanente, valorRemanente, type PaqueteDetalle as Detalle } from '@/lib/paquetes/paquete';
import { cerrarPaqueteAction, confirmarRetroactivoAction, editarPaqueteAction } from '@/app/(app)/paquetes/actions';
import { BarraUso } from './paquetes-section';

const nombreServicio = (s: string) => NOMBRE_SERVICIO[s] ?? (s === 'PSICOMETRICAS' ? 'Psicométricas' : s);
const fecha = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

export function PaqueteDetalleView({ detalle: d, hoy }: { detalle: Detalle; hoy: string }) {
  const puede = usePuede();
  const router = useRouter();
  const puedeGestionar = puede('gestionar_paquetes');
  const p = d.paquete;
  const e = estadoEfectivo(p, hoy);
  const dias = diasParaVencer(p, hoy);
  const [busy, setBusy] = useState(false);
  const [modo, setModo] = useState<'' | 'factura' | 'vence' | 'cerrar'>('');
  const [noFactura, setNoFactura] = useState(p.noFactura ?? '');
  const [vence, setVence] = useState(p.venceEn ?? '');
  const [motivo, setMotivo] = useState('');
  const cerrado = p.estado === 'cerrado';

  const correr = async (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    setBusy(true);
    try { const r = await fn(); if (!r.ok) { toast.error(r.error ?? 'No se pudo.'); return; } toast.success(okMsg); setModo(''); router.refresh(); }
    finally { setBusy(false); }
  };
  const descargarCsv = () => {
    const blob = new Blob([csvDetalle(d)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${p.correlativo}-estado.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const vigentes = d.consumos.filter(c => !c.revertidoEn), revertidos = d.consumos.filter(c => !!c.revertidoEn);

  return (
    <div className="page" data-paquete-detalle={p.correlativo} data-estado={e}>
      <div className="page-header">
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}><Link href={`/tarifario/${encodeURIComponent(p.nit)}`} style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Tarifario · {p.cliente || p.nit}</Link> · <Link href="/paquetes" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>Todos los paquetes</Link></div>
          <h1 className="page-title">{p.correlativo} · {p.nombre}</h1>
          <div className="page-subtitle" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{p.cliente || '—'} · <span className="num">NIT {p.nit}</span></span>
            <span className={'badge ' + BADGE_ESTADO[e]} data-badge-estado={e}>{ETIQUETA_ESTADO[e]}</span>
            <span data-usadas-texto>{textoUsadas(p)}</span>
            {p.venceEn && <span className={dias !== null && dias < 0 ? 'badge badge-wine' : 'cell-mute'}>{dias !== null && dias < 0 ? `venció el ${fecha(p.venceEn)}` : `vence ${fecha(p.venceEn)}${dias !== null ? ` (${dias} d)` : ''}`}</span>}
          </div>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href={`/imprimir/paquete/${p.id}`} target="_blank" rel="noreferrer" className="btn btn-secondary" data-accion="pdf-paquete" title="Estado del paquete para mandárselo al cliente"><I.Print size={13} /> Estado del paquete (PDF)</a>
          <button type="button" className="btn btn-ghost" onClick={descargarCsv} data-accion="csv-paquete"><I.Download size={13} /> CSV</button>
          {puedeGestionar && !cerrado && p.retroPendientes > 0 && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void correr(() => confirmarRetroactivoAction(p.id), 'Aplicación retroactiva confirmada')} data-accion="confirmar-retro">Aplicar a {p.retroPendientes} ya terminada{p.retroPendientes === 1 ? '' : 's'}</button>}
          {puedeGestionar && !cerrado && modo === '' && <>
            <button type="button" className="btn btn-ghost" onClick={() => setModo('factura')} data-accion="enlazar-factura">{p.noFactura ? 'Cambiar factura' : 'Enlazar factura del anticipo'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setModo('vence')} data-accion="extender">{p.venceEn ? 'Extender / quitar vencimiento' : 'Poner vencimiento'}</button>
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--wine)' }} onClick={() => setModo('cerrar')} data-accion="cerrar-paquete">Cerrar paquete</button>
          </>}
        </div>
      </div>

      {modo === 'factura' && (
        <div className="card" role="dialog" aria-label="Factura del anticipo" style={{ marginBottom: 14 }}><div className="card-pad" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
          <span>Número de la factura del anticipo (vacío = pendiente de facturar):</span>
          <input className="input" style={{ maxWidth: 220 }} value={noFactura} onChange={ev => setNoFactura(ev.target.value)} data-campo="no-factura" />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void correr(() => editarPaqueteAction(p.id, { noFactura: noFactura.trim() || null }), noFactura.trim() ? `Factura ${noFactura.trim()} enlazada` : 'Queda pendiente de facturar')} data-accion="guardar-factura">Guardar</button>
          <button type="button" className="btn btn-ghost" onClick={() => setModo('')} disabled={busy}>Cancelar</button>
        </div></div>
      )}
      {modo === 'vence' && (
        <div className="card" role="dialog" aria-label="Vencimiento" style={{ marginBottom: 14 }}><div className="card-pad" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
          <span>Nuevo vencimiento (vacío = sin vencimiento). Un paquete vencido vuelve a descontar al extenderlo.</span>
          <input className="input" type="date" style={{ maxWidth: 180 }} value={vence} onChange={ev => setVence(ev.target.value)} data-campo="vence" />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void correr(() => editarPaqueteAction(p.id, { venceEn: vence || null }), vence ? `Vence el ${fecha(vence)}` : 'Sin vencimiento')} data-accion="guardar-vence">Guardar</button>
          <button type="button" className="btn btn-ghost" onClick={() => setModo('')} disabled={busy}>Cancelar</button>
        </div></div>
      )}
      {modo === 'cerrar' && (
        <div className="card" role="alertdialog" aria-label="Cerrar paquete" style={{ marginBottom: 14, borderColor: 'var(--wine)' }}><div className="card-pad" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
          <span>Se cierra <strong>{p.correlativo}</strong> con <strong>{totalRemanente(p)}</strong> pruebas sin usar ({Q(valorRemanente(p))} sin IVA). No vuelve a descontar. Motivo:</span>
          <input className="input" style={{ minWidth: 240 }} value={motivo} onChange={ev => setMotivo(ev.target.value)} placeholder="vencido sin renovación / renegociado / error" data-campo="motivo-cierre" />
          <button type="button" className="btn btn-primary" disabled={busy || !motivo.trim()} onClick={() => void correr(() => cerrarPaqueteAction(p.id, motivo), 'Paquete cerrado')} data-accion="confirmar-cierre">Cerrar paquete</button>
          <button type="button" className="btn btn-ghost" onClick={() => setModo('')} disabled={busy}>Cancelar</button>
        </div></div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        <div className="kpi" data-kpi="remanente"><div className="kpi-label">Remanente</div><div className="kpi-value">{totalRemanente(p)}</div><div className="kpi-delta"><span className="vs">{textoUsadas(p)}</span></div></div>
        <div className="kpi" data-kpi="valor"><div className="kpi-label">Valor del remanente</div><div className="kpi-value">{Q(valorRemanente(p))}</div><div className="kpi-delta"><span className="vs">remanente × precio unitario, sin IVA</span></div></div>
        <div className="kpi" data-kpi="factura"><div className="kpi-label">Factura del anticipo</div><div className="kpi-value" style={{ fontSize: 18 }}>{p.noFactura ? (p.facturaAppId ? <Link href={`/facturacion/${p.facturaAppId}`} style={{ color: 'var(--ink)', textDecoration: 'none' }}>{p.noFactura}</Link> : p.noFactura) : <span className="cell-mute">pendiente</span>}</div><div className="kpi-delta"><span className="vs">va a la Agenda como «{p.noFactura ? `${p.noFactura} (${p.correlativo})` : p.correlativo}»</span></div></div>
        <div className="kpi" data-kpi="vigencia"><div className="kpi-label">Vigencia</div><div className="kpi-value" style={{ fontSize: 18 }}>{fecha(p.fechaInicio)} → {p.venceEn ? fecha(p.venceEn) : 'sin vencimiento'}</div><div className="kpi-delta"><span className="vs">cubre pruebas con resultado desde el inicio · aviso con {p.umbralAviso} o menos</span></div></div>
      </div>

      {cerrado && <div className="card" role="status" style={{ marginBottom: 14, borderColor: 'var(--line-2)' }}><div className="card-pad" style={{ fontSize: 12.5 }}>Cerrado el {fecha(p.cerradoEn)} por {p.cerradoPor || '—'}{p.cerradoMotivo ? ` · ${p.cerradoMotivo}` : ''}.</div></div>}
      {p.notas && <div className="card" style={{ marginBottom: 14 }}><div className="card-pad" style={{ fontSize: 12.5 }}>{p.notas}</div></div>}

      {p.lineas.map(l => { const cs = vigentes.filter(c => c.lineaId === l.id); return (
        <div className="card" key={l.id} style={{ marginBottom: 14 }} data-linea={l.id} data-remanente={l.remanente}>
          <div className="card-head">
            <div className="card-title">{etiquetaLinea(l, nombreServicio)} <span className="cell-mute" style={{ fontWeight: 400, fontSize: 12 }}>· {Q(l.precioUnitario)} c/u sin IVA</span></div>
            <div className="card-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <BarraUso p={{ lineas: [l] }} />
              <span className="cell-strong">Restan {l.remanente}</span>
              {l.remanente === 0 && <span className="badge badge-wine">Agotada</span>}
              {l.remanente > 0 && l.remanente <= p.umbralAviso && <span className="badge badge-warn">Por agotarse</span>}
            </div>
          </div>
          {cs.length === 0 ? <div className="card-pad cell-mute" style={{ fontSize: 12.5 }}>Todavía no se descontó ninguna prueba de esta línea.</div> : (
            <div className="table-wrap" style={{ border: 'none' }}>
              <table className="table" data-consumos={cs.length}>
                <thead><tr><th>#</th><th>Persona</th><th>Solicitante</th><th>Fecha de resultado</th><th>Resultado</th><th>Expediente</th><th>Descontada el</th></tr></thead>
                <tbody>
                  {cs.map((c, i) => (
                    <tr key={c.id} data-consumo={c.idExterno}>
                      <td className="num cell-mute">{i + 1}</td>
                      <td className="cell-strong">{c.persona || '—'}<div className="cell-mute" style={{ fontSize: 11 }}>{c.puesto}</div></td>
                      <td>{c.solicitante || '—'}</td>
                      <td className="num">{fecha(c.fechaResultado)}</td>
                      <td>{resultadoLegible(c.servicio, c.estadoPrueba)}</td>
                      <td className="num" style={{ fontSize: 12 }}>{c.idExterno}{c.detalleId && <Link href={`/por-facturar/detalle/${c.detalleId}`} className="badge badge-warn" style={{ marginLeft: 6, fontSize: 10, textDecoration: 'none' }}>detalle</Link>}</td>
                      <td className="num cell-mute" style={{ fontSize: 12 }}>{fecha(c.fecha)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ); })}

      {revertidos.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head"><div className="card-title">Reversiones <span className="cell-mute" style={{ fontWeight: 400, fontSize: 12 }}>· la unidad volvió al paquete</span></div></div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table" data-reversiones={revertidos.length}>
              <thead><tr><th>Persona</th><th>Línea</th><th>Descontada el</th><th>Revertida el</th><th>Motivo</th></tr></thead>
              <tbody>{revertidos.map(c => <tr key={c.id}><td className="cell-strong">{c.persona || c.idExterno}</td><td>{etiquetaLinea(p.lineas.find(l => l.id === c.lineaId) ?? { servicio: c.servicio, categoria: c.categoria, territorio: c.territorio }, nombreServicio)}</td><td className="num">{fecha(c.fecha)}</td><td className="num">{fecha(c.revertidoEn)}</td><td style={{ fontSize: 12 }}>{c.motivoReversion}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
