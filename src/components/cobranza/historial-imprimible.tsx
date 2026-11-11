/**
 * CENTRO DE COBROS (033) · historial de cobranza de un cliente para imprimir / guardar como PDF (gerencia, reclamos).
 * Fuera del shell de la app: solo el documento, con el logo de la empresa (mismo dominio). Server component.
 */
import { Q, formatDateDDMMYYYY } from '@/lib/utils';
import { formatearFechaConHora } from '@/lib/utils/fechas';
import { ETIQUETA_CANAL, ETIQUETA_ESTADO_BASE, ETIQUETA_FORMA_PAGO, ETIQUETA_MODIFICADOR, ETIQUETA_PROMESA, ETIQUETA_RESULTADO, ETIQUETA_ROL_CONTACTO, ETIQUETA_TIPO_EVENTO } from '@/lib/cobranza/estado';
import type { EventoCobranza, FichaCobranza } from '@/lib/db/cobranza';

function describir(e: EventoCobranza): string {
  if (e.tipo === 'gestion') return `${ETIQUETA_CANAL[e.canal ?? 'nota']}${e.contactoNombre || e.contactoTexto ? ` a ${e.contactoNombre || e.contactoTexto}` : ''} · ${ETIQUETA_RESULTADO[e.resultado ?? 'contactado']}${e.comentario ? ` · ${e.comentario}` : ''}${e.disputaMotivo ? ` · motivo: ${e.disputaMotivo}` : ''}${e.proximoSeguimiento ? ` · seguimiento ${formatDateDDMMYYYY(e.proximoSeguimiento)}` : ''}`;
  if (e.tipo === 'promesa') return `Prometió ${e.monto ? Q(e.monto) : 'pagar'} para el ${e.fechaPromesa ? formatDateDDMMYYYY(e.fechaPromesa) : '—'} · ${ETIQUETA_PROMESA[e.promesaEstado ?? 'pendiente']}`;
  return `${e.comentario || ETIQUETA_TIPO_EVENTO[e.tipo]}${e.monto ? ` · ${Q(e.monto)}` : ''}`;
}

export function HistorialImprimible({ ficha: f, emisor }: { ficha: FichaCobranza; emisor: { nombre: string; logoUrl?: string | null } }) {
  const c = f.condiciones;
  const requisitos = [c.reqOrdenCompra && 'orden de compra', c.reqContrasena && `contraseña${c.reqContrasenaNota ? ` (${c.reqContrasenaNota})` : ''}`, c.reqPortal && 'portal de proveedores', c.reqDetalleAprobado && 'detalle aprobado antes de facturar'].filter(Boolean) as string[];
  return (
    <main className="doc" data-historial-imprimible={f.eventos.length}>
      <style>{`
        @media print { @page { size: letter; margin: 14mm 12mm; } .no-print { display: none !important; } .doc-fila { break-inside: avoid; } }
        .doc { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111; max-width: 820px; margin: 0 auto; padding: 18px; font-size: 12px; line-height: 1.4; }
        .doc h1 { font-size: 20px; margin: 0 0 2px; } .doc h2 { font-size: 13px; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1.5px solid #111; padding-bottom: 2px; }
        .doc table { width: 100%; border-collapse: collapse; } .doc th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #111; padding: 4px; } .doc td { padding: 4px; border-bottom: 1px solid #ddd; vertical-align: top; }
        .doc .num { text-align: right; font-variant-numeric: tabular-nums; } .doc .mute { color: #666; } .doc-fila { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 8px; padding: 5px 0; border-bottom: 1px solid #e5e5e5; }
        .doc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 10px; } .doc-head img { height: 44px; }
        .doc-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; } .doc-kpis div { border: 1px solid #ddd; padding: 6px 8px; } .doc-kpis b { display: block; font-size: 15px; }
      `}</style>
      <div className="doc-head">
        <div><h1>Historial de cobranza · {f.nombre}</h1><div className="mute">NIT {f.nit || '—'} · {emisor.nombre} · generado {formatDateDDMMYYYY(f.hoy)}</div></div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {emisor.logoUrl && <img src={emisor.logoUrl} alt={emisor.nombre} />}
      </div>
      <div className="doc-kpis">
        <div><span className="mute">Saldo pendiente</span><b className="num">{Q(f.saldo)}</b></div>
        <div><span className="mute">Vencido</span><b className="num">{Q(f.vencido)}</b></div>
        <div><span className="mute">Días de crédito</span><b>{c.diasCredito}</b></div>
        <div><span className="mute">Próximo seguimiento</span><b>{f.proximoSeguimiento ? formatDateDDMMYYYY(f.proximoSeguimiento) : '—'}</b></div>
      </div>
      <div><strong>Resumen:</strong> {f.resumen}</div>
      <h2>Condiciones de cobro</h2>
      <div>Día de pago: {c.diaPago || '—'} · Forma de pago: {c.formaPago ? ETIQUETA_FORMA_PAGO[c.formaPago] : '—'} · Requisitos: {requisitos.length ? requisitos.join(', ') : 'ninguno registrado'} · Responsable: {c.responsableCobro || 'sin asignar'}{c.instruccionesCobro ? ` · Notas: ${c.instruccionesCobro}` : ''}</div>
      <h2>Contactos de cobro</h2>
      <table><thead><tr><th>Nombre</th><th>Rol</th><th>Correo</th><th>Teléfono / WhatsApp</th><th>Último contacto</th></tr></thead>
        <tbody>{f.contactos.filter(x => x.activo).map(x => <tr key={x.id}><td>{x.nombre}{x.preferido ? ' ★' : ''}{x.cargo ? ` · ${x.cargo}` : ''}</td><td>{ETIQUETA_ROL_CONTACTO[x.rol]}</td><td>{x.correo || '—'}</td><td>{[x.telefono, x.whatsapp && `WA ${x.whatsapp}`].filter(Boolean).join(' · ') || '—'}</td><td>{f.ultimoContactoPorContacto[x.id] ? formatearFechaConHora(f.ultimoContactoPorContacto[x.id]) : '—'}</td></tr>)}</tbody></table>
      <h2>Facturas abiertas</h2>
      <table><thead><tr><th>Factura</th><th className="num">Emisión</th><th className="num">Vence</th><th className="num">Saldo</th><th>Estado</th><th>Promesa</th></tr></thead>
        <tbody>{f.facturas.map(x => <tr key={x.id}><td className="num">{x.noFactura}</td><td className="num">{formatDateDDMMYYYY(x.fechaEmision)}</td><td className="num">{x.estadoCobro.vence ? formatDateDDMMYYYY(x.estadoCobro.vence) : '—'}</td><td className="num">{Q(x.saldo)}</td><td>{[ETIQUETA_ESTADO_BASE[x.estadoCobro.estado], ...x.estadoCobro.modificadores.map(m => ETIQUETA_MODIFICADOR[m])].join(' · ')}{x.estadoCobro.diasVencida > 0 ? ` · ${x.estadoCobro.diasVencida} d` : ''}</td><td>{x.estadoCobro.promesaFecha ? `${formatDateDDMMYYYY(x.estadoCobro.promesaFecha)} · ${ETIQUETA_PROMESA[x.estadoCobro.promesaEstado ?? 'pendiente']}` : '—'}</td></tr>)}</tbody></table>
      <h2>Historial ({f.eventos.length})</h2>
      {f.eventos.map(e => (
        <div key={e.id} className="doc-fila">
          <div className="mute">{formatearFechaConHora(e.fecha)}<br /><span style={{ fontSize: 10.5 }}>{ETIQUETA_TIPO_EVENTO[e.tipo]}{e.origen === 'automatico' ? '' : ` · ${e.creadoPor}`}</span></div>
          <div>{describir(e)}{e.facturas.length ? <span className="mute"> · {e.facturas.join(', ')}</span> : null}{e.adjuntos.length ? <span className="mute"> · {e.adjuntos.length} adjunto{e.adjuntos.length === 1 ? '' : 's'}</span> : null}</div>
        </div>
      ))}
      {f.eventos.length === 0 && <div className="mute">Sin eventos registrados.</div>}
    </main>
  );
}
