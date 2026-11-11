'use client';

/**
 * PAQUETES PREPAGADOS (034) · sección «Paquetes» del cliente en el tarifario: la lista de sus paquetes (barra usadas / total,
 * remanente, vence, estado) y «Crear paquete» (admin y contador): nombre, fecha de inicio, vencimiento opcional, umbral de
 * aviso, factura del anticipo (buscar por número o «pendiente de facturar»), notas y las líneas (servicio, categoría y
 * territorio con los mismos selectores del tarifario, cantidad y precio unitario propuesto desde la tarifa vigente).
 * Con fecha de inicio en el pasado, «Vista previa» muestra las pruebas ya terminadas que descontaría; el CFO confirma.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { usePuede } from '@/components/auth/permisos';
import { CATEGORIAS, TERRITORIOS, TIPOS_PRUEBA, UNICA, formaPrecio, usaCategoria, usaTerritorio } from '@/lib/tarifario/canon';
import type { Tarifa } from '@/lib/tarifario/lookup';
import { NOMBRE_SERVICIO } from '@/lib/facturacion-agenda/situacion';
import { BADGE_ESTADO, ETIQUETA_ESTADO, estadoEfectivo, etiquetaLinea, porcentajeUsado, totalCantidad, totalRemanente, totalUsadas, umbralPorDefecto, valorRemanente, type Paquete } from '@/lib/paquetes/paquete';
import { buscarFacturaAnticipoAction, crearPaqueteAction, vistaPreviaPaqueteAction } from '@/app/(app)/paquetes/actions';
import type { FacturaAnticipo, VistaPreviaLinea } from '@/lib/db/paquetes';

export const SERVICIO_PSICOMETRICAS = 'PSICOMETRICAS';
const SERVICIOS = [...TIPOS_PRUEBA.filter(t => t !== 'COMPLETO'), SERVICIO_PSICOMETRICAS];
const nombreServicio = (s: string) => NOMBRE_SERVICIO[s] ?? (s === SERVICIO_PSICOMETRICAS ? 'Psicométricas' : s);
const fecha = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

interface LineaForm { uid: string; servicio: string; categoria: string; territorio: string; cantidad: string; precio: string; precioEditado: boolean }
const nuevaLinea = (): LineaForm => ({ uid: Math.random().toString(36).slice(2, 9), servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: '', cantidad: '', precio: '', precioEditado: false });
/** La forma de precio del servicio dice si lleva categoría / territorio; las psicométricas no se tarifan: todo UNICA. */
const dims = (servicio: string) => { if (servicio === SERVICIO_PSICOMETRICAS) return { cat: false, ter: false }; const f = formaPrecio(servicio); return { cat: usaCategoria(f), ter: usaTerritorio(f) }; };
/** Precio propuesto: la tarifa activa con monto del mismo servicio y categoría (y territorio si se fijó; si no, la primera que calce). */
function precioPropuesto(tarifas: readonly Tarifa[], l: Pick<LineaForm, 'servicio' | 'categoria' | 'territorio'>): number | null {
  const d = dims(l.servicio);
  const cand = tarifas.filter(t => t.activo && Number(t.monto) > 0 && t.tipoPrueba === l.servicio && (!d.cat || t.categoria === l.categoria || t.categoria === UNICA) && (!d.ter || !l.territorio || t.territorio === l.territorio || t.territorio === UNICA));
  if (!cand.length) return null;
  return Number((cand.find(t => t.territorio === l.territorio) ?? cand[0]).monto);
}

export function BarraUso({ p }: { p: Pick<Paquete, 'lineas'> }) {
  const pct = porcentajeUsado(p);
  return (
    <div title={`${totalUsadas(p)} usadas de ${totalCantidad(p)} · restan ${totalRemanente(p)}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--line-2)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: pct >= 90 ? 'var(--wine)' : pct >= 70 ? 'var(--burnt, #b5651d)' : 'var(--olive)' }} /></div>
      <span className="num" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }} data-usadas={totalUsadas(p)} data-total={totalCantidad(p)}>{totalUsadas(p)} / {totalCantidad(p)}</span>
    </div>
  );
}

export function PaquetesSection({ nit, razonSocial, tarifas, paquetes, hoy }: { nit: string; razonSocial: string; tarifas: Tarifa[]; paquetes: Paquete[]; hoy: string }) {
  const puede = usePuede();
  const router = useRouter();
  const puedeGestionar = puede('gestionar_paquetes');
  const [creando, setCreando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nombre, setNombre] = useState('');
  const [inicio, setInicio] = useState(hoy);
  const [vence, setVence] = useState('');
  const [umbral, setUmbral] = useState('');
  const [noFactura, setNoFactura] = useState('');
  const [factura, setFactura] = useState<FacturaAnticipo | null | 'no'>(null);
  const [notas, setNotas] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([nuevaLinea()]);
  const [vista, setVista] = useState<VistaPreviaLinea[] | null>(null);
  const [aplicarRetro, setAplicarRetro] = useState(true);
  const totalCant = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0), 0);

  const lineasInput = () => lineas.map(l => { const d = dims(l.servicio); return { servicio: l.servicio, categoria: d.cat ? l.categoria : UNICA, territorio: d.ter && l.territorio ? l.territorio : null, cantidad: Number(l.cantidad) || 0, precioUnitario: Number(l.precio) || 0 }; });
  const setLinea = (uid: string, patch: Partial<LineaForm>) => setLineas(ls => ls.map(l => {
    if (l.uid !== uid) return l;
    const n = { ...l, ...patch };
    if (!n.precioEditado && (patch.servicio !== undefined || patch.categoria !== undefined || patch.territorio !== undefined)) { const p = precioPropuesto(tarifas, n); n.precio = p === null ? '' : String(p); }
    return n;
  }));
  const agregarLinea = () => setLineas(ls => [...ls, (() => { const l = nuevaLinea(); const p = precioPropuesto(tarifas, l); if (p !== null) l.precio = String(p); return l; })()]);
  const abrir = () => { setCreando(true); setVista(null); setLineas([(() => { const l = nuevaLinea(); const p = precioPropuesto(tarifas, l); if (p !== null) l.precio = String(p); return l; })()]); };
  const esRetro = inicio < hoy;
  const valido = nombre.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(inicio) && (!vence || vence >= inicio) && lineas.length > 0 && lineas.every(l => Number(l.cantidad) > 0 && Number(l.precio) >= 0);

  const buscarFactura = async () => {
    if (!noFactura.trim()) { setFactura(null); return; }
    setBusy(true);
    try { const f = await buscarFacturaAnticipoAction(noFactura); setFactura(f ?? 'no'); if (!f) toast.warning(`No encontré la factura ${noFactura.trim()}: podés dejarla pendiente de facturar y enlazarla después.`); }
    finally { setBusy(false); }
  };
  const previsualizar = async () => {
    setBusy(true);
    try { setVista(await vistaPreviaPaqueteAction(nit, inicio, vence || null, lineasInput())); }
    finally { setBusy(false); }
  };
  const guardar = async () => {
    if (!valido) return;
    if (esRetro && !vista) { await previsualizar(); return; }   // primero la vista previa; el CFO confirma
    setBusy(true);
    try {
      const r = await crearPaqueteAction({ nit, nombre: nombre.trim(), fechaInicio: inicio, venceEn: vence || null, umbralAviso: umbral ? Number(umbral) : null, noFactura: noFactura.trim() || null, notas: notas.trim() || null, retroactivoConfirmado: esRetro && aplicarRetro, lineas: lineasInput() });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`Paquete ${r.correlativo} creado · ${r.aplicado.consumidos} prueba${r.aplicado.consumidos === 1 ? '' : 's'} ya descontada${r.aplicado.consumidos === 1 ? '' : 's'}${r.aplicado.avisos.length ? ` · ${r.aplicado.avisos.map(a => a.aviso === 'agotado' ? 'agotado' : `por agotarse (quedan ${a.remanente})`).join(', ')}` : ''}`);
      setCreando(false); setNombre(''); setVence(''); setUmbral(''); setNoFactura(''); setFactura(null); setNotas(''); setVista(null);
      router.refresh();
    } finally { setBusy(false); }
  };

  const vigentes = useMemo(() => paquetes.filter(p => p.estado !== 'cerrado'), [paquetes]);
  const cerrados = paquetes.length - vigentes.length;

  return (
    <div className="card" style={{ marginBottom: 14 }} data-paquetes={paquetes.length}>
      <div className="card-head">
        <div className="card-title">Paquetes prepagados <span className="cell-mute" style={{ fontWeight: 400, fontSize: 12 }}>· {vigentes.length} vigente{vigentes.length === 1 ? '' : 's'}{cerrados ? ` · ${cerrados} cerrado${cerrados === 1 ? '' : 's'}` : ''}</span></div>
        <div className="card-actions" style={{ display: 'flex', gap: 8 }}>
          <Link href="/paquetes" className="btn btn-ghost" style={{ fontSize: 12 }}>Todos los paquetes</Link>
          {puedeGestionar && !creando && <button type="button" className="btn btn-primary" style={{ fontSize: 12 }} onClick={abrir} data-accion="crear-paquete"><I.Plus size={12} /> Crear paquete</button>}
        </div>
      </div>

      {creando && (
        <div className="card-pad" style={{ borderBottom: '1px solid var(--line-3)', display: 'grid', gap: 12, fontSize: 12.5 }} data-form-paquete>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div className="field" style={{ margin: 0, gridColumn: 'span 2' }}><label className="label">Nombre</label><input className="input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder={`Paquete 100 polígrafos ${hoy.slice(0, 4)}`} data-campo="nombre" /></div>
            <div className="field" style={{ margin: 0 }}><label className="label">Fecha de inicio</label><input className="input" type="date" value={inicio} onChange={e => { setInicio(e.target.value); setVista(null); }} data-campo="fecha-inicio" title="Cubre pruebas con resultado desde esta fecha" /></div>
            <div className="field" style={{ margin: 0 }}><label className="label">Vence (opcional)</label><input className="input" type="date" value={vence} onChange={e => { setVence(e.target.value); setVista(null); }} data-campo="vence" /></div>
            <div className="field" style={{ margin: 0 }}><label className="label">Aviso cuando queden</label><input className="input num" inputMode="numeric" value={umbral} onChange={e => setUmbral(e.target.value.replace(/\D/g, ''))} placeholder={String(umbralPorDefecto(totalCant))} data-campo="umbral" title="Por defecto el 10 % de la cantidad o 5, lo que sea mayor" /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0, minWidth: 220 }}><label className="label">Factura del anticipo</label><input className="input" value={noFactura} onChange={e => { setNoFactura(e.target.value); setFactura(null); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void buscarFactura(); } }} placeholder="Número de factura, o dejar pendiente" data-campo="no-factura" /></div>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => void buscarFactura()} disabled={busy || !noFactura.trim()} data-accion="buscar-factura"><I.Search size={12} /> Buscar</button>
            {factura && factura !== 'no' && <span className="badge badge-olive" data-factura-encontrada>{factura.noFactura} · {fecha(factura.fechaEmision)} · {Q(factura.total)}{factura.cliente ? ` · ${factura.cliente}` : ''}</span>}
            {factura === 'no' && <span className="badge badge-warn">no encontrada · queda pendiente de facturar</span>}
            {!noFactura.trim() && <span className="cell-mute" style={{ fontSize: 11.5 }}>Sin número: pendiente de facturar (se enlaza después desde el detalle).</span>}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><strong style={{ fontSize: 12 }}>Líneas</strong><span className="cell-mute" style={{ fontSize: 11.5 }}>cada línea cubre un servicio y una categoría; una prueba de otra categoría se factura aparte</span></div>
            <div style={{ display: 'grid', gap: 6 }}>
              {lineas.map((l, i) => { const d = dims(l.servicio); return (
                <div key={l.uid} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.4fr) minmax(120px, 1fr) minmax(120px, 1fr) 90px 110px 32px', gap: 6, alignItems: 'center' }} data-linea-form={i}>
                  <select className="input" value={l.servicio} onChange={e => setLinea(l.uid, { servicio: e.target.value })} aria-label="Servicio" data-campo="linea-servicio">{SERVICIOS.map(s => <option key={s} value={s}>{nombreServicio(s)}</option>)}</select>
                  <select className="input" value={d.cat ? l.categoria : UNICA} onChange={e => setLinea(l.uid, { categoria: e.target.value })} disabled={!d.cat} aria-label="Categoría" data-campo="linea-categoria">{d.cat ? CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>) : <option value={UNICA}>— cualquiera —</option>}</select>
                  <select className="input" value={d.ter ? l.territorio : ''} onChange={e => setLinea(l.uid, { territorio: e.target.value })} disabled={!d.ter} aria-label="Territorio" data-campo="linea-territorio"><option value="">Cualquier territorio</option>{d.ter && TERRITORIOS.map(t => <option key={t} value={t}>{t}</option>)}</select>
                  <input className="input num" inputMode="numeric" placeholder="Cant." value={l.cantidad} onChange={e => setLinea(l.uid, { cantidad: e.target.value.replace(/\D/g, '') })} aria-label="Cantidad" data-campo="linea-cantidad" />
                  <input className="input num" inputMode="decimal" placeholder="Precio s/IVA" value={l.precio} onChange={e => setLinea(l.uid, { precio: e.target.value.replace(/[^\d.]/g, ''), precioEditado: true })} aria-label="Precio unitario sin IVA" data-campo="linea-precio" title={precioPropuesto(tarifas, l) === null ? 'Sin tarifa vigente para proponer: escribí el precio pactado' : `Tarifa vigente: ${Q(precioPropuesto(tarifas, l)!)}`} />
                  <button type="button" className="btn btn-ghost" style={{ padding: '4px 6px' }} onClick={() => setLineas(ls => ls.length > 1 ? ls.filter(x => x.uid !== l.uid) : ls)} disabled={lineas.length === 1} aria-label="Quitar línea"><I.X size={12} /></button>
                </div>
              ); })}
            </div>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, marginTop: 6 }} onClick={agregarLinea} data-accion="agregar-linea"><I.Plus size={12} /> Otra línea</button>
          </div>
          <div className="field" style={{ margin: 0 }}><label className="label">Notas (opcional)</label><input className="input" value={notas} onChange={e => setNotas(e.target.value)} data-campo="notas" /></div>

          {esRetro && (
            <div className="card" role="status" style={{ borderColor: 'var(--burnt, #b5651d)' }} data-vista-previa={vista ? vista.reduce((a, v) => a + v.tomaria, 0) : ''}>
              <div className="card-pad" style={{ fontSize: 12.5, display: 'grid', gap: 6 }}>
                <div>La fecha de inicio está en el pasado: hay pruebas <strong>ya terminadas y sin facturar</strong> desde el {fecha(inicio)} que este paquete descontaría. {!vista && <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => void previsualizar()} disabled={busy || !valido} data-accion="vista-previa">Ver vista previa</button>}</div>
                {vista && vista.map(v => (
                  <div key={v.n} data-vista-linea={v.n} data-tomaria={v.tomaria}>
                    <strong>{etiquetaLinea({ servicio: v.servicio, categoria: v.categoria, territorio: v.territorio }, nombreServicio)}</strong>: {v.candidatas} prueba{v.candidatas === 1 ? '' : 's'} terminada{v.candidatas === 1 ? '' : 's'} · descontaría <strong>{v.tomaria}</strong> de {v.cantidad}
                    {v.pruebas.length > 0 && <div className="cell-mute" style={{ fontSize: 11.5 }}>{v.pruebas.slice(0, v.tomaria).map(p => `${p.persona || p.idExterno} (${fecha(p.fecha)})`).join(' · ')}{v.candidatas > v.tomaria ? ` · las otras ${v.candidatas - v.tomaria} quedan a tarifa` : ''}</div>}
                  </div>
                ))}
                {vista && <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={aplicarRetro} onChange={e => setAplicarRetro(e.target.checked)} data-campo="aplicar-retro" /> Aplicar el paquete a esas pruebas ya terminadas (si no, solo descuenta las que terminen de ahora en adelante)</label>}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setCreando(false)} disabled={busy}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={busy || !valido} data-accion="guardar-paquete">{busy ? 'Guardando…' : esRetro && !vista ? 'Ver vista previa' : 'Crear paquete'}</button>
          </div>
        </div>
      )}

      {paquetes.length === 0 ? <div className="card-pad cell-mute" style={{ fontSize: 12.5 }} data-sin-paquetes>Este cliente no tiene paquetes prepagados.{puedeGestionar ? ' Creá uno cuando venda N pruebas por adelantado.' : ''}</div> : (
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="table">
            <thead><tr><th>Paquete</th><th>Líneas</th><th>Usadas / total</th><th className="num">Remanente</th><th className="num">Valor</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {paquetes.map(p => { const e = estadoEfectivo(p, hoy); return (
                <tr key={p.id} data-paquete={p.correlativo} data-estado={e} data-remanente={totalRemanente(p)}>
                  <td><Link href={`/tarifario/paquetes/${p.id}`} className="cell-strong" style={{ textDecoration: 'none', color: 'var(--ink)' }}>{p.correlativo}</Link><div className="cell-mute" style={{ fontSize: 11 }}>{p.nombre}{p.noFactura ? ` · factura ${p.noFactura}` : ' · pendiente de facturar'}</div></td>
                  <td style={{ fontSize: 12 }}>{p.lineas.map(l => <div key={l.id}>{etiquetaLinea(l, nombreServicio)}: <span className="num">{l.remanente}</span> de {l.cantidad}</div>)}</td>
                  <td><BarraUso p={p} /></td>
                  <td className="num cell-strong">{totalRemanente(p)}</td>
                  <td className="num cell-mute" title="remanente × precio unitario, sin IVA">{Q(valorRemanente(p))}</td>
                  <td className="num" style={{ fontSize: 12 }}>{fecha(p.venceEn)}</td>
                  <td><span className={'badge ' + BADGE_ESTADO[e]} data-badge-estado={e}>{ETIQUETA_ESTADO[e]}</span>{p.retroPendientes > 0 && <span className="badge badge-outline" style={{ marginLeft: 4, fontSize: 10 }} title="Pruebas terminadas antes de crear el paquete que esperan tu confirmación">{p.retroPendientes} por confirmar</span>}</td>
                  <td><Link href={`/tarifario/paquetes/${p.id}`} className="btn btn-ghost" style={{ fontSize: 12 }} data-accion="ver-paquete">Detalle →</Link></td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
      {razonSocial ? null : null}
    </div>
  );
}
