'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { usePuede } from '@/components/auth/permisos';
import { crearPresupuestoAction } from '@/app/(app)/presupuesto/actions';
import type { PresupuestoCab } from '@/lib/db/presupuesto';

interface Props {
  disponible: boolean;
  presupuestos: Array<PresupuestoCab & { totalIngresos: number; totalGastos: number }>;
  anioSugerido: number;
}

const ESTADO_CLS: Record<string, string> = { Borrador: 'badge-warn', Aprobado: 'badge-olive', Archivado: 'badge-mute' };
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export function PresupuestosLista({ disponible, presupuestos, anioSugerido }: Props) {
  const router = useRouter();
  const puede = usePuede();
  const puedeEditar = puede('presupuesto');
  const [abierto, setAbierto] = useState(false);
  const [anio, setAnio] = useState(anioSugerido);
  const [nombre, setNombre] = useState('');
  const [modo, setModo] = useState<'blanco' | 'precarga'>('precarga');
  const [globalPct, setGlobalPct] = useState('0');
  const [ingPct, setIngPct] = useState('');
  const [cosPct, setCosPct] = useState('');
  const [gasPct, setGasPct] = useState('');
  const [busy, setBusy] = useState(false);

  const pct = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const crear = async () => {
    setBusy(true);
    try {
      const r = await crearPresupuestoAction({
        anio, nombre: nombre || undefined, modo,
        ajustes: { globalPct: Number(globalPct) || 0, porClasePct: { ingreso: pct(ingPct), costo: pct(cosPct), gasto: pct(gasPct) } },
      });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(r.mensaje);
      router.push(`/presupuesto/${r.id}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Presupuesto</h1>
          <div className="page-subtitle">El presupuesto anual sobre las mismas líneas del Estado de Resultados, y cada mes lo real contra lo presupuestado.</div>
        </div>
        <div className="page-actions">
          {puedeEditar && disponible && <button className="btn btn-primary" onClick={() => setAbierto(v => !v)}><I.Plus size={13} /> Nuevo presupuesto</button>}
        </div>
      </div>

      {!disponible && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }}>
          <div className="card-pad" style={{ fontSize: 13 }}>Falta aplicar la migración <strong>011_presupuesto</strong> en esta base.</div>
        </div>
      )}

      {abierto && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><div className="card-title">Nuevo presupuesto</div></div>
          <div className="card-pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, alignItems: 'end' }}>
            <label style={{ fontSize: 12 }}>Año<input className="input" type="number" min={2024} max={2100} value={anio} onChange={e => setAnio(Number(e.target.value))} style={{ width: '100%' }} /></label>
            <label style={{ fontSize: 12, gridColumn: 'span 3' }}>Nombre (opcional)<input className="input" value={nombre} placeholder={`Presupuesto ${anio}`} onChange={e => setNombre(e.target.value)} style={{ width: '100%' }} /></label>
            <div style={{ gridColumn: 'span 4', display: 'flex', gap: 18, fontSize: 13 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={modo === 'precarga'} onChange={() => setModo('precarga')} /> Precargar con el real de {anio - 1} (editable después)</label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={modo === 'blanco'} onChange={() => setModo('blanco')} /> En blanco</label>
            </div>
            {modo === 'precarga' && (
              <>
                <label style={{ fontSize: 12 }}>Ajuste global %<input className="input" inputMode="decimal" value={globalPct} onChange={e => setGlobalPct(e.target.value)} style={{ width: '100%' }} /></label>
                <label style={{ fontSize: 12 }}>Ingresos % <span style={{ color: 'var(--ink-4)' }}>(vacío = global)</span><input className="input" inputMode="decimal" value={ingPct} onChange={e => setIngPct(e.target.value)} style={{ width: '100%' }} /></label>
                <label style={{ fontSize: 12 }}>Costos %<input className="input" inputMode="decimal" value={cosPct} onChange={e => setCosPct(e.target.value)} style={{ width: '100%' }} /></label>
                <label style={{ fontSize: 12 }}>Gastos %<input className="input" inputMode="decimal" value={gasPct} onChange={e => setGasPct(e.target.value)} style={{ width: '100%' }} /></label>
                <div style={{ gridColumn: 'span 4', fontSize: 12, color: 'var(--ink-3)' }}>
                  Trae, por línea × centro × mes, el real de {anio - 1} del Estado de Resultados y le aplica el ajuste (ej. 10 = +10%). Es un punto de partida: después se edita celda por celda.
                </div>
              </>
            )}
            <div style={{ gridColumn: 'span 4', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setAbierto(false)}>Cancelar</button>
              <button className="btn btn-primary" disabled={busy} onClick={crear}>{busy ? 'Creando…' : 'Crear borrador'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead><tr><th style={{ width: 80 }}>Año</th><th>Nombre</th><th style={{ width: 110 }}>Estado</th><th className="num">Ingresos ppto.</th><th className="num">Costos + gastos ppto.</th><th style={{ width: 210 }}>Aprobado</th><th style={{ width: 120 }}>Actualizado</th></tr></thead>
          <tbody>
            {presupuestos.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>Todavía no hay presupuestos.{puedeEditar && disponible ? ' Creá el primero con "Nuevo presupuesto".' : ''}</td></tr>
            )}
            {presupuestos.map(p => (
              <tr key={p.id} className="clickable" style={{ cursor: 'pointer' }} onClick={() => router.push(`/presupuesto/${p.id}`)}>
                <td className="num cell-strong">{p.anio}</td>
                <td><a href={`/presupuesto/${p.id}`} onClick={e => e.stopPropagation()}>{p.nombre}</a></td>
                <td><span className={'badge ' + (ESTADO_CLS[p.estado] ?? 'badge-mute')}>{p.estado}</span></td>
                <td className="num">{Q(p.totalIngresos)}</td>
                <td className="num">{Q(p.totalGastos)}</td>
                <td style={{ fontSize: 12 }}>{p.aprobadoPor ? `${p.aprobadoPor} · ${fecha(p.aprobadoEn)}` : '—'}</td>
                <td style={{ fontSize: 12 }}>{fecha(p.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 10 }}>Solo puede haber un presupuesto <strong>aprobado</strong> por año (lo garantiza la base de datos). Los borradores se pueden tener varios.</p>
    </div>
  );
}
