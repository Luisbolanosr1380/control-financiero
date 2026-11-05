'use client';

/**
 * DETALLE DIGITAL (029) · la página que ve el CLIENTE (sin usuario). Lee el token del fragmento (#…), pide el
 * detalle al endpoint propio (POST, el token va en el cuerpo), muestra una fila por prueba y deja elegir por línea
 * Aprobado (por defecto) / Corrección / Cobrar el próximo mes / No aplica (con el motivo obligatorio en esas tres).
 * Con todo aprobado se abre la firma (nombre, cargo, correo, casilla de autorización y firma dibujada en canvas,
 * con dedo o mouse); con alguna no aprobada no se puede firmar: "Enviar observaciones". Después de responder queda
 * en solo lectura. Sin recursos externos; funciona a 390 px. Sin diálogos del navegador.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DECISIONES, DESCRIPCION_DECISION, ETIQUETA_DECISION, exigeNota, LIMITE_FIRMA_PNG, type Decision, type DetallePublico, type LineaPublica } from '@/lib/detalle-link/publico';

type Estado = { fase: 'cargando' } | { fase: 'invalido'; mensaje: string } | { fase: 'vigente'; detalle: DetallePublico } | { fase: 'respondido'; detalle: DetallePublico; recien?: { estado: 'aprobada' | 'con_observaciones'; observaciones: number } };
interface Resp { decision: Decision; nota: string }

const Q = (n: number) => `Q${n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Guatemala' }) : '—');
const fechaHora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Guatemala' }) : '—');
const huella = (h: string) => h.slice(0, 12).replace(/(.{4})(?=.)/g, '$1 ').toUpperCase();

async function pedir(cuerpo: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch('/api/aprobar-detalle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, json };
}

export function AprobarDetalleClient() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [token, setToken] = useState('');
  useEffect(() => {
    const t = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '').trim();
    if (!/^[A-Za-z0-9_-]{40,48}$/.test(t)) { setEstado({ fase: 'invalido', mensaje: 'Este link no está completo. Abrilo de nuevo desde el correo que te llegó.' }); return; }
    setToken(t);
    // El token SE QUEDA en el fragmento (#): el cliente abre el link hoy y lo llena días después (recarga, vuelve por el
    // historial o el teléfono descarta la pestaña). Borrarlo de la barra hacía que el link "venciera" al recargar.
    // El fragmento nunca viaja al servidor (ni logs ni referer): la seguridad no cambia.
    void pedir({ accion: 'abrir', token: t }).then(({ json }) => {
      if (json.estado === 'vigente' && json.detalle) setEstado({ fase: 'vigente', detalle: json.detalle as DetallePublico });
      else if (json.estado === 'respondido' && json.detalle) setEstado({ fase: 'respondido', detalle: json.detalle as DetallePublico });
      else setEstado({ fase: 'invalido', mensaje: String(json.error ?? 'Este link ya no es válido.') });
    }).catch(() => setEstado({ fase: 'invalido', mensaje: 'No se pudo cargar el detalle. Probá de nuevo en un momento.' }));
    // otro link (otro #token) en la misma pestaña: Chrome no recarga en un cambio de fragmento → se recarga a mano
    const alCambiar = () => { if (window.location.hash.length > 1) window.location.reload(); };
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  return (
    <div className="ad-page" data-aprobar-detalle data-fase={estado.fase}>
      <style>{CSS}</style>
      {estado.fase === 'cargando' && <div className="ad-card ad-centro">Cargando el detalle…</div>}
      {estado.fase === 'invalido' && <div className="ad-card ad-centro" role="status" data-invalido><div className="ad-h1">Detalle de servicios</div><p>{estado.mensaje}</p><p className="ad-mute">Si creés que es un error, respondé el correo con el que recibiste este link.</p></div>}
      {estado.fase === 'vigente' && <Formulario detalle={estado.detalle} token={token} onRespondido={(recien, detalle) => setEstado({ fase: 'respondido', detalle, recien })} />}
      {estado.fase === 'respondido' && <SoloLectura detalle={estado.detalle} recien={estado.recien} />}
    </div>
  );
}

function Encabezado({ d }: { d: DetallePublico }) {
  return (
    <header className="ad-card">
      {d.logoUrl && /^\/[^/]/.test(d.logoUrl) ? <img src={d.logoUrl} alt={d.emisor} style={{ height: 40, width: 'auto', display: 'block', marginBottom: 10 }} data-logo /> : <div className="ad-emisor">{d.emisor}</div>}
      <div className="ad-h1">Detalle de servicios · {d.correlativo}</div>
      {d.version > 1 && <div className="ad-version" data-version={d.version}>Versión {d.version} · corregida</div>}
      <div className="ad-datos">
        <div><span className="ad-mute">Cliente</span> <strong>{d.cliente}</strong></div>
        {d.titulo && <div><span className="ad-mute">Corte</span> {d.titulo}</div>}
        {d.dirigidoA && <div><span className="ad-mute">Dirigido a</span> {d.dirigidoA}</div>}
        <div><span className="ad-mute">Pruebas</span> {d.lineas.length} · <span className="ad-mute">Total con IVA</span> <strong>{Q(d.total)}</strong></div>
        {d.estado === 'vigente' && <div className="ad-mute">Este link vence el {fecha(d.expiraEn)} y se usa una sola vez.</div>}
      </div>
      {d.notas && <div className="ad-notas"><span className="ad-mute">Notas:</span> {d.notas}</div>}
    </header>
  );
}

function Formulario({ detalle: d, token, onRespondido }: { detalle: DetallePublico; token: string; onRespondido: (r: { estado: 'aprobada' | 'con_observaciones'; observaciones: number }, detalle: DetallePublico) => void }) {
  const [resp, setResp] = useState<Record<string, Resp>>(() => Object.fromEntries(d.lineas.map(l => [l.ref, { decision: 'aprobado' as Decision, nota: '' }])));
  const [soloNoAprobadas, setSoloNoAprobadas] = useState(false);
  const [firmando, setFirmando] = useState(false);
  const [nombre, setNombre] = useState(''); const [cargo, setCargo] = useState(''); const [correo, setCorreo] = useState(''); const [autoriza, setAutoriza] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const firmaRef = useRef<FirmaCanvasHandle>(null);
  const noAprobadas = useMemo(() => d.lineas.filter(l => resp[l.ref]?.decision !== 'aprobado'), [d.lineas, resp]);
  const todas = noAprobadas.length === 0;
  const faltaNota = noAprobadas.filter(l => (resp[l.ref]?.nota ?? '').trim().length < 3);
  const visibles = soloNoAprobadas ? noAprobadas : d.lineas;
  const set = (ref: string, patch: Partial<Resp>) => setResp(r => ({ ...r, [ref]: { ...r[ref], ...patch } }));
  const aprobarTodo = () => { setResp(Object.fromEntries(d.lineas.map(l => [l.ref, { decision: 'aprobado' as Decision, nota: '' }]))); setSoloNoAprobadas(false); };

  const enviar = async () => {
    setError('');
    if (faltaNota.length) { setError(`Falta el motivo en ${faltaNota.length} línea${faltaNota.length === 1 ? '' : 's'} que no ${faltaNota.length === 1 ? 'está aprobada' : 'están aprobadas'}.`); setSoloNoAprobadas(true); return; }
    let firma: Record<string, unknown> | null = null;
    if (todas) {
      const png = firmaRef.current?.exportar() ?? '';
      if (!nombre.trim() || !cargo.trim() || !correo.trim()) { setError('Para firmar hacen falta tu nombre, cargo y correo.'); return; }
      if (!autoriza) { setError('Marcá la casilla de autorización para firmar.'); return; }
      if (!png) { setError('Dibujá tu firma en el recuadro.'); return; }
      if (png.length > LIMITE_FIRMA_PNG) { setError('La firma quedó demasiado pesada: limpiala y firmá de nuevo.'); return; }
      firma = { nombre: nombre.trim(), cargo: cargo.trim(), correo: correo.trim(), autoriza: true, png };
    }
    setEnviando(true);
    try {
      const { status, json } = await pedir({ accion: 'responder', token, respuestas: d.lineas.map(l => ({ ref: l.ref, decision: resp[l.ref].decision, nota: resp[l.ref].nota.trim() })), firma, empresa_web: honeypot });
      if (status !== 200 || !json.ok) { setError(String(json.error ?? 'No se pudo enviar. Probá de nuevo.')); return; }
      const estadoR = json.estado === 'aprobada' ? 'aprobada' : 'con_observaciones';
      const lineas: LineaPublica[] = d.lineas.map(l => ({ ...l, respuesta: { decision: resp[l.ref].decision, nota: resp[l.ref].nota.trim() } }));
      onRespondido({ estado: estadoR, observaciones: Number(json.observaciones ?? noAprobadas.length) }, { ...d, estado: 'respondido', lineas, resultado: { estado: estadoR, respondidoEn: new Date().toISOString(), nombre: nombre.trim(), cargo: cargo.trim(), observaciones: noAprobadas.length } });
    } catch { setError('No se pudo enviar. Revisá tu conexión y probá de nuevo.'); }
    finally { setEnviando(false); }
  };

  return (
    <>
      <Encabezado d={d} />
      <section className="ad-card">
        <div className="ad-barra">
          <div className="ad-mute">Revisá cada línea. <strong>Aprobado</strong> viene marcado por defecto; si algo no está bien, elegí la opción y escribí el motivo.</div>
          <div className="ad-acciones">
            <button type="button" className="ad-btn" onClick={aprobarTodo} data-accion="aprobar-todo">Aprobar todo</button>
            <button type="button" className={'ad-btn' + (soloNoAprobadas ? ' ad-btn-on' : '')} onClick={() => setSoloNoAprobadas(v => !v)} disabled={!noAprobadas.length && !soloNoAprobadas} data-accion="solo-no-aprobadas">{soloNoAprobadas ? 'Ver todas' : `Ver solo las que no aprobé (${noAprobadas.length})`}</button>
          </div>
        </div>
        <ol className="ad-lineas" data-lineas>
          {visibles.map((l, i) => {
            const r = resp[l.ref];
            return (
              <li key={l.ref} className={'ad-linea' + (r.decision !== 'aprobado' ? ' ad-linea-obs' : '')} data-linea={l.ref} data-decision={r.decision}>
                <div className="ad-linea-cab">
                  <div className="ad-persona"><span className="ad-num">{(soloNoAprobadas ? d.lineas.indexOf(l) : i) + 1}.</span> <strong>{l.persona}</strong>{l.puesto ? <span className="ad-mute"> · {l.puesto}</span> : null}</div>
                  <div className="ad-monto">{Q(l.monto)} <span className="ad-mute">IVA incl.</span></div>
                </div>
                <div className="ad-linea-datos">
                  <span>{l.resultado}</span>{l.categoria ? <span>· {l.categoria}</span> : null}{l.territorio ? <span>· {l.territorio}</span> : null}
                  {l.solicitante ? <span>· solicitó {l.solicitante}</span> : null}{l.fechaIngreso ? <span>· ingreso {fecha(l.fechaIngreso)}</span> : null}
                </div>
                {l.previa && (
                  <div className="ad-previa" data-previa>
                    <div><span className="ad-mute">En la versión anterior marcaste</span> <strong>{ETIQUETA_DECISION[l.previa.decision]}</strong>{l.previa.nota ? <>: <em>{l.previa.nota}</em></> : null}</div>
                    {l.previa.respuestaGolden && <div><span className="ad-mute">Respuesta de {d.emisor}:</span> {l.previa.respuestaGolden}</div>}
                  </div>
                )}
                <div className="ad-opciones" role="radiogroup" aria-label={`Decisión para ${l.persona}`}>
                  {DECISIONES.map(dec => (
                    <label key={dec} className={'ad-opcion' + (r.decision === dec ? ' ad-opcion-on' : '')} title={DESCRIPCION_DECISION[dec]}>
                      <input type="radio" name={`dec-${l.ref}`} value={dec} checked={r.decision === dec} onChange={() => set(l.ref, { decision: dec })} />
                      {ETIQUETA_DECISION[dec]}
                    </label>
                  ))}
                </div>
                {exigeNota(r.decision) && (
                  <textarea className="ad-nota" placeholder={`Motivo (obligatorio): ${DESCRIPCION_DECISION[r.decision]}`} value={r.nota} onChange={e => set(l.ref, { nota: e.target.value })} maxLength={500} rows={2} aria-label={`Motivo para ${l.persona}`} data-nota />
                )}
              </li>
            );
          })}
          {visibles.length === 0 && <li className="ad-mute" style={{ padding: 14 }}>Todas las líneas están aprobadas.</li>}
        </ol>
        <div className="ad-totales" data-totales>
          <div className="ad-total"><span>Total (IVA incluido)</span> {Q(d.total)}</div>
          <div className="ad-mute" style={{ fontSize: 13 }}>Base sin IVA {Q(d.subtotal)} · IVA 12 % {Q(d.iva)}</div>
        </div>
      </section>

      <section className="ad-card" data-cierre>
        {/* campo trampa para bots: oculto; una persona nunca lo llena */}
        <div style={{ position: 'absolute', left: -9999, top: -9999, opacity: 0, height: 0, overflow: 'hidden' }} aria-hidden>
          <label>Empresa web <input type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={e => setHoneypot(e.target.value)} name="empresa_web" /></label>
        </div>
        {todas ? (
          <>
            {!firmando ? (
              <div className="ad-cierre-fila">
                <div><strong>Todo aprobado.</strong> <span className="ad-mute">Para terminar, firmá el detalle.</span></div>
                <button type="button" className="ad-btn ad-btn-primario" onClick={() => setFirmando(true)} data-accion="ir-a-firmar">Firmar y aprobar</button>
              </div>
            ) : (
              <div className="ad-firma" data-firma>
                <div className="ad-h2">Firma</div>
                <div className="ad-campos">
                  <label>Nombre<input value={nombre} onChange={e => setNombre(e.target.value)} maxLength={200} autoComplete="name" data-campo="nombre" /></label>
                  <label>Cargo<input value={cargo} onChange={e => setCargo(e.target.value)} maxLength={200} autoComplete="organization-title" data-campo="cargo" /></label>
                  <label>Correo<input value={correo} onChange={e => setCorreo(e.target.value)} maxLength={200} type="email" inputMode="email" autoComplete="email" data-campo="correo" /></label>
                </div>
                <label className="ad-check"><input type="checkbox" checked={autoriza} onChange={e => setAutoriza(e.target.checked)} data-campo="autoriza" /> Autorizo la facturación de este detalle por el total indicado ({Q(d.total)} con IVA).</label>
                <FirmaCanvas ref={firmaRef} />
                <div className="ad-mute" style={{ fontSize: 12 }}>Al confirmar se guardan tu nombre, cargo, correo, fecha y hora, y la huella del documento ({huella(d.huella)}).</div>
              </div>
            )}
          </>
        ) : (
          <div className="ad-cierre-fila">
            <div><strong>{noAprobadas.length} línea{noAprobadas.length === 1 ? '' : 's'} sin aprobar.</strong> <span className="ad-mute">No se puede firmar hasta que todo esté aprobado: {d.emisor} revisa tus observaciones y te manda una versión corregida.</span></div>
          </div>
        )}
        {error && <div className="ad-error" role="alert" data-error>{error}</div>}
        <div className="ad-cierre-fila" style={{ marginTop: 10 }}>
          <span className="ad-mute" style={{ fontSize: 12 }}>Después de enviar, este link queda en solo lectura.</span>
          {(firmando || !todas) && <button type="button" className="ad-btn ad-btn-primario" onClick={() => void enviar()} disabled={enviando} data-accion="enviar">{enviando ? 'Enviando…' : todas ? 'Confirmar firma y aprobar' : `Enviar observaciones a ${d.emisor}`}</button>}
        </div>
      </section>
    </>
  );
}

function SoloLectura({ detalle: d, recien }: { detalle: DetallePublico; recien?: { estado: 'aprobada' | 'con_observaciones'; observaciones: number } }) {
  const r = d.resultado;
  const aprobada = (recien?.estado ?? r?.estado) === 'aprobada';
  return (
    <>
      {recien && (
        <div className={'ad-card ad-confirmacion' + (aprobada ? ' ad-ok' : '')} role="status" data-confirmacion={recien.estado}>
          <div className="ad-h2">{aprobada ? 'Detalle aprobado y firmado' : 'Observaciones enviadas'}</div>
          <p>{aprobada ? `Gracias. Queda autorizada la facturación por ${Q(d.total)} con IVA.` : `${d.emisor} recibió ${recien.observaciones} ${recien.observaciones === 1 ? 'observación' : 'observaciones'}. Te van a mandar una versión corregida por correo.`}</p>
        </div>
      )}
      <Encabezado d={d} />
      <section className="ad-card" data-solo-lectura>
        <div className="ad-barra"><div className="ad-mute">Este detalle ya fue respondido{r?.respondidoEn ? ` el ${fechaHora(r.respondidoEn)}` : ''}{r?.nombre ? ` por ${r.nombre}${r.cargo ? ` (${r.cargo})` : ''}` : ''}. Es solo lectura.</div></div>
        <ol className="ad-lineas">
          {d.lineas.map((l, i) => (
            <li key={l.ref} className={'ad-linea' + (l.respuesta && l.respuesta.decision !== 'aprobado' ? ' ad-linea-obs' : '')} data-linea={l.ref} data-decision={l.respuesta?.decision ?? ''}>
              <div className="ad-linea-cab"><div className="ad-persona"><span className="ad-num">{i + 1}.</span> <strong>{l.persona}</strong>{l.puesto ? <span className="ad-mute"> · {l.puesto}</span> : null}</div><div className="ad-monto">{Q(l.monto)} <span className="ad-mute">IVA incl.</span></div></div>
              <div className="ad-linea-datos"><span>{l.resultado}</span>{l.categoria ? <span>· {l.categoria}</span> : null}{l.territorio ? <span>· {l.territorio}</span> : null}</div>
              <div className="ad-respuesta"><strong>{l.respuesta ? ETIQUETA_DECISION[l.respuesta.decision] : '—'}</strong>{l.respuesta?.nota ? <>: <em>{l.respuesta.nota}</em></> : null}</div>
            </li>
          ))}
        </ol>
        <div className="ad-totales" data-totales><div className="ad-total"><span>Total (IVA incluido)</span> {Q(d.total)}</div><div className="ad-mute" style={{ fontSize: 13 }}>Base sin IVA {Q(d.subtotal)} · IVA 12 % {Q(d.iva)}</div></div>
        {aprobada && <div className="ad-mute" style={{ fontSize: 12, marginTop: 8 }}>Aprobado digitalmente{r?.nombre ? ` por ${r.nombre}` : ''}{r?.respondidoEn ? ` el ${fechaHora(r.respondidoEn)}` : ''} · huella {huella(d.huella)}</div>}
      </section>
    </>
  );
}

// ── Firma dibujada (canvas, dedo o mouse) ───────────────────────────────────────────────────────
import { forwardRef, useImperativeHandle } from 'react';
interface FirmaCanvasHandle { exportar: () => string; limpiar: () => void }
const FirmaCanvas = forwardRef<FirmaCanvasHandle>(function FirmaCanvas(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [trazos, setTrazos] = useState(0);
  const dibujando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const c = canvasRef.current!; const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
  const empezar = (e: React.PointerEvent<HTMLCanvasElement>) => { e.preventDefault(); dibujando.current = true; ultimo.current = pos(e); canvasRef.current?.setPointerCapture(e.pointerId); };
  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dibujando.current || !ultimo.current) return;
    const c = canvasRef.current!; const ctx = c.getContext('2d')!; const p = pos(e);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    ctx.beginPath(); ctx.moveTo(ultimo.current.x, ultimo.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ultimo.current = p; setTrazos(t => t + 1);
  };
  const terminar = () => { dibujando.current = false; ultimo.current = null; };
  const limpiar = () => { const c = canvasRef.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setTrazos(0); };
  useImperativeHandle(ref, () => ({ exportar: () => (trazos > 0 && canvasRef.current ? canvasRef.current.toDataURL('image/png') : ''), limpiar }), [trazos]);
  return (
    <div className="ad-canvas-wrap">
      <canvas ref={canvasRef} width={720} height={220} className="ad-canvas" onPointerDown={empezar} onPointerMove={mover} onPointerUp={terminar} onPointerLeave={terminar} onPointerCancel={terminar} aria-label="Firmá acá con el dedo o el mouse" data-canvas-firma data-trazos={trazos} />
      <div className="ad-canvas-pie"><span className="ad-mute">Firmá acá con el dedo o el mouse.</span><button type="button" className="ad-btn" onClick={limpiar} data-accion="limpiar-firma">Limpiar</button></div>
    </div>
  );
});

const CSS = `
.ad-page { max-width: 760px; margin: 0 auto; padding: 16px; font-family: var(--font-sans, Inter, system-ui, sans-serif); color: #111; font-size: 15px; line-height: 1.45; }
.ad-card { background: #fff; border: 1px solid #e3e0d8; border-radius: 10px; padding: 16px; margin-bottom: 12px; position: relative; }
.ad-centro { text-align: center; padding: 36px 16px; }
.ad-emisor { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #666; }
.ad-h1 { font-family: var(--font-serif, Georgia, serif); font-size: 24px; font-weight: 600; margin: 2px 0 6px; }
.ad-h2 { font-family: var(--font-serif, Georgia, serif); font-size: 19px; font-weight: 600; margin: 0 0 8px; }
.ad-version { display: inline-block; background: #fbe9e9; color: #8a2a2a; font-size: 12px; padding: 2px 8px; border-radius: 4px; margin-bottom: 6px; }
.ad-datos { display: grid; gap: 2px; font-size: 14px; }
.ad-mute { color: #666; }
.ad-notas { margin-top: 8px; font-size: 13px; }
.ad-barra { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; font-size: 13px; margin-bottom: 10px; }
.ad-acciones { display: flex; gap: 6px; flex-wrap: wrap; }
.ad-btn { background: #fff; border: 1px solid #c9c4b8; border-radius: 6px; padding: 8px 12px; font-size: 14px; cursor: pointer; color: #111; min-height: 40px; }
.ad-btn:disabled { opacity: .5; cursor: default; }
.ad-btn-on { background: #efece4; }
.ad-btn-primario { background: #1a3b33; color: #fff; border-color: #1a3b33; font-weight: 600; }
.ad-lineas { list-style: none; margin: 0; padding: 0; }
.ad-linea { border-top: 1px solid #ece9e1; padding: 12px 0; }
.ad-linea-obs { background: #fff8f2; margin: 0 -16px; padding: 12px 16px; border-left: 3px solid #b5651d; }
.ad-linea-cab { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.ad-num { color: #999; font-size: 13px; }
.ad-monto { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }
.ad-linea-datos { font-size: 13px; color: #444; display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 2px 0 8px; }
.ad-previa { font-size: 13px; background: #f3f1ec; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; display: grid; gap: 2px; }
.ad-opciones { display: flex; flex-wrap: wrap; gap: 6px; }
.ad-opcion { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #c9c4b8; border-radius: 999px; padding: 7px 12px; font-size: 14px; cursor: pointer; background: #fff; min-height: 38px; }
.ad-opcion input { margin: 0; }
.ad-opcion-on { background: #1a3b33; color: #fff; border-color: #1a3b33; }
.ad-nota { display: block; width: 100%; box-sizing: border-box; margin-top: 8px; border: 1px solid #c9c4b8; border-radius: 6px; padding: 8px 10px; font: inherit; font-size: 14px; }
.ad-totales { border-top: 2px solid #111; margin-top: 10px; padding-top: 8px; display: grid; gap: 2px; justify-items: end; font-variant-numeric: tabular-nums; }
.ad-total { font-weight: 700; font-size: 17px; }
.ad-cierre-fila { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.ad-firma { display: grid; gap: 10px; }
.ad-campos { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.ad-campos label { display: grid; gap: 4px; font-size: 13px; color: #444; }
.ad-campos input { border: 1px solid #c9c4b8; border-radius: 6px; padding: 9px 10px; font: inherit; font-size: 15px; min-height: 42px; }
.ad-check { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; }
.ad-check input { margin-top: 4px; }
.ad-canvas-wrap { display: grid; gap: 6px; }
.ad-canvas { width: 100%; height: auto; aspect-ratio: 720 / 220; border: 1px dashed #8a8578; border-radius: 8px; background: #fff; touch-action: none; display: block; }
.ad-canvas-pie { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.ad-error { margin-top: 10px; background: #fbe9e9; color: #8a2a2a; padding: 8px 10px; border-radius: 6px; font-size: 14px; }
.ad-confirmacion { border-color: #b5651d; }
.ad-ok { border-color: #3d7a4e; }
.ad-respuesta { font-size: 14px; margin-top: 4px; }
@media (max-width: 480px) { .ad-page { padding: 10px; } .ad-card { padding: 12px; border-radius: 8px; } .ad-linea-obs { margin: 0 -12px; padding: 12px; } .ad-h1 { font-size: 21px; } .ad-opcion { padding: 7px 10px; font-size: 13.5px; } }
`;
