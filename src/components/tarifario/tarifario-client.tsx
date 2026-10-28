'use client';

/**
 * TARIFARIO · pantalla de gestión: lista filtrable (NIT/razón social, tipo,
 * categoría, territorio, estado), KPIs, alta (modal), edición inline del
 * monto, aprobación (gobierno), desactivar/reactivar, CSV y un simulador
 * que corre el motor de lookup como lo haría un expediente de la Agenda.
 */
import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { Q } from '@/lib/utils';
import { csvEscape } from '@/lib/facturacion/reporte-csv';
import { activarTarifaAction, aprobarTarifaAction, editarTarifaAction, resolverTarifaAction } from '@/app/(app)/tarifario/actions';
import { CATEGORIAS, TERRITORIOS, TIPOS_PRUEBA, canonCategoria, canonTerritorio, canonTipoPrueba, esSinTarifa } from '@/lib/tarifario/canon';
import { tarifasDuplicadas, type ResultadoLookup, type Tarifa } from '@/lib/tarifario/lookup';
import { TarifaForm } from './tarifa-form';

interface Props { disponible: boolean; tarifas: Tarifa[] }
type Estado = 'activas' | 'pendientes' | 'aprobadas' | 'sin_tarifa' | 'duplicadas' | 'inactivas';

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

export function TarifarioClient({ disponible, tarifas }: Props) {
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
  const [busyId, setBusyId] = useState<string | null>(null);

  const duplicadas = useMemo(() => tarifasDuplicadas(tarifas), [tarifas]);
  const activas = tarifas.filter(t => t.activo);
  const kpis = {
    tarifas: activas.length,
    clientes: new Set(activas.map(t => t.nit)).size,
    sinTarifa: activas.filter(t => esSinTarifa(t.monto)).length,
    pendientes: activas.filter(t => !t.aprobadoEn && !esSinTarifa(t.monto)).length,
    duplicadas: duplicadas.size,
  };
  const tipos = useMemo(() => [...new Set([...TIPOS_PRUEBA.filter(t => t !== 'COMPLETO'), ...tarifas.map(t => canonTipoPrueba(t.tipoPrueba))])], [tarifas]);
  const categorias = useMemo(() => [...new Set([...CATEGORIAS, ...tarifas.map(t => canonCategoria(t.categoria))])], [tarifas]);

  let filas = tarifas;
  if (estado === 'activas')     filas = filas.filter(t => t.activo);
  if (estado === 'pendientes')  filas = filas.filter(t => t.activo && !t.aprobadoEn && !esSinTarifa(t.monto));
  if (estado === 'aprobadas')   filas = filas.filter(t => t.activo && !!t.aprobadoEn);
  if (estado === 'sin_tarifa')  filas = filas.filter(t => t.activo && esSinTarifa(t.monto));
  if (estado === 'duplicadas')  filas = filas.filter(t => duplicadas.has(t.id));
  if (estado === 'inactivas')   filas = filas.filter(t => !t.activo);
  if (tipo)       filas = filas.filter(t => canonTipoPrueba(t.tipoPrueba) === tipo);
  if (categoria)  filas = filas.filter(t => canonCategoria(t.categoria) === categoria);
  if (territorio) filas = filas.filter(t => canonTerritorio(t.territorio) === territorio);
  if (search.trim()) { const q = search.toLowerCase(); filas = filas.filter(t => t.nit.toLowerCase().includes(q) || t.razonSocial.toLowerCase().includes(q)); }

  const guardarMonto = async (t: Tarifa) => {
    const m = Number(montoEdit.replace(/,/g, ''));
    if (!Number.isFinite(m) || m < 0) { toast.error('Monto inválido.'); return; }
    setBusyId(t.id);
    try { const r = await editarTarifaAction(t.id, { monto: m }); if (r.ok) { toast.success(r.mensaje); setEditando(null); router.refresh(); } else toast.error(r.error); }
    finally { setBusyId(null); }
  };
  const aprobar = async (t: Tarifa) => { setBusyId(t.id); try { const r = await aprobarTarifaAction(t.id); if (r.ok) { toast.success(r.mensaje); router.refresh(); } else toast.error(r.error); } finally { setBusyId(null); } };
  const activar = async (t: Tarifa, activo: boolean) => { setBusyId(t.id); try { const r = await activarTarifaAction(t.id, activo); if (r.ok) { toast.success(r.mensaje); router.refresh(); } else toast.error(r.error); } finally { setBusyId(null); } };

  const exportar = () => {
    const L = [['NIT', 'Razon_Social', 'Tipo_Prueba', 'Categoria', 'Territorio', 'Monto_Sin_IVA', 'IVA', 'Total_Con_IVA', 'Anio', 'Estado', 'Aprobado_Por', 'Aprobado_En', 'Activa'].join(',')];
    for (const t of filas) {
      const iva = Math.round(t.monto * 12) / 100;
      L.push([t.nit, t.razonSocial, canonTipoPrueba(t.tipoPrueba), canonCategoria(t.categoria), canonTerritorio(t.territorio), t.monto.toFixed(2), iva.toFixed(2), (t.monto + iva).toFixed(2), t.anio, esSinTarifa(t.monto) ? 'sin tarifa' : t.aprobadoEn ? 'aprobada' : 'pendiente', t.aprobadoPor, t.aprobadoEn ? t.aprobadoEn.slice(0, 10) : '', t.activo ? 'sí' : 'no'].map(csvEscape).join(','));
    }
    const blob = new Blob(['﻿' + L.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tarifario_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tarifario</h1>
          <div className="page-subtitle">Precio pactado con cada cliente (NIT) por tipo de prueba, categoría y territorio. Montos <strong>sin IVA</strong>; Q0 = sin tarifa definida.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={exportar} disabled={filas.length === 0}><I.Download size={13} /> Exportar CSV</button>
          {puedeEditar && disponible && <button className="btn btn-primary" onClick={() => setAlta(true)}><I.Plus size={13} /> Nueva tarifa</button>}
        </div>
      </div>

      {!disponible && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }}>
          <div className="card-pad" style={{ fontSize: 13 }}>Falta aplicar la migración <strong>014_tarifario</strong> en esta base.</div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 14 }}>
        <div className="kpi"><div className="kpi-label">Tarifas activas</div><div className="kpi-value">{kpis.tarifas}</div><div className="kpi-delta"><span className="vs">{kpis.clientes} clientes (NIT)</span></div></div>
        <div className="kpi"><div className="kpi-label">Aprobadas</div><div className="kpi-value">{kpis.tarifas - kpis.pendientes - kpis.sinTarifa}</div><div className="kpi-delta"><span className="vs">gobierno: aprobado por / en</span></div></div>
        <div className="kpi"><div className="kpi-label">Pendientes de aprobación</div><div className="kpi-value" style={{ color: kpis.pendientes ? 'var(--burnt, #b5651d)' : undefined }}>{kpis.pendientes}</div><div className="kpi-delta"><span className="vs">con monto, sin aprobar</span></div></div>
        <div className="kpi"><div className="kpi-label">Sin tarifa (Q0)</div><div className="kpi-value" style={{ color: kpis.sinTarifa ? 'var(--wine)' : undefined }}>{kpis.sinTarifa}</div><div className="kpi-delta"><span className="vs">no es gratis: falta pactar</span></div></div>
        <div className="kpi"><div className="kpi-label">Combinaciones repetidas</div><div className="kpi-value" style={{ color: kpis.duplicadas ? 'var(--wine)' : undefined }}>{kpis.duplicadas}</div><div className="kpi-delta"><span className="vs">misma llave, distinta grafía</span></div></div>
      </div>

      <Simulador />

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <input className="input" placeholder="NIT o razón social…" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />
          <select className="input" value={tipo} onChange={e => setTipo(e.target.value)} title="Tipo de prueba"><option value="">Tipo (todos)</option>{tipos.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <select className="input" value={categoria} onChange={e => setCategoria(e.target.value)} title="Categoría"><option value="">Categoría (todas)</option>{categorias.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <select className="input" value={territorio} onChange={e => setTerritorio(e.target.value)} title="Territorio"><option value="">Territorio (todos)</option>{TERRITORIOS.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <select className="input" value={estado} onChange={e => setEstado(e.target.value as Estado)} title="Estado">
            <option value="activas">Activas</option><option value="pendientes">Pendientes de aprobación</option><option value="aprobadas">Aprobadas</option>
            <option value="sin_tarifa">Sin tarifa (Q0)</option><option value="duplicadas">Combinaciones repetidas</option><option value="inactivas">Inactivas</option>
          </select>
          <span style={{ marginLeft: 'auto', color: 'var(--ink-4)' }}>{filas.length} tarifa{filas.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div className="card">
        <table className="table">
          <thead><tr><th>Cliente</th><th>Tipo</th><th>Categoría</th><th>Territorio</th><th className="num">Monto sin IVA</th><th className="num">Con IVA</th><th>Año</th><th>Aprobación</th><th></th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>{tarifas.length === 0 ? 'El tarifario está vacío.' : 'Nada con esos filtros.'}{puedeEditar && disponible && tarifas.length === 0 ? ' Cargá la primera con "Nueva tarifa".' : ''}</td></tr>}
            {filas.map(t => {
              const sin = esSinTarifa(t.monto);
              return (
                <Fragment key={t.id}>
                  <tr style={{ opacity: t.activo ? 1 : 0.55, background: duplicadas.has(t.id) ? 'rgba(138, 42, 42, 0.05)' : undefined }}>
                    <td><div className="cell-strong" style={{ fontSize: 12.5 }}>{t.razonSocial || '—'}</div><div className="num cell-mute" style={{ fontSize: 11 }}>NIT {t.nit}{duplicadas.has(t.id) && <span className="badge badge-wine" style={{ fontSize: 9.5, marginLeft: 6 }}>Repetida</span>}</div></td>
                    <td style={{ fontSize: 12 }}>{canonTipoPrueba(t.tipoPrueba)}{canonTipoPrueba(t.tipoPrueba) !== t.tipoPrueba.trim().toUpperCase() && <span className="cell-mute" style={{ fontSize: 10.5 }}> ({t.tipoPrueba})</span>}</td>
                    <td style={{ fontSize: 12 }}>{canonCategoria(t.categoria)}{canonCategoria(t.categoria) !== t.categoria.trim().toUpperCase() && <span className="cell-mute" style={{ fontSize: 10.5 }}> ({t.categoria})</span>}</td>
                    <td style={{ fontSize: 12 }}>{canonTerritorio(t.territorio)}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {editando === t.id ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <input autoFocus aria-label={`Monto de ${t.razonSocial || t.nit} ${canonTipoPrueba(t.tipoPrueba)} ${canonCategoria(t.categoria)} ${canonTerritorio(t.territorio)}`} className="input num" value={montoEdit} disabled={busyId === t.id} onChange={e => setMontoEdit(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void guardarMonto(t); } if (e.key === 'Escape') setEditando(null); }} style={{ fontSize: 12, padding: '3px 6px', width: 90 }} />
                          <button type="button" className="btn btn-primary" style={{ fontSize: 11, padding: '3px 8px' }} disabled={busyId === t.id} onClick={() => void guardarMonto(t)}>Guardar</button>
                          <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 6px' }} disabled={busyId === t.id} onClick={() => setEditando(null)}>Esc</button>
                        </span>
                      ) : sin ? <span className="badge badge-wine" style={{ fontSize: 10 }}>Sin tarifa</span> : <span className="cell-strong">{Q(t.monto)}</span>}
                      {puedeEditar && t.activo && editando !== t.id && <button type="button" className="btn btn-ghost" aria-label={`Editar monto de ${t.razonSocial || t.nit} ${canonTipoPrueba(t.tipoPrueba)} ${canonCategoria(t.categoria)} ${canonTerritorio(t.territorio)}`} title="Editar monto" style={{ fontSize: 11, padding: '1px 6px', marginLeft: 4 }} onClick={() => { setEditando(t.id); setMontoEdit(t.monto.toFixed(2)); }}>✎</button>}
                    </td>
                    <td className="num cell-mute">{sin ? '—' : Q(Math.round(t.monto * 112) / 100)}</td>
                    <td className="cell-mute" style={{ fontSize: 12 }}>{t.anio || '—'}</td>
                    <td style={{ fontSize: 11.5 }}>
                      {!t.activo ? <span className="badge badge-mute" style={{ fontSize: 10 }}>Inactiva</span>
                        : sin ? <span className="cell-mute">no aplica</span>
                        : t.aprobadoEn ? <><span className="badge badge-olive" style={{ fontSize: 10 }}>Aprobada</span><div className="cell-mute" style={{ fontSize: 10.5 }}>{t.aprobadoPor} · {fecha(t.aprobadoEn)}</div></>
                        : <><span className="badge badge-warn" style={{ fontSize: 10 }}>Pendiente</span>{puedeEditar && <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px', marginLeft: 4 }} disabled={busyId === t.id} onClick={() => void aprobar(t)}>Aprobar</button>}</>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {puedeEditar && (t.activo
                        ? <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} disabled={busyId === t.id} onClick={() => void activar(t, false)}>Desactivar</button>
                        : <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} disabled={busyId === t.id} onClick={() => void activar(t, true)}>Reactivar</button>)}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 10 }}>Una tarifa no se borra: se desactiva (queda el histórico). Cambiar el monto de una tarifa aprobada la deja pendiente de aprobación.</p>

      {alta && <TarifaForm onClose={() => setAlta(false)} tarifas={tarifas} />}
    </div>
  );
}

/** Corre el motor con los mismos datos que trae un expediente de la Agenda. */
function Simulador() {
  const [empresa, setEmpresa] = useState('');
  const [nit, setNit] = useState('');
  const [tipo, setTipo] = useState('POLIGRAFO');
  const [categoria, setCategoria] = useState('PRE EMPLEO');
  const [territorio, setTerritorio] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ResultadoLookup | null>(null);
  const correr = async () => {
    setBusy(true);
    try { setRes(await resolverTarifaAction({ nit: nit || undefined, empresa: empresa || undefined, tipoPrueba: tipo, categoria, territorio: territorio || undefined })); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };
  const color = res?.estado === 'ok' ? 'var(--olive)' : res?.estado === 'sin_tarifa' || res?.estado === 'ambigua' ? 'var(--burnt, #b5651d)' : 'var(--wine)';
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-head"><div className="card-title">Probar un precio (como lo resolvería un expediente de la Agenda)</div></div>
      <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
        <input className="input" placeholder="Empresa (como en la Agenda)" value={empresa} onChange={e => setEmpresa(e.target.value)} style={{ minWidth: 200 }} aria-label="Empresa" />
        <input className="input num" placeholder="o NIT" value={nit} onChange={e => setNit(e.target.value)} style={{ width: 120 }} aria-label="NIT" />
        <select className="input" value={tipo} onChange={e => setTipo(e.target.value)} aria-label="Tipo de prueba">{TIPOS_PRUEBA.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <select className="input" value={categoria} onChange={e => setCategoria(e.target.value)} aria-label="Categoría">{CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <select className="input" value={territorio} onChange={e => setTerritorio(e.target.value)} aria-label="Territorio"><option value="">Territorio (no indicado)</option>{TERRITORIOS.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <button className="btn btn-secondary" onClick={() => void correr()} disabled={busy || (!empresa.trim() && !nit.trim())}>{busy ? 'Buscando…' : 'Resolver precio'}</button>
      </div>
      {res && (
        <div role="status" className="card-pad" style={{ borderTop: '1px solid var(--line-2)', fontSize: 13, color }}>
          {res.estado === 'ok' && <>
            <strong>Q{res.monto.toFixed(2)} sin IVA</strong> · IVA Q{res.iva.toFixed(2)} · total <strong>Q{res.total.toFixed(2)}</strong> · NIT {res.nit} · {res.tarifa.razonSocial}
            {res.componentes && <span className="cell-mute"> ({res.componentes.map(c => `${canonTipoPrueba(c.tipoPrueba)} Q${c.monto.toFixed(2)}`).join(' + ')})</span>}
            {!res.aprobada && <span className="badge badge-warn" style={{ fontSize: 10, marginLeft: 8 }}>Tarifa no aprobada</span>}
            {res.avisos.filter(a => !/no está aprobada/.test(a)).map(a => <div key={a} style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>· {a}</div>)}
          </>}
          {res.estado === 'sin_tarifa' && <><strong>Sin tarifa definida.</strong> {res.mensaje}</>}
          {res.estado === 'ambigua' && <><strong>Ambigua.</strong> {res.mensaje}</>}
          {res.estado === 'no_encontrada' && <><strong>No encontrada.</strong> {res.mensaje}</>}
          {res.estado === 'cliente_no_identificado' && <><strong>Cliente no identificado.</strong> {res.mensaje}</>}
        </div>
      )}
    </div>
  );
}
