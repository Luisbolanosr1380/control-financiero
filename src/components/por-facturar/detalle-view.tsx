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
 * 032: «Subir detalle firmado» (PDF / foto del papel firmado) en la tarjeta del flujo, con el detalle enviado, con
 * observaciones, aprobado o facturado; en enviado / con observaciones ofrece «y marcar como aprobado» (canal papel,
 * revoca el link). El archivo va directo al bucket privado por URL firmada de subida y el servidor lo valida por sus
 * bytes. Sección «Detalle firmado» con Ver / Descargar (URL firmada de 5 min) y reemplazar / quitar con motivo
 * (admin / contador; el anterior queda como versión anterior).
 */
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { Q } from '@/lib/utils';
import { formatearFechaConHora } from '@/lib/utils/fechas';
import { anularDetalleAction, editarEncabezadoDetalleAction, enviarDetalleAction, facturarDetalleAction, marcarAprobadaAction, marcarEnviadaAction, quitarLineaDetalleAction, reresolverPreciosAction, responderNotaDetalleAction, revocarLinkDetalleAction } from '@/app/(app)/por-facturar/actions';
import { BADGE_DECISION_DETALLE, BADGE_ESTADO_DETALLE, ETIQUETA_CANAL_APROBACION, ETIQUETA_DECISION_DETALLE, ETIQUETA_ESTADO_DETALLE, primerDiaMesSiguiente, type CanalAprobacion, type RespuestaDetalle } from '@/lib/facturacion-agenda/detalle';
import { huellaCorta } from '@/lib/detalle-link/publico';
import { confirmarSubidaFirmadoAction, prepararSubidaFirmadoAction, quitarArchivoFirmadoAction } from '@/app/(app)/por-facturar/actions';
import { ACEPTA_INPUT, ETIQUETA_MIME, MAX_ARCHIVOS_FIRMADO, MAX_BYTES_ARCHIVO, esImagen, formatearBytes, puedeAprobarEnPapelEn, puedeSubirFirmadoEn, tipoRealDe, validarArchivosDeclarados, type MimeFirmado } from '@/lib/detalle-archivo/puro';
import type { ArchivoDetalle } from '@/lib/db/detalle-archivo';
import { formatearFechaCorta, obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
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
  // 032: detalle firmado en papel
  const puedeGestionarArchivo = usePuede()('gestionar_archivo_detalle');
  const [subiendoFirmado, setSubiendoFirmado] = useState<{ reemplazaId: string | null } | null>(null);
  const [quitandoArchivo, setQuitandoArchivo] = useState<string | null>(null);
  const [motivoArchivo, setMotivoArchivo] = useState('');
  const [verAnteriores, setVerAnteriores] = useState(false);
  const archivosVigentes = datos.archivos.filter(a => a.vigente), archivosAnteriores = datos.archivos.filter(a => !a.vigente);
  const firmadoPapel = archivosVigentes[0] ?? null;
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
          <Paso hecho={!!d.enviadaEn} n={2} titulo="Enviado al cliente" sub={d.enviadaEn ? `${formatearFechaConHora(d.enviadaEn)} · ${d.enviadaPor}` : 'por correo (manual)'} />
          <Paso hecho={!!d.aprobadaEn} n={3} titulo="Aprobado por el cliente" sub={d.aprobadaEn ? `${formatearFechaConHora(d.aprobadaEn)} · ${d.aprobadoPor} · ${d.aprobadoCanal ? ETIQUETA_CANAL_APROBACION[d.aprobadoCanal] : '—'}` : conObs ? `con observaciones (${observaciones.length}) · versión ${d.version}` : 'pendiente'}
            extra={(puede && puedeSubirFirmadoEn(d.estado)) || firmadoPapel ? (
              <div style={{ marginTop: 4, fontSize: 11.5, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }} data-firmado-papel={firmadoPapel ? 'si' : 'no'}>
                {firmadoPapel && <span className="cell-strong" style={{ fontSize: 11.5 }}><I.Paperclip size={12} /> Firmado en papel por {firmadoPapel.firmadoPor} el {formatearFechaCorta(firmadoPapel.firmadoFecha)} · <a href="#detalle-firmado" style={{ color: 'var(--ink-3)' }}>ver</a></span>}
                {puede && puedeSubirFirmadoEn(d.estado) && !anulando && <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setSubiendoFirmado({ reemplazaId: null })} disabled={busy || archivosVigentes.length >= MAX_ARCHIVOS_FIRMADO} title={archivosVigentes.length >= MAX_ARCHIVOS_FIRMADO ? `Ya hay ${MAX_ARCHIVOS_FIRMADO} archivos` : 'PDF, JPG, PNG o HEIC del detalle firmado (hasta 5 archivos de 15 MB)'} data-accion="subir-firmado"><I.Paperclip size={12} /> {firmadoPapel ? 'Subir otra hoja' : 'Subir detalle firmado'}</button>}
              </div>
            ) : null} />
          <Paso hecho={d.estado === 'facturada'} n={4} titulo="Facturado (SAT)" sub={d.facturadoEn ? `${formatearFechaConHora(d.facturadoEn)} · ${d.noFactura}` : 'solo con el detalle aprobado'} />
          {d.estado === 'anulada' && <div style={{ color: 'var(--wine)' }}><strong>Anulado</strong> {d.anuladaEn ? formatearFechaConHora(d.anuladaEn) : ''} · {d.anuladaPor}{d.motivoAnulacion ? ` · ${d.motivoAnulacion}` : ''} · los expedientes volvieron a la cola</div>}
        </div>
      </div>

      {/* 032: el papel firmado (escaneo o foto) */}
      {datos.archivos.length > 0 && (
        <div className="card" id="detalle-firmado" style={{ marginBottom: 14, borderColor: firmadoPapel ? 'var(--olive)' : undefined }} data-detalle-firmado={archivosVigentes.length}>
          <div className="card-head"><div className="card-title">Detalle firmado</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>respaldo de la aprobación en papel · bucket privado, enlaces de 5 minutos</span></div></div>
          <div className="card-pad" style={{ display: 'grid', gap: 10, fontSize: 13 }}>
            {archivosVigentes.length === 0 && <div className="cell-mute">No hay archivo vigente (los anteriores quedaron como versiones anteriores).</div>}
            {archivosVigentes.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }} data-archivo={a.id} data-mime={a.mime}>
                <a href={`/api/detalle-archivo/${a.id}`} target="_blank" rel="noopener" style={{ width: 72, height: 72, borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }} title="Ver">
                  {a.miniaturaUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={a.miniaturaUrl} alt={a.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} data-miniatura /> : <span className="cell-mute" style={{ fontSize: 11, fontWeight: 600 }}>{ETIQUETA_MIME[a.mime]}</span>}
                </a>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="cell-strong" data-archivo-nombre>{a.nombre} <span className="cell-mute" style={{ fontWeight: 400, fontSize: 11 }}>· {ETIQUETA_MIME[a.mime]} · {formatearBytes(a.bytes)}</span></div>
                  <div style={{ fontSize: 12 }} data-firmado-por>Firmado por <strong>{a.firmadoPor}</strong>{a.firmadoCargo ? ` · ${a.firmadoCargo}` : ''} el {formatearFechaCorta(a.firmadoFecha)}</div>
                  {a.notas && <div className="cell-mute" style={{ fontSize: 12 }} data-archivo-notas>{a.notas}</div>}
                  <div className="cell-mute" style={{ fontSize: 11 }}>subido {formatearFechaConHora(a.subidoEn)} por {a.subidoPor}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    <a className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} href={`/api/detalle-archivo/${a.id}`} target="_blank" rel="noopener" data-accion="ver-archivo"><I.Eye size={12} /> Ver</a>
                    <a className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} href={`/api/detalle-archivo/${a.id}?descargar=1`} data-accion="descargar-archivo"><I.Download size={12} /> Descargar</a>
                    {puedeGestionarArchivo && quitandoArchivo !== a.id && <>
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setSubiendoFirmado({ reemplazaId: a.id })} disabled={busy} data-accion="reemplazar-archivo">Reemplazar</button>
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setQuitandoArchivo(a.id); setMotivoArchivo(''); }} disabled={busy} data-accion="quitar-archivo">Quitar</button>
                    </>}
                  </div>
                  {quitandoArchivo === a.id && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }} data-quitar-archivo>
                      <input className="input" placeholder="Motivo (obligatorio): queda en la versión anterior" value={motivoArchivo} onChange={e => setMotivoArchivo(e.target.value)} aria-label="Motivo" style={{ minWidth: 260, flex: 1 }} maxLength={300} autoFocus data-campo="motivo-archivo" />
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setQuitandoArchivo(null)} disabled={busy}>Volver</button>
                      <button type="button" className="btn btn-danger" style={{ fontSize: 11 }} onClick={() => void correr(() => quitarArchivoFirmadoAction(a.id, motivoArchivo), 'Archivo quitado: queda como versión anterior').then(ok => { if (ok) setQuitandoArchivo(null); })} disabled={busy || motivoArchivo.trim().length < 3} data-accion="confirmar-quitar-archivo">Quitar archivo</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {archivosAnteriores.length > 0 && (
              <div style={{ fontSize: 12 }} data-archivos-anteriores={archivosAnteriores.length}>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => setVerAnteriores(v => !v)} aria-expanded={verAnteriores} data-accion="ver-anteriores">{verAnteriores ? 'ocultar' : 'ver'} {archivosAnteriores.length === 1 ? 'la versión anterior' : `las ${archivosAnteriores.length} versiones anteriores`}</button>
                {verAnteriores && <ul style={{ margin: '4px 0 0', paddingLeft: 16, display: 'grid', gap: 2 }} className="cell-mute">{archivosAnteriores.map(a => <li key={a.id} data-archivo-anterior={a.id}><a href={`/api/detalle-archivo/${a.id}`} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{a.nombre}</a> · firmado por {a.firmadoPor} · subido {formatearFechaConHora(a.subidoEn)} · {a.reemplazadoPor ? 'reemplazado' : 'quitado'} {formatearFechaConHora(a.reemplazadoEn)}{a.motivoReemplazo ? ` · ${a.motivoReemplazo}` : ''}</li>)}</ul>}
              </div>
            )}
          </div>
        </div>
      )}

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

      {datos.envios.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }} data-bitacora-envios>
          <div className="card-head"><div className="card-title">Envíos</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>bitácora: fecha, a quién, versión y resultado del proveedor</span></div></div>
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Versión</th><th>Destinatarios</th><th>Modo</th><th>Resultado</th><th>Por</th></tr></thead>
            <tbody>{datos.envios.map(e => <tr key={e.id}><td className="cell-mute" style={{ whiteSpace: 'nowrap' }}>{formatearFechaConHora(e.createdAt)}</td><td>{e.tipo === 'aviso' ? 'Aviso a Finanzas' : 'Envío al cliente'}</td><td className="num">{e.version}</td><td>{e.destinatarios.join(', ') || '—'}{e.cc.length ? <span className="cell-mute"> · cc {e.cc.join(', ')}</span> : null}</td><td>{e.modo === 'resend' ? 'Resend' : e.modo === 'mock' ? 'Prueba (mock)' : 'Copiar link'}</td><td><span className={'badge ' + (e.resultado === 'enviado' ? 'badge-olive' : e.resultado === 'error' ? 'badge-wine' : 'badge-mute')} style={{ fontSize: 10 }} title={e.error || undefined}>{e.resultado === 'enviado' ? 'enviado' : e.resultado === 'error' ? 'error' : 'sin correo'}</span></td><td className="cell-mute">{e.enviadoPor}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {subiendoFirmado && (
        <SubirFirmadoDialogo datos={datos} reemplazaId={subiendoFirmado.reemplazaId} busy={busy} setBusy={setBusy} onClose={() => setSubiendoFirmado(null)}
          onListo={(msg) => { setSubiendoFirmado(null); toast.success(msg); router.refresh(); }} />
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

/** 032: archivo elegido en el navegador con su tipo real (primeros bytes) y el veredicto previo. */
interface ArchivoElegido { file: File; mime: MimeFirmado | null; error: string | null }

/**
 * 032: «Subir detalle firmado» / «Reemplazar». El archivo va directo al bucket privado con una URL firmada de subida
 * (paso 1), y el servidor lo valida por sus bytes y lo registra (paso 2). Sin diálogos del navegador.
 */
function SubirFirmadoDialogo({ datos, reemplazaId, busy, setBusy, onClose, onListo }: { datos: DetalleCompleto; reemplazaId: string | null; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void; onListo: (msg: string) => void }) {
  const d = datos.detalle;
  const anterior = reemplazaId ? datos.archivos.find(a => a.id === reemplazaId) ?? null : null;
  const yaVigentes = datos.archivos.filter(a => a.vigente).length - (reemplazaId ? 1 : 0);
  const ofreceAprobar = !reemplazaId && puedeAprobarEnPapelEn(d.estado);
  const [archivos, setArchivos] = useState<ArchivoElegido[]>([]);
  const [firmadoPor, setFirmadoPor] = useState(anterior?.firmadoPor ?? d.aprobadoPor ?? '');
  const [cargo, setCargo] = useState(anterior?.firmadoCargo ?? '');
  const [fecha, setFecha] = useState(anterior?.firmadoFecha ?? obtenerFechaHoyGuatemala());
  const [notas, setNotas] = useState('');
  const [motivo, setMotivo] = useState('');
  const [aprobar, setAprobar] = useState(ofreceAprobar);
  const [error, setError] = useState('');
  const [progreso, setProgreso] = useState('');

  const elegir = async (lista: FileList | null) => {
    const files = [...(lista ?? [])].slice(0, reemplazaId ? 1 : MAX_ARCHIVOS_FIRMADO);
    const out: ArchivoElegido[] = [];
    for (const file of files) {
      const cab = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const mime = tipoRealDe(cab);
      out.push({ file, mime, error: !mime ? 'no es PDF ni imagen (JPG, PNG o HEIC)' : file.size > MAX_BYTES_ARCHIVO ? 'pesa más de 15 MB' : file.size === 0 ? 'está vacío' : null });
    }
    setArchivos(out); setError('');
  };
  const listos = archivos.filter(a => !a.error && a.mime);
  const puedeEnviar = listos.length > 0 && listos.length === archivos.length && firmadoPor.trim().length >= 2 && (!reemplazaId || motivo.trim().length >= 3) && !busy;

  const subir = async () => {
    setError(''); setBusy(true);
    try {
      const v = validarArchivosDeclarados(listos.map(a => ({ nombre: a.file.name, bytes: a.file.size, mime: a.mime! })), yaVigentes);
      if (!v.ok) { setError(v.error); return; }
      setProgreso('Preparando la subida…');
      const prep = await prepararSubidaFirmadoAction(d.id, listos.map(a => ({ nombre: a.file.name, bytes: a.file.size, mime: a.mime! })), { reemplazaId });
      if (!prep.ok) { setError(prep.error); return; }
      for (let i = 0; i < prep.subidas.length; i++) {
        const s = prep.subidas[i], a = listos[i];
        setProgreso(`Subiendo ${i + 1} de ${prep.subidas.length}: ${a.file.name}…`);
        // directo al bucket privado, a un path fijo, con la URL firmada de subida (una sola vez)
        const res = await fetch(s.url, { method: 'PUT', headers: { 'content-type': s.mime, 'x-upsert': 'false' }, body: a.file, credentials: 'omit', cache: 'no-store' });
        if (!res.ok) { setError(`No se pudo subir "${a.file.name}" (${res.status}). Probá de nuevo.`); return; }
      }
      setProgreso('Verificando y guardando…');
      const r = await confirmarSubidaFirmadoAction(d.id, { archivos: prep.subidas.map(s => ({ path: s.path, nombre: s.nombre })), firmadoPor, firmadoCargo: cargo, firmadoFecha: fecha, notas, aprobar: ofreceAprobar && aprobar, reemplazaId, motivo });
      if (!r.ok) { setError(r.error); return; }
      onListo(reemplazaId ? 'Archivo reemplazado: el anterior queda como versión anterior' : r.aprobado ? `${d.correlativo} aprobado con el detalle firmado en papel${r.linkRevocado ? ' · link digital revocado' : ''}` : `${r.archivos.length === 1 ? 'Archivo guardado' : `${r.archivos.length} archivos guardados`} en el detalle`);
    } finally { setBusy(false); setProgreso(''); }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={reemplazaId ? 'Reemplazar el detalle firmado' : 'Subir detalle firmado'} onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div className="card" style={{ maxWidth: 560, width: '100%' }} onClick={e => e.stopPropagation()} data-dialogo-firmado={reemplazaId ? 'reemplazar' : 'subir'}>
        <div className="card-head"><div className="card-title">{reemplazaId ? 'Reemplazar el detalle firmado' : 'Subir detalle firmado'}</div></div>
        <div className="card-pad" style={{ display: 'grid', gap: 10, fontSize: 13 }}>
          <div className="cell-mute" style={{ fontSize: 12 }}>El papel firmado por el cliente (escaneo o foto): PDF, JPG, PNG o HEIC, hasta {MAX_ARCHIVOS_FIRMADO} archivos de 15 MB. Queda en un bucket privado: se ve solo con sesión.</div>
          <label style={{ display: 'grid', gap: 4 }}>{reemplazaId ? 'Archivo nuevo' : 'Archivo(s)'}
            <input className="input" type="file" accept={ACEPTA_INPUT} multiple={!reemplazaId} onChange={e => void elegir(e.target.files)} disabled={busy} aria-label="Archivos del detalle firmado" data-campo="archivos" />
          </label>
          {archivos.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }} data-archivos-elegidos={archivos.length}>
              {archivos.map((a, i) => <li key={i} style={{ color: a.error ? 'var(--wine)' : undefined }} data-elegido={a.error ? 'error' : 'ok'}>{a.file.name} · {formatearBytes(a.file.size)}{a.mime ? ` · ${ETIQUETA_MIME[a.mime]}${esImagen(a.mime) ? ' (foto)' : ''}` : ''}{a.error ? ` · ${a.error}` : ''}</li>)}
            </ul>
          )}
          <label style={{ display: 'grid', gap: 4 }}>Firmado por <input className="input" value={firmadoPor} onChange={e => setFirmadoPor(e.target.value)} placeholder="Nombre de quien firmó, del lado del cliente" aria-label="Firmado por" maxLength={200} disabled={busy} data-campo="firmado-por" /></label>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
            <label style={{ display: 'grid', gap: 4 }}>Cargo (opcional) <input className="input" value={cargo} onChange={e => setCargo(e.target.value)} aria-label="Cargo" maxLength={200} disabled={busy} data-campo="firmado-cargo" /></label>
            <label style={{ display: 'grid', gap: 4 }}>Fecha de firma <input className="input" type="date" value={fecha} max={obtenerFechaHoyGuatemala()} onChange={e => setFecha(e.target.value)} aria-label="Fecha de firma" disabled={busy} data-campo="firmado-fecha" /></label>
          </div>
          <label style={{ display: 'grid', gap: 4 }}>Notas (opcional) <textarea className="input" value={notas} onChange={e => setNotas(e.target.value)} rows={2} maxLength={1000} placeholder="Ej.: marcó NO en la línea 7, se quitó" aria-label="Notas" disabled={busy} data-campo="firmado-notas" /></label>
          {reemplazaId && <label style={{ display: 'grid', gap: 4 }}>Motivo del reemplazo <input className="input" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Obligatorio: el archivo anterior queda como versión anterior" aria-label="Motivo del reemplazo" maxLength={300} disabled={busy} data-campo="motivo-reemplazo" /></label>}
          {ofreceAprobar && <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={aprobar} onChange={e => setAprobar(e.target.checked)} disabled={busy} data-campo="aprobar-papel" /> <span><strong>y marcar como aprobado</strong> <span className="cell-mute">(canal: firmado en papel{datos.link?.vigente ? '; se revoca el link digital vigente' : ''})</span></span></label>}
          {!ofreceAprobar && !reemplazaId && <div className="cell-mute" style={{ fontSize: 12 }}>El detalle ya está {ETIQUETA_ESTADO_DETALLE[d.estado].toLowerCase()}: solo se adjunta el archivo, no cambia nada más.</div>}
          {progreso && <div className="cell-mute" role="status" data-progreso>{progreso}</div>}
          {error && <div style={{ color: 'var(--wine)' }} role="alert" data-error-firmado>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void subir()} disabled={!puedeEnviar} data-accion="confirmar-subir-firmado"><I.Paperclip size={13} /> {busy ? 'Subiendo…' : reemplazaId ? 'Reemplazar' : ofreceAprobar && aprobar ? 'Subir y marcar como aprobado' : 'Subir'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
