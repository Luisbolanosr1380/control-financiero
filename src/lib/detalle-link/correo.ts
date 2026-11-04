/**
 * DETALLE DIGITAL (029) · correos — PURO (sin IO). HTML sobrio, sin recursos externos, sin nombres de candidatos
 * en el asunto. Dos piezas: el envío al cliente (link + vencimiento) y el aviso de vuelta a Finanzas.
 */

export interface CorreoArmado { asunto: string; html: string; texto: string }

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const Q = (n: number) => `Q${Number(n).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaGt = (iso: string) => new Date(iso).toLocaleDateString('es-GT', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Guatemala' });
const mesGt = (d: Date) => { const s = d.toLocaleDateString('es-GT', { month: 'short', year: 'numeric', timeZone: 'America/Guatemala' }).replace('.', ''); return s.charAt(0).toUpperCase() + s.slice(1); };

export function asuntoEnvio(correlativo: string, emisor: string, fecha: Date = new Date()): string {
  return `Detalle de servicios ${correlativo} · ${emisor} · ${mesGt(fecha)}`;
}

export function asuntoAviso(correlativo: string, cliente: string, estado: 'aprobada' | 'con_observaciones', observaciones: number): string {
  return estado === 'aprobada' ? `${correlativo} · ${cliente} aprobó y firmó el detalle` : `${correlativo} · ${cliente} mandó ${observaciones} ${observaciones === 1 ? 'observación' : 'observaciones'}`;
}

const base = (titulo: string, cuerpo: string, pie: string) => `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f6f5f1;font-family:Georgia,'Times New Roman',serif;color:#111">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e0d8;padding:28px 30px">
<div style="font-size:19px;font-weight:600;margin-bottom:14px">${titulo}</div>
${cuerpo}
<div style="margin-top:26px;border-top:1px solid #e3e0d8;padding-top:10px;font-size:12px;color:#666">${pie}</div>
</div></body></html>`;

/** Correo al cliente con el link de aprobación. `mensaje` es el texto corto editable de quien envía. */
export function correoEnvio(p: { correlativo: string; version: number; cliente: string; emisor: string; titulo: string; dirigidoA: string; pruebas: number; total: number; link: string; expiraEn: string; mensaje: string; remitenteNombre: string }): CorreoArmado {
  const asunto = asuntoEnvio(p.correlativo, p.emisor);
  const saludo = p.dirigidoA ? `Estimado/a ${esc(p.dirigidoA)}:` : 'Estimados:';
  const corregida = p.version > 1 ? `<p style="margin:0 0 10px;color:#8a2a2a"><strong>Versión ${p.version} · corregida.</strong> Esta versión responde a sus observaciones; las líneas que siguen aparecen aprobadas por defecto.</p>` : '';
  const cuerpo = `
<p style="margin:0 0 12px">${saludo}</p>
${corregida}
${p.mensaje ? `<p style="margin:0 0 14px;white-space:pre-line">${esc(p.mensaje)}</p>` : ''}
<table style="border-collapse:collapse;font-size:14px;margin:0 0 18px">
<tr><td style="padding:3px 12px 3px 0;color:#666">Cliente</td><td style="padding:3px 0">${esc(p.cliente)}</td></tr>
${p.titulo ? `<tr><td style="padding:3px 12px 3px 0;color:#666">Corte</td><td style="padding:3px 0">${esc(p.titulo)}</td></tr>` : ''}
<tr><td style="padding:3px 12px 3px 0;color:#666">Detalle</td><td style="padding:3px 0">${esc(p.correlativo)}${p.version > 1 ? ` · versión ${p.version}` : ''}</td></tr>
<tr><td style="padding:3px 12px 3px 0;color:#666">Pruebas</td><td style="padding:3px 0">${p.pruebas}</td></tr>
<tr><td style="padding:3px 12px 3px 0;color:#666">Total con IVA</td><td style="padding:3px 0"><strong>${Q(p.total)}</strong></td></tr>
</table>
<p style="margin:0 0 18px"><a href="${esc(p.link)}" style="display:inline-block;background:#1a3b33;color:#fff;text-decoration:none;padding:11px 18px;font-size:15px">Revisar y aprobar</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#444">El link es personal, vence el <strong>${esc(fechaGt(p.expiraEn))}</strong> y se usa una sola vez. En cada línea podés aprobar, pedir corrección, pedir que se cobre el próximo mes o marcar que no aplica. Si todo está bien, firmás ahí mismo.</p>
<p style="margin:0;font-size:12px;color:#777">Si el botón no abre, copiá esta dirección: ${esc(p.link)}</p>`;
  const texto = `${saludo}\n\n${p.mensaje ? p.mensaje + '\n\n' : ''}Detalle de servicios ${p.correlativo}${p.version > 1 ? ` · versión ${p.version} (corregida)` : ''}\nCliente: ${p.cliente}\n${p.titulo ? `Corte: ${p.titulo}\n` : ''}Pruebas: ${p.pruebas}\nTotal con IVA: ${Q(p.total)}\n\nRevisar y aprobar: ${p.link}\n\nEl link es personal, vence el ${fechaGt(p.expiraEn)} y se usa una sola vez.\n\n${p.remitenteNombre} · ${p.emisor}`;
  return { asunto, html: base(`Detalle de servicios ${esc(p.correlativo)}`, cuerpo, `${esc(p.remitenteNombre)} · ${esc(p.emisor)}. Documento previo a la factura: no es una factura ni tiene número de SAT.`), texto };
}

/** Aviso a Finanzas cuando el cliente responde. */
export function correoAviso(p: { correlativo: string; cliente: string; estado: 'aprobada' | 'con_observaciones'; observaciones: number; nombre: string; cargo: string; respondidoEn: string; linkFinanzas: string; total: number; version: number }): CorreoArmado {
  const asunto = asuntoAviso(p.correlativo, p.cliente, p.estado, p.observaciones);
  const que = p.estado === 'aprobada' ? `<strong>aprobó y firmó</strong> el detalle ${esc(p.correlativo)}${p.version > 1 ? ` (versión ${p.version})` : ''} por ${Q(p.total)} con IVA. Ya se puede facturar.` : `mandó <strong>${p.observaciones} ${p.observaciones === 1 ? 'observación' : 'observaciones'}</strong> sobre el detalle ${esc(p.correlativo)}${p.version > 1 ? ` (versión ${p.version})` : ''}. Hay que revisarlas, corregir y reenviar la versión corregida.`;
  const cuerpo = `<p style="margin:0 0 12px">${esc(p.cliente)} ${que}</p>
<p style="margin:0 0 12px;font-size:13px;color:#444">Respondió ${esc(p.nombre || '—')}${p.cargo ? ` (${esc(p.cargo)})` : ''} el ${esc(fechaGt(p.respondidoEn))}.</p>
<p style="margin:0"><a href="${esc(p.linkFinanzas)}" style="display:inline-block;background:#1a3b33;color:#fff;text-decoration:none;padding:10px 16px;font-size:14px">Abrir el detalle en Finanzas</a></p>`;
  const texto = `${p.cliente} ${p.estado === 'aprobada' ? 'aprobó y firmó' : `mandó ${p.observaciones} observación(es) sobre`} el detalle ${p.correlativo}.\nRespondió ${p.nombre || '—'}${p.cargo ? ` (${p.cargo})` : ''} el ${fechaGt(p.respondidoEn)}.\n\n${p.linkFinanzas}`;
  return { asunto, html: base(asunto.replace(/^.*? · /, ''), cuerpo, 'Aviso automático de Finanzas.'), texto };
}

/** Texto listo para pegar cuando no hay correo configurado ("copiar link"). */
export function textoCopiarLink(p: { correlativo: string; cliente: string; emisor: string; titulo: string; pruebas: number; total: number; link: string; expiraEn: string; version: number }): string {
  return `Detalle de servicios ${p.correlativo}${p.version > 1 ? ` · versión ${p.version} (corregida)` : ''} · ${p.emisor}\nCliente: ${p.cliente}${p.titulo ? `\nCorte: ${p.titulo}` : ''}\nPruebas: ${p.pruebas} · Total con IVA: ${Q(p.total)}\n\nRevisar y aprobar: ${p.link}\n\nEl link es personal, vence el ${fechaGt(p.expiraEn)} y se usa una sola vez.`;
}
