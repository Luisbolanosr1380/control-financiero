'use client';

/**
 * TARIFARIO · tabla de tarifas (modo plano): filtros por tipo, categoría,
 * territorio y estado; edición inline del monto (con motivo opcional para la
 * bitácora); aprobar; desactivar / reactivar; CSV; alta en modal con aviso de
 * combinación repetida. Por fila: antigüedad del precio ("última subida: hace
 * X" / "desde {año}", en ámbar/rojo si está estancada) y "ver histórico" con
 * la línea de tiempo y el sparkline de cómo creció.
 * Con `nitFijo` queda scoped a una empresa (detalle) y el alta precarga el NIT.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { Q } from '@/lib/utils';
import { csvEscape } from '@/lib/facturacion/reporte-csv';
import { activarTarifaAction, aprobarTarifaAction, editarTarifaAction, historialTarifaAction } from '@/app/(app)/tarifario/actions';
import { CATEGORIAS, TERRITORIOS, TIPOS_PRUEBA, canonCategoria, canonTerritorio, canonTipoPrueba, dimTexto, esSinTarifa, esUnica, formaPrecio } from '@/lib/tarifario/canon';
import { tarifasDuplicadas, type Tarifa } from '@/lib/tarifario/lookup';
import { ETIQUETAS_ACCION, UMBRAL_ESTANCADA_MESES_DEFAULT, crecimiento, puntosPrecio, textoAntiguedad, type AntiguedadPrecio, type HistorialTarifa } from '@/lib/tarifario/antiguedad';
import { TarifaForm } from './tarifa-form';

interface Props {
  disponible: boolean; tarifas: Tarifa[];
  /** Detalle de una empresa: oculta el buscador por NIT y precarga el alta. */
  nitFijo?: string; razonSocialFija?: string;
  /** id → antigüedad del precio (bitácora 015 o año de la tarifa). */
  antiguedad?: Record<string, AntiguedadPrecio>;
  umbralMeses?: number;
}
type Estado = 'activas' | 'pendientes' | 'aprobadas' | 'sin_tarifa' | 'estancadas' | 'duplicadas' | 'inactivas';

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const pct = (v: number | null) => (v === null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(2)} %`);
const QA = (v: number | null) => (v === null ? '—' : esSinTarifa(v) ? 'sin tarifa' : `Q${v.toFixed(2)}`);

export function TarifasTabla({ disponible, tarifas, nitFijo, razonSocialFija, antiguedad = {}, umbralMeses = UMBRAL_ESTANCADA_MESES_DEFAULT }: Props) {
  const router = useRouter();
  const puede = usePuede();
  const puedeEditar = puede('catalogos');
  const [search, setSearch] = useState('');
  const [tipo, setTipo] = useState('');
  const [categoria, setCategoria] = useState('');
  const [territorio, setTerritorio] = useState('');
  const [estado, setEstado] = useState<Estado>('activas');
  const [alta, setAlta] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [montoEdit, setMontoEdit] = useState('');
  const [motivoEdit, setMotivoEdit] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [historial, setHistorial] = useState<Record<string, HistorialTarifa[] | 'cargando'>>({});

  const duplicadas = useMemo(() => tarifasDuplicadas(tarifas), [tarifas]);
  const tipos = useMemo(() => [...new Set([...TIPOS_PRUEBA.filter(t => t !== 'COMPLETO'), ...tarifas.map(t => canonTipoPrueba(t.tipoPrueba))])], [tarifas]);
  const categorias = useMemo(() => [...new Set([...CATEGORIAS, ...tarifas.map(t => canonCategoria(t.categoria))])].filter(Boolean), [tarifas]);

  let filas = tarifas;
  if (estado === 'activas')     filas = filas.filter(t => t.activo);
  if (estado === 'pendientes')  filas = filas.filter(t => t.activo && !t.aprobadoEn && !esSinTarifa(t.monto));
  if (estado === 'aprobadas')   filas = filas.filter(t => t.activo && !!t.aprobadoEn);
  if (estado === 'sin_tarifa')  filas = filas.filter(t => t.activo && esSinTarifa(t.monto));
  if (estado === 'estancadas')  filas = filas.filter(t => t.activo && !!antiguedad[t.id]?.estancada);
  if (estado === 'duplicadas')  filas = filas.filter(t => duplicadas.has(t.id));
  if (estado === 'inactivas')   filas = filas.filter(t => !t.activo);
  if (tipo)       filas = filas.filter(t => canonTipoPrueba(t.tipoPrueba) === tipo);
  if (categoria)  filas = filas.filter(t => canonCategoria(t.categoria) === categoria);
  if (territorio) filas = filas.filter(t => canonTerritorio(t.territorio) === territorio);
  if (search.trim()) { const q = search.toLowerCase(); filas = filas.filter(t => t.nit.toLowerCase().includes(q) || t.razonSocial.toLowerCase().includes(q)); }

  const descripcion = (t: Tarifa) => `${t.razonSocial || t.nit} ${canonTipoPrueba(t.tipoPrueba)} ${canonCategoria(t.categoria)} ${canonTerritorio(t.territorio)}`;

  const guardarMonto = async (t: Tarifa) => {
    const m = Number(montoEdit.replace(/,/g, ''));
    if (!Number.isFinite(m) || m < 0) { toast.error('Monto inválido.'); return; }
    setBusyId(t.id);
    try {
      const r = await editarTarifaAction(t.id, { monto: m, motivo: motivoEdit.trim() || undefined });
      if (r.ok) { toast.success(r.mensaje); setEditando(null); setMotivoEdit(''); invalidarHist(t.id); router.refresh(); } else toast.error(r.error);
    } finally { setBusyId(null); }
  };
  const aprobar = async (t: Tarifa) => { setBusyId(t.id); try { const r = await aprobarTarifaAction(t.id); if (r.ok) { toast.success(r.mensaje); invalidarHist(t.id); router.refresh(); } else toast.error(r.error); } finally { setBusyId(null); } };
  const activar = async (t: Tarifa, activo: boolean) => { setBusyId(t.id); try { const r = await activarTarifaAction(t.id, activo); if (r.ok) { toast.success(r.mensaje); invalidarHist(t.id); router.refresh(); } else toast.error(r.error); } finally { setBusyId(null); } };
  const invalidarHist = (id: string) => setHistorial(h => { const { [id]: _omitido, ...resto } = h; void _omitido; return resto; });
  // El histórico se carga al abrir la fila y se recarga solo tras cada escritura (la caché se invalida).
  useEffect(() => {
    const id = abierto;
    if (!id || historial[id]) return;
    setHistorial(h => ({ ...h, [id]: 'cargando' }));
    historialTarifaAction(id)
      .then(rows => setHistorial(h => ({ ...h, [id]: rows })))
      .catch((e: unknown) => { toast.error(e instanceof Error ? e.message : 'No se pudo cargar el histórico.'); setHistorial(h => ({ ...h, [id]: [] })); });
  }, [abierto, historial]);
  const verHistorial = (t: Tarifa) => setAbierto(abierto === t.id ? null : t.id);

  const exportar = () => {
    const L = [['NIT', 'Razon_Social', 'Tipo_Prueba', 'Categoria', 'Territorio', 'Monto_Sin_IVA', 'IVA', 'Total_Con_IVA', 'Anio', 'Estado', 'Aprobado_Por', 'Aprobado_En', 'Activa', 'Precio_Desde', 'Meses_Sin_Cambio', 'Estancada'].join(',')];
    for (const t of filas) {
      const iva = Math.round(t.monto * 12) / 100;
      const a = antiguedad[t.id];
      L.push([t.nit, t.razonSocial, canonTipoPrueba(t.tipoPrueba), canonCategoria(t.categoria), canonTerritorio(t.territorio), t.monto.toFixed(2), iva.toFixed(2), (t.monto + iva).toFixed(2), t.anio, esSinTarifa(t.monto) ? 'sin tarifa' : t.aprobadoEn ? 'aprobada' : 'pendiente', t.aprobadoPor, t.aprobadoEn ? t.aprobadoEn.slice(0, 10) : '', t.activo ? 'sí' : 'no', a?.desde ? a.desde.slice(0, 10) : '', a?.desde ? String(a.meses) : '', a?.estancada ? 'sí' : 'no'].map(csvEscape).join(','));
    }
    const blob = new Blob(['﻿' + L.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tarifario_${nitFijo ? nitFijo + '_' : ''}${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          {!nitFijo && <input className="input" placeholder="NIT o razón social…" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />}
          <select className="input" value={tipo} onChange={e => setTipo(e.target.value)} title="Tipo de prueba"><option value="">Tipo (todos)</option>{tipos.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <select className="input" value={categoria} onChange={e => setCategoria(e.target.value)} title="Categoría"><option value="">Categoría (todas)</option>{categorias.map(c => <option key={c} value={c}>{esUnica(c) ? 'Única (sin categoría)' : c}</option>)}</select>
          <select className="input" value={territorio} onChange={e => setTerritorio(e.target.value)} title="Territorio"><option value="">Territorio (todos)</option>{TERRITORIOS.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <select className="input" value={estado} onChange={e => setEstado(e.target.value as Estado)} title="Estado">
            <option value="activas">Activas</option><option value="pendientes">Pendientes de aprobación</option><option value="aprobadas">Aprobadas</option>
            <option value="sin_tarifa">Sin tarifa (Q0)</option><option value="estancadas">Estancadas (sin subir &gt; {umbralMeses} meses)</option><option value="duplicadas">Combinaciones repetidas</option><option value="inactivas">Inactivas</option>
          </select>
          <span style={{ marginLeft: 'auto', color: 'var(--ink-4)' }}>{filas.length} tarifa{filas.length === 1 ? '' : 's'}</span>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={exportar} disabled={filas.length === 0}><I.Download size={13} /> CSV</button>
          {puedeEditar && disponible && <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => setAlta(true)}><I.Plus size={13} /> Nueva tarifa</button>}
        </div>
      </div>

      <div className="card">
        <table className="table">
          <thead><tr><th>Cliente</th><th>Tipo</th><th>Categoría</th><th>Territorio</th><th className="num">Monto sin IVA</th><th className="num">Con IVA</th><th>Precio desde</th><th>Aprobación</th><th></th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>{tarifas.length === 0 ? 'El tarifario está vacío.' : 'Nada con esos filtros.'}{puedeEditar && disponible && tarifas.length === 0 ? ' Cargá la primera con "Nueva tarifa".' : ''}</td></tr>}
            {filas.map(t => {
              const sin = esSinTarifa(t.monto);
              const a = antiguedad[t.id];
              const hist = historial[t.id];
              return (
                <Fragment key={t.id}>
                  <tr style={{ opacity: t.activo ? 1 : 0.55, background: duplicadas.has(t.id) ? 'rgba(138, 42, 42, 0.05)' : undefined }}>
                    <td><div className="cell-strong" style={{ fontSize: 12.5 }}>{t.razonSocial || '—'}</div><div className="num cell-mute" style={{ fontSize: 11 }}>NIT {t.nit}{duplicadas.has(t.id) && <span className="badge badge-wine" style={{ fontSize: 9.5, marginLeft: 6 }}>Repetida</span>}</div></td>
                    <td style={{ fontSize: 12 }}>{canonTipoPrueba(t.tipoPrueba)}{canonTipoPrueba(t.tipoPrueba) !== t.tipoPrueba.trim().toUpperCase() && <span className="cell-mute" style={{ fontSize: 10.5 }}> ({t.tipoPrueba})</span>}</td>
                    <td style={{ fontSize: 12 }} title={esUnica(t.categoria) ? 'Sin categoría: la forma de precio de este servicio no la usa' : undefined}>{dimTexto(t.categoria)}{!esUnica(t.categoria) && canonCategoria(t.categoria) !== t.categoria.trim().toUpperCase() && <span className="cell-mute" style={{ fontSize: 10.5 }}> ({t.categoria})</span>}</td>
                    <td style={{ fontSize: 12 }} title={esUnica(t.territorio) ? (formaPrecio(t.tipoPrueba) === 'categoria' ? 'Sin territorio: precio por categoría, el mismo en metro y depto' : 'Sin territorio: precio único por cliente') : undefined}>{dimTexto(t.territorio)}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {editando === t.id ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <input autoFocus aria-label={`Monto de ${descripcion(t)}`} className="input num" value={montoEdit} disabled={busyId === t.id} onChange={e => setMontoEdit(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void guardarMonto(t); } if (e.key === 'Escape') setEditando(null); }} style={{ fontSize: 12, padding: '3px 6px', width: 90 }} />
                          <input aria-label={`Motivo del cambio de ${descripcion(t)}`} className="input" placeholder="Motivo (opcional)" value={motivoEdit} disabled={busyId === t.id} maxLength={200} onChange={e => setMotivoEdit(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void guardarMonto(t); } if (e.key === 'Escape') setEditando(null); }} style={{ fontSize: 12, padding: '3px 6px', width: 150 }} />
                          <button type="button" className="btn btn-primary" style={{ fontSize: 11, padding: '3px 8px' }} disabled={busyId === t.id} onClick={() => void guardarMonto(t)}>Guardar</button>
                          <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 6px' }} disabled={busyId === t.id} onClick={() => setEditando(null)}>Esc</button>
                        </span>
                      ) : sin ? <span className="badge badge-wine" style={{ fontSize: 10 }}>Sin tarifa</span> : <span className="cell-strong">{Q(t.monto)}</span>}
                      {puedeEditar && t.activo && editando !== t.id && <button type="button" className="btn btn-ghost" aria-label={`Editar monto de ${descripcion(t)}`} title="Editar monto" style={{ fontSize: 11, padding: '1px 6px', marginLeft: 4 }} onClick={() => { setEditando(t.id); setMontoEdit(t.monto.toFixed(2)); setMotivoEdit(''); }}>✎</button>}
                    </td>
                    <td className="num cell-mute">{sin ? '—' : Q(Math.round(t.monto * 112) / 100)}</td>
                    <td style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                      <div className="cell-mute">{t.anio || '—'}</div>
                      {a && t.activo && !sin && (
                        <span className={'badge ' + (a.estancada ? (a.meses > umbralMeses * 2 ? 'badge-wine' : 'badge-warn') : 'badge-mute')} style={{ fontSize: 10 }} title={a.estancada ? `Estancada: ${a.meses} meses sin subir (umbral ${umbralMeses})` : a.desde ? `${a.meses} meses` : undefined}>
                          {textoAntiguedad(a)}{a.estancada ? ' · estancada' : ''}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 11.5 }}>
                      {!t.activo ? <span className="badge badge-mute" style={{ fontSize: 10 }}>Inactiva</span>
                        : sin ? <span className="cell-mute">no aplica</span>
                        : t.aprobadoEn ? <><span className="badge badge-olive" style={{ fontSize: 10 }}>Aprobada</span><div className="cell-mute" style={{ fontSize: 10.5 }}>{t.aprobadoPor} · {fecha(t.aprobadoEn)}</div></>
                        : <><span className="badge badge-warn" style={{ fontSize: 10 }}>Pendiente</span>{puedeEditar && <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px', marginLeft: 4 }} disabled={busyId === t.id} onClick={() => void aprobar(t)}>Aprobar</button>}</>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn btn-ghost" aria-label={`Ver histórico de ${descripcion(t)}`} aria-expanded={abierto === t.id} style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => verHistorial(t)}>{abierto === t.id ? 'Cerrar' : 'Histórico'}</button>
                      {puedeEditar && (t.activo
                        ? <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} disabled={busyId === t.id} onClick={() => void activar(t, false)}>Desactivar</button>
                        : <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} disabled={busyId === t.id} onClick={() => void activar(t, true)}>Reactivar</button>)}
                    </td>
                  </tr>
                  {abierto === t.id && (
                    <tr data-historial-de={t.id}>
                      <td colSpan={9} style={{ background: 'var(--bg-2)', padding: '10px 14px' }}>
                        {hist === 'cargando' || hist === undefined ? <span className="cell-mute" style={{ fontSize: 12 }}>Cargando histórico…</span> : <HistorialPanel rows={hist} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 10 }}>Una tarifa no se borra: se desactiva (queda el histórico). Cambiar el monto de una tarifa aprobada la deja pendiente de aprobación. &quot;Precio desde&quot;: último cambio registrado o, si no hay, el año de la tarifa; estancada = sin subir hace más de {umbralMeses} meses.</p>

      {alta && <TarifaForm onClose={() => setAlta(false)} tarifas={tarifas} inicial={nitFijo ? { nit: nitFijo, razonSocial: razonSocialFija } : undefined} />}
    </>
  );
}

/** Línea de tiempo de una tarifa + sparkline de cómo creció el precio (si hay ≥ 2 puntos). */
function HistorialPanel({ rows }: { rows: HistorialTarifa[] }) {
  if (rows.length === 0) return <span className="cell-mute" style={{ fontSize: 12 }}>Sin movimientos registrados: el histórico arranca con el primer cambio desde la pantalla (las tarifas cargadas al inicio no tienen bitácora; su &quot;precio desde&quot; sale del año).</span>;
  const puntos = puntosPrecio(rows);
  const crec = crecimiento(puntos);
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <table className="table" style={{ fontSize: 11.5, flex: 1, minWidth: 420 }} aria-label="Línea de tiempo">
        <thead><tr><th>Fecha</th><th>Acción</th><th className="num">Anterior → nuevo</th><th className="num">±%</th><th>Usuario</th><th>Motivo</th></tr></thead>
        <tbody>
          {[...rows].sort((x, y) => y.seq - x.seq).map(h => (
            <tr key={h.id}>
              <td className="cell-mute" style={{ whiteSpace: 'nowrap' }}>{fechaHora(h.createdAt)}</td>
              <td>{ETIQUETAS_ACCION[h.accion] ?? h.accion}</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>{h.accion === 'cambio_precio' ? `${QA(h.montoAnterior)} → ${QA(h.montoNuevo)}` : QA(h.montoNuevo)}</td>
              <td className="num" style={{ color: h.variacionPct === null ? undefined : h.variacionPct > 0 ? 'var(--olive)' : 'var(--wine)' }}>{pct(h.variacionPct)}</td>
              <td className="cell-mute">{h.usuario || <span title="Cambio hecho por fuera de la pantalla (SQL directo)">—</span>}</td>
              <td className="cell-mute">{h.motivo || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {puntos.length >= 2 && crec && (
        <div style={{ minWidth: 200, fontSize: 12 }} aria-label="Evolución del precio">
          <div className="cell-strong" style={{ marginBottom: 4 }}>Cómo creció</div>
          <Sparkline valores={puntos.map(p => p.monto)} />
          <div className="cell-mute" style={{ marginTop: 4 }}>
            Q{crec.inicial.toFixed(2)} → Q{crec.final.toFixed(2)}{crec.pct !== null && <> · <span style={{ color: crec.pct >= 0 ? 'var(--olive)' : 'var(--wine)' }}>{pct(crec.pct)}</span></>} en {puntos.length - 1} cambio{puntos.length - 1 === 1 ? '' : 's'}
          </div>
        </div>
      )}
    </div>
  );
}

function Sparkline({ valores }: { valores: number[] }) {
  const W = 200, H = 40, P = 4;
  const min = Math.min(...valores), max = Math.max(...valores);
  const y = (v: number) => (max === min ? H / 2 : P + (H - 2 * P) * (1 - (v - min) / (max - min)));
  const x = (i: number) => P + ((W - 2 * P) * i) / Math.max(1, valores.length - 1);
  const d = valores.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Precio: ${valores.map(v => `Q${v.toFixed(2)}`).join(' → ')}`}>
      <path d={d} fill="none" stroke="var(--olive)" strokeWidth={1.5} />
      {valores.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={i === valores.length - 1 ? 'var(--olive)' : 'var(--ink-4)'} />)}
    </svg>
  );
}
