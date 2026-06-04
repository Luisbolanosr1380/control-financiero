'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { darDeBajaEmpleadoAction } from '@/app/(app)/empleados/actions';
import { calcularLiquidacion, type MotivoSalida } from '@/lib/calculos/planilla';
import type { Empleado, StatusEmpleado } from '@/lib/db/empleados';

interface Props {
  empleado: Empleado;
  onClose: () => void;
}

const MOTIVOS: MotivoSalida[] = [
  'Renuncia',
  'Despido con responsabilidad',
  'Despido sin responsabilidad',
  'Fin de contrato',
  'Mutuo acuerdo',
  'Otro',
];

const STATUS_POR_MOTIVO: Record<MotivoSalida, StatusEmpleado> = {
  'Renuncia':                   'RENUNCIA',
  'Despido con responsabilidad': 'DESPIDO',
  'Despido sin responsabilidad': 'DESPIDO',
  'Fin de contrato':            'INACTIVO',
  'Mutuo acuerdo':              'INACTIVO',
  'Otro':                       'INACTIVO',
};

export function ModalDarDeBaja({ empleado, onClose }: Props) {
  const router = useRouter();
  const hoy = obtenerFechaHoyGuatemala();
  const [fecha, setFecha] = useState(hoy);
  const [motivo, setMotivo] = useState<MotivoSalida>('Renuncia');
  const [detalle, setDetalle] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const liquidacion = useMemo(
    () => calcularLiquidacion(
      { fechaIngreso: empleado.fechaIngreso, salarioMensual: empleado.salarioMensual, salarioBase: empleado.salarioBase },
      motivo,
      fecha,
    ),
    [empleado.fechaIngreso, empleado.salarioMensual, empleado.salarioBase, motivo, fecha],
  );

  const onConfirm = async () => {
    setLoading(true);
    try {
      const motivoCompleto = detalle.trim() ? `${motivo} — ${detalle.trim()}` : motivo;
      const res = await darDeBajaEmpleadoAction(empleado.id, fecha, motivoCompleto, STATUS_POR_MOTIVO[motivo]);
      if (res.ok) {
        toast.success(`${empleado.nombre} dado de baja · Liquidación estimada Q${liquidacion.total.toFixed(2)}`);
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo dar de baja');
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
          width: 'min(600px, 94vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Alert size={15} style={{ color: 'var(--wine)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Dar de baja · {empleado.nombre}</div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
            Antigüedad acumulada: <strong className="num">{empleado.antiguedad.textoLegible}</strong> ·
            Salario mensual <span className="num">{Q(empleado.salarioMensual)}</span>
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label">Fecha de salida</label>
            <input type="date" className="input num" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={loading} />
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label">Motivo</label>
            <select className="input" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoSalida)} disabled={loading}>
              {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {motivo === 'Despido sin responsabilidad' && (
              <div style={{ fontSize: 11, color: 'var(--wine)', marginTop: 4 }}>
                Incluye indemnización legal (1 mes × año + pro-rata).
              </div>
            )}
            {motivo === 'Renuncia' && (
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                No incluye indemnización (renuncia voluntaria).
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label className="label">Detalle (opcional)</label>
            <textarea
              className="input" rows={2}
              placeholder="Ej. Acuerdo verbal con RH; cambio a otra empresa."
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              disabled={loading}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          {/* Liquidación estimada */}
          <div style={{
            border: '1px solid var(--olive)', borderRadius: 'var(--r-2)',
            background: '#EFF1E0', padding: '12px 14px',
          }}>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              Liquidación estimada
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 12.5 }}>
              <span style={{ color: 'var(--ink-3)' }}>Bono 14 acumulado</span>
              <span className="num" style={{ textAlign: 'right' }}>{Q(liquidacion.bono14)}</span>
              <span style={{ color: 'var(--ink-3)' }}>Aguinaldo acumulado</span>
              <span className="num" style={{ textAlign: 'right' }}>{Q(liquidacion.aguinaldo)}</span>
              <span style={{ color: 'var(--ink-3)' }}>Vacaciones</span>
              <span className="num" style={{ textAlign: 'right' }}>{Q(liquidacion.vacaciones)}</span>
              <span style={{ color: liquidacion.indemnizacion > 0 ? 'var(--ink-2)' : 'var(--ink-4)' }}>
                Indemnización
              </span>
              <span className="num" style={{ textAlign: 'right', color: liquidacion.indemnizacion > 0 ? 'var(--ink-2)' : 'var(--ink-4)' }}>
                {liquidacion.indemnizacion > 0 ? Q(liquidacion.indemnizacion) : '—'}
              </span>
              <span style={{ fontWeight: 500, borderTop: '1px solid var(--olive)', paddingTop: 4 }}>Total</span>
              <span className="num" style={{ textAlign: 'right', fontWeight: 600, borderTop: '1px solid var(--olive)', paddingTop: 4 }}>
                {Q(liquidacion.total)}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8, lineHeight: 1.5 }}>
              El sistema NO paga la liquidación automáticamente — solo registra que el empleado pasa a INACTIVO. El pago se gestiona aparte.
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? <><I.Refresh size={13} /> Procesando…</> : <><I.Check size={13} /> Dar de baja</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
