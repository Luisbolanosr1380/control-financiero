import { Q } from '@/lib/utils';
import { formatearFechaCorta } from '@/lib/utils/fechas';
import type { DetalleCompleto } from '@/lib/db/detalle-facturacion';
import { ImprimirBoton } from './imprimir-boton';
import { huellaCorta } from '@/lib/detalle-link/publico';
import { ETIQUETA_DECISION_DETALLE } from '@/lib/facturacion-agenda/detalle';

/**
 * Documento imprimible (server component): encabezado del emisor y del cliente, correlativo, fecha,
 * título "Detalle de servicios / Pre-liquidación" (o "Detalle de la factura N°" cuando ya se facturó),
 * título del corte y "dirigido a" (028), una línea por prueba con solicitante, totales. Los procesos
 * sin precio quedan abajo como "no incluidos" y no suman. 030: la columna de monto es el PRECIO CON IVA de cada prueba
 * (como en la factura); al pie, el total IVA incluido y, más chico, la base sin IVA y el IVA (regla FEL).
 *
 * Para que el cliente revise con lapicero: letra compacta (≥ 30 líneas por hoja carta), casillas
 * "Sí / No" vacías de verdad (CSS) y una columna de observaciones en blanco por línea; bloque de firma
 * al pie mientras el detalle no está facturado. En impresión las filas no se parten entre hojas y el
 * encabezado de la tabla se repite en cada hoja. Estilos propios + @media print (sin shell).
 */
const territorioCorto = (t: string): string => (/^METRO/i.test(t) ? 'Metro' : /^DEPART/i.test(t) ? 'Depto' : t);

export function DetalleImprimible({ datos, emisor }: { datos: DetalleCompleto; emisor: { nombre: string; nit: string; direccion: string; logoUrl?: string | null } }) {
  const { detalle: d, documento: doc } = datos;
  const facturado = d.estado === 'facturada' && d.noFactura;
  // 029: aprobado por link → firma digital, casillas marcadas según lo que respondió el cliente
  const digital = d.aprobadoCanal === 'link' && !!d.respondidoEn && (d.estado === 'aprobada' || d.estado === 'facturada');
  const respuestas = new Map(datos.respuestas.filter(r => r.version === d.version).map(r => [r.componenteId, r] as const));
  // 032: con el papel firmado subido, el pie dice «Firmado en papel por …» y ya no va el bloque de firma en blanco
  const firmadoPapel = datos.archivos.find(a => a.vigente) ?? null;
  const paraRevisar = !facturado && d.estado !== 'anulada' && !digital && !firmadoPapel;
  const conCasillas = paraRevisar || digital;
  return (
    <main style={{ fontFamily: 'Georgia, "Times New Roman", serif', color: '#111', maxWidth: 820, margin: '0 auto', padding: '32px 28px', background: '#fff' }} data-imprimible data-estado={d.estado}>
      <style>{`
        @media print {
          .no-print { display: none !important; } body { margin: 0; } main { padding: 0 !important; max-width: none !important; } @page { size: letter portrait; margin: 14mm 12mm; }
          .doc-tabla thead { display: table-header-group; } .doc-tabla tfoot { display: table-row-group; }
          .doc-tabla tr { break-inside: avoid; page-break-inside: avoid; }
          .doc-firma { break-inside: avoid; page-break-inside: avoid; }
        }
        .doc-tabla { width: 100%; border-collapse: collapse; font-size: 10px; line-height: 1.25; table-layout: fixed; }
        .doc-tabla td, .doc-tabla th { overflow-wrap: anywhere; }
        .doc-tabla th { text-align: left; font-weight: 600; border-bottom: 1.5px solid #111; padding: 4px 4px; font-size: 9.5px; letter-spacing: .04em; text-transform: uppercase; }
        .doc-tabla td { padding: 4px 4px; border-bottom: 1px solid #ddd; vertical-align: top; }
        .doc-tabla td.nowrap, .doc-tabla th.nowrap { white-space: nowrap; }
        /* ancho fijo por columna (colgroup): la tabla nunca se sale de la hoja; el nombre completo hace wrap (el cliente tiene que leerlo entero) */
        .doc-tabla td.corta { white-space: normal; }
        .doc-tabla td.num, .doc-tabla th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .doc-tabla td.check, .doc-tabla th.check { white-space: nowrap; text-align: center; }
        .doc-mute { color: #666; font-size: 9.5px; }
        .cb { display: inline-block; width: 9px; height: 9px; border: 1px solid #111; vertical-align: -1px; margin-right: 3px; border-radius: 1px; background: #fff; position: relative; }
        .cb.on::after { content: ''; position: absolute; left: 1px; top: 1px; width: 5px; height: 5px; background: #111; }
        .doc-firma img { height: 54px; display: block; }
        .cb + .cb-lbl { margin-right: 7px; }
        .doc-firma { margin-top: 26px; border-top: 1px solid #111; padding-top: 10px; font-size: 11px; }
        .doc-firma .linea { display: inline-block; border-bottom: 1px solid #111; min-width: 220px; height: 16px; vertical-align: bottom; margin-left: 6px; }
        .doc-firma .campo { margin-top: 12px; }
      `}</style>
      <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 16 }}>
        <a href={`/por-facturar/detalle/${d.id}`} style={{ fontSize: 13, color: '#444', alignSelf: 'center' }}>← Volver al detalle</a>
        <ImprimirBoton />
      </div>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 24, borderBottom: '2px solid #111', paddingBottom: 12, marginBottom: 14 }}>
        <div>
          {emisor.logoUrl && <img src={emisor.logoUrl} alt={emisor.nombre} style={{ height: 46, width: 'auto', display: 'block', marginBottom: 8 }} data-logo />}
          <div style={{ fontSize: 17, fontWeight: 600 }}>{emisor.nombre}</div>
          {emisor.nit && <div className="doc-mute">NIT {emisor.nit}</div>}
          {emisor.direccion && <div className="doc-mute">{emisor.direccion}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{facturado ? `Detalle de la factura ${d.noFactura}` : 'Detalle de servicios'}</div>
          <div className="doc-mute">{facturado ? `Pre-liquidación ${d.correlativo}` : `Pre-liquidación · ${d.correlativo}`}</div>
          <div className="doc-mute">Fecha: {formatearFechaCorta(facturado && d.facturadoEn ? d.facturadoEn : d.createdAt)}</div>
          {!facturado && <div className="doc-mute" style={{ marginTop: 4 }}>Documento previo a la factura: no es una factura ni tiene número de SAT.</div>}
        </div>
      </header>
      <section style={{ marginBottom: 12, fontSize: 12 }} data-cliente>
        <div><strong>Cliente:</strong> {datos.clienteNombre}</div>
        <div><strong>NIT:</strong> {d.nit}{datos.empresaNombreExterno && datos.empresaNombreExterno !== datos.clienteNombre ? <span className="doc-mute"> · en la Agenda: {datos.empresaNombreExterno}</span> : null}</div>
        {d.titulo && <div data-titulo><strong>Corte:</strong> {d.titulo}</div>}
        {d.dirigidoA && <div data-dirigido-a><strong>Dirigido a:</strong> {d.dirigidoA}</div>}
        {d.aprobadaEn && <div className="doc-mute" data-aprobado>Aprobado por {d.aprobadoPor} ({d.aprobadoCanal}) el {formatearFechaCorta(d.aprobadaEn)}</div>}
      </section>
      <table className="doc-tabla" data-tabla-doc>
        <colgroup>
          <col style={{ width: 20 }} /><col /><col style={{ width: 80 }} /><col style={{ width: 62 }} /><col style={{ width: 104 }} /><col style={{ width: 72 }} /><col style={{ width: 42 }} />
          {conCasillas && <col style={{ width: 64 }} />}
          <col style={{ width: 56 }} />
          {conCasillas && <col style={{ width: 96 }} />}
        </colgroup>
        <thead><tr>
          <th>#</th><th>Persona</th><th>Solicitante</th><th>Ingreso</th><th>Prueba · resultado</th><th>Cat.</th><th>Terr.</th>
          {conCasillas && <th className="check" title={digital ? 'Lo que respondió el cliente por link' : 'Para que el cliente marque con lapicero'}>Conforme</th>}
          <th className="num" style={{ whiteSpace: 'normal' }}>Precio<br />IVA incl.</th>
          {conCasillas && <th className="obs">Observaciones</th>}
        </tr></thead>
        <tbody>
          {doc.incluidas.map((l, i) => (
            <tr key={l.componenteId || l.idExterno} data-linea>
              <td className="num">{i + 1}</td>
              <td className="corta" title={`${l.persona}${l.puesto ? ` · ${l.puesto}` : ''}`}>{l.persona}{l.puesto ? <span className="doc-mute"> · {l.puesto}</span> : null}</td>
              <td className="corta sol" data-solicitante={l.solicitante} title={l.solicitante || undefined}>{l.solicitante || '—'}</td>
              <td className="num">{l.fechaIngreso ? formatearFechaCorta(l.fechaIngreso) : '—'}</td>
              <td>{l.resultado || l.servicio}</td>
              <td>{l.categoria}</td><td className="nowrap">{territorioCorto(l.territorio)}</td>
              {conCasillas && (() => { const r = digital ? respuestas.get(l.componenteId) : undefined; const si = digital && r?.decision === 'aprobado'; const no = digital && !!r && r.decision !== 'aprobado'; return <td className="check" data-casillas data-marcada={si ? 'si' : no ? 'no' : ''}><span className={'cb' + (si ? ' on' : '')} aria-hidden /><span className="cb-lbl">Sí</span><span className={'cb' + (no ? ' on' : '')} aria-hidden /><span className="cb-lbl">No</span></td>; })()}
              <td className="num" data-precio-iva={l.montoConIva}>{Q(l.montoConIva)}</td>
              {conCasillas && <td className="obs" data-observaciones>{digital ? (respuestas.get(l.componenteId)?.nota ?? '') : ''}</td>}
            </tr>
          ))}
          {doc.incluidas.length === 0 && <tr><td colSpan={conCasillas ? 10 : 8} style={{ textAlign: 'center', padding: 20, color: '#666' }}>Ningún proceso con precio en este detalle.</td></tr>}
        </tbody>
        <tfoot>
          <tr><td colSpan={conCasillas ? 8 : 7} className="num" style={{ borderTop: '1.5px solid #111', borderBottom: 'none', fontWeight: 600, fontSize: 12.5, paddingTop: 8 }}>Total (IVA incluido)</td><td className="num" style={{ borderTop: '1.5px solid #111', borderBottom: 'none', fontWeight: 600, fontSize: 12.5, paddingTop: 8 }} data-total={doc.total}>{Q(doc.total)}</td>{conCasillas && <td style={{ borderTop: '1.5px solid #111', borderBottom: 'none' }} />}</tr>
          <tr><td colSpan={conCasillas ? 8 : 7} className="num doc-mute" style={{ borderBottom: 'none', paddingTop: 0 }} data-base={doc.subtotal} data-iva={doc.iva}>Base sin IVA {Q(doc.subtotal)} · IVA 12 % {Q(doc.iva)}</td><td style={{ borderBottom: 'none' }} />{conCasillas && <td style={{ borderBottom: 'none' }} />}</tr>
        </tfoot>
      </table>
      {doc.faltantes.length > 0 && (
        <section style={{ marginTop: 14, fontSize: 10.5 }} data-faltantes>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No incluidos en este detalle ({doc.faltantes.length})</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#555' }}>{doc.faltantes.map(l => <li key={l.componenteId || l.idExterno}>{l.persona} · {l.resultado || l.servicio} · {l.motivo}</li>)}</ul>
        </section>
      )}
      {d.notas && <section style={{ marginTop: 14, fontSize: 11 }}><strong>Notas:</strong> {d.notas}</section>}
      {digital && (
        <section className="doc-firma" data-firma-digital data-huella={d.documentoHash ?? ''}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Aprobado digitalmente</div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {d.firmaPng && /* eslint-disable-next-line @next/next/no-img-element */ <img src={d.firmaPng} alt={`Firma de ${d.respondidoPorNombre}`} />}
            <div style={{ fontSize: 11, lineHeight: 1.5 }}>
              <div><strong>{d.respondidoPorNombre || d.aprobadoPor}</strong>{d.respondidoPorCargo ? ` · ${d.respondidoPorCargo}` : ''}{d.respondidoPorCorreo ? ` · ${d.respondidoPorCorreo}` : ''}</div>
              <div>Aprobado digitalmente por {d.respondidoPorNombre || d.aprobadoPor} el {d.respondidoEn ? new Date(d.respondidoEn).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Guatemala' }) : formatearFechaCorta(d.aprobadaEn ?? d.createdAt)} · versión {d.version} · huella {huellaCorta(d.documentoHash)}</div>
              <div className="doc-mute">Las casillas reflejan lo que respondió el cliente en el link{[...respuestas.values()].some(r => r.decision !== 'aprobado') ? ` (${[...respuestas.values()].filter(r => r.decision !== 'aprobado').map(r => ETIQUETA_DECISION_DETALLE[r.decision]).join(', ')})` : ''}.</div>
            </div>
          </div>
        </section>
      )}
      {firmadoPapel && (
        <section className="doc-firma" data-firmado-papel>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Firmado en papel</div>
          <div style={{ fontSize: 11, lineHeight: 1.5 }}>Firmado en papel por <strong>{firmadoPapel.firmadoPor}</strong>{firmadoPapel.firmadoCargo ? ` · ${firmadoPapel.firmadoCargo}` : ''} el {formatearFechaCorta(firmadoPapel.firmadoFecha)} · respaldo en el sistema ({datos.archivos.filter(a => a.vigente).length === 1 ? '1 archivo' : `${datos.archivos.filter(a => a.vigente).length} archivos`}{firmadoPapel.notas ? ` · ${firmadoPapel.notas}` : ''})</div>
        </section>
      )}
      {paraRevisar && (
        <section className="doc-firma" data-firma>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Autorizado por el cliente</div>
          <div className="doc-mute">Marcá en cada línea si estás conforme (Sí / No) y anotá las observaciones. Con la firma se autoriza la facturación de este detalle por el total indicado.</div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <div className="campo">Nombre:<span className="linea" /></div>
            <div className="campo">Cargo:<span className="linea" /></div>
          </div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <div className="campo">Firma:<span className="linea" style={{ minWidth: 260, height: 34 }} /></div>
            <div className="campo">Fecha:<span className="linea" style={{ minWidth: 140 }} /></div>
          </div>
        </section>
      )}
      <footer className="doc-mute" style={{ marginTop: 22, borderTop: '1px solid #ddd', paddingTop: 6 }}>Montos en quetzales. Precios según el tarifario pactado con el cliente. {facturado ? '' : 'Al aprobarse este detalle se emite la factura electrónica (FEL/SAT) por el total indicado.'}</footer>
    </main>
  );
}
