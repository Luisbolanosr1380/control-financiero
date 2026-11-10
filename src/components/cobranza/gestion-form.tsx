'use client';

/**
 * CENTRO DE COBROS (033) · «Registrar gestión»: el formulario rápido (bandeja y ficha). Canal, con quién, resultado
 * (lista fija), comentario, facturas, promesa (monto + fecha) cuando el resultado es promesa, motivo cuando es disputa
 * y la fecha de PRÓXIMO SEGUIMIENTO, obligatoria. Adjuntos opcionales (captura, PDF, .eml) por URL firmada de subida.
 * Modal propio; sin diálogos del navegador.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { confirmarAdjuntosCobranzaAction, prepararAdjuntosCobranzaAction, registrarGestionCobranzaAction } from '@/app/(app)/cobranza/actions';
import { CANALES_COBRANZA, DESCRIPCION_RESULTADO, ETIQUETA_CANAL, ETIQUETA_RESULTADO, RESULTADOS_GESTION, sumarDias, type CanalCobranza, type ResultadoGestion } from '@/lib/cobranza/estado';
import { ACEPTA_ADJUNTO, MAX_BYTES_ADJUNTO, tipoRealAdjunto } from '@/lib/cobranza/adjuntos';
import type { ContactoCobro } from '@/lib/db/cobranza';

export interface FacturaParaGestion { noFactura: string; saldo: number; diasVencidos: number }
interface Props { clienteId: string; clienteNombre: string; contactos: ContactoCobro[]; facturas: FacturaParaGestion[]; facturasPre?: string[]; resultadoPre?: ResultadoGestion; onClose: () => void; onListo: (msg: string) => void }

export function GestionForm({ clienteId, clienteNombre, contactos, facturas, facturasPre = [], resultadoPre, onClose, onListo }: Props) {
  const hoy = obtenerFechaHoyGuatemala();
  const pref = contactos.find(c => c.preferido) ?? contactos[0] ?? null;
  const [canal, setCanal] = useState<CanalCobranza>('llamada');
  const [contactoId, setContactoId] = useState<string>(pref?.id ?? '');
  const [contactoTexto, setContactoTexto] = useState('');
  const [resultado, setResultado] = useState<ResultadoGestion>(resultadoPre ?? 'contactado');
  const [comentario, setComentario] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set(facturasPre));
  const [promesaMonto, setPromesaMonto] = useState('');
  const [promesaFecha, setPromesaFecha] = useState('');
  const [disputaMotivo, setDisputaMotivo] = useState('');
  const [seguimiento, setSeguimiento] = useState(sumarDias(hoy, 7));
  const [fecha, setFecha] = useState(hoy);
  const [archivos, setArchivos] = useState<Array<{ file: File; mime: string | null; error: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const elegir = async (lista: FileList | null) => {
    const out: typeof archivos = [];
    for (const file of [...(lista ?? [])].slice(0, 5)) {
      const cab = new Uint8Array(await file.slice(0, 512).arrayBuffer());
      const mime = tipoRealAdjunto(cab, file.name);
      out.push({ file, mime, error: !mime ? 'no es PDF, imagen ni correo (.eml)' : file.size > MAX_BYTES_ADJUNTO ? 'pesa más de 10 MB' : null });
    }
    setArchivos(out);
  };
  const toggle = (nf: string) => setSel(s => { const n = new Set(s); if (n.has(nf)) n.delete(nf); else n.add(nf); return n; });
  const montoSel = facturas.filter(f => sel.has(f.noFactura)).reduce((s, f) => s + f.saldo, 0);
  const puede = !busy && !!seguimiento && (resultado !== 'promesa' || !!promesaFecha) && archivos.every(a => !a.error);

  const guardar = async () => {
    setError(''); setBusy(true);
    try {
      const r = await registrarGestionCobranzaAction(clienteId, { canal, resultado, comentario, contactoId: contactoId || null, contactoTexto: contactoId ? '' : contactoTexto, facturas: [...sel], promesaMonto: promesaMonto ? Number(promesaMonto.replace(/,/g, '')) : (resultado === 'promesa' && montoSel > 0 ? montoSel : null), promesaFecha: promesaFecha || null, proximoSeguimiento: seguimiento, disputaMotivo, fecha });
      if (!r.ok) { setError(r.error); return; }
      const buenos = archivos.filter(a => a.mime && !a.error);
      if (buenos.length) {
        const prep = await prepararAdjuntosCobranzaAction(r.gestionId, buenos.map(a => ({ nombre: a.file.name, bytes: a.file.size, mime: a.mime! })));
        if (!prep.ok) { toast.error(`Gestión guardada, pero los adjuntos no: ${prep.error}`); onListo('Gestión registrada'); return; }
        for (let i = 0; i < prep.subidas.length; i++) {
          const res = await fetch(prep.subidas[i].url, { method: 'PUT', headers: { 'content-type': prep.subidas[i].mime, 'x-upsert': 'false' }, body: buenos[i].file, credentials: 'omit', cache: 'no-store' });
          if (!res.ok) { toast.error(`No se pudo subir "${buenos[i].file.name}" (${res.status})`); onListo('Gestión registrada'); return; }
        }
        const conf = await confirmarAdjuntosCobranzaAction(r.gestionId, prep.subidas.map(s => ({ path: s.path, nombre: s.nombre })), clienteId);
        if (!conf.ok) { toast.error(`Gestión guardada, pero los adjuntos no: ${conf.error}`); onListo('Gestión registrada'); return; }
      }
      onListo(resultado === 'promesa' ? `Gestión y promesa registradas · seguimiento el ${seguimiento}` : `Gestión registrada · seguimiento el ${seguimiento}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Registrar gestión" onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 12, overflowY: 'auto' }}>
      <div className="card" style={{ maxWidth: 640, width: '100%', marginTop: 12 }} onClick={e => e.stopPropagation()} data-gestion-form>
        <div className="card-head"><div className="card-title">Registrar gestión · {clienteNombre}</div><div className="card-actions"><button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cerrar</button></div></div>
        <div className="card-pad" style={{ display: 'grid', gap: 10, fontSize: 13 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="radiogroup" aria-label="Canal">
            {CANALES_COBRANZA.map(c => <button key={c} type="button" className={'btn ' + (canal === c ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setCanal(c)} data-canal={c}>{ETIQUETA_CANAL[c]}</button>)}
          </div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 4 }}>Con quién
              <select className="input" value={contactoId} onChange={e => setContactoId(e.target.value)} aria-label="Contacto" disabled={busy} data-campo="contacto">
                {contactos.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.cargo ? ` · ${c.cargo}` : ''}{c.preferido ? ' ★' : ''}</option>)}
                <option value="">Otra persona (escribir)</option>
              </select>
            </label>
            {!contactoId && <label style={{ display: 'grid', gap: 4 }}>Nombre <input className="input" value={contactoTexto} onChange={e => setContactoTexto(e.target.value)} placeholder="Con quién hablaste" aria-label="Nombre del contacto" maxLength={200} disabled={busy} data-campo="contacto-texto" /></label>}
            <label style={{ display: 'grid', gap: 4 }}>Fecha de la gestión <input className="input" type="date" value={fecha} max={hoy} onChange={e => setFecha(e.target.value)} aria-label="Fecha de la gestión" disabled={busy} data-campo="fecha" /></label>
          </div>
          <label style={{ display: 'grid', gap: 4 }}>Resultado
            <select className="input" value={resultado} onChange={e => setResultado(e.target.value as ResultadoGestion)} aria-label="Resultado" disabled={busy} data-campo="resultado">
              {RESULTADOS_GESTION.map(r => <option key={r} value={r}>{ETIQUETA_RESULTADO[r]}</option>)}
            </select>
            <span className="cell-mute" style={{ fontSize: 11.5 }}>{DESCRIPCION_RESULTADO[resultado]}</span>
          </label>
          {resultado === 'promesa' && (
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }} data-promesa>
              <label style={{ display: 'grid', gap: 4 }}>Monto prometido <input className="input num" inputMode="decimal" value={promesaMonto} onChange={e => setPromesaMonto(e.target.value)} placeholder={montoSel > 0 ? Q(montoSel) : 'Q'} aria-label="Monto prometido" disabled={busy} data-campo="promesa-monto" /></label>
              <label style={{ display: 'grid', gap: 4 }}>Fecha prometida <input className="input" type="date" value={promesaFecha} min={hoy} onChange={e => { setPromesaFecha(e.target.value); if (e.target.value) setSeguimiento(sumarDias(e.target.value, 1)); }} aria-label="Fecha prometida" disabled={busy} data-campo="promesa-fecha" /></label>
            </div>
          )}
          {resultado === 'disputa' && <label style={{ display: 'grid', gap: 4 }}>Motivo de la disputa <input className="input" value={disputaMotivo} onChange={e => setDisputaMotivo(e.target.value)} aria-label="Motivo de la disputa" maxLength={500} disabled={busy} data-campo="disputa-motivo" /></label>}
          <label style={{ display: 'grid', gap: 4 }}>Comentario (qué dijo el cliente) <textarea className="input" value={comentario} onChange={e => setComentario(e.target.value)} rows={3} maxLength={2000} placeholder="Ej.: pide la contraseña de la factura; la dan al recibirla física" aria-label="Comentario" disabled={busy} data-campo="comentario" /></label>
          {facturas.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }} data-facturas-gestion>
              <span>Facturas involucradas <span className="cell-mute">({sel.size} de {facturas.length}{sel.size ? ` · ${Q(montoSel)}` : ''})</span></span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {facturas.map(f => <label key={f.noFactura} className={'badge ' + (sel.has(f.noFactura) ? 'badge-outline' : 'badge-mute')} style={{ cursor: 'pointer', fontSize: 11.5, padding: '4px 8px', display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={sel.has(f.noFactura)} onChange={() => toggle(f.noFactura)} disabled={busy} data-factura={f.noFactura} style={{ margin: 0 }} /> <span className="num">{f.noFactura}</span> · {Q(f.saldo)}{f.diasVencidos > 0 ? <span style={{ color: 'var(--wine)' }}> · {f.diasVencidos} d</span> : null}</label>)}
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gap: 4 }} data-seguimiento>
            <span><strong>Próximo seguimiento</strong> <span className="cell-mute">(obligatorio: el sistema te lo trae ese día)</span></span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" type="date" value={seguimiento} min={hoy} onChange={e => setSeguimiento(e.target.value)} aria-label="Próximo seguimiento" disabled={busy} data-campo="seguimiento" style={{ maxWidth: 180 }} />
              {([['mañana', 1], ['3 días', 3], ['1 semana', 7], ['2 semanas', 14]] as const).map(([t, d]) => <button key={t} type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 8px' }} onClick={() => setSeguimiento(sumarDias(hoy, d))} disabled={busy} data-atajo={d}>{t}</button>)}
            </div>
          </div>
          <label style={{ display: 'grid', gap: 4 }}>Adjuntos (opcional: captura de WhatsApp, PDF, correo .eml; hasta 5 de 10 MB)
            <input className="input" type="file" accept={ACEPTA_ADJUNTO} multiple onChange={e => void elegir(e.target.files)} disabled={busy} aria-label="Adjuntos" data-campo="adjuntos" />
          </label>
          {archivos.length > 0 && <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>{archivos.map((a, i) => <li key={i} style={{ color: a.error ? 'var(--wine)' : undefined }} data-adjunto-elegido={a.error ? 'error' : 'ok'}>{a.file.name}{a.error ? ` · ${a.error}` : ''}</li>)}</ul>}
          {error && <div style={{ color: 'var(--wine)' }} role="alert" data-error-gestion>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!puede} data-accion="guardar-gestion"><I.Check size={13} /> {busy ? 'Guardando…' : 'Guardar gestión'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
