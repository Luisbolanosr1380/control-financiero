'use client';

/**
 * DETALLE DE FACTURACIÓN (pre-liquidación): encabezado (cliente, correlativo, fecha, estado),
 * una línea por proceso con monto sin IVA, totales, faltantes marcados, y los botones del
 * flujo: Imprimir / PDF → Marcar como enviada → Marcar como aprobada (quién y canal) →
 * Facturar (solo aprobada; abre el diálogo de SAT/FEL) → Anular (libera). Permiso
 * facturar_agenda. Confirmaciones en línea, sin diálogos del navegador.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { Q } from '@/lib/utils';
import { formatearFechaConHora } from '@/lib/utils/fechas';
import { anularDetalleAction, facturarDetalleAction, marcarAprobadaAction, marcarEnviadaAction } from '@/app/(app)/por-facturar/actions';
import { BADGE_ESTADO_DETALLE, ETIQUETA_ESTADO_DETALLE, type CanalAprobacion } from '@/lib/facturacion-agenda/detalle';
import type { DetalleCompleto } from '@/lib/db/detalle-facturacion';
import { FacturarDialogo } from './facturar-dialogo';
import { ReintentarWritebackButton } from './reintentar-writeback-button';

interface Props { datos: DetalleCompleto; writeback: boolean; configurada: boolean; montoModo: 'con_iva' | 'sin_iva' }

export function DetalleView({ datos, writeback, configurada, montoModo }: Props) {
  const router = useRouter();
  const puede = usePuede()('facturar_agenda');
  const { detalle: d, documento: doc, expedientes } = datos;
  const [busy, setBusy] = useState(false);
  const [aprobando, setAprobando] = useState(false);
  const [quien, setQuien] = useState('');
  const [canal, setCanal] = useState<CanalAprobacion>('correo');
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [facturando, setFacturando] = useState(false);
  const [resultado, setResultado] = useState<{ noFactura: string; facturaAppId: string; writeback: { estado: string; detalle: string } } | null>(null);

  const correr = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string) => {
    setBusy(true);
    try { const r = await fn(); if (r.ok) { toast.success(exito); router.refresh(); } else toast.error(r.error); return r.ok; }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}><Link href="/por-facturar" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Por facturar</Link> · <Link href={`/por-facturar/${encodeURIComponent('n-' + d.nit)}`} style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>{datos.clienteNombre}</Link></div>
          <h1 className="page-title">Detalle de servicios · {d.correlativo}</h1>
          <div className="page-subtitle">Pre-liquidación para <strong>{datos.clienteNombre}</strong> · <span className="num">NIT {d.nit}</span> · generado {formatearFechaConHora(d.createdAt)} por {d.creadoPor || '—'} · <span className={'badge ' + BADGE_ESTADO_DETALLE[d.estado]} style={{ fontSize: 10 }} data-estado={d.estado}>{ETIQUETA_ESTADO_DETALLE[d.estado]}</span></div>
        </div>
        <div className="page-actions">
          <a className="btn btn-secondary" href={`/imprimir/detalle/${d.id}`} target="_blank" rel="noopener" data-accion="imprimir"><I.Print size={13} /> Imprimir / PDF</a>
          {d.estado === 'facturada' && d.facturaAppId && <Link href={`/facturacion/${d.facturaAppId}`} className="btn btn-secondary"><I.Receipt size={13} /> Ver factura {d.noFactura}</Link>}
        </div>
      </div>

      {resultado && (
        <div className="card" role="status" data-resultado="factura" style={{ borderColor: resultado.writeback.estado === 'confirmado' || resultado.writeback.estado === 'omitido' ? 'var(--olive)' : 'var(--wine)', marginBottom: 14 }}>
          <div className="card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            <div style={{ flex: 1, minWidth: 260 }}><strong>Factura {resultado.noFactura}</strong> registrada en financiero. <span className="cell-mute">{resultado.writeback.detalle}</span></div>
            <Link href={`/facturacion/${resultado.facturaAppId}`} className="btn btn-secondary"><I.Receipt size={13} /> Ver factura</Link>
            {['pendiente', 'conflicto', 'error'].includes(resultado.writeback.estado) && <ReintentarWritebackButton noFactura={resultado.noFactura} />}
          </div>
        </div>
      )}

      {/* Línea de tiempo del flujo */}
      <div className="card" style={{ marginBottom: 14 }} data-flujo>
        <div className="card-pad" style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5 }}>
          <Paso hecho n={1} titulo="Generado" sub={`${formatearFechaConHora(d.createdAt)} · ${d.creadoPor || '—'}`} />
          <Paso hecho={!!d.enviadaEn} n={2} titulo="Enviado al cliente" sub={d.enviadaEn ? `${formatearFechaConHora(d.enviadaEn)} · ${d.enviadaPor}` : 'por correo (manual)'} />
          <Paso hecho={!!d.aprobadaEn} n={3} titulo="Aprobado por el cliente" sub={d.aprobadaEn ? `${formatearFechaConHora(d.aprobadaEn)} · ${d.aprobadoPor} · ${d.aprobadoCanal}` : 'pendiente'} />
          <Paso hecho={d.estado === 'facturada'} n={4} titulo="Facturado (SAT)" sub={d.facturadoEn ? `${formatearFechaConHora(d.facturadoEn)} · ${d.noFactura}` : 'solo con el detalle aprobado'} />
          {d.estado === 'anulada' && <div style={{ color: 'var(--wine)' }}><strong>Anulado</strong> {d.anuladaEn ? formatearFechaConHora(d.anuladaEn) : ''} · {d.anuladaPor}{d.motivoAnulacion ? ` · ${d.motivoAnulacion}` : ''} · los expedientes volvieron a la cola</div>}
        </div>
      </div>

      {puede && d.estado !== 'facturada' && d.estado !== 'anulada' && (
        <div className="card" role="region" aria-label="Acciones del detalle" style={{ marginBottom: 14, borderColor: 'var(--olive)' }}>
          <div className="card-pad" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            {d.estado === 'borrador' && !anulando && <button className="btn btn-primary" onClick={() => void correr(() => marcarEnviadaAction(d.id), `${d.correlativo} marcado como enviado al cliente`)} disabled={busy} data-accion="marcar-enviada"><I.Send size={13} /> Marcar como enviada</button>}
            {d.estado === 'enviada' && !aprobando && !anulando && <button className="btn btn-primary" onClick={() => setAprobando(true)} disabled={busy} data-accion="marcar-aprobada"><I.Check size={13} /> Marcar como aprobada</button>}
            {d.estado === 'enviada' && aprobando && <>
              <input className="input" placeholder="Quién aprobó (nombre del lado del cliente)" value={quien} onChange={e => setQuien(e.target.value)} aria-label="Quién aprobó" style={{ minWidth: 300 }} maxLength={200} disabled={busy} autoFocus />
              <select className="input" value={canal} onChange={e => setCanal(e.target.value as CanalAprobacion)} aria-label="Canal de aprobación" disabled={busy}><option value="correo">Por correo</option><option value="otro">Otro</option></select>
              <button className="btn btn-ghost" onClick={() => setAprobando(false)} disabled={busy}>Volver</button>
              <button className="btn btn-primary" onClick={() => void correr(() => marcarAprobadaAction(d.id, { aprobadoPor: quien, canal }), `${d.correlativo} aprobado por ${quien.trim()}`).then(ok => { if (ok) setAprobando(false); })} disabled={busy || !quien.trim()} data-accion="confirmar-aprobada"><I.Check size={13} /> Confirmar aprobación</button>
            </>}
            {d.estado === 'aprobada' && !anulando && <button className="btn btn-primary" onClick={() => setFacturando(true)} disabled={busy || doc.incluidas.length === 0} data-accion="facturar"><I.Receipt size={13} /> Facturar (SAT/FEL)</button>}
            {!anulando && <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setAnulando(true)} disabled={busy} data-accion="anular">Anular detalle</button>}
            {anulando && <>
              <span style={{ flex: 1, minWidth: 220 }}>Se anula <strong>{d.correlativo}</strong> y sus {d.expedientes} expediente(s) vuelven a la cola.</span>
              <input className="input" placeholder="Motivo (opcional)" value={motivo} onChange={e => setMotivo(e.target.value)} aria-label="Motivo de anulación" style={{ minWidth: 240 }} maxLength={300} disabled={busy} />
              <button className="btn btn-ghost" onClick={() => setAnulando(false)} disabled={busy}>Volver</button>
              <button className="btn btn-danger" onClick={() => void correr(() => anularDetalleAction(d.id, motivo), `${d.correlativo} anulado: los expedientes volvieron a la cola`).then(ok => { if (ok) setAnulando(false); })} disabled={busy} data-accion="confirmar-anular">Confirmar anulación</button>
            </>}
          </div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        <div className="kpi" data-kpi="procesos"><div className="kpi-label">Procesos incluidos</div><div className="kpi-value">{doc.incluidas.length}</div><div className="kpi-delta"><span className="vs">{doc.faltantes.length ? `${doc.faltantes.length} no incluido(s)` : 'todos con precio'}</span></div></div>
        <div className="kpi" data-kpi="subtotal"><div className="kpi-label">Subtotal sin IVA</div><div className="kpi-value">{Q(doc.subtotal)}</div><div className="kpi-delta"><span className="vs">del tarifario</span></div></div>
        <div className="kpi" data-kpi="iva"><div className="kpi-label">IVA 12 %</div><div className="kpi-value">{Q(doc.iva)}</div><div className="kpi-delta"><span className="vs">Guatemala</span></div></div>
        <div className="kpi" data-kpi="total"><div className="kpi-label">Total</div><div className="kpi-value">{Q(doc.total)}</div><div className="kpi-delta"><span className="vs">{doc.total !== d.total ? `al generar: ${Q(d.total)}` : 'igual que al generar'}</span></div></div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="card-title">Procesos</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>una línea por proceso · un COMPLETO muestra sus componentes · montos sin IVA</span></div></div>
        <table className="table" data-lista="detalle">
          <thead><tr><th>Persona</th><th>Ingreso</th><th>Servicio</th><th>Categoría</th><th>Territorio</th><th className="num">Monto sin IVA</th></tr></thead>
          <tbody>
            {doc.lineas.map(l => (
              <tr key={l.idExterno} style={{ opacity: l.incluido ? 1 : 0.6 }} data-linea={l.incluido ? 'incluida' : 'faltante'}>
                <td><div className="cell-strong">{l.persona}</div><div className="cell-mute" style={{ fontSize: 11 }}>{l.puesto || l.idExterno}</div></td>
                <td className="num" style={{ fontSize: 12 }}>{l.fechaIngreso ?? '—'}</td>
                <td>{l.servicio}{l.componentes ? <div className="cell-mute" style={{ fontSize: 11 }}>{l.componentes}</div> : null}</td>
                <td>{l.categoria}</td><td>{l.territorio}</td>
                <td className="num">{l.incluido ? <span className="cell-strong">{Q(l.monto)}</span> : <span className="badge badge-warn" style={{ fontSize: 10 }} title="No suma al total">no incluido · {l.motivo}</span>}</td>
              </tr>
            ))}
            <tr style={{ background: 'var(--bg-2)' }}><td colSpan={5} className="num" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>Subtotal · IVA (12 %) · <strong>Total</strong></td><td className="num" data-total={doc.total}>{Q(doc.subtotal)} · {Q(doc.iva)} · <strong>{Q(doc.total)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      {d.notas && <div className="card" style={{ marginBottom: 14 }}><div className="card-pad" style={{ fontSize: 13 }}><strong>Notas:</strong> {d.notas}</div></div>}

      {facturando && d.estado === 'aprobada' && (
        <FacturarDialogo
          seleccion={expedientes.filter(e => doc.incluidas.some(l => l.idExterno === e.idExterno))} centros={datos.centros} cliente={datos.clienteNombre} writeback={writeback} configurada={configurada} montoModo={montoModo}
          contexto={`${d.correlativo} · aprobado por ${d.aprobadoPor}`}
          onClose={() => setFacturando(false)}
          onConfirmar={input => facturarDetalleAction(d.id, input)}
          onHecho={r => { setResultado(r); setFacturando(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Paso({ hecho, n, titulo, sub }: { hecho: boolean; n: number; titulo: string; sub: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', minWidth: 200 }} data-paso={n} data-hecho={hecho}>
      <span style={{ width: 20, height: 20, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, background: hecho ? 'var(--olive)' : 'var(--bg-2)', color: hecho ? '#fff' : 'var(--ink-3)', border: hecho ? 'none' : '1px solid var(--line-2)' }}>{hecho ? '✓' : n}</span>
      <div><div className="cell-strong" style={{ fontSize: 12.5 }}>{titulo}</div><div className="cell-mute" style={{ fontSize: 11 }}>{sub}</div></div>
    </div>
  );
}
