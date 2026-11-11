'use client';

/**
 * CENTRO DE COBROS · PR 2 (035) · «Recordatorios propuestos»: los borradores de hoy, agrupables por regla. Cada uno con
 * destinatario (contacto preferido o el de pagos; se puede cambiar), copia al responsable, asunto y cuerpo EDITABLES de
 * la plantilla, el motivo de la regla y, si aplica, el BLOQUEO (disputa abierta / promesa vigente) que exige un motivo
 * para forzarlo. «Enviar» uno por uno o «Enviar seleccionados». Nada sale sin esa acción. «Omitir hasta» con motivo.
 * Sin diálogos del navegador. 390 px: una tarjeta por fila.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { HelpButton } from '@/components/ayuda/help-button';
import { Q, formatDateDDMMYYYY } from '@/lib/utils';
import { enviarRecordatorioAction, enviarRecordatoriosAction, omitirRecordatorioAction } from '@/app/(app)/cobranza/actions';
import { BADGE_REGLA, ETIQUETA_BLOQUEO, ETIQUETA_REGLA, ORDEN_REGLA, type ReglaClave } from '@/lib/cobranza/recordatorios';
import { sumarDias } from '@/lib/cobranza/estado';
import type { BorradorPreparado, DatosRecordatorios, EnvioResult } from '@/lib/db/cobranza-recordatorios';

interface Edicion { para: string; paraOtro: string; cc: string; asunto: string; cuerpo: string; forzarMotivo: string; abierto: boolean; omitiendo: boolean; omitirHasta: string; omitirMotivo: string }
const OTRO = '__otro__';

export function RecordatoriosClient({ datos, email }: { datos: DatosRecordatorios; email: string }) {
  const router = useRouter();
  const puedeEnviar = usePuede()('gestionar_cobranza');
  const [regla, setRegla] = useState<ReglaClave | 'todas'>('todas');
  const [verOmitidos, setVerOmitidos] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ed, setEd] = useState<Record<string, Edicion>>({});
  const [resultados, setResultados] = useState<Record<string, EnvioResult>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const edicion = (b: BorradorPreparado): Edicion => ed[b.id] ?? { para: b.destinatario?.correo ?? (b.destinatariosPosibles[0]?.correo ?? OTRO), paraOtro: '', cc: b.cc.join(', '), asunto: b.asunto, cuerpo: b.cuerpo, forzarMotivo: '', abierto: false, omitiendo: false, omitirHasta: sumarDias(datos.hoy, 7), omitirMotivo: '' };
  const setE = (b: BorradorPreparado, patch: Partial<Edicion>) => setEd(m => ({ ...m, [b.id]: { ...edicion(b), ...patch } }));
  const paraDe = (b: BorradorPreparado) => { const e = edicion(b); return e.para === OTRO ? e.paraOtro : e.para; };
  const inputDe = (b: BorradorPreparado) => { const e = edicion(b); return { para: paraDe(b), cc: e.cc, asunto: e.asunto, cuerpo: e.cuerpo, forzarMotivo: e.forzarMotivo }; };
  const listo = (b: BorradorPreparado) => !!paraDe(b) && (!b.bloqueo || edicion(b).forzarMotivo.trim().length >= 5) && !resultados[b.id]?.ok;

  const vivos = useMemo(() => datos.borradores.filter(b => !b.omitidoHasta), [datos.borradores]);
  const omitidos = useMemo(() => datos.borradores.filter(b => b.omitidoHasta), [datos.borradores]);
  const lista = (verOmitidos ? datos.borradores : vivos).filter(b => regla === 'todas' || b.regla === regla);
  const n = (r: ReglaClave) => vivos.filter(b => b.regla === r).length;
  const r = datos.resumen;

  const enviarUno = async (b: BorradorPreparado) => {
    setBusy(b.id);
    try {
      const res = await enviarRecordatorioAction(b.id, inputDe(b));
      setResultados(m => ({ ...m, [b.id]: res }));
      if (res.ok) { toast.success(res.detalle); setSel(s => { const x = new Set(s); x.delete(b.id); return x; }); router.refresh(); } else toast.error(res.error);
    } finally { setBusy(null); }
  };
  const enviarSeleccionados = async () => {
    const items = vivos.filter(b => sel.has(b.id) && listo(b)).map(b => ({ id: b.id, input: inputDe(b) }));
    if (!items.length) return;
    setBusy('__lote__');
    try {
      const res = await enviarRecordatoriosAction(items);
      const map: Record<string, EnvioResult> = {}; for (const x of res) map[x.id] = x.resultado;
      setResultados(m => ({ ...m, ...map }));
      const okN = res.filter(x => x.resultado.ok).length;
      if (okN) toast.success(`${okN} de ${res.length} recordatorios enviados`); if (okN < res.length) toast.error(`${res.length - okN} no salieron: revisá cada uno`);
      setSel(new Set()); router.refresh();
    } finally { setBusy(null); }
  };
  const omitir = async (b: BorradorPreparado) => {
    const e = edicion(b); setBusy(b.id);
    try { const res = await omitirRecordatorioAction(b.clienteUuid, b.regla, e.omitirHasta, e.omitirMotivo); if (res.ok) { toast.success(`Omitido hasta el ${formatDateDDMMYYYY(e.omitirHasta)}`); router.refresh(); } else toast.error(res.error); } finally { setBusy(null); }
  };
  const toggleSel = (id: string) => setSel(s => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const seleccionables = vivos.filter(b => listo(b) && (regla === 'todas' || b.regla === regla));
  const nSel = vivos.filter(b => sel.has(b.id) && listo(b)).length;

  return (
    <div className="page" data-recordatorios={vivos.length} data-listos={r.listos} data-bloqueados={r.bloqueados}>
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}><Link href="/cobranza" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Centro de Cobros</Link></div>
          <h1 className="page-title">Recordatorios propuestos <HelpButton tag="recordatorios" /></h1>
          <div className="page-subtitle">{formatDateDDMMYYYY(datos.hoy)} · {datos.misClientes ? 'mis clientes y los sin responsable' : 'todos los clientes'} · nada se manda sin que presiones <strong>Enviar</strong> · responder-a: {datos.remitente}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={() => router.push(datos.misClientes ? '/cobranza/recordatorios?todos=1' : '/cobranza/recordatorios')} data-accion="alternar-mios">{datos.misClientes ? 'Ver todos' : 'Ver mis clientes'}</button>
          <Link href="/cobranza/plantillas" className="btn btn-secondary" data-accion="plantillas"><I.Edit size={13} /> Plantillas y reglas</Link>
          {puedeEnviar && <button type="button" className="btn btn-primary" onClick={() => void enviarSeleccionados()} disabled={!nSel || busy !== null || !datos.correoConfigurado} data-accion="enviar-seleccionados"><I.Send size={13} /> {busy === '__lote__' ? 'Enviando…' : `Enviar seleccionados (${nSel})`}</button>}
        </div>
      </div>

      {datos.error && <div className="card" style={{ marginBottom: 12 }}><div className="card-pad" style={{ color: 'var(--wine)', fontSize: 13 }} role="alert" data-error>{datos.error}</div></div>}
      {!datos.correoConfigurado && datos.disponible && <div className="card" style={{ marginBottom: 12 }}><div className="card-pad" style={{ fontSize: 13 }} role="status" data-sin-correo>Correo no configurado en este deploy (falta RESEND_API_KEY): los borradores se ven, pero no se pueden enviar.</div></div>}

      <div className="kpi-grid" style={{ marginBottom: 14 }} data-kpis>
        <div className="kpi" data-kpi="propuestos"><div className="kpi-label">Propuestos hoy</div><div className="kpi-value">{r.total}</div><div className="kpi-delta"><span className="vs">{Q(vivos.reduce((s, b) => s + b.monto, 0))} en facturas</span></div></div>
        <div className="kpi" data-kpi="listos"><div className="kpi-label">Listos para enviar</div><div className="kpi-value">{r.listos}</div><div className="kpi-delta"><span className="vs">con destinatario y sin bloqueo</span></div></div>
        <div className="kpi" data-kpi="bloqueados"><div className="kpi-label">Bloqueados</div><div className="kpi-value" style={{ color: r.bloqueados ? 'var(--wine)' : undefined }}>{r.bloqueados}</div><div className="kpi-delta"><span className="vs">disputa abierta o promesa vigente: se mandan solo con motivo</span></div></div>
        <div className="kpi" data-kpi="sin-correo"><div className="kpi-label">Sin correo</div><div className="kpi-value" style={{ color: r.sinCorreo ? 'var(--wine)' : undefined }}>{r.sinCorreo}</div><div className="kpi-delta"><span className="vs">clientes sin contacto con correo{r.omitidos ? ` · ${r.omitidos} omitidos` : ''}</span></div></div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <button type="button" className={'btn ' + (regla === 'todas' ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setRegla('todas')} data-filtro="todas">Todos ({vivos.length})</button>
          {ORDEN_REGLA.map(c => <button key={c} type="button" className={'btn ' + (regla === c ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setRegla(c)} data-filtro={c}>{ETIQUETA_REGLA[c]} ({n(c)})</button>)}
          {omitidos.length > 0 && <button type="button" className="btn btn-ghost" style={{ fontSize: 12, marginLeft: 'auto' }} onClick={() => setVerOmitidos(v => !v)} data-accion="ver-omitidos">{verOmitidos ? 'ocultar' : 'ver'} {omitidos.length} omitido{omitidos.length === 1 ? '' : 's'}</button>}
          {puedeEnviar && seleccionables.length > 0 && <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setSel(s => (seleccionables.every(b => s.has(b.id)) ? new Set() : new Set(seleccionables.map(b => b.id))))} data-accion="seleccionar-listos">{seleccionables.every(b => sel.has(b.id)) ? 'Quitar selección' : `Seleccionar los ${seleccionables.length} listos`}</button>}
        </div>
      </div>

      <div className="card" data-lista-recordatorios>
        {lista.length === 0 && <div className="card-pad" style={{ textAlign: 'center', padding: 36, color: 'var(--ink-4)' }}><I.Check size={26} style={{ opacity: .4, marginBottom: 8 }} /><div style={{ fontSize: 13 }}>{vivos.length === 0 ? 'Nada que recordar hoy: no hay facturas por vencer ni vencidas sin recordatorio, ni promesas que confirmar.' : 'Nada en este filtro.'}</div></div>}
        {lista.map((b, idx) => {
          const e = edicion(b); const res = resultados[b.id]; const enviado = res?.ok === true; const omitido = !!b.omitidoHasta;
          return (
            <div key={b.id} className="card-pad" style={{ borderTop: idx ? '1px solid var(--line-3)' : 'none', display: 'grid', gap: 8, opacity: omitido || enviado ? .6 : 1 }} data-borrador={b.id} data-regla={b.regla} data-cliente={b.clienteId} data-bloqueo={b.bloqueo?.tipo ?? ''} data-enviado={enviado} data-omitido={omitido}>
              <div style={{ display: 'grid', gridTemplateColumns: puedeEnviar ? '22px minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto', gap: 8, alignItems: 'start' }}>
                {puedeEnviar && <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggleSel(b.id)} disabled={!listo(b) || omitido || busy !== null} aria-label="Seleccionar" style={{ marginTop: 4 }} data-sel={b.id} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={'badge ' + BADGE_REGLA[b.regla]} style={{ fontSize: 10.5 }}>{ETIQUETA_REGLA[b.regla]}</span>
                    <Link href={`/cobranza/${encodeURIComponent(b.clienteId)}`} className="cell-strong" style={{ textDecoration: 'none', color: 'var(--ink)', fontSize: 14 }} data-accion="abrir-ficha">{b.clienteNombre}</Link>
                    <span className="num cell-strong">{Q(b.monto)}</span>
                    {b.bloqueo && <span className="badge badge-wine" style={{ fontSize: 10.5 }} title={b.bloqueo.detalle} data-badge-bloqueo>{ETIQUETA_BLOQUEO[b.bloqueo.tipo]}</span>}
                    {!b.destinatario && <span className="badge badge-warn" style={{ fontSize: 10.5 }} data-badge-sin-correo>Sin correo</span>}
                    {omitido && <span className="badge badge-mute" style={{ fontSize: 10.5 }}>omitido hasta {formatDateDDMMYYYY(b.omitidoHasta!)}</span>}
                    {enviado && <span className="badge badge-olive" style={{ fontSize: 10.5 }} data-badge-enviado>Enviado</span>}
                    {res && !res.ok && <span className="badge badge-wine" style={{ fontSize: 10.5 }} data-badge-error>No salió</span>}
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 2 }} data-motivo>{b.motivo}<span className="cell-mute"> · {b.facturas.slice(0, 6).join(', ')}{b.facturas.length > 6 ? ` +${b.facturas.length - 6}` : ''}</span></div>
                  {b.bloqueo && <div style={{ fontSize: 12, color: 'var(--wine)', marginTop: 2 }} data-bloqueo-detalle>{b.bloqueo.detalle} {puedeEnviar && !enviado && 'Para mandarlo igual, escribí el motivo.'}</div>}
                  {res && !res.ok && <div style={{ fontSize: 12, color: 'var(--wine)' }} role="alert" data-error-envio>{res.error}</div>}
                  {enviado && <div style={{ fontSize: 12 }} data-detalle-envio>{res.detalle}</div>}
                  {!omitido && !enviado && (
                    <div style={{ display: 'grid', gap: 6, marginTop: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', fontSize: 12.5 }}>
                      <label style={{ display: 'grid', gap: 3 }}>Para
                        <select className="input" value={e.para} onChange={ev => setE(b, { para: ev.target.value })} disabled={!puedeEnviar || busy !== null} aria-label="Destinatario" data-campo="para">
                          {b.destinatariosPosibles.map(c => <option key={c.id} value={c.correo}>{c.nombre} · {c.correo}{c.preferido ? ' ★' : ''}</option>)}
                          <option value={OTRO}>Otro correo…</option>
                        </select>
                        {e.para === OTRO && <input className="input" type="email" value={e.paraOtro} onChange={ev => setE(b, { paraOtro: ev.target.value })} placeholder="correo@cliente.com" aria-label="Otro correo" disabled={!puedeEnviar || busy !== null} data-campo="para-otro" />}
                      </label>
                      <label style={{ display: 'grid', gap: 3 }}>Copia (CC) <input className="input" value={e.cc} onChange={ev => setE(b, { cc: ev.target.value })} placeholder={email} aria-label="Copia" disabled={!puedeEnviar || busy !== null} data-campo="cc" /></label>
                      {b.bloqueo && puedeEnviar && <label style={{ display: 'grid', gap: 3 }}>Motivo para forzarlo <input className="input" value={e.forzarMotivo} onChange={ev => setE(b, { forzarMotivo: ev.target.value })} placeholder="p. ej. el cliente pidió el recordatorio igual" maxLength={300} disabled={busy !== null} data-campo="forzar-motivo" /></label>}
                    </div>
                  )}
                  {!omitido && !enviado && (
                    <div style={{ marginTop: 6 }}>
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: '2px 8px' }} onClick={() => setE(b, { abierto: !e.abierto })} data-accion="ver-correo">{e.abierto ? 'Ocultar el correo' : 'Ver / editar el correo'}</button>
                      {e.abierto && (
                        <div style={{ display: 'grid', gap: 6, marginTop: 6, fontSize: 12.5 }} data-correo-abierto>
                          <label style={{ display: 'grid', gap: 3 }}>Asunto <input className="input" value={e.asunto} onChange={ev => setE(b, { asunto: ev.target.value })} maxLength={200} disabled={!puedeEnviar || busy !== null} data-campo="asunto" /></label>
                          <label style={{ display: 'grid', gap: 3 }}>Cuerpo <span className="cell-mute" style={{ fontSize: 11 }}>({'{{estado_cuenta}}'} se reemplaza por la tabla del estado de cuenta al enviar)</span>
                            <textarea className="input" value={e.cuerpo} onChange={ev => setE(b, { cuerpo: ev.target.value })} rows={10} maxLength={8000} disabled={!puedeEnviar || busy !== null} data-campo="cuerpo" style={{ fontFamily: 'inherit', fontSize: 12.5 }} />
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                  {e.omitiendo && !omitido && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6, fontSize: 12.5 }} data-form-omitir>
                      <span>Omitir hasta</span><input className="input" type="date" value={e.omitirHasta} min={datos.hoy} onChange={ev => setE(b, { omitirHasta: ev.target.value })} style={{ maxWidth: 170 }} aria-label="Omitir hasta" data-campo="omitir-hasta" />
                      <input className="input" value={e.omitirMotivo} onChange={ev => setE(b, { omitirMotivo: ev.target.value })} placeholder="por qué (obligatorio)" maxLength={300} style={{ minWidth: 220, flex: 1 }} aria-label="Motivo" data-campo="omitir-motivo" />
                      <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => void omitir(b)} disabled={busy !== null || e.omitirMotivo.trim().length < 3} data-accion="confirmar-omitir">Confirmar</button>
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setE(b, { omitiendo: false })} disabled={busy !== null}>Cancelar</button>
                    </div>
                  )}
                </div>
                {puedeEnviar && !omitido && !enviado && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <button type="button" className="btn btn-primary" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => void enviarUno(b)} disabled={!listo(b) || busy !== null || !datos.correoConfigurado} title={!paraDe(b) ? 'Falta el destinatario' : b.bloqueo && e.forzarMotivo.trim().length < 5 ? 'Bloqueado: escribí el motivo para forzarlo' : 'Mandar este recordatorio'} data-accion="enviar"><I.Send size={12} /> {busy === b.id ? 'Enviando…' : b.bloqueo ? 'Enviar igual' : 'Enviar'}</button>
                    {!e.omitiendo && <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={() => setE(b, { omitiendo: true })} disabled={busy !== null} data-accion="omitir">Omitir hasta…</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
