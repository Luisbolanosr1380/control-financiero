'use client';

import type { LineaPres } from '@/lib/presupuesto/modelo';
import { MESES_CORTOS } from '@/lib/presupuesto/modelo';
import type { CentroPres, EntradaLog } from '@/lib/db/presupuesto';

const ACCION: Record<string, string> = {
  crear: 'Creó el presupuesto', precargar: 'Precargó desde el real', editar_celda: 'Editó celdas', limpiar: 'Puso celdas en cero',
  aprobar: 'Aprobó', reabrir: 'Reabrió a Borrador', archivar: 'Archivó',
};
const cuando = (iso: string) => new Date(iso).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const Q = (n: number) => `Q${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export function Historial({ log, lineas, centros }: { log: EntradaLog[]; lineas: LineaPres[]; centros: CentroPres[] }) {
  const nombreLinea = new Map(lineas.map(l => [l.orden, l.nombre]));
  const nombreCentro = new Map(centros.map(c => [c.id, c.nombre]));
  const detalle = (e: EntradaLog): string => {
    const d = (e.detalle ?? {}) as Record<string, unknown>;
    if (e.accion === 'precargar') {
      const a = d.ajustes as { globalPct?: number } | undefined;
      return `${String(d.desde ?? '')} · ajuste global ${a?.globalPct ?? 0}% · ${d.celdas ?? 0} celdas · ${Q(Number(d.montoTotal ?? 0))}`;
    }
    if (e.accion === 'editar_celda') {
      const cambios = (d.cambios as Array<{ orden: number; centro: string; mes: number; antes: number; despues: number }> | undefined) ?? [];
      const muestra = cambios.slice(0, 4).map(c => `${nombreLinea.get(c.orden) ?? c.orden} · ${nombreCentro.get(c.centro) ?? 'centro'} · ${MESES_CORTOS[c.mes - 1]}: ${Q(c.antes)} → ${Q(c.despues)}`);
      return `${d.celdas ?? cambios.length} celda(s)${muestra.length ? ` — ${muestra.join(' · ')}${cambios.length > 4 ? ' …' : ''}` : ''}`;
    }
    if (e.accion === 'reabrir') return `Motivo: ${String(d.motivo ?? '')}${d.aprobadoAntesPor ? ` · lo había aprobado ${d.aprobadoAntesPor}` : ''}`;
    if (e.accion === 'limpiar') return `Centro: ${d.centro === 'todos' ? 'todos' : nombreCentro.get(String(d.centro)) ?? String(d.centro)}`;
    if (e.accion === 'crear') return `Año ${d.anio ?? ''} · ${d.modo === 'precarga' ? 'con precarga' : 'en blanco'}`;
    return '';
  };
  return (
    <div className="card">
      <table className="table">
        <thead><tr><th style={{ width: 170 }}>Cuándo</th><th style={{ width: 220 }}>Quién</th><th style={{ width: 200 }}>Acción</th><th>Detalle</th></tr></thead>
        <tbody>
          {log.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--ink-4)' }}>Sin movimientos.</td></tr>}
          {log.map(e => (
            <tr key={e.id}>
              <td style={{ fontSize: 12 }}>{cuando(e.createdAt)}</td>
              <td style={{ fontSize: 12 }}>{e.actor ?? '—'}</td>
              <td><span className={'badge ' + (e.accion === 'aprobar' ? 'badge-olive' : e.accion === 'reabrir' ? 'badge-warn' : 'badge-outline')}>{ACCION[e.accion] ?? e.accion}</span></td>
              <td style={{ fontSize: 12.5 }}>{detalle(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
