'use client';

/**
 * Presupuesto — pantalla de escritorio. Pestañas:
 *  · Editor: grilla línea de ER × meses por centro (o consolidado); en
 *    Borrador se edita celda por celda y se guarda en lote.
 *  · Seguimiento: presupuesto vs real por mes o acumulado, por centro.
 *  · Resumen de junta: una pantalla para la junta.
 *  · Historial: presupuesto_log.
 * Los botones siguen al rol (usePuede); el servidor revalida cada acción.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { usePuede } from '@/components/auth/permisos';
import {
  aprobarPresupuestoAction, archivarPresupuestoAction, editarCeldasAction, limpiarCeldasAction,
  precargarPresupuestoAction, reabrirPresupuestoAction,
} from '@/app/(app)/presupuesto/actions';
import { claveCelda, mesDeCorte, TODOS, type LineaPres, type RealCeldas } from '@/lib/presupuesto/modelo';
import type { CentroPres, EntradaLog, PresupuestoCab } from '@/lib/db/presupuesto';
import { EditorGrilla } from './editor-grilla';
import { Seguimiento } from './seguimiento';
import { ResumenJunta } from './resumen-junta';
import { Historial } from './historial';

export interface DatosReal { porCelda: Array<[string, number]>; consolidado: Array<[string, number]>; numPartidas: number; partidasSinCentro: number }
interface Props {
  cab: PresupuestoCab;
  lineas: LineaPres[];
  centros: CentroPres[];
  celdas: Array<[string, number]>;
  real: DatosReal;
  log: EntradaLog[];
  hoy: string;
}

type Pestana = 'editor' | 'seguimiento' | 'junta' | 'historial';
const ESTADO_CLS: Record<string, string> = { Borrador: 'badge-warn', Aprobado: 'badge-olive', Archivado: 'badge-mute' };

export function PresupuestoDetalle({ cab, lineas, centros, celdas, real, log, hoy }: Props) {
  const router = useRouter();
  const puede = usePuede();
  const editable = cab.estado === 'Borrador' && puede('presupuesto');
  const [pestana, setPestana] = useState<Pestana>(cab.estado === 'Aprobado' ? 'junta' : 'editor');
  const [centro, setCentro] = useState<string>(centros[0]?.id ?? TODOS);
  const [busy, setBusy] = useState<string | null>(null);

  const base = useMemo(() => new Map(celdas), [celdas]);
  const [cambios, setCambios] = useState<Map<string, number>>(new Map());
  const vigentes = useMemo(() => { const m = new Map(base); for (const [k, v] of cambios) m.set(k, v); return m; }, [base, cambios]);
  const realCeldas: RealCeldas = useMemo(() => ({ porCelda: new Map(real.porCelda), consolidado: new Map(real.consolidado) }), [real]);
  const corte = mesDeCorte(cab.anio, hoy);

  const correr = async (key: string, fn: () => Promise<{ ok: true; mensaje: string } | { ok: false; error: string }>, despues?: () => void) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r.ok) { toast.success(r.mensaje); despues?.(); router.refresh(); } else toast.error(r.error);
    } finally { setBusy(null); }
  };

  const guardar = () => correr('guardar', () => editarCeldasAction({
    id: cab.id,
    cambios: [...cambios].map(([k, monto]) => { const [o, c, m] = k.split('|'); return { orden: Number(o), centroId: c, mes: Number(m), monto }; }),
  }), () => setCambios(new Map()));

  const precargar = () => {
    const g = window.prompt(`Precargar con el real ${cab.anio - 1} del Estado de Resultados.\nAjuste global en % (ej. 10 = +10%). Reemplaza las celdas que tengan real ${cab.anio - 1}; el resto queda igual:`, '0');
    if (g === null) return;
    correr('precargar', () => precargarPresupuestoAction({ id: cab.id, ajustes: { globalPct: Number(g) || 0 } }), () => setCambios(new Map()));
  };
  const limpiar = () => {
    const nombre = centro === TODOS ? 'todos los centros' : centros.find(c => c.id === centro)?.nombre;
    if (!window.confirm(`¿Poner en cero las celdas de ${nombre}?`)) return;
    correr('limpiar', () => limpiarCeldasAction({ id: cab.id, centroId: centro === TODOS ? null : centro }), () => setCambios(new Map()));
  };
  const aprobar = () => {
    if (cambios.size > 0) { toast.error('Guardá los cambios antes de aprobar.'); return; }
    if (!window.confirm(`¿Aprobar el presupuesto ${cab.anio}? Queda bloqueado (no se editan celdas) y pasa a ser el vigente del año.`)) return;
    correr('aprobar', () => aprobarPresupuestoAction(cab.id), () => setPestana('junta'));
  };
  const reabrir = () => {
    const motivo = window.prompt('Motivo de la reapertura (queda en el historial con quién lo aprobó y cuándo):');
    if (!motivo) return;
    correr('reabrir', () => reabrirPresupuestoAction({ id: cab.id, motivo }), () => setPestana('editor'));
  };
  const archivar = () => {
    if (!window.confirm('¿Archivar este borrador?')) return;
    correr('archivar', () => archivarPresupuestoAction(cab.id));
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{cab.nombre} <span className={'badge ' + (ESTADO_CLS[cab.estado] ?? 'badge-mute')} style={{ fontSize: 12, verticalAlign: 'middle' }}>{cab.estado}</span></h1>
          <div className="page-subtitle">
            {cab.estado === 'Aprobado' && cab.aprobadoPor ? `Aprobado por ${cab.aprobadoPor} el ${new Date(cab.aprobadoEn!).toLocaleDateString('es-GT', { day: '2-digit', month: 'long', year: 'numeric' })}. ` : ''}
            Líneas del Estado de Resultados × centro de costo × mes. Los subtotales se calculan con las mismas fórmulas del ER.
          </div>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 6 }}>
          <a className="btn btn-ghost" href="/presupuesto">← Presupuestos</a>
          {editable && <button className="btn btn-secondary" disabled={!!busy} onClick={precargar}>Precargar real {cab.anio - 1}</button>}
          {editable && <button className="btn btn-primary" disabled={!!busy} onClick={aprobar}>Aprobar</button>}
          {cab.estado === 'Aprobado' && puede('reabrir_presupuesto') && <button className="btn btn-secondary" disabled={!!busy} onClick={reabrir}>Reabrir</button>}
          {editable && <button className="btn btn-ghost" disabled={!!busy} onClick={archivar} style={{ color: 'var(--ink-3)' }}>Archivar</button>}
        </div>
      </div>

      {real.numPartidas === 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 14 }}>
          <div className="card-pad" style={{ fontSize: 12.5 }}>
            El real sale del <strong>Estado de Resultados</strong> (libro diario). Hoy no hay partidas contabilizadas en {cab.anio}, así que el real se ve en cero
            {cab.anio > Number(hoy.slice(0, 4)) ? ' — el año todavía no empieza' : ' hasta que se registren los asientos'}.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--line-3)' }}>
        {([['editor', cab.estado === 'Borrador' ? 'Editor' : 'Presupuesto'], ['seguimiento', 'Presupuesto vs real'], ['junta', 'Resumen de junta'], ['historial', `Historial (${log.length})`]] as const).map(([k, l]) => (
          <button key={k} className="btn btn-ghost" onClick={() => setPestana(k)}
            style={{ borderRadius: 0, borderBottom: pestana === k ? '2px solid var(--ink)' : '2px solid transparent', fontWeight: pestana === k ? 600 : 400, fontSize: 13 }}>
            {l}
          </button>
        ))}
      </div>

      {pestana === 'editor' && (
        <EditorGrilla
          cab={cab} lineas={lineas} centros={centros} celdas={vigentes} cambios={cambios} editable={editable}
          centro={centro} setCentro={setCentro}
          onCambio={(orden, centroId, mes, monto) => setCambios(prev => {
            const n = new Map(prev); const k = claveCelda(orden, centroId, mes);
            if ((base.get(k) ?? 0) === monto) n.delete(k); else n.set(k, monto);
            return n;
          })}
          onGuardar={guardar} onDescartar={() => setCambios(new Map())} onLimpiar={limpiar} guardando={busy === 'guardar'}
        />
      )}
      {pestana === 'seguimiento' && <Seguimiento cab={cab} lineas={lineas} centros={centros} celdas={vigentes} real={realCeldas} corte={corte} sinCentro={real.partidasSinCentro} />}
      {pestana === 'junta' && <ResumenJunta cab={cab} lineas={lineas} celdas={vigentes} real={realCeldas} corte={corte} hoy={hoy} />}
      {pestana === 'historial' && <Historial log={log} lineas={lineas} centros={centros} />}
    </div>
  );
}
