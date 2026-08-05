'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { formatDate } from '@/lib/utils';
import { crearRoadmapItemAction, editarRoadmapItemAction } from '@/app/(app)/admin/roadmap/actions';
import {
  ESTADOS_ROADMAP, PRIORIDADES_ROADMAP, CATEGORIAS_ROADMAP_SUGERIDAS,
  type RoadmapItem, type EstadoRoadmap, type PrioridadRoadmap,
} from '@/lib/db/roadmap';

interface Props {
  items: RoadmapItem[];
}

// Descartado no tiene columna en el kanban — se ve solo en la lista.
const COLUMNAS: EstadoRoadmap[] = ['Idea', 'Pendiente', 'En progreso', 'Hecho', 'Pausado'];

const COLOR_PRIORIDAD: Record<PrioridadRoadmap, string> = {
  Alta: 'badge-wine', Media: 'badge-warn', Baja: 'badge-mute',
};

// Colores estables por categoría (hash simple sobre una paleta).
const PALETA_CAT = [
  { color: '#1d4ed8', bg: 'rgba(37, 99, 235, 0.10)' },
  { color: 'var(--olive)', bg: 'var(--olive-bg)' },
  { color: '#6d28d9', bg: 'rgba(124, 58, 237, 0.10)' },
  { color: 'var(--wine)', bg: 'var(--wine-bg)' },
  { color: 'var(--amber)', bg: 'var(--amber-bg)' },
  { color: 'var(--ink-3)', bg: 'var(--bg-2)' },
];
function colorCategoria(cat: string) {
  let h = 0;
  for (const ch of cat) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return PALETA_CAT[h % PALETA_CAT.length];
}

interface FormState {
  id?: string;                 // presente = edición
  titulo: string; descripcion: string; categoria: string; estado: EstadoRoadmap;
  prioridad: PrioridadRoadmap; impacto: string; fechaObjetivo: string; notas: string;
}
const FORM_VACIO: FormState = {
  titulo: '', descripcion: '', categoria: '', estado: 'Idea',
  prioridad: 'Media', impacto: '', fechaObjetivo: '', notas: '',
};

export function RoadmapClient({ items }: Props) {
  const router = useRouter();
  const [vista, setVista] = useState<'kanban' | 'lista'>('kanban');
  const [fCategoria, setFCategoria] = useState('');
  const [fPrioridad, setFPrioridad] = useState('');
  const [fEstado, setFEstado] = useState('');       // solo vista lista
  const [soloAlta, setSoloAlta] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [cambiando, setCambiando] = useState<string | null>(null);

  const categorias = useMemo(() => [...new Set(items.map(i => i.categoria))].sort(), [items]);

  const filtrados = useMemo(() => {
    let out = items;
    if (fCategoria) out = out.filter(i => i.categoria === fCategoria);
    if (fPrioridad) out = out.filter(i => i.prioridad === fPrioridad);
    if (soloAlta)   out = out.filter(i => i.prioridad === 'Alta');
    return out;
  }, [items, fCategoria, fPrioridad, soloAlta]);

  const porEstado = useMemo(() => {
    const m = new Map<EstadoRoadmap, RoadmapItem[]>();
    for (const e of ESTADOS_ROADMAP) m.set(e, []);
    for (const i of filtrados) m.get(i.estado)!.push(i);
    return m;
  }, [filtrados]);

  const resumen = useMemo(() => {
    const m = new Map<EstadoRoadmap, number>();
    for (const i of items) m.set(i.estado, (m.get(i.estado) ?? 0) + 1);
    return m;
  }, [items]);

  const cambiarEstado = async (item: RoadmapItem, estado: EstadoRoadmap) => {
    if (estado === item.estado) return;
    setCambiando(item.id);
    try {
      const res = await editarRoadmapItemAction(item.id, { estado });
      if (res.ok) { toast.success(estado === 'Hecho' ? `"${item.titulo}" → Hecho ✓ (fecha sellada)` : `"${item.titulo}" → ${estado}`); router.refresh(); }
      else toast.error(res.error);
    } finally { setCambiando(null); }
  };

  const abrirEdicion = (i: RoadmapItem) => setForm({
    id: i.id, titulo: i.titulo, descripcion: i.descripcion ?? '', categoria: i.categoria,
    estado: i.estado, prioridad: i.prioridad, impacto: i.impacto ?? '',
    fechaObjetivo: i.fechaObjetivo ?? '', notas: i.notas ?? '',
  });

  const guardar = async () => {
    if (!form || !form.titulo.trim()) return;
    setLoading(true);
    try {
      const payload = {
        titulo: form.titulo, descripcion: form.descripcion, categoria: form.categoria || 'General',
        estado: form.estado, prioridad: form.prioridad, impacto: form.impacto,
        fechaObjetivo: form.fechaObjetivo || undefined, notas: form.notas,
      };
      const res = form.id
        ? await editarRoadmapItemAction(form.id, payload)
        : await crearRoadmapItemAction(payload);
      if (res.ok) { toast.success(res.mensaje); setForm(null); router.refresh(); }
      else toast.error(res.error);
    } finally { setLoading(false); }
  };

  const Tarjeta = ({ i }: { i: RoadmapItem }) => {
    const cc = colorCategoria(i.categoria);
    return (
      <div
        className="card"
        style={{ padding: '10px 12px', cursor: 'pointer', opacity: cambiando === i.id ? 0.5 : 1 }}
        onClick={() => abrirEdicion(i)}
        title="Editar / notas"
      >
        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', marginBottom: 6, lineHeight: 1.35 }}>{i.titulo}</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginBottom: i.impacto ? 6 : 0 }}>
          <span className="badge" style={{ color: cc.color, background: cc.bg, fontSize: 10 }}>{i.categoria}</span>
          <span className={`badge ${COLOR_PRIORIDAD[i.prioridad]}`} style={{ fontSize: 10 }}>{i.prioridad}</span>
          {i.fechaObjetivo && <span className="num" style={{ fontSize: 10, color: 'var(--ink-4)' }}>🎯 {formatDate(i.fechaObjetivo)}</span>}
          {i.estado === 'Hecho' && i.fechaHecho && <span className="num" style={{ fontSize: 10, color: 'var(--olive)' }}>✓ {formatDate(i.fechaHecho.slice(0, 10))}</span>}
        </div>
        {i.impacto && <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4, marginBottom: 6 }}>{i.impacto}</div>}
        <select
          className="input"
          style={{ fontSize: 11, padding: '3px 6px', width: '100%' }}
          value={i.estado}
          disabled={cambiando === i.id}
          onClick={e => e.stopPropagation()}
          onChange={e => cambiarEstado(i, e.target.value as EstadoRoadmap)}
        >
          {ESTADOS_ROADMAP.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Roadmap</h1>
          <div className="page-subtitle" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            {ESTADOS_ROADMAP.filter(e => (resumen.get(e) ?? 0) > 0)
              .map(e => `${resumen.get(e)} ${e.toLowerCase()}`).join(' · ') || 'Tablero vacío — agregá el primer ítem.'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignSelf: 'flex-start' }}>
          <button className={`btn ${vista === 'kanban' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setVista('kanban')}>Tablero</button>
          <button className={`btn ${vista === 'lista' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setVista('lista')}>Lista</button>
          <button className="btn btn-primary" onClick={() => setForm({ ...FORM_VACIO })}><I.Plus size={13} /> Nuevo ítem</button>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <select className="input" style={{ width: 'auto' }} value={fCategoria} onChange={e => setFCategoria(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input" style={{ width: 'auto' }} value={fPrioridad} onChange={e => setFPrioridad(e.target.value)}>
          <option value="">Todas las prioridades</option>
          {PRIORIDADES_ROADMAP.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {vista === 'lista' && (
          <select className="input" style={{ width: 'auto' }} value={fEstado} onChange={e => setFEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            {ESTADOS_ROADMAP.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloAlta} onChange={e => setSoloAlta(e.target.checked)} />
          Solo alta prioridad
        </label>
      </div>

      {vista === 'kanban' ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLUMNAS.length}, minmax(200px, 1fr))`, gap: 12, alignItems: 'start', overflowX: 'auto' }}>
          {COLUMNAS.map(col => {
            const lista = porEstado.get(col) ?? [];
            return (
              <div key={col} style={{ background: 'var(--bg-2)', borderRadius: 'var(--r-2)', padding: 10 }}>
                <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{col}</span><span className="num">{lista.length}</span>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {lista.map(i => <Tarjeta key={i.id} i={i} />)}
                  {lista.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-4)', textAlign: 'center', padding: '14px 0' }}>—</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ítem</th><th>Categoría</th><th>Prioridad</th><th>Estado</th>
                <th className="num">Objetivo</th><th className="num">Hecho</th><th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.filter(i => !fEstado || i.estado === fEstado).map(i => {
                const cc = colorCategoria(i.categoria);
                return (
                  <tr key={i.id} className="clickable" onClick={() => abrirEdicion(i)}>
                    <td className="cell-strong" style={{ maxWidth: 340 }}>
                      {i.titulo}
                      {i.impacto && <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 400 }}>{i.impacto}</div>}
                    </td>
                    <td><span className="badge" style={{ color: cc.color, background: cc.bg }}>{i.categoria}</span></td>
                    <td><span className={`badge ${COLOR_PRIORIDAD[i.prioridad]}`}>{i.prioridad}</span></td>
                    <td onClick={e => e.stopPropagation()}>
                      <select className="input" style={{ fontSize: 11.5, padding: '3px 6px' }} value={i.estado}
                        disabled={cambiando === i.id} onChange={e => cambiarEstado(i, e.target.value as EstadoRoadmap)}>
                        {ESTADOS_ROADMAP.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="num cell-mute">{i.fechaObjetivo ? formatDate(i.fechaObjetivo) : '—'}</td>
                    <td className="num" style={{ color: 'var(--olive)' }}>{i.fechaHecho ? formatDate(i.fechaHecho.slice(0, 10)) : '—'}</td>
                    <td><I.More size={13} style={{ color: 'var(--ink-4)' }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div onClick={() => { if (!loading) setForm(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20,18,16,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 'min(600px, 96vw)', maxHeight: '92vh', overflowY: 'auto', background: 'var(--paper)', borderRadius: 'var(--r-3)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <I.TrendUp size={15} style={{ color: 'var(--ink-3)' }} />
              <div style={{ fontSize: 14, fontWeight: 500 }}>{form.id ? 'Editar ítem' : 'Nuevo ítem'}</div>
              <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setForm(null)} disabled={loading}><I.X size={15} /></button>
            </div>
            <div style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                <label className="label">Título *</label>
                <input className="input" value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} disabled={loading} autoFocus />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Categoría</label>
                <input className="input" list="roadmap-cats" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} disabled={loading} placeholder="General" />
                <datalist id="roadmap-cats">
                  {[...new Set([...CATEGORIAS_ROADMAP_SUGERIDAS, ...categorias])].map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Prioridad</label>
                <select className="input" value={form.prioridad} onChange={e => setForm({ ...form, prioridad: e.target.value as PrioridadRoadmap })} disabled={loading}>
                  {PRIORIDADES_ROADMAP.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Estado</label>
                <select className="input" value={form.estado} onChange={e => setForm({ ...form, estado: e.target.value as EstadoRoadmap })} disabled={loading}>
                  {ESTADOS_ROADMAP.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Fecha objetivo</label>
                <input type="date" className="input num" value={form.fechaObjetivo} onChange={e => setForm({ ...form, fechaObjetivo: e.target.value })} disabled={loading} />
              </div>
              <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                <label className="label">Impacto (por qué importa)</label>
                <input className="input" value={form.impacto} onChange={e => setForm({ ...form, impacto: e.target.value })} disabled={loading} />
              </div>
              <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                <label className="label">Descripción</label>
                <textarea className="input" rows={2} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} disabled={loading} />
              </div>
              <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                <label className="label">Notas (bitácora del ítem)</label>
                <textarea className="input" rows={3} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} disabled={loading} />
              </div>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div>
                {form.id && form.estado !== 'Descartado' && (
                  <button className="btn btn-ghost" style={{ color: 'var(--wine)' }} disabled={loading}
                    onClick={() => setForm({ ...form, estado: 'Descartado' })}
                    title="No se borra: queda como Descartado, fuera del tablero pero con registro">
                    Descartar
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setForm(null)} disabled={loading}>Cancelar</button>
                <button className="btn btn-primary" onClick={guardar} disabled={loading || !form.titulo.trim()}>
                  {loading ? <><I.Refresh size={13} /> Guardando…</> : <><I.Check size={13} /> {form.id ? 'Guardar' : 'Crear'}</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
