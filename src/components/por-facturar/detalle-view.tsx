'use client';

/**
 * DETALLE DE FACTURACIÓN (pre-liquidación): encabezado (cliente, correlativo, fecha, estado),
 * una línea por proceso con monto sin IVA, totales, faltantes marcados, y los botones del
 * flujo: Imprimir / PDF → Enviar al cliente (029: link de aprobación + correo, o copiar el link) /
 * Marcar como enviada → aprobación (por link, o Marcar como aprobada con quién y canal) →
 * Facturar (solo aprobada; abre el diálogo de SAT/FEL) → Anular (libera).
 * 029: con observaciones del cliente, cada línea muestra su respuesta y su nota; Facturación
 * quita la línea (vuelve a la cola, o diferida al próximo mes), responde la nota y manda la
 * versión corregida (sube la versión, revoca el link anterior, correo otra vez). Permiso
 * facturar_agenda. Confirmaciones en línea / modal propio, sin diálogos del navegador.
 * 031: junto a "Enviado al cliente", las aperturas del link («Abierto N veces · primera · última · dispositivos» o
 * «Sin abrir»; las de la red de quien envió se marcan y no cuentan) con la lista desplegable; en la bitácora, las
 * aperturas van junto a los envíos. «Abierto» ≠ «leído por el cliente» (un antivirus de correo puede abrirlo).
 */
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { Q } from '@/lib/utils';
import { formatearFechaCompacta, formatearFechaConHora } from '@/lib/utils/fechas';
import { ETIQUETA_DISPOSITIVO, ETIQUETA_MARCA_RED, marcaRed, resumenAperturas, textoAperturas, type AperturaLink } from '@/lib/detalle-link/aperturas';
import { anularDetalleAction, editarEncabezadoDetalleAction, enviarDetalleAction, facturarDetalleAction, marcarAprobadaAction, marcarEnviadaAction, quitarLineaDetalleAction, reresolverPreciosAction, responderNotaDetalleAction, revocarLinkDetalleAction } from '@/app/(app)/por-facturar/actions';
import { BADGE_DECISION_DETALLE, BADGE_ESTADO_DETALLE, ETIQUETA_DECISION_DETALLE, ETIQUETA_ESTADO_DETALLE, primerDiaMesSiguiente, type CanalAprobacion, type RespuestaDetalle } from '@/lib/facturacion-agenda/detalle';
import { huellaCorta } from '@/lib/detalle-link/publico';
import type { EmitirLinkResult } from '@/lib/db/detalle-link';
import type { DetalleCompleto } from '@/lib/db/detalle-facturacion';
import { pruebaParaFactura } from '@/lib/facturacion-agenda/mapeo';
import { FacturarDialogo } from './facturar-dialogo';
import { ReintentarWritebackButton } from './reintentar-writeback-button';

interface Props { datos: DetalleCompleto; writeback: boolean; configurada: boolean; montoModo: 'con_iva' | 'sin_iva'; /** 029: hay correo (Resend o mock) y secreto del link en este deploy */ correoConfigurado?: boolean; linkConfigurado?: boolean }

export function DetalleView({ datos, writeback, configurada, montoModo, correoConfigurado = false, linkConfigurado = false }: Props) {
  const router = useRouter();
  const puede = usePuede()('facturar_agenda');
  const { detalle: d, documento: doc, expedientes, pruebas } = datos;
  // 029: envío por link, respuestas del cliente (versión vigente) y acciones por línea
  const [enviando, setEnviando] = useState(false);
  const [resultadoEnvio, setResultadoEnvio] = useState<Extract<EmitirLinkResult, { ok: true }> | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);
  const [difiriendo, setDifiriendo] = useState(false);
  const [motivoQuitar, setMotivoQuitar] = useState('');
  const [notaGolden, setNotaGolden] = useState<Record<string, string>>({});
  const respuestasVigentes = new Map(datos.respuestas.filter(r => r.version === d.version).map(r => [r.componenteId, r] as const));
  const observaciones = [...respuestasVigentes.values()].filter(r => r.decision !== 'aprobado');
  const conObs = d.estado === 'con_observaciones';
  const puedeQuitar = puede && (d.estado === 'borrador' || conObs);
  const [busy, setBusy] = useState(false);
  const [aprobando, setAprobando] = useState(false);
  const [quien, setQuien] = useState('');
  const [canal, setCanal] = useState<CanalAprobacion>('correo');
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [facturando, setFacturando] = useState(false);
  const [resultado, setResultado] = useState<{ noFactura: string; facturaAppId: string; writeback: { estado: string; detalle: string } } | null>(null);
  // 028: título del corte y "dirigido a", editables mientras no esté facturado ni anulado
  const [editandoEnc, setEditandoEnc] = useState(false);
  const [titulo, setTitulo] = useState(d.titulo);
  const [dirigidoA, setDirigidoA] = useState(d.dirigidoA);
  const encEditable = puede && d.estado !== 'facturada' && d.estado !== 'anulada';

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

      {/* 028: encabezado del corte */}
      <div className="card" style={{ marginBottom: 14 }} data-encabezado>
        <div className="card-pad" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          {!editandoEnc ? <>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div><span className="cell-mute">Corte:</span> <strong data-titulo>{d.titulo || <span className="cell-mute" style={{ fontWeight: 400 }}>sin título</span>}</strong></div>
              <div><span className="cell-mute">Dirigido a:</span> <span data-dirigido-a>{d.dirigidoA || <span className="cell-mute">—</span>}</span></div>
            </div>
            {encEditable && <button className="btn btn-ghost" onClick={() => { setTitulo(d.titulo); setDirigidoA(d.dirigidoA); setEditandoEnc(true); }} disabled={busy} data-accion="editar-encabezado"><I.Edit size={13} /> Editar título / destinatario</button>}
          </> : <>
            <input className="input" placeholder="Título del corte (opcional)" value={titulo} onChange={e => setTitulo(e.target.value)} aria-label="Título del corte" style={{ minWidth: 300, flex: 1 }} maxLength={200} disabled={busy} autoFocus data-campo="titulo" />
            <input className="input" placeholder="Dirigido a (opcional)" value={dirigidoA} onChange={e => setDirigidoA(e.target.value)} aria-label="Dirigido a" style={{ minWidth: 220 }} maxLength={120} disabled={busy} data-campo="dirigido-a" />
            <button className="btn btn-ghost" onClick={() => setEditandoEnc(false)} disabled={busy}>Volver</button>
            <button className="btn btn-primary" onClick={() => void correr(() => editarEncabezadoDetalleAction(d.id, { titulo, dirigidoA }), 'Encabezado del detalle guardado').then(ok => { if (ok) setEditandoEnc(false); })} disabled={busy} data-accion="guardar-encabezado"><I.Check size={13} /> Guardar</button>
          </>}
        </div>
      </div>

      {/* Línea de tiempo del flujo */}
      <div className="card" style={{ marginBottom: 14 }} data-flujo>
        <div className="card-pad" style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5 }}>
          <Paso hecho n={1} titulo="Generado" sub={`${formatearFechaConHora(d.createdAt)} · ${d.creadoPor || '—'}`} />
          <Paso hecho={!!d.enviadaEn} n={2} titulo="Enviado al cliente" sub={d.enviadaEn ? `${formatearFechaConHora(d.enviadaEn)} · ${d.enviadaPor}` : 'por correo (manual)'} extra={datos.link ? <Aperturas aperturas={datos.aperturas.filter(a => a.linkId === datos.link!.id)} creadorIpHash={datos.link.creadorIpHash} version={datos.link.version} /> : null} />
          <Paso hecho={!!d.aprobadaEn} n={3} titulo="Aprobado por el cliente" sub={d.aprobadaEn ? `${formatearFechaConHora(d.aprobadaEn)} · ${d.aprobadoPor} · ${d.aprobadoCanal}` : conObs ? `con observaciones (${observaciones.length}) · versión ${d.version}` : 'pendiente'} />
          <Paso hecho={d.estado === 'facturada'} n={4} titulo="Facturado (SAT)" sub={d.facturadoEn ? `${formatearFechaConHora(d.facturadoEn)} · ${d.noFactura}` : 'solo con el detalle aprobado'} />
          {d.estado === 'anulada' && <div style={{ color: 'var(--wine)' }}><strong>Anulado</strong> {d.anuladaEn ? formatearFechaConHora(d.anuladaEn) : ''} · {d.anuladaPor}{d.motivoAnulacion ? ` · ${d.motivoAnulacion}` : ''} · los expedientes volvieron a la cola</div>}
        </div>
      </div>

      {/* 029: estado del link, respuesta del cliente y firma */}
      {(datos.link || d.respondidoEn || conObs) && (
        <div className="card" style={{ marginBottom: 14, borderColor: conObs ? 'var(--wine)' : d.aprobadoCanal === 'link' ? 'var(--olive)' : undefined }} data-link-cliente data-version={d.version}>
          <div className="card-pad" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', fontSize: 13 }}>
            {datos.link && (
              <div style={{ minWidth: 240 }}>
                <div className="cell-strong">Link de aprobación · versión {datos.link.version}</div>
                <div className="cell-mute" style={{ fontSize: 12 }}>
                  {datos.link.usadoEn ? `respondido ${formatearFechaConHora(datos.link.usadoEn)}` : datos.link.revocadoEn ? `revocado ${formatearFechaConHora(datos.link.revocadoEn)}` : Date.parse(datos.link.expiraEn) < Date.now() ? `vencido ${formatearFechaConHora(datos.link.expiraEn)}` : `vigente hasta ${formatearFechaConHora(datos.link.expiraEn)}`}
                  {datos.link.abiertoEn ? ` · abierto ${formatearFechaConHora(datos.link.abiertoEn)} (informativo)` : ' · sin abrir'}
                </div>
                {d.destinatarios.length > 0 && <div className="cell-mute" style={{ fontSize: 12 }}>a {d.destinatarios.join(', ')}</div>}
              </div>
            )}
            {d.respondidoEn && (
              <div style={{ minWidth: 240 }} data-respuesta-cliente={d.estado}>
                <div className="cell-strong">{d.aprobadoCanal === 'link' && d.estado !== 'con_observaciones' ? 'Aprobado digitalmente' : `Respuesta del cliente · ${observaciones.length} ${observaciones.length === 1 ? 'observación' : 'observaciones'}`}</div>
                <div className="cell-mute" style={{ fontSize: 12 }}>{d.respondidoPorNombre || '—'}{d.respondidoPorCargo ? ` · ${d.respondidoPorCargo}` : ''}{d.respondidoPorCorreo ? ` · ${d.respondidoPorCorreo}` : ''} · {formatearFechaConHora(d.respondidoEn)}</div>
                {d.documentoHash && d.aprobadoCanal === 'link' && d.estado !== 'con_observaciones' && <div className="cell-mute num" style={{ fontSize: 12 }} data-huella={d.documentoHash}>huella {huellaCorta(d.documentoHash)}</div>}
              </div>
            )}
            {d.firmaPng && d.aprobadoCanal === 'link' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.firmaPng} alt={`Firma de ${d.respondidoPorNombre}`} style={{ height: 56, border: '1px solid var(--line-2)', borderRadius: 6, background: '#fff' }} data-firma-img />
            )}
            {conObs && <div style={{ flex: 1, minWidth: 260, color: 'var(--wine)' }}><strong>No hay aprobación parcial:</strong> todo regresa, se corrige y se reenvía. Revisá cada observación abajo, quitá o corregí las líneas, respondé las notas y presioná <strong>Enviar versión corregida</strong>.</div>}
          </div>
        </div>
      )}

      {puede && d.estado !== 'facturada' && d.estado !== 'anulada' && (
        <div className="card" role="region" aria-label="Acciones del detalle" style={{ marginBottom: 14, borderColor: 'var(--olive)' }}>
          <div className="card-pad" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            {(d.estado === 'borrador' || d.estado === 'enviada' || conObs) && !anulando && !aprobando && <button className="btn btn-primary" onClick={() => setEnviando(true)} disabled={busy || doc.incluidas.length === 0} data-accion="enviar-cliente" title={linkConfigurado ? (correoConfigurado ? 'Genera el link de aprobación y manda el correo' : 'Correo no configurado: genera el link y lo copiás') : 'Falta DETALLE_LINK_SECRET en este deploy'}><I.Send size={13} /> {conObs ? 'Enviar versión corregida' : d.estado === 'enviada' ? 'Reenviar al cliente' : 'Enviar al cliente'}</button>}
            {d.estado === 'borrador' && !anulando && <button className="btn btn-ghost" onClick={() => void correr(() => marcarEnviadaAction(d.id), `${d.correlativo} marcado como enviado al cliente`)} disabled={busy} data-accion="marcar-enviada" title="Si se mandó por otro canal (correo manual, otro)">Marcar como enviada</button>}
            {conObs && !anulando && <button className="btn btn-secondary" onClick={() => void correr(() => reresolverPreciosAction().then(r => (r.ok ? { ok: true as const } : { ok: false as const, error: r.error })), 'Precios re-resueltos')} disabled={busy} data-accion="re-resolver" title="Después de corregir afuera (tarifa, categoría en la Agenda), vuelve a calcular los precios"><I.Refresh size={13} /> Re-resolver</button>}
            {datos.link?.vigente && !anulando && <button className="btn btn-ghost" onClick={() => void correr(() => revocarLinkDetalleAction(d.id).then(r => (r.ok ? { ok: true as const } : r)), 'Link revocado: el cliente ya no puede responder con él')} disabled={busy} data-accion="revocar-link" title="El cliente ya no podrá responder con el link vigente">Revocar link</button>}
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
              <span style={{ flex: 1, minWidth: 220 }}>Se anula <strong>{d.correlativo}</strong> y sus {d.pruebas || d.expedientes} prueba(s) vuelven a la cola.</span>
              <input className="input" placeholder="Motivo (opcional)" value={motivo} onChange={e => setMotivo(e.target.value)} aria-label="Motivo de anulación" style={{ minWidth: 240 }} maxLength={300} disabled={busy} />
              <button className="btn btn-ghost" onClick={() => setAnulando(false)} disabled={busy}>Volver</button>
              <button className="btn btn-danger" onClick={() => void correr(() => anularDetalleAction(d.id, motivo), `${d.correlativo} anulado: los expedientes volvieron a la cola`).then(ok => { if (ok) setAnulando(false); })} disabled={busy} data-accion="confirmar-anular">Confirmar anulación</button>
            </>}
          </div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        <div className="kpi" data-kpi="procesos"><div className="kpi-label">Pruebas incluidas</div><div className="kpi-value">{doc.incluidas.length}</div><div className="kpi-delta"><span className="vs">{doc.faltantes.length ? `${doc.faltantes.length} no incluido(s)` : 'todos con precio'}</span></div></div>
        <div className="kpi" data-kpi="subtotal"><div className="kpi-label">Base sin IVA</div><div className="kpi-value">{Q(doc.subtotal)}</div><div className="kpi-delta"><span className="vs">total ÷ 1.12 (regla FEL)</span></div></div>
        <div className="kpi" data-kpi="iva"><div className="kpi-label">IVA 12 %</div><div className="kpi-value">{Q(doc.iva)}</div><div className="kpi-delta"><span className="vs">total − base</span></div></div>
        <div className="kpi" data-kpi="total"><div className="kpi-label">Total (IVA incluido)</div><div className="kpi-value">{Q(doc.total)}</div><div className="kpi-delta"><span className="vs">{doc.total !== d.total ? `al generar: ${Q(d.total)}` : 'igual que al generar'}</span></div></div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="card-title">Pruebas</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>una línea por prueba con su resultado (un candidato puede tener solo el polígrafo acá) · montos sin IVA</span></div></div>
        <div className="table-scroll">
        <table className="table" data-lista="detalle">
          <thead><tr><th>Persona</th><th title="Quién pidió la evaluación del lado del cliente (Agenda)">Solicitante</th><th>Ingreso</th><th>Prueba · resultado</th><th>Categoría</th><th>Territorio</th><th className="num">Sin IVA</th><th className="num" title="Precio de la prueba con IVA, como en la factura (030)">Con IVA</th>{(respuestasVigentes.size > 0 || puedeQuitar) && <th>Respuesta del cliente</th>}</tr></thead>
          <tbody>
            {doc.lineas.map(l => (
              <tr key={l.componenteId || l.idExterno} style={{ opacity: l.incluido ? 1 : 0.6 }} data-linea={l.incluido ? 'incluida' : 'faltante'} data-prueba={l.componenteId} data-respuesta-linea={respuestasVigentes.get(l.componenteId)?.decision ?? ''}>
                <td><div className="cell-strong">{l.persona}</div><div className="cell-mute" style={{ fontSize: 11 }}>{l.puesto || l.idExterno}</div></td>
                <td style={{ fontSize: 12 }} data-solicitante={l.solicitante}>{l.solicitante || <span className="cell-mute">—</span>}</td>
                <td className="num" style={{ fontSize: 12 }}>{l.fechaIngreso ?? '—'}</td>
                <td><div>{l.resultado || l.servicio}</div>{l.resultado && l.resultado !== l.servicio ? <div className="cell-mute" style={{ fontSize: 11 }}>{l.servicio}</div> : null}</td>
                <td>{l.categoria}</td><td>{l.territorio}</td>
                <td className="num">{l.incluido ? <span>{Q(l.monto)}</span> : <span className="badge badge-warn" style={{ fontSize: 10 }} title="No suma al total">no incluido · {l.motivo}</span>}</td>
                <td className="num">{l.incluido ? <span className="cell-strong" data-precio-iva={l.montoConIva}>{Q(l.montoConIva)}</span> : <span className="cell-mute">—</span>}</td>
                {(respuestasVigentes.size > 0 || puedeQuitar) && (
                  <td style={{ fontSize: 12, minWidth: 220 }}>
                    <RespuestaLinea r={respuestasVigentes.get(l.componenteId) ?? null} />
                    {puedeQuitar && quitando !== l.componenteId && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => { setQuitando(l.componenteId); setDifiriendo(respuestasVigentes.get(l.componenteId)?.decision === 'proximo_mes'); setMotivoQuitar(''); }} disabled={busy} data-accion="quitar-linea">Quitar línea</button>
                        {conObs && respuestasVigentes.get(l.componenteId) && respuestasVigentes.get(l.componenteId)!.decision !== 'aprobado' && (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <input className="input" placeholder="Respuesta de Golden (la verá en la versión siguiente)" value={notaGolden[l.componenteId] ?? respuestasVigentes.get(l.componenteId)!.respuestaGolden} onChange={e => setNotaGolden(n => ({ ...n, [l.componenteId]: e.target.value }))} maxLength={500} style={{ minWidth: 220, fontSize: 12, padding: '3px 8px' }} aria-label={`Respuesta de Golden para ${l.persona}`} data-campo="respuesta-golden" />
                            <button className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => void correr(() => responderNotaDetalleAction(d.id, l.componenteId, notaGolden[l.componenteId] ?? ''), 'Respuesta guardada')} disabled={busy || notaGolden[l.componenteId] === undefined} data-accion="guardar-respuesta-golden">Guardar</button>
                          </span>
                        )}
                      </div>
                    )}
                    {quitando === l.componenteId && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }} data-quitar-linea>
                        <span>La prueba vuelve a la cola.</span>
                        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={difiriendo} onChange={e => setDifiriendo(e.target.checked)} data-campo="diferir" /> Diferida al {primerDiaMesSiguiente()}</label>
                        <input className="input" placeholder="Motivo (opcional)" value={motivoQuitar} onChange={e => setMotivoQuitar(e.target.value)} maxLength={300} style={{ minWidth: 180, fontSize: 12, padding: '3px 8px' }} aria-label="Motivo" />
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => setQuitando(null)} disabled={busy}>Volver</button>
                        <button className="btn btn-danger" style={{ fontSize: 11, padding: '1px 8px' }} onClick={() => void correr(() => quitarLineaDetalleAction(d.id, l.componenteId, { motivo: motivoQuitar, diferirHasta: difiriendo ? primerDiaMesSiguiente() : null }), difiriendo ? `Línea quitada y diferida al ${primerDiaMesSiguiente()}` : 'Línea quitada: la prueba volvió a la cola').then(ok => { if (ok) setQuitando(null); })} disabled={busy} data-accion="confirmar-quitar-linea">Confirmar</button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
            <tr style={{ background: 'var(--bg-2)' }}><td colSpan={(respuestasVigentes.size > 0 || puedeQuitar) ? 7 : 6} className="num" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>Base sin IVA {Q(doc.subtotal)} · IVA 12 % {Q(doc.iva)} · <strong>Total (IVA incluido)</strong></td><td className="num" data-total={doc.total}><strong>{Q(doc.total)}</strong></td>{(respuestasVigentes.size > 0 || puedeQuitar) && <td />}</tr>
          </tbody>
        </table>
        </div>
      </div>
      {d.notas && <div className="card" style={{ marginBottom: 14 }}><div className="card-pad" style={{ fontSize: 13 }}><strong>Notas:</strong> {d.notas}</div></div>}

      {(datos.envios.length > 0 || datos.aperturas.length > 0) && (
        <div className="card" style={{ marginBottom: 14 }} data-bitacora-envios>
          <div className="card-head"><div className="card-title">Envíos y aperturas</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>bitácora: fecha, a quién, versión y resultado del proveedor; cada apertura del link con dispositivo, navegador y red (abierto ≠ leído)</span></div></div>
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Versión</th><th>Destinatarios / dispositivo</th><th>Modo / red</th><th>Resultado</th><th>Por</th></tr></thead>
            <tbody>{[
              ...datos.envios.map(e => ({ fecha: e.createdAt, fila: <tr key={'e' + e.id} data-bitacora-fila="envio"><td className="cell-mute" style={{ whiteSpace: 'nowrap' }}>{formatearFechaConHora(e.createdAt)}</td><td>{e.tipo === 'aviso' ? 'Aviso a Finanzas' : 'Envío al cliente'}</td><td className="num">{e.version}</td><td>{e.destinatarios.join(', ') || '—'}{e.cc.length ? <span className="cell-mute"> · cc {e.cc.join(', ')}</span> : null}</td><td>{e.modo === 'resend' ? 'Resend' : e.modo === 'mock' ? 'Prueba (mock)' : 'Copiar link'}</td><td><span className={'badge ' + (e.resultado === 'enviado' ? 'badge-olive' : e.resultado === 'error' ? 'badge-wine' : 'badge-mute')} style={{ fontSize: 10 }} title={e.error || undefined}>{e.resultado === 'enviado' ? 'enviado' : e.resultado === 'error' ? 'error' : 'sin correo'}</span></td><td className="cell-mute">{e.enviadoPor}</td></tr> })),
              ...datos.aperturas.map(a => { const lk = datos.links.find(l => l.id === a.linkId); const marca = marcaRed(a, datos.aperturas.filter(x => x.linkId === a.linkId), lk?.creadorIpHash); return { fecha: a.abiertoEn, fila: <tr key={'a' + a.id} data-bitacora-fila="apertura" data-marca={marca}><td className="cell-mute" style={{ whiteSpace: 'nowrap' }}>{formatearFechaConHora(a.abiertoEn)}</td><td>Apertura del link</td><td className="num">{a.version}</td><td>{ETIQUETA_DISPOSITIVO[a.dispositivo]} · {a.navegador}</td><td className={marca === 'creador' ? 'cell-mute' : undefined}>{ETIQUETA_MARCA_RED[marca]}</td><td><span className={'badge ' + (a.respondio ? 'badge-olive' : 'badge-mute')} style={{ fontSize: 10 }} title="Alguien abrió el link (puede ser un antivirus del correo); no confirma quién lo leyó">{a.respondio ? 'abierto · respondió' : 'abierto'}</span></td><td className="cell-mute">—</td></tr> }; }),
            ].sort((x, y) => Date.parse(y.fecha) - Date.parse(x.fecha)).map(f => f.fila)}</tbody>
          </table>
        </div>
      )}

      {enviando && (
        <EnviarDialogo
          datos={datos} correoConfigurado={correoConfigurado} linkConfigurado={linkConfigurado} busy={busy}
          onClose={() => setEnviando(false)}
          onEnviar={async input => { setBusy(true); try { const r = await enviarDetalleAction(d.id, input); if (r.ok) { setResultadoEnvio(r); setEnviando(false); toast.success(r.correo.resultado === 'enviado' ? `${d.correlativo} enviado · versión ${r.link.version}` : `Link generado · versión ${r.link.version}: copialo y mandalo`); router.refresh(); } else toast.error(r.error); } finally { setBusy(false); } }}
        />
      )}
      {resultadoEnvio && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Link de aprobación" onClick={() => setResultadoEnvio(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card" style={{ maxWidth: 640, width: '100%' }} onClick={e => e.stopPropagation()} data-resultado-envio={resultadoEnvio.correo.resultado}>
            <div className="card-head"><div className="card-title">{resultadoEnvio.correo.resultado === 'enviado' ? 'Enviado al cliente' : 'Link listo para copiar'}</div></div>
            <div className="card-pad" style={{ fontSize: 13, display: 'grid', gap: 10 }}>
              <div>{resultadoEnvio.correo.detalle}</div>
              <div className="cell-mute" style={{ fontSize: 12 }}>Versión {resultadoEnvio.link.version} · vence {formatearFechaConHora(resultadoEnvio.link.expiraEn)} · huella {huellaCorta(resultadoEnvio.huella)}. El link es de un solo uso y solo se muestra acá: si lo perdés, reenviá.</div>
              <textarea className="input" readOnly value={resultadoEnvio.correo.textoCopiar} rows={7} style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }} aria-label="Texto para pegar" data-texto-copiar onFocus={e => e.currentTarget.select()} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setResultadoEnvio(null)}>Cerrar</button>
                <button className="btn btn-secondary" onClick={() => { void navigator.clipboard?.writeText(resultadoEnvio.url).then(() => toast.success('Link copiado')).catch(() => toast.error('No se pudo copiar: seleccioná el texto')); }} data-accion="copiar-link">Copiar solo el link</button>
                <button className="btn btn-primary" onClick={() => { void navigator.clipboard?.writeText(resultadoEnvio.correo.textoCopiar).then(() => toast.success('Texto copiado')).catch(() => toast.error('No se pudo copiar: seleccioná el texto')); }} data-accion="copiar-texto">Copiar texto con link</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {facturando && d.estado === 'aprobada' && (
        <FacturarDialogo
          seleccion={pruebas.filter(p => doc.incluidas.some(l => l.componenteId === p.id)).map(p => pruebaParaFactura(p, expedientes.find(e => e.idExterno === p.idExterno)?.persona ?? p.idExterno))} centros={datos.centros} cliente={datos.clienteNombre} writeback={writeback} configurada={configurada} montoModo={montoModo}
          contexto={`${d.correlativo} · aprobado por ${d.aprobadoPor}`}
          onClose={() => setFacturando(false)}
          onConfirmar={input => facturarDetalleAction(d.id, input)}
          onHecho={r => { setResultado(r); setFacturando(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

/** 029: decisión del cliente en una línea (badge + nota + respuesta de Golden). */
function RespuestaLinea({ r }: { r: RespuestaDetalle | null }) {
  if (!r) return <span className="cell-mute">—</span>;
  return (
    <div>
      <span className={'badge ' + BADGE_DECISION_DETALLE[r.decision]} style={{ fontSize: 10 }}>{ETIQUETA_DECISION_DETALLE[r.decision]}</span>
      {r.nota && <div style={{ marginTop: 2 }} data-nota-cliente>{r.nota}</div>}
      {r.respuestaGolden && <div className="cell-mute" style={{ fontSize: 11, marginTop: 2 }}>Golden: {r.respuestaGolden}</div>}
    </div>
  );
}

/** 029: modal "Enviar al cliente": destinatarios (sugeridos del cliente), CC, asunto y mensaje. */
function EnviarDialogo({ datos, correoConfigurado, linkConfigurado, busy, onClose, onEnviar }: { datos: DetalleCompleto; correoConfigurado: boolean; linkConfigurado: boolean; busy: boolean; onClose: () => void; onEnviar: (input: { destinatarios: string[]; cc: string[]; asunto: string; mensaje: string }) => Promise<void> }) {
  const d = datos.detalle;
  const mes = new Date().toLocaleDateString('es-GT', { month: 'short', year: 'numeric', timeZone: 'America/Guatemala' }).replace('.', '');
  const [para, setPara] = useState((d.destinatarios.length ? d.destinatarios : datos.correosCliente).join(', '));
  const [cc, setCc] = useState('');
  const [asunto, setAsunto] = useState(`Detalle de servicios ${d.correlativo} · Golden Talent · ${mes.charAt(0).toUpperCase() + mes.slice(1)}`);
  const [mensaje, setMensaje] = useState(d.estado === 'con_observaciones' ? 'Les mandamos la versión corregida del detalle con las respuestas a sus observaciones. Quedamos atentos a su aprobación.' : 'Les compartimos el detalle de servicios para su revisión y aprobación. Cualquier duda, respondan este correo.');
  const lista = (s: string) => s.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  const corregida = d.estado === 'con_observaciones';
  return (
    <div role="dialog" aria-modal="true" aria-label="Enviar al cliente" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 640, width: '100%' }} onClick={e => e.stopPropagation()} data-dialogo-enviar>
        <div className="card-head"><div className="card-title">{corregida ? `Enviar versión ${d.version + 1} · corregida` : 'Enviar al cliente'}</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>{d.correlativo} · {datos.documento.incluidas.length} prueba(s) · {Q(datos.documento.total)} con IVA</span></div></div>
        <div className="card-pad" style={{ display: 'grid', gap: 10, fontSize: 13 }}>
          {!linkConfigurado && <div style={{ color: 'var(--wine)' }}>Falta <strong>DETALLE_LINK_SECRET</strong> en este deploy: sin eso no se puede generar el link.</div>}
          {linkConfigurado && !correoConfigurado && <div className="cell-mute" role="status" data-sin-correo>Correo no configurado (falta RESEND_API_KEY): se genera el link y lo copiás con un texto listo para pegar.</div>}
          {corregida && <div className="cell-mute">Se sube la versión, se revoca el link anterior y se manda el correo otra vez. El cliente verá "Versión {d.version + 1} · corregida" con las respuestas de Golden a sus notas; las líneas que siguen aparecen aprobadas por defecto.</div>}
          <label style={{ display: 'grid', gap: 4 }}>Destinatarios <input className="input" value={para} onChange={e => setPara(e.target.value)} placeholder="correo@cliente.com, otro@cliente.com" aria-label="Destinatarios" data-campo="destinatarios" /><span className="cell-mute" style={{ fontSize: 11 }}>{datos.correosCliente.length ? `Sugeridos del cliente: ${datos.correosCliente.join(', ')}` : 'El cliente no tiene correo de cobros cargado.'}</span></label>
          <label style={{ display: 'grid', gap: 4 }}>CC (opcional) <input className="input" value={cc} onChange={e => setCc(e.target.value)} aria-label="CC" data-campo="cc" /></label>
          <label style={{ display: 'grid', gap: 4 }}>Asunto <input className="input" value={asunto} onChange={e => setAsunto(e.target.value)} maxLength={200} aria-label="Asunto" data-campo="asunto" /></label>
          <label style={{ display: 'grid', gap: 4 }}>Mensaje <textarea className="input" value={mensaje} onChange={e => setMensaje(e.target.value)} rows={3} maxLength={1000} aria-label="Mensaje" data-campo="mensaje" /></label>
          <div className="cell-mute" style={{ fontSize: 11 }}>El correo lleva el resumen (cliente, corte, pruebas, total con IVA), el botón "Revisar y aprobar" y el vencimiento (30 días). Sin nombres de candidatos en el asunto. El PDF no se adjunta: el cliente revisa en el link.</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => void onEnviar({ destinatarios: lista(para), cc: lista(cc), asunto, mensaje })} disabled={busy || !linkConfigurado} data-accion="confirmar-enviar"><I.Send size={13} /> {busy ? 'Enviando…' : correoConfigurado && lista(para).length ? (corregida ? 'Enviar versión corregida' : 'Enviar correo') : 'Generar link para copiar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Paso({ hecho, n, titulo, sub, extra }: { hecho: boolean; n: number; titulo: string; sub: string; extra?: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', minWidth: 200 }} data-paso={n} data-hecho={hecho}>
      <span style={{ width: 20, height: 20, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, background: hecho ? 'var(--olive)' : 'var(--bg-2)', color: hecho ? '#fff' : 'var(--ink-3)', border: hecho ? 'none' : '1px solid var(--line-2)' }}>{hecho ? '✓' : n}</span>
      <div><div className="cell-strong" style={{ fontSize: 12.5 }}>{titulo}</div><div className="cell-mute" style={{ fontSize: 11 }}>{sub}</div>{extra}</div>
    </div>
  );
}

const AYUDA_ABIERTO = 'Abierto = alguien abrió el link (puede ser un antivirus del correo); no confirma quién lo leyó.';

/** 031: «Abierto N veces · primera · última · N dispositivos» o «Sin abrir», con la lista de aperturas desplegable. */
function Aperturas({ aperturas, creadorIpHash, version }: { aperturas: AperturaLink[]; creadorIpHash: string | null; version: number }) {
  const [abierto, setAbierto] = useState(false);
  const r = resumenAperturas(aperturas, creadorIpHash);
  const orden = [...aperturas].sort((x, y) => Date.parse(y.abiertoEn) - Date.parse(x.abiertoEn));
  return (
    <div style={{ marginTop: 4, fontSize: 11.5 }} data-aperturas={r.n} data-aperturas-propias={r.propias} title={AYUDA_ABIERTO}>
      <span className={r.n > 0 ? 'cell-strong' : 'cell-mute'} style={{ fontSize: 11.5 }}>{textoAperturas(r, formatearFechaCompacta)}</span>
      {aperturas.length > 0 && <button type="button" className="btn btn-ghost" style={{ fontSize: 10.5, padding: '0 6px', marginLeft: 6 }} onClick={() => setAbierto(v => !v)} aria-expanded={abierto} data-accion="ver-aperturas">{abierto ? 'ocultar' : `ver ${aperturas.length === 1 ? 'la apertura' : `las ${aperturas.length} aperturas`}`}</button>}
      {abierto && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 14, display: 'grid', gap: 2 }} data-lista-aperturas={version}>
          {orden.map(a => { const marca = marcaRed(a, aperturas, creadorIpHash); return (
            <li key={a.id} className={marca === 'creador' ? 'cell-mute' : undefined} data-apertura data-marca={marca} data-dispositivo={a.dispositivo}>
              <span className="num">{formatearFechaCompacta(a.abiertoEn)}</span> · {ETIQUETA_DISPOSITIVO[a.dispositivo]} · {a.navegador} · <em>{ETIQUETA_MARCA_RED[marca]}</em>{a.respondio ? ' · respondió' : ''}
            </li>
          ); })}
        </ul>
      )}
      <div className="cell-mute" style={{ fontSize: 10.5, marginTop: 2 }}>{AYUDA_ABIERTO}</div>
    </div>
  );
}
