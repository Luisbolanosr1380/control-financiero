'use client';

/**
 * CENTRO DE COBROS (033) · ficha de cobranza del cliente: responde «¿con quién hablo? ¿qué pasó? ¿ya le mandé correo?
 * ¿qué fecha me dio?» en una sola pantalla. Encabezado (saldo, vencido, crédito, condiciones, responsable, próximo
 * seguimiento), contactos con acciones rápidas y último contacto con cada uno, facturas abiertas con su estado
 * calculado, resumen en una línea (datos, no IA) y el historial completo con filtros y buscador. 390 px.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { HelpButton } from '@/components/ayuda/help-button';
import { Q, formatDateDDMMYYYY } from '@/lib/utils';
import { formatearFechaConHora } from '@/lib/utils/fechas';
import { crearContactoCobroAction, desactivarContactoCobroAction, editarCondicionesCobroAction, editarContactoCobroAction, marcarSeguimientoHechoAction } from '@/app/(app)/cobranza/actions';
import { BADGE_ESTADO_BASE, ETIQUETA_CANAL, ETIQUETA_ESTADO_BASE, ETIQUETA_FORMA_PAGO, ETIQUETA_MODIFICADOR, ETIQUETA_PROMESA, ETIQUETA_RESULTADO, ETIQUETA_ROL_CONTACTO, ETIQUETA_TIPO_EVENTO, FORMAS_PAGO, ROLES_CONTACTO, type FormaPago, type RolContacto, type TipoEvento } from '@/lib/cobranza/estado';
import type { CondicionesCobro, ContactoCobro, EventoCobranza, FichaCobranza } from '@/lib/db/cobranza';
import { GestionForm } from './gestion-form';
import { ContactoRapido } from './bandeja-client';
import { EstadoCuentaEnviar } from './estado-cuenta-enviar';

const ICONO_TIPO: Record<TipoEvento, string> = { gestion: '☎', promesa: '🤝', correo_enviado: '✉', correo_recibido: '📩', correo_copiado: '📨', factura_emitida: '🧾', cobro_recibido: '💵', detalle_enviado: '📄', detalle_aprobado: '✅', detalle_observaciones: '✏', cambio_condicion: '⚙' };

function describirEvento(e: EventoCobranza): string {
  switch (e.tipo) {
    case 'gestion': return `${ETIQUETA_CANAL[e.canal ?? 'nota']}${e.contactoNombre || e.contactoTexto ? ` a ${e.contactoNombre || e.contactoTexto}` : ''} · ${ETIQUETA_RESULTADO[e.resultado ?? 'contactado']}${e.comentario ? ` · ${e.comentario}` : ''}${e.disputaMotivo ? ` · motivo: ${e.disputaMotivo}` : ''}${e.proximoSeguimiento ? ` · seguimiento ${formatDateDDMMYYYY(e.proximoSeguimiento)}${e.seguimientoHechoEn ? ' (hecho)' : ''}` : ''}`;
    case 'promesa': return `Prometió ${e.monto ? Q(e.monto) : 'pagar'} para el ${e.fechaPromesa ? formatDateDDMMYYYY(e.fechaPromesa) : '—'} · ${ETIQUETA_PROMESA[e.promesaEstado ?? 'pendiente']}`;
    default: return `${e.comentario || ETIQUETA_TIPO_EVENTO[e.tipo]}${e.monto ? ` · ${Q(e.monto)}` : ''}`;
  }
}

export function FichaCobranzaClient({ ficha, email }: { ficha: FichaCobranza; email: string }) {
  const router = useRouter();
  const puedeGestionar = usePuede()('gestionar_cobranza');
  const f = ficha, c = ficha.condiciones;
  const [gestion, setGestion] = useState<{ facturas: string[] } | null>(null);
  const [enviandoEC, setEnviandoEC] = useState(false);   // 035: enviar estado de cuenta
  const [editandoCond, setEditandoCond] = useState(false);
  const [cond, setCond] = useState<CondicionesCobro>(c);
  const [contactoEdit, setContactoEdit] = useState<Partial<ContactoCobro> | null>(null);
  const [verInactivos, setVerInactivos] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<TipoEvento | 'todos'>('todos');
  const [filtroFactura, setFiltroFactura] = useState('');
  const [filtroContacto, setFiltroContacto] = useState('');
  const [buscar, setBuscar] = useState('');
  const [busy, setBusy] = useState(false);

  const correr = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string) => {
    setBusy(true);
    try { const r = await fn(); if (r.ok) { toast.success(exito); router.refresh(); } else toast.error(r.error); return r.ok; } finally { setBusy(false); }
  };
  const eventos = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return f.eventos.filter(e => (filtroTipo === 'todos' || e.tipo === filtroTipo) && (!filtroFactura || e.facturas.includes(filtroFactura)) && (!filtroContacto || e.contactoId === filtroContacto) && (!q || describirEvento(e).toLowerCase().includes(q) || e.creadoPor.toLowerCase().includes(q) || e.facturas.join(' ').toLowerCase().includes(q)));
  }, [f.eventos, filtroTipo, filtroFactura, filtroContacto, buscar]);
  const activos = f.contactos.filter(x => x.activo), inactivos = f.contactos.filter(x => !x.activo);
  const requisitos = [c.reqOrdenCompra && 'orden de compra', c.reqContrasena && `contraseña${c.reqContrasenaNota ? ` (${c.reqContrasenaNota})` : ''}`, c.reqPortal && `portal de proveedores${c.portalUsuario ? ` (usuario: ${c.portalUsuario})` : ''}`, c.reqDetalleAprobado && 'detalle aprobado antes de facturar'].filter(Boolean) as string[];

  const guardarContacto = async () => {
    if (!contactoEdit) return;
    const input = { nombre: contactoEdit.nombre ?? '', cargo: contactoEdit.cargo, rol: contactoEdit.rol ?? 'otro', correo: contactoEdit.correo, telefono: contactoEdit.telefono, whatsapp: contactoEdit.whatsapp, preferido: contactoEdit.preferido, notas: contactoEdit.notas };
    const ok = await correr(async () => { const r = contactoEdit.id ? await editarContactoCobroAction(contactoEdit.id, input, f.clienteId) : await crearContactoCobroAction(f.clienteId, input); return r.ok ? { ok: true } : r; }, contactoEdit.id ? 'Contacto actualizado' : 'Contacto creado');
    if (ok) setContactoEdit(null);
  };

  return (
    <div className="page" data-ficha-cobranza={f.clienteId}>
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}><Link href="/cobranza" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Centro de Cobros</Link> · <Link href={`/clientes/${encodeURIComponent(f.clienteId)}`} style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>ficha del cliente</Link></div>
          <h1 className="page-title">{f.nombre} <HelpButton tag="modulo-cobranza" /></h1>
          <div className="page-subtitle"><span className="num">NIT {f.nit || '—'}</span> · {c.diasCredito} días de crédito · responsable {c.responsableCobro ? (c.responsableCobro === email ? 'vos' : c.responsableCobro) : <span style={{ color: 'var(--wine)' }}>sin asignar</span>}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn btn-secondary" href={`/imprimir/cobranza/${encodeURIComponent(f.clienteId)}`} target="_blank" rel="noopener" data-accion="exportar-pdf"><I.Print size={13} /> Historial PDF</a>
          <a className="btn btn-secondary" href={`/imprimir/estado-cuenta/${encodeURIComponent(f.clienteId)}`} target="_blank" rel="noopener" data-accion="estado-cuenta-pdf" title="Facturas abiertas con antigüedad y saldo real, para el cliente"><I.Receipt size={13} /> Estado de cuenta</a>
          {puedeGestionar && <button type="button" className="btn btn-secondary" onClick={() => setEnviandoEC(true)} data-accion="enviar-estado-cuenta"><I.Mail size={13} /> Enviar estado de cuenta</button>}
          {puedeGestionar && <button type="button" className="btn btn-primary" onClick={() => setGestion({ facturas: [] })} data-accion="registrar-gestion"><I.Plus size={13} /> Registrar gestión</button>}
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi" data-kpi="saldo"><div className="kpi-label">Saldo pendiente</div><div className="kpi-value">{Q(f.saldo)}</div><div className="kpi-delta"><span className="vs">{f.facturas.filter(x => !x.cedida).length} facturas abiertas</span></div></div>
        <div className="kpi" data-kpi="vencido"><div className="kpi-label">Vencido</div><div className="kpi-value" style={{ color: f.vencido > 0 ? 'var(--wine)' : undefined }}>{Q(f.vencido)}</div><div className="kpi-delta"><span className="vs">{f.facturas.filter(x => x.vencida && !x.cedida).length} vencidas</span></div></div>
        <div className="kpi" data-kpi="promesa"><div className="kpi-label">Promesa vigente</div><div className="kpi-value" style={{ fontSize: 18 }}>{f.promesaVigente ? formatDateDDMMYYYY(f.promesaVigente.fecha) : '—'}</div><div className="kpi-delta"><span className="vs">{f.promesaVigente ? (f.promesaVigente.monto ? Q(f.promesaVigente.monto) : f.promesaVigente.facturas.join(', ') || 'sin monto') : 'sin promesa'}</span></div></div>
        <div className="kpi" data-kpi="seguimiento"><div className="kpi-label">Próximo seguimiento</div><div className="kpi-value" style={{ fontSize: 18, color: f.proximoSeguimiento && f.proximoSeguimiento < f.hoy ? 'var(--wine)' : undefined }}>{f.proximoSeguimiento ? formatDateDDMMYYYY(f.proximoSeguimiento) : '—'}</div><div className="kpi-delta"><span className="vs">{f.proximoSeguimiento ? (f.proximoSeguimiento < f.hoy ? 'atrasado' : f.proximoSeguimiento === f.hoy ? 'hoy' : 'programado') : 'sin programar'}</span></div></div>
      </div>

      {/* condiciones y requisitos */}
      <div className="card" style={{ marginBottom: 14 }} data-condiciones>
        <div className="card-head"><div className="card-title">Cómo le cobramos</div><div className="card-actions">{puedeGestionar && !editandoCond && <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setCond(c); setEditandoCond(true); }} data-accion="editar-condiciones"><I.Edit size={12} /> Editar</button>}</div></div>
        {!editandoCond ? (
          <div className="card-pad" style={{ fontSize: 13, display: 'grid', gap: 4 }}>
            <div><span className="cell-mute">Día de pago:</span> {c.diaPago || '—'} · <span className="cell-mute">Forma de pago:</span> {c.formaPago ? ETIQUETA_FORMA_PAGO[c.formaPago] : '—'} · <span className="cell-mute">Crédito:</span> {c.diasCredito} días</div>
            <div data-requisitos><span className="cell-mute">Requisitos para pagar:</span> {requisitos.length ? requisitos.join(' · ') : 'ninguno registrado'}{c.reqPortal && c.portalUrl ? <> · <a href={c.portalUrl} target="_blank" rel="noopener">portal</a></> : null}</div>
            {c.instruccionesCobro && <div><span className="cell-mute">Notas:</span> {c.instruccionesCobro}</div>}
          </div>
        ) : (
          <div className="card-pad" style={{ display: 'grid', gap: 10, fontSize: 13 }} data-form-condiciones>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label style={{ display: 'grid', gap: 4 }}>Día o semana de pago <input className="input" value={cond.diaPago} onChange={e => setCond({ ...cond, diaPago: e.target.value })} placeholder="pagan jueves / cierre el 25" maxLength={120} data-campo="dia-pago" /></label>
              <label style={{ display: 'grid', gap: 4 }}>Forma de pago habitual <select className="input" value={cond.formaPago ?? ''} onChange={e => setCond({ ...cond, formaPago: (e.target.value || null) as FormaPago | null })} data-campo="forma-pago"><option value="">—</option>{FORMAS_PAGO.map(x => <option key={x} value={x}>{ETIQUETA_FORMA_PAGO[x]}</option>)}</select></label>
              <label style={{ display: 'grid', gap: 4 }}>Responsable de cobro (correo) <input className="input" value={cond.responsableCobro} onChange={e => setCond({ ...cond, responsableCobro: e.target.value })} placeholder={email} maxLength={200} data-campo="responsable" /></label>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={cond.reqOrdenCompra} onChange={e => setCond({ ...cond, reqOrdenCompra: e.target.checked })} data-campo="req-oc" /> Pide orden de compra</label>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><input type="checkbox" checked={cond.reqContrasena} onChange={e => setCond({ ...cond, reqContrasena: e.target.checked })} data-campo="req-contrasena" /> Contraseña / recepción de facturas {cond.reqContrasena && <input className="input" value={cond.reqContrasenaNota} onChange={e => setCond({ ...cond, reqContrasenaNota: e.target.value })} placeholder="la contraseña la dan al recibir la factura física" maxLength={300} style={{ minWidth: 260, flex: 1 }} data-campo="contrasena-nota" />}</label>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><input type="checkbox" checked={cond.reqPortal} onChange={e => setCond({ ...cond, reqPortal: e.target.checked })} data-campo="req-portal" /> Portal de proveedores {cond.reqPortal && <><input className="input" value={cond.portalUrl} onChange={e => setCond({ ...cond, portalUrl: e.target.value })} placeholder="https://…" maxLength={300} style={{ minWidth: 220, flex: 1 }} data-campo="portal-url" /><input className="input" value={cond.portalUsuario} onChange={e => setCond({ ...cond, portalUsuario: e.target.value })} placeholder="quién tiene el usuario (nunca la clave)" maxLength={200} style={{ minWidth: 220, flex: 1 }} data-campo="portal-usuario" /></>}</label>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={cond.reqDetalleAprobado} onChange={e => setCond({ ...cond, reqDetalleAprobado: e.target.checked })} data-campo="req-detalle" /> Detalle aprobado antes de facturar</label>
            </div>
            <label style={{ display: 'grid', gap: 4 }}>Notas libres <textarea className="input" value={cond.instruccionesCobro} onChange={e => setCond({ ...cond, instruccionesCobro: e.target.value })} rows={2} maxLength={2000} data-campo="instrucciones" /></label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditandoCond(false)} disabled={busy}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => void correr(() => editarCondicionesCobroAction(f.clienteId, cond).then(r => (r.ok ? { ok: true as const } : r)), 'Condiciones guardadas').then(ok => { if (ok) setEditandoCond(false); })} disabled={busy} data-accion="guardar-condiciones">Guardar</button>
            </div>
          </div>
        )}
      </div>

      {/* contactos */}
      <div className="card" style={{ marginBottom: 14 }} data-contactos={activos.length}>
        <div className="card-head"><div className="card-title">Contactos de cobro · ¿con quién hablo?</div><div className="card-actions" style={{ display: 'flex', gap: 6 }}>{inactivos.length > 0 && <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setVerInactivos(v => !v)} data-accion="ver-inactivos">{verInactivos ? 'ocultar' : 'ver'} {inactivos.length} inactivo{inactivos.length === 1 ? '' : 's'}</button>}{puedeGestionar && <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setContactoEdit({ rol: 'otro', preferido: activos.length === 0 })} data-accion="nuevo-contacto"><I.Plus size={12} /> Contacto</button>}</div></div>
        <div className="card-pad" style={{ display: 'grid', gap: 8, fontSize: 13 }}>
          {activos.length === 0 && <div className="cell-mute">Sin contactos de cobro registrados. Agregá a la persona que paga.</div>}
          {[...activos, ...(verInactivos ? inactivos : [])].map(x => (
            <div key={x.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', opacity: x.activo ? 1 : .6 }} data-contacto={x.id} data-activo={x.activo}>
              <div style={{ minWidth: 220, flex: 1 }}>
                <div><span className="cell-strong">{x.nombre}</span>{x.preferido && <span className="badge badge-olive" style={{ fontSize: 10, marginLeft: 6 }}>preferido</span>}{!x.activo && <span className="badge badge-mute" style={{ fontSize: 10, marginLeft: 6 }}>inactivo</span>} <span className="cell-mute">· {ETIQUETA_ROL_CONTACTO[x.rol]}{x.cargo ? ` · ${x.cargo}` : ''}</span></div>
                <div className="cell-mute" style={{ fontSize: 12 }}>{[x.correo, x.telefono, x.whatsapp && `WA ${x.whatsapp}`].filter(Boolean).join(' · ') || 'sin datos de contacto'}{x.notas ? ` · ${x.notas}` : ''}</div>
                <div className="cell-mute" style={{ fontSize: 11.5 }} data-ultimo-contacto-con={x.id}>{f.ultimoContactoPorContacto[x.id] ? `último contacto ${formatearFechaConHora(f.ultimoContactoPorContacto[x.id])}` : 'sin gestiones con esta persona'}</div>
              </div>
              <ContactoRapido c={{ id: x.id, nombre: '', correo: x.correo || null, telefono: x.telefono || null, whatsapp: x.whatsapp || null }} />
              {puedeGestionar && x.activo && <span style={{ display: 'inline-flex', gap: 4 }}><button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setContactoEdit(x)} data-accion="editar-contacto">Editar</button><button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => void correr(() => desactivarContactoCobroAction(x.id, f.clienteId), 'Contacto desactivado: el historial lo conserva')} disabled={busy} data-accion="desactivar-contacto">Desactivar</button></span>}
            </div>
          ))}
          {contactoEdit && (
            <div style={{ borderTop: '1px solid var(--line-3)', paddingTop: 10, display: 'grid', gap: 8 }} data-form-contacto>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <input className="input" placeholder="Nombre *" value={contactoEdit.nombre ?? ''} onChange={e => setContactoEdit({ ...contactoEdit, nombre: e.target.value })} aria-label="Nombre" maxLength={200} data-campo="c-nombre" />
                <input className="input" placeholder="Cargo" value={contactoEdit.cargo ?? ''} onChange={e => setContactoEdit({ ...contactoEdit, cargo: e.target.value })} aria-label="Cargo" maxLength={120} data-campo="c-cargo" />
                <select className="input" value={contactoEdit.rol ?? 'otro'} onChange={e => setContactoEdit({ ...contactoEdit, rol: e.target.value as RolContacto })} aria-label="Rol en el cobro" data-campo="c-rol">{ROLES_CONTACTO.map(r => <option key={r} value={r}>{ETIQUETA_ROL_CONTACTO[r]}</option>)}</select>
                <input className="input" placeholder="Correo" value={contactoEdit.correo ?? ''} onChange={e => setContactoEdit({ ...contactoEdit, correo: e.target.value })} aria-label="Correo" maxLength={200} data-campo="c-correo" />
                <input className="input" placeholder="Teléfono" value={contactoEdit.telefono ?? ''} onChange={e => setContactoEdit({ ...contactoEdit, telefono: e.target.value })} aria-label="Teléfono" maxLength={40} data-campo="c-telefono" />
                <input className="input" placeholder="WhatsApp" value={contactoEdit.whatsapp ?? ''} onChange={e => setContactoEdit({ ...contactoEdit, whatsapp: e.target.value })} aria-label="WhatsApp" maxLength={40} data-campo="c-whatsapp" />
              </div>
              <input className="input" placeholder="Notas (contestar solo por la mañana…)" value={contactoEdit.notas ?? ''} onChange={e => setContactoEdit({ ...contactoEdit, notas: e.target.value })} aria-label="Notas" maxLength={500} data-campo="c-notas" />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={contactoEdit.preferido === true} onChange={e => setContactoEdit({ ...contactoEdit, preferido: e.target.checked })} data-campo="c-preferido" /> Preferido</label>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}><button type="button" className="btn btn-ghost" onClick={() => setContactoEdit(null)} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void guardarContacto()} disabled={busy || !(contactoEdit.nombre ?? '').trim()} data-accion="guardar-contacto">Guardar contacto</button></span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* facturas abiertas */}
      <div className="card" style={{ marginBottom: 14 }} data-facturas-abiertas={f.facturas.length}>
        <div className="card-head"><div className="card-title">Facturas abiertas</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>estado calculado: emisión + crédito, cobros (026), última promesa y última gestión</span></div></div>
        <div className="table-scroll">
          <table className="table" data-lista="facturas-cobranza">
            <thead><tr><th>Factura</th><th className="num">Emisión</th><th className="num">Vence</th><th className="num">Saldo</th><th>Estado</th><th className="num">Atraso</th><th>Promesa</th><th style={{ width: 120 }}></th></tr></thead>
            <tbody>
              {f.facturas.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--ink-4)' }}>Sin facturas abiertas.</td></tr>}
              {f.facturas.map(x => { const s = x.estadoCobro; return (
                <tr key={x.id} data-factura={x.noFactura} data-estado-cobro={s.estado} data-modificadores={s.modificadores.join(' ')}>
                  <td className="num cell-strong"><Link href={`/facturacion/${x.id}`} style={{ textDecoration: 'none', color: 'var(--ink)' }}>{x.noFactura}</Link>{x.cedida && <span className="badge badge-mute" style={{ fontSize: 10, marginLeft: 6 }} title="Cedida a factoraje: la cobra el financiador">cedida</span>}</td>
                  <td className="num">{formatDateDDMMYYYY(x.fechaEmision)}</td>
                  <td className="num">{s.vence ? formatDateDDMMYYYY(s.vence) : '—'}</td>
                  <td className="num cell-strong">{Q(x.saldo)}{x.esParcial && <span className="cell-mute" style={{ fontSize: 11 }}> de {Q(x.total)}</span>}</td>
                  <td><span className={'badge ' + BADGE_ESTADO_BASE[s.estado]} style={{ fontSize: 10.5 }}>{ETIQUETA_ESTADO_BASE[s.estado]}</span>{s.modificadores.map(m => <span key={m} className="badge badge-outline" style={{ fontSize: 10, marginLeft: 4 }}>{ETIQUETA_MODIFICADOR[m]}</span>)}</td>
                  <td className="num" style={{ color: s.diasVencida > 0 ? 'var(--wine)' : 'var(--ink-3)' }}>{s.diasVencida > 0 ? `${s.diasVencida} d` : '—'}</td>
                  <td style={{ fontSize: 12 }}>{s.promesaFecha ? `${formatDateDDMMYYYY(s.promesaFecha)} · ${ETIQUETA_PROMESA[s.promesaEstado ?? 'pendiente']}` : <span className="cell-mute">—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.adjuntoUrl && <a className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} href={x.adjuntoUrl} target="_blank" rel="noopener" title="PDF de la factura">PDF</a>}{puedeGestionar && <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setGestion({ facturas: [x.noFactura] })} data-accion="gestion-factura">Gestión</button>}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      </div>

      {/* historial */}
      <div className="card" data-historial={f.eventos.length}>
        <div className="card-head"><div className="card-title">Historial</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>todo lo que pasó, manual y automático</span></div></div>
        <div className="card-pad" style={{ fontSize: 13, borderBottom: '1px solid var(--line-3)' }} data-resumen>{f.resumen}</div>
        <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, borderBottom: '1px solid var(--line-3)' }}>
          <select className="input" style={{ width: 'auto' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoEvento | 'todos')} aria-label="Tipo" data-filtro="tipo"><option value="todos">Todos los tipos</option>{(Object.keys(ETIQUETA_TIPO_EVENTO) as TipoEvento[]).map(t => <option key={t} value={t}>{ETIQUETA_TIPO_EVENTO[t]}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} value={filtroFactura} onChange={e => setFiltroFactura(e.target.value)} aria-label="Factura" data-filtro="factura"><option value="">Todas las facturas</option>{[...new Set(f.eventos.flatMap(e => e.facturas))].sort().map(nf => <option key={nf} value={nf}>{nf}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} value={filtroContacto} onChange={e => setFiltroContacto(e.target.value)} aria-label="Contacto" data-filtro="contacto"><option value="">Todos los contactos</option>{f.contactos.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
          <input className="input" style={{ minWidth: 180, flex: 1 }} value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar en el historial…" aria-label="Buscar" data-filtro="texto" />
          <span className="cell-mute">{eventos.length} de {f.eventos.length}</span>
        </div>
        <div style={{ display: 'grid' }} data-lista-historial>
          {eventos.length === 0 && <div className="card-pad cell-mute" style={{ textAlign: 'center', padding: 24 }}>Sin eventos{f.eventos.length ? ' con ese filtro' : ': registrá la primera gestión'}.</div>}
          {eventos.map(e => (
            <div key={e.id} className="card-pad" style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 8, borderTop: '1px solid var(--line-3)', fontSize: 13 }} data-evento={e.tipo} data-evento-id={e.id} data-origen={e.origen}>
              <span title={ETIQUETA_TIPO_EVENTO[e.tipo]} style={{ fontSize: 16, lineHeight: 1.2 }}>{ICONO_TIPO[e.tipo]}</span>
              <div style={{ minWidth: 0 }}>
                <div className="cell-mute" style={{ fontSize: 11.5 }}>{formatearFechaConHora(e.fecha)} · {ETIQUETA_TIPO_EVENTO[e.tipo]} · {e.origen === 'automatico' ? 'automático' : e.creadoPor}{e.facturas.length ? ` · ${e.facturas.join(', ')}` : ''}</div>
                <div>{describirEvento(e)}</div>
                {e.adjuntos.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>{e.adjuntos.map(a => <a key={a.id} className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} href={`/api/cobranza-adjunto/${a.id}`} target="_blank" rel="noopener" data-adjunto={a.id}><I.Paperclip size={11} /> {a.nombre}</a>)}</div>}
                {puedeGestionar && e.tipo === 'gestion' && e.proximoSeguimiento && !e.seguimientoHechoEn && <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px', marginTop: 4 }} onClick={() => void correr(() => marcarSeguimientoHechoAction(e.id, f.clienteId), 'Seguimiento marcado como hecho')} disabled={busy} data-accion="seguimiento-hecho">Marcar seguimiento hecho</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {enviandoEC && <EstadoCuentaEnviar clienteId={f.clienteId} clienteNombre={f.nombre} onClose={() => setEnviandoEC(false)} onListo={msg => { setEnviandoEC(false); toast.success(msg); router.refresh(); }} />}
      {gestion && <GestionForm clienteId={f.clienteId} clienteNombre={f.nombre} contactos={activos} facturas={f.facturas.filter(x => !x.cedida).map(x => ({ noFactura: x.noFactura, saldo: x.saldo, diasVencidos: x.diasVencidos }))} facturasPre={gestion.facturas} onClose={() => setGestion(null)} onListo={msg => { setGestion(null); toast.success(msg); router.refresh(); }} />}
    </div>
  );
}
