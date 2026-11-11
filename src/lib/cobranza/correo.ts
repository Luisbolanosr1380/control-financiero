/**
 * CENTRO DE COBROS · PR 2 (035) · el correo de cobranza — PURO (sin IO). HTML sobrio, sin recursos externos (ni logo
 * remoto ni píxeles), mismo molde que el correo del detalle digital (029). El cuerpo que escribe la persona es TEXTO: se
 * escapa y se convierte en párrafos; {{estado_cuenta}} se reemplaza por la tabla (HTML) o el bloque (texto) y
 * {{datos_pago}} por el bloque editable.
 */
import { ETIQUETA_TRAMO, fechaLarga, renderPlantilla, textoEstadoCuenta, type EstadoCuenta } from './recordatorios';

export interface CorreoArmado { asunto: string; html: string; texto: string }

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const Q = (n: number) => `Q${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaCorta = (iso: string) => { if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const TD = 'padding:5px 8px;border-bottom:1px solid #e3e0d8;font-size:13px;vertical-align:top';
const TDN = `${TD};text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums`;
const TH = 'padding:5px 8px;border-bottom:1.5px solid #111;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;color:#444';

/** La tabla del estado de cuenta para el cuerpo del correo (sin estilos externos). */
export function htmlEstadoCuenta(ec: EstadoCuenta): string {
  const filas = ec.facturas.map(f => `<tr><td style="${TD}">${esc(f.noFactura)}</td><td style="${TDN}">${fechaCorta(f.fechaEmision)}</td><td style="${TDN}">${fechaCorta(f.fechaVencimiento)}</td><td style="${TDN};color:${f.diasVencida > 0 ? '#8a2a2a' : '#444'}">${f.diasVencida > 0 ? `${f.diasVencida} vencida` : f.diasVencida === 0 ? 'vence hoy' : `en ${-f.diasVencida}`}</td><td style="${TDN}">${Q(f.total)}</td><td style="${TDN}"><strong>${Q(f.saldo)}</strong></td></tr>`).join('');
  const tramos = ec.aging.filter(a => a.n > 0).map(a => `${esc(a.etiqueta)}: ${Q(a.monto)}`).join(' · ');
  const paquetes = ec.paquetes.length ? `<p style="margin:10px 0 0;font-size:12.5px;color:#444">${ec.paquetes.map(p => `Paquete prepagado <strong>${esc(p.correlativo)}</strong> · ${esc(p.nombre)}: ${p.usadas} usadas de ${p.cantidad}, <strong>${p.remanente} restantes</strong>${p.venceEn ? ` · vence ${fechaCorta(p.venceEn)}` : ''}`).join('<br>')}</p>` : '';
  return `<div style="margin:14px 0;border:1px solid #e3e0d8;padding:12px 14px;background:#faf9f6">
<div style="font-size:13px;font-weight:600;margin-bottom:6px">Estado de cuenta · ${esc(ec.cliente.nombre)} · al ${esc(fechaLarga(ec.hoy))}</div>
<table style="border-collapse:collapse;width:100%"><thead><tr><th style="${TH}">Factura</th><th style="${TH};text-align:right">Emisión</th><th style="${TH};text-align:right">Vence</th><th style="${TH};text-align:right">Días</th><th style="${TH};text-align:right">Total</th><th style="${TH};text-align:right">Saldo</th></tr></thead>
<tbody>${filas || `<tr><td colspan="6" style="${TD};color:#666">Sin facturas pendientes.</td></tr>`}</tbody>
<tfoot><tr><td colspan="5" style="${TD};border-bottom:0;text-align:right;font-weight:600">Saldo pendiente</td><td style="${TDN};border-bottom:0;font-weight:600">${Q(ec.totales.saldo)}</td></tr></tfoot></table>
<div style="font-size:12px;color:#444;margin-top:4px">Vencido: <strong style="color:${ec.totales.vencido > 0 ? '#8a2a2a' : '#111'}">${Q(ec.totales.vencido)}</strong> · Por vencer: ${Q(ec.totales.porVencer)}${tramos ? ` · ${tramos}` : ''}</div>
${paquetes}</div>`;
}

const parrafos = (texto: string) => texto.split(/\n{2,}/).map(p => `<p style="margin:0 0 12px;white-space:pre-line">${esc(p)}</p>`).join('');

const base = (titulo: string, cuerpo: string, pie: string) => `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f6f5f1;font-family:Georgia,'Times New Roman',serif;color:#111">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e3e0d8;padding:28px 30px">
<div style="font-size:18px;font-weight:600;margin-bottom:14px">${titulo}</div>
${cuerpo}
<div style="margin-top:22px;border-top:1px solid #e3e0d8;padding-top:10px;font-size:12px;color:#666">${pie}</div>
</div></body></html>`;

/**
 * Arma el correo: `cuerpo` es el texto ya revisado por la persona (puede traer {{estado_cuenta}} y {{datos_pago}});
 * `vars` son las variables del borrador (cliente, facturas, saldo…), por si la persona escribió una a mano.
 */
export function correoCobranza(p: { asunto: string; cuerpo: string; ec: EstadoCuenta; datosPago: string; vars: Record<string, string>; emisor: string; remitente: string }): CorreoArmado {
  const MARCA_EC = '\u0000EC\u0000';
  const datosPago = renderPlantilla(p.datosPago, p.vars).trim();
  const vars = { ...p.vars, datos_pago: datosPago, estado_cuenta: MARCA_EC };
  const asunto = renderPlantilla(p.asunto, vars).replace(MARCA_EC, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const cuerpoTexto = renderPlantilla(p.cuerpo, vars).trim();
  const texto = `${cuerpoTexto.replace(MARCA_EC, `\n${textoEstadoCuenta(p.ec)}\n`)}\n\n${p.remitente} · ${p.emisor}`;
  const html = cuerpoTexto.split(MARCA_EC).map(parrafos).join(htmlEstadoCuenta(p.ec));
  return { asunto, html: base(esc(asunto), html, `${esc(p.remitente)} · ${esc(p.emisor)}. Si ya realizó el pago, responda a este correo con la fecha y el banco para aplicarlo.`), texto };
}

export { ETIQUETA_TRAMO };
