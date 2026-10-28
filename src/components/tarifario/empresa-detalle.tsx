'use client';

/**
 * TARIFARIO · DETALLE de una empresa: encabezado con KPIs propios, "Aprobar
 * todas las de este cliente" (lote: pendientes con monto; las Q0 quedan
 * fuera; confirmación en línea, sin diálogos del navegador) y la matriz
 * scoped al NIT con todo lo del listado (alta, edición inline, desactivar).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { aprobarTarifasPorNitAction } from '@/app/(app)/tarifario/actions';
import { esSinTarifa } from '@/lib/tarifario/canon';
import type { Tarifa } from '@/lib/tarifario/lookup';
import { aprobablesDe, semaforoDe } from '@/lib/tarifario/resumen';
import { TarifasTabla } from './tarifas-tabla';

export function EmpresaDetalle({ nit, tarifas }: { nit: string; tarifas: Tarifa[] }) {
  const router = useRouter();
  const puede = usePuede();
  const puedeAprobar = puede('catalogos');
  const [confirmando, setConfirmando] = useState(false);
  const [busy, setBusy] = useState(false);
  const activas = tarifas.filter(t => t.activo);
  const razonSocial = tarifas.find(t => t.razonSocial)?.razonSocial ?? '';
  const sinTarifa = activas.filter(t => esSinTarifa(t.monto)).length;
  const aprobables = aprobablesDe(tarifas);
  const aprobadas = activas.length - sinTarifa - aprobables.length;
  const sem = semaforoDe({ pendientes: aprobables.length, sinTarifa });

  const aprobarTodas = async () => {
    setBusy(true);
    try {
      const r = await aprobarTarifasPorNitAction(nit);
      if (r.ok) { toast.success(r.mensaje); setConfirmando(false); router.refresh(); } else toast.error(r.error);
    } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}><Link href="/tarifario" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Tarifario</Link></div>
          <h1 className="page-title">{razonSocial || `NIT ${nit}`}</h1>
          <div className="page-subtitle"><span className="num">NIT {nit}</span> · precios sin IVA por tipo de prueba, categoría y territorio.</div>
        </div>
        <div className="page-actions">
          {puedeAprobar && !confirmando && (
            <button className="btn btn-primary" disabled={aprobables.length === 0 || busy} title={aprobables.length === 0 ? 'No hay tarifas pendientes con monto' : undefined} onClick={() => setConfirmando(true)}>
              <I.Check size={13} /> Aprobar todas las de este cliente{aprobables.length ? ` (${aprobables.length})` : ''}
            </button>
          )}
        </div>
      </div>

      {confirmando && (
        <div role="alertdialog" aria-label="Confirmar aprobación en lote" className="card" style={{ marginBottom: 14, borderColor: 'var(--olive)' }}>
          <div className="card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            <div style={{ flex: 1, minWidth: 280, lineHeight: 1.45 }}>
              Se aprueban <strong>{aprobables.length}</strong> tarifa{aprobables.length === 1 ? '' : 's'} pendiente{aprobables.length === 1 ? '' : 's'} de <strong>{razonSocial || nit}</strong> con tu usuario y la fecha de hoy.
              {sinTarifa > 0 && <> Las <strong>{sinTarifa} en Q0</strong> quedan fuera: sin tarifa definida no se aprueba.</>}
            </div>
            <button className="btn btn-ghost" onClick={() => setConfirmando(false)} disabled={busy}>Volver</button>
            <button className="btn btn-primary" onClick={() => void aprobarTodas()} disabled={busy}>{busy ? <><I.Refresh size={13} /> Aprobando…</> : 'Confirmar aprobación'}</button>
          </div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        <div className="kpi"><div className="kpi-label">Tarifas activas</div><div className="kpi-value">{activas.length}</div><div className="kpi-delta"><span className="vs">{tarifas.length - activas.length} inactivas</span></div></div>
        <div className="kpi"><div className="kpi-label">Aprobadas</div><div className="kpi-value">{aprobadas}</div><div className="kpi-delta"><span className="vs">gobierno: aprobado por / en</span></div></div>
        <div className="kpi"><div className="kpi-label">Pendientes de aprobación</div><div className="kpi-value" style={{ color: aprobables.length ? 'var(--burnt, #b5651d)' : undefined }}>{aprobables.length}</div><div className="kpi-delta"><span className="vs">con monto, sin aprobar</span></div></div>
        <div className="kpi"><div className="kpi-label">Sin tarifa (Q0)</div><div className="kpi-value" style={{ color: sinTarifa ? 'var(--wine)' : undefined }}>{sinTarifa}</div><div className="kpi-delta"><span className="vs">{sem === 'rojo' ? 'falta pactar precio' : sem === 'amarillo' ? 'solo falta aprobar' : 'todo al día'}</span></div></div>
      </div>

      <TarifasTabla disponible tarifas={tarifas} nitFijo={nit} razonSocialFija={razonSocial} />
    </div>
  );
}
