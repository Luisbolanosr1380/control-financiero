'use client';

/**
 * TARIFARIO · tabla de tarifas (modo plano): filtros por tipo, categoría,
 * territorio y estado; edición inline del monto; aprobar; desactivar /
 * reactivar; CSV; alta en modal con aviso de combinación repetida.
 * Con `nitFijo` queda scoped a una empresa (detalle) y el alta precarga el NIT.
 */
import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { Q } from '@/lib/utils';
import { csvEscape } from '@/lib/facturacion/reporte-csv';
import { activarTarifaAction, aprobarTarifaAction, editarTarifaAction } from '@/app/(app)/tarifario/actions';
import { CATEGORIAS, TERRITORIOS, TIPOS_PRUEBA, canonCategoria, canonTerritorio, canonTipoPrueba, esSinTarifa } from '@/lib/tarifario/canon';
import { tarifasDuplicadas, type Tarifa } from '@/lib/tarifario/lookup';
import { TarifaForm } from './tarifa-form';

interface Props { disponible: boolean; tarifas: Tarifa[]; /** Detalle de una empresa: oculta el buscador por NIT y precarga el alta. */ nitFijo?: string; razonSocialFija?: string }
type Estado = 'activas' | 'pendientes' | 'aprobadas' | 'sin_tarifa' | 'duplicadas' | 'inactivas';

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

export function TarifasTabla({ disponible, tarifas, nitFijo, razonSocialFija }: Props) {
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
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tarifario_${nitFijo ? nitFijo + '_' : ''}${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          {!nitFijo && <input className="input" placeholder="NIT o razón social…" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />}
          <select className="input" value={tipo} onChange={e => setTipo(e.target.value)} title="Tipo de prueba"><option value="">Tipo (todos)</option>{tipos.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <select className="input" value={categoria} onChange={e => setCategoria(e.target.value)} title="Categoría"><option value="">Categoría (todas)</option>{categorias.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <select className="input" value={territorio} onChange={e => setTerritorio(e.target.value)} title="Territorio"><option value="">Territorio (todos)</option>{TERRITORIOS.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <select className="input" value={estado} onChange={e => setEstado(e.target.value as Estado)} title="Estado">
            <option value="activas">Activas</option><option value="pendientes">Pendientes de aprobación</option><option value="aprobadas">Aprobadas</option>
            <option value="sin_tarifa">Sin tarifa (Q0)</option><option value="duplicadas">Combinaciones repetidas</option><option value="inactivas">Inactivas</option>
          </select>
          <span style={{ marginLeft: 'auto', color: 'var(--ink-4)' }}>{filas.length} tarifa{filas.length === 1 ? '' : 's'}</span>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={exportar} disabled={filas.length === 0}><I.Download size={13} /> CSV</button>
          {puedeEditar && disponible && <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => setAlta(true)}><I.Plus size={13} /> Nueva tarifa</button>}
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

      {alta && <TarifaForm onClose={() => setAlta(false)} tarifas={tarifas} inicial={nitFijo ? { nit: nitFijo, razonSocial: razonSocialFija } : undefined} />}
    </>
  );
}
