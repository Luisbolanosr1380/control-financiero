'use client';

/**
 * F-038.4.bis — Banner de decisión para pagos pendientes 15+ días.
 *
 * Aparece arriba de los KPIs en /planillas/pendientes cuando hay al menos un
 * pago con alerta=roja (15+ días). Ofrece 3 acciones:
 *   1. Diferir todos a deuda — modal con motivo común; ejecuta diferirMasivoAction.
 *   2. Mantener como pendientes — modal con razón opcional + snooze 5 días.
 *   3. Recordarme en 5 días — snooze sin razón.
 *
 * El snooze se guarda en localStorage por usuario (key `planillas.snooze`).
 * Cuando expira (5 días) el banner reaparece. Si el conjunto de empleados
 * críticos cambia (la lista de IDs es distinta), el snooze SE INVALIDA — Stark
 * tiene que decidir sobre los nuevos.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { diferirMasivoAction } from '@/app/(app)/planillas/actions';
import type { KPIsPagosPendientes } from '@/lib/db/planillas';

interface Props {
  decision: KPIsPagosPendientes['decisionRequerida'];
}

const SNOOZE_KEY = 'planillas.decision.snooze.v1';
const SNOOZE_MS  = 5 * 24 * 60 * 60 * 1000;

interface SnoozeEntry {
  until: number;             // epoch ms
  razon?: string;
  empleadoIdsHash: string;   // si los IDs cambian, el snooze se invalida
  tipo: 'mantener' | 'recordatorio';
}

function hashIds(ids: string[]): string {
  return [...ids].sort().join('|');
}

function leerSnooze(): SnoozeEntry | null {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(SNOOZE_KEY);
    if (!raw) return null;
    const e = JSON.parse(raw) as SnoozeEntry;
    if (!e.until || !e.empleadoIdsHash) return null;
    return e;
  } catch { return null; }
}

function guardarSnooze(e: SnoozeEntry): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(e));
}

function limpiarSnooze(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SNOOZE_KEY);
}

export function BannerDecisionPendientes({ decision }: Props) {
  const router = useRouter();
  const idsHashActual = useMemo(() => hashIds(decision.empleados.map(e => e.planillaId)), [decision]);
  const [oculto, setOculto] = useState<boolean | null>(null);   // null = aún no resuelto en client
  const [openMantener, setOpenMantener] = useState(false);
  const [openDiferir, setOpenDiferir] = useState(false);

  // Evaluación del snooze al montar / cambiar la lista. SSR-safe (lazy).
  useEffect(() => {
    if (decision.cantidad === 0) { setOculto(true); return; }
    const e = leerSnooze();
    if (!e) { setOculto(false); return; }
    // Si la lista cambió (nuevo empleado entró en 15+ días), invalidamos snooze.
    if (e.empleadoIdsHash !== idsHashActual) {
      limpiarSnooze();
      setOculto(false);
      return;
    }
    if (Date.now() < e.until) { setOculto(true); return; }
    // Vencido
    limpiarSnooze();
    setOculto(false);
  }, [decision.cantidad, idsHashActual]);

  if (decision.cantidad === 0 || oculto === null || oculto) return null;

  const onSnooze = (razon?: string, tipo: 'mantener' | 'recordatorio' = 'recordatorio') => {
    guardarSnooze({
      until: Date.now() + SNOOZE_MS,
      razon,
      empleadoIdsHash: idsHashActual,
      tipo,
    });
    setOculto(true);
    if (razon) {
      toast.success(`Mantenidos como pendientes. Te recordaré en 5 días.`, { duration: 4000 });
    } else {
      toast.success('Recordatorio pospuesto 5 días.', { duration: 3000 });
    }
  };

  return (
    <>
      <div
        style={{
          marginBottom: 22,
          border: '2px solid var(--wine)',
          borderRadius: 'var(--r-3)',
          background: '#F5E2DD',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Alert size={18} style={{ color: 'var(--wine)' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--wine)', letterSpacing: '0.02em' }}>
            🔴 Decisión recomendada
          </div>
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          Tenés <strong className="num">{decision.cantidad}</strong> pago{decision.cantidad === 1 ? '' : 's'} pendiente{decision.cantidad === 1 ? '' : 's'} hace
          más de 15 días por <strong className="num">{Q(decision.montoTotal)}</strong>. Es momento de decidir formalmente:
          <span style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginTop: 4 }}>
            Diferir = se convierten en deuda formal (categoría empleados). Mantener pendiente = quedan en planilla sin deuda, pero seguirán acumulando días.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <button className="btn btn-danger" onClick={() => setOpenDiferir(true)}>
            <I.Clock size={13} /> Diferir todos a deuda
          </button>
          <button className="btn btn-secondary" onClick={() => setOpenMantener(true)}>
            Mantener como pendientes
          </button>
          <button className="btn btn-ghost" onClick={() => onSnooze(undefined, 'recordatorio')}>
            <I.Clock size={11} /> Recordarme en 5 días
          </button>
        </div>
      </div>

      {openDiferir && (
        <ModalDiferirMasivo
          decision={decision}
          onClose={() => setOpenDiferir(false)}
          onDone={() => {
            limpiarSnooze();   // ya no hay rojas → cualquier snooze previo se invalida
            setOpenDiferir(false);
            router.refresh();
          }}
        />
      )}
      {openMantener && (
        <ModalMantenerPendientes
          decision={decision}
          onClose={() => setOpenMantener(false)}
          onConfirm={(razon) => { onSnooze(razon, 'mantener'); setOpenMantener(false); }}
        />
      )}
    </>
  );
}

/* ============================================================
 * Modal: Diferir todos los pendientes 15+ días a deuda
 * ============================================================ */

function ModalDiferirMasivo({ decision, onClose, onDone }: {
  decision: KPIsPagosPendientes['decisionRequerida'];
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const onConfirm = async () => {
    if (!motivo.trim()) return;
    setLoading(true);
    try {
      const res = await diferirMasivoAction({
        lineaIds: decision.empleados.map(e => e.planillaId),
        motivo: motivo.trim(),
      });
      if (res.exitosos > 0) {
        const detalle = res.fallidos > 0 ? ` (${res.fallidos} fallaron — revisá Airtable)` : '';
        toast.success(`Se difirieron ${res.exitosos} pagos por Q${decision.montoTotal.toFixed(2)}${detalle}. Ver en /deudas.`, { duration: 6000 });
        onDone();
      } else {
        toast.error('No se pudo diferir ningún pago. ' + (res.errores[0]?.error ?? ''));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setLoading(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      onClick={() => { if (!loading) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(620px, 96vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Alert size={15} style={{ color: 'var(--wine)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            Diferir {decision.cantidad} pagos a deuda
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 12px', lineHeight: 1.55 }}>
            Vas a crear <strong className="num">{decision.cantidad}</strong> deudas (una por empleado, categoría 🟢 Empleados) por un total
            de <strong className="num">{Q(decision.montoTotal)}</strong>. Las líneas de planilla pasarán a estado <strong>Diferido</strong>.
          </p>

          {/* Lista de empleados */}
          <div style={{
            border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
            background: 'var(--paper-2)', padding: '8px 10px', marginBottom: 14,
            maxHeight: 200, overflowY: 'auto',
          }}>
            {decision.empleados.map(e => (
              <div key={e.planillaId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0', borderBottom: '1px dashed var(--line-3)' }}>
                <span style={{ flex: 1, color: 'var(--ink-2)' }}>{e.nombre}</span>
                <span style={{ color: 'var(--ink-4)', fontSize: 11 }}>{e.periodoNombre}</span>
                <span style={{ fontSize: 11, color: 'var(--wine)', fontWeight: 500 }}>{e.diasPendiente}d</span>
                <span className="num" style={{ fontWeight: 500, minWidth: 80, textAlign: 'right' }}>{Q(e.neto)}</span>
              </div>
            ))}
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Motivo común (se aplica a las {decision.cantidad} deudas)</label>
            <textarea
              className="input" rows={3}
              placeholder="Ej. Flujo de caja apretado en junio; se libera en julio."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={loading}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={loading || !motivo.trim()}>
            {loading ? <><I.Refresh size={13} /> Difiriendo…</> : <><I.Check size={13} /> Confirmar y crear {decision.cantidad} deudas</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ============================================================
 * Modal: Mantener como pendientes (snooze 5 días con razón opcional)
 * ============================================================ */

function ModalMantenerPendientes({ decision, onClose, onConfirm }: {
  decision: KPIsPagosPendientes['decisionRequerida'];
  onClose: () => void;
  onConfirm: (razon?: string) => void;
}) {
  const [razon, setRazon] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 96vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Clock size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            Mantener pendientes · {decision.cantidad} pagos
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 12px', lineHeight: 1.55 }}>
            Los {decision.cantidad} pagos siguen como <strong>Pendientes</strong>. NO se genera deuda. El banner se ocultará por 5 días.
            Después de eso, si siguen pendientes, va a volver a recordártelo.
          </p>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Razón para mantenerlos (opcional, queda en tu historial)</label>
            <textarea
              className="input" rows={3}
              placeholder="Ej. Espero ingreso del cliente X la próxima semana."
              value={razon}
              onChange={(e) => setRazon(e.target.value)}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-secondary" onClick={() => onConfirm(razon.trim() || undefined)}>
            <I.Check size={13} /> Mantener pendientes
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
