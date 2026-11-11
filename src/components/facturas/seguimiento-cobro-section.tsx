'use client';

/**
 * SEGUIMIENTO DE COBRO · sección de /facturacion/[id], debajo de los totales. Visible abierta en facturas no cobradas y
 * plegada (como historial) en las cobradas. Encabezado: estado de cobro con modificadores (igual que la lista), promesa
 * vigente, próximo seguimiento, responsable de cobro y contacto preferido con llamar / WhatsApp / correo. Historial de
 * ESTA factura (los eventos que la nombran), del más nuevo al más viejo, con el interruptor «incluir lo general del
 * cliente». «Registrar seguimiento» abre el MISMO formulario del Centro de Cobros con esta factura preseleccionada;
 * solo quien tiene gestionar_cobranza ve el botón (la acción vuelve a validar en el servidor).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q, formatDateDDMMYYYY } from '@/lib/utils';
import { formatearFechaConHora } from '@/lib/utils/fechas';
import { usePuede } from '@/components/auth/permisos';
import { GestionForm } from '@/components/cobranza/gestion-form';
import { ETIQUETA_CANAL, ETIQUETA_ESTADO_BASE, ETIQUETA_MODIFICADOR, ETIQUETA_PROMESA, ETIQUETA_RESULTADO, ETIQUETA_TIPO_EVENTO, BADGE_ESTADO_BASE } from '@/lib/cobranza/estado';
import { fechaCorta } from '@/lib/cobranza/seguimiento';
import type { SeguimientoDeFactura } from '@/lib/db/cobranza-facturas';
import type { EventoCobranza as Ev } from '@/lib/db/cobranza';

const telHref = (t: string) => `tel:${t.replace(/[^\d+]/g, '')}`;
const waHref = (t: string) => { const d = t.replace(/\D/g, ''); return `https://wa.me/${d.length <= 8 ? '502' + d : d}`; };

function describir(e: Ev): string {
  if (e.tipo === 'gestion') return `${ETIQUETA_CANAL[e.canal ?? 'nota']}${e.contactoNombre || e.contactoTexto ? ` a ${e.contactoNombre || e.contactoTexto}` : ''} · ${ETIQUETA_RESULTADO[e.resultado ?? 'contactado']}${e.comentario ? ` · ${e.comentario}` : ''}${e.disputaMotivo ? ` · motivo: ${e.disputaMotivo}` : ''}${e.proximoSeguimiento ? ` · seguimiento ${formatDateDDMMYYYY(e.proximoSeguimiento)}${e.seguimientoHechoEn ? ' (hecho)' : ''}` : ''}`;
  if (e.tipo === 'promesa') return `Prometió ${e.monto ? Q(e.monto) : 'pagar'} para el ${e.fechaPromesa ? formatDateDDMMYYYY(e.fechaPromesa) : '—'} · ${ETIQUETA_PROMESA[e.promesaEstado ?? 'pendiente']}`;
  return `${e.comentario || ETIQUETA_TIPO_EVENTO[e.tipo]}${e.monto ? ` · ${Q(e.monto)}` : ''}`;
}

export function SeguimientoCobroSection({ datos: d }: { datos: SeguimientoDeFactura }) {
  const puede = usePuede();
  const router = useRouter();
  const s = d.seguimiento;
  const cobrada = s.estado.cobrada || s.estado.estado === 'anulada';
  const [abierta, setAbierta] = useState(!cobrada);
  const [conCliente, setConCliente] = useState(false);
  const [form, setForm] = useState(false);
  const eventos: Ev[] = (conCliente ? [...d.eventosFactura, ...d.eventosCliente] : d.eventosFactura).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const pref = d.contactoPreferido;

  return (
    <div className="card" style={{ marginBottom: 22 }} data-seguimiento-cobro={d.eventosFactura.length} data-badge={s.badge?.clave ?? ''}>
      <div className="card-head" style={{ cursor: cobrada ? 'pointer' : undefined }} onClick={cobrada ? () => setAbierta(v => !v) : undefined}>
        <div className="card-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          Seguimiento de cobro
          <span className={'badge ' + BADGE_ESTADO_BASE[s.estado.estado]} data-estado-cobro={s.estado.estado}>{ETIQUETA_ESTADO_BASE[s.estado.estado]}{s.estado.diasVencida > 0 && !cobrada ? ` · ${s.estado.diasVencida} d` : ''}</span>
          {s.estado.modificadores.map(m => <span key={m} className="badge badge-outline" data-modificador={m}>{ETIQUETA_MODIFICADOR[m]}</span>)}
          {s.badge && s.badge.clave !== 'promesa' && <span className={'badge ' + s.badge.cls} data-badge-texto title={s.badges.map(b => b.texto).join(' · ')}>{s.badge.texto}</span>}
        </div>
        <div className="card-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href={`/cobranza/${d.clienteId}`} className="btn btn-ghost" style={{ fontSize: 12 }} data-accion="ver-ficha-cobranza" onClick={e => e.stopPropagation()}><I.Users size={12} /> Ver ficha de cobranza del cliente</Link>
          {puede('gestionar_cobranza') && !cobrada && <button type="button" className="btn btn-primary" style={{ fontSize: 12 }} onClick={e => { e.stopPropagation(); setForm(true); }} data-accion="registrar-seguimiento"><I.Plus size={12} /> Registrar seguimiento</button>}
          {cobrada && <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={e => { e.stopPropagation(); setAbierta(v => !v); }} aria-expanded={abierta} data-accion="plegar-seguimiento">{abierta ? <I.ChevUp size={13} /> : <I.ChevDown size={13} />} {abierta ? 'Plegar' : `Historial (${d.eventosFactura.length})`}</button>}
        </div>
      </div>
      {abierta && (
        <div className="card-pad" style={{ display: 'grid', gap: 12, fontSize: 12.5 }}>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }} data-encabezado-seguimiento>
            <div><div className="kpi-label">Promesa vigente</div><div data-promesa-vigente={s.promesa ? s.promesa.fecha : ''} style={{ color: s.promesa?.estado === 'incumplida' || (s.promesa && s.promesa.fecha < d.hoy) ? 'var(--wine)' : 'var(--ink)' }}>{s.promesa ? `${s.promesa.monto ? Q(s.promesa.monto) : 'pagar'} el ${fechaCorta(s.promesa.fecha, d.hoy)}${s.promesa.fecha === d.hoy ? ' (hoy)' : ''} · ${ETIQUETA_PROMESA[s.promesa.estado]}` : 'sin promesa'}</div></div>
            <div><div className="kpi-label">Próximo seguimiento</div><div data-proximo-seguimiento={s.proximoSeguimiento ?? ''} style={{ color: s.proximoSeguimiento && s.proximoSeguimiento < d.hoy ? 'var(--wine)' : 'var(--ink)' }}>{s.proximoSeguimiento ? `${fechaCorta(s.proximoSeguimiento, d.hoy)}${s.proximoSeguimiento < d.hoy ? ' (atrasado)' : s.proximoSeguimiento === d.hoy ? ' (hoy)' : ''}` : '—'}</div></div>
            <div><div className="kpi-label">Responsable de cobro</div><div data-responsable>{d.responsable || <span className="cell-mute">sin asignar</span>}</div></div>
            <div>
              <div className="kpi-label">Contacto preferido</div>
              {pref ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} data-contacto-preferido>
                  <span title={pref.cargo || undefined}>{pref.nombre}</span>
                  {pref.telefono && <a className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: 11 }} href={telHref(pref.telefono)} title={`Llamar ${pref.telefono}`} data-accion="llamar"><I.Phone size={12} /></a>}
                  {pref.whatsapp && <a className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: 11 }} href={waHref(pref.whatsapp)} target="_blank" rel="noreferrer" title={`WhatsApp ${pref.whatsapp}`} data-accion="whatsapp"><I.Send size={12} /></a>}
                  {pref.correo && <a className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: 11 }} href={`mailto:${pref.correo}`} title={pref.correo} data-accion="correo"><I.Mail size={12} /></a>}
                </div>
              ) : <span className="cell-mute">sin contacto de cobro</span>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--line-3)', paddingTop: 10 }}>
            <strong style={{ fontSize: 12 }}>Historial de esta factura ({d.eventosFactura.length})</strong>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>
              <input type="checkbox" checked={conCliente} onChange={e => setConCliente(e.target.checked)} data-campo="incluir-cliente" /> incluir lo general del cliente ({d.eventosCliente.length})
            </label>
          </div>
          {eventos.length === 0 ? <div className="cell-mute" data-sin-eventos>Sin gestiones registradas para esta factura.</div> : (
            <div style={{ display: 'grid', gap: 4 }} data-historial-factura={eventos.length}>
              {eventos.map(e => (
                <div key={e.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 130px) minmax(0, 1fr)', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--line-3)' }} data-evento={e.tipo} data-evento-id={e.id} data-general={e.facturas.length === 0 ? '1' : '0'}>
                  <div className="cell-mute" style={{ fontSize: 11 }}>{formatearFechaConHora(e.fecha)}<br /><span>{ETIQUETA_TIPO_EVENTO[e.tipo]}{e.origen === 'automatico' ? '' : ` · ${e.creadoPor}`}</span>{e.facturas.length === 0 && <span className="badge badge-mute" style={{ marginLeft: 4, fontSize: 9.5 }}>general</span>}</div>
                  <div>{describir(e)}{e.adjuntos.length > 0 && <span className="cell-mute"> · {e.adjuntos.map(a => <a key={a.id} href={`/api/cobranza-adjunto/${a.id}`} target="_blank" rel="noreferrer" style={{ marginLeft: 4, textDecoration: 'underline' }}>{a.nombre}</a>)}</span>}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {form && (
        <GestionForm
          clienteId={d.clienteId} clienteNombre={d.clienteNombre} contactos={d.contactos}
          facturas={[{ noFactura: d.noFactura, saldo: d.saldo, diasVencidos: s.estado.diasVencida }]} facturasPre={[d.noFactura]}
          onClose={() => setForm(false)}
          onListo={msg => { setForm(false); toast.success(msg); router.refresh(); }}
        />
      )}
    </div>
  );
}
