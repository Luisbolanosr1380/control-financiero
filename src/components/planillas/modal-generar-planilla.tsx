'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { crearPeriodoAction, generarPlanillaAction } from '@/app/(app)/planillas/actions';

interface EmpleadoPreview {
  id: string;
  nombre: string;
  salarioBase: number;
  netoEstimado: number;
}

interface Props {
  empleadosActivos: EmpleadoPreview[];       // ya viene precalculado por el server
  periodosExistentes: Array<{ quincena: 1 | 2; mes: number; anio: number }>;
  defaultSugerido?: { quincena: 1 | 2; mes: number; anio: number };
  onClose: () => void;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function siguienteQuincenaNoCreada(existentes: Array<{ quincena: 1 | 2; mes: number; anio: number }>, hoy: Date): { quincena: 1 | 2; mes: number; anio: number } {
  const set = new Set(existentes.map(p => `${p.anio}-${p.mes}-${p.quincena}`));
  let y = hoy.getFullYear();
  let m = hoy.getMonth() + 1;
  let q: 1 | 2 = hoy.getDate() <= 15 ? 1 : 2;
  // avanza hasta encontrar una que no exista; máx 24 saltos.
  for (let i = 0; i < 24; i++) {
    if (!set.has(`${y}-${m}-${q}`)) return { quincena: q, mes: m, anio: y };
    if (q === 1) { q = 2; }
    else {
      q = 1;
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }
  return { quincena: q, mes: m, anio: y };
}

export function ModalGenerarPlanilla({ empleadosActivos, periodosExistentes, defaultSugerido, onClose }: Props) {
  const router = useRouter();
  const inicial = useMemo(
    () => defaultSugerido ?? siguienteQuincenaNoCreada(periodosExistentes, new Date()),
    [defaultSugerido, periodosExistentes],
  );
  const [quincena, setQuincena] = useState<1 | 2>(inicial.quincena);
  const [mes,      setMes]      = useState<number>(inicial.mes);
  const [anio,     setAnio]     = useState<number>(inicial.anio);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const yaExiste = periodosExistentes.some(p => p.anio === anio && p.mes === mes && p.quincena === quincena);
  const montoTotal = empleadosActivos.reduce((s, e) => s + e.netoEstimado, 0);
  const valido = !yaExiste && empleadosActivos.length > 0;

  const onConfirm = async () => {
    if (!valido) return;
    setLoading(true);
    try {
      const crear = await crearPeriodoAction({ quincena, mes, anio });
      if (!crear.ok || !crear.periodoId) {
        toast.error(crear.ok ? 'No se obtuvo el ID del período creado.' : crear.error);
        return;
      }
      const gen = await generarPlanillaAction(crear.periodoId);
      if (gen.ok) {
        toast.success(`Planilla generada · ${gen.cantidadEmpleados} empleados · Q${gen.montoTotalProyectado.toFixed(2)}`);
        onClose();
        router.refresh();
      } else {
        toast.error(gen.error ?? 'No se pudo generar la planilla.');
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
          width: 'min(560px, 94vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Payroll size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Generar planilla</div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 14px', lineHeight: 1.55 }}>
            Se creará un período nuevo en estado <strong>Borrador</strong> y se generará una línea
            por cada empleado activo, con el cálculo base (sin ajustes). Podrás editar las líneas
            antes de aprobar.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div className="field">
              <label className="label">Quincena</label>
              <select className="input" value={quincena} onChange={(e) => setQuincena(Number(e.target.value) as 1 | 2)} disabled={loading}>
                <option value={1}>Q1 (1–15)</option>
                <option value={2}>Q2 (16–fin)</option>
              </select>
            </div>
            <div className="field">
              <label className="label">Mes</label>
              <select className="input" value={mes} onChange={(e) => setMes(Number(e.target.value))} disabled={loading}>
                {MESES.map((nombre, i) => (
                  <option key={i} value={i + 1}>{nombre}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">Año</label>
              <input
                type="number" className="input num"
                value={anio} min={2024} max={2099}
                onChange={(e) => setAnio(Number(e.target.value))}
                disabled={loading}
              />
            </div>
          </div>

          {yaExiste && (
            <div style={{ fontSize: 11.5, color: 'var(--wine)', marginBottom: 10 }}>
              Ya existe un período para Q{quincena}-{MESES[mes - 1]}-{anio}. Elegí otro.
            </div>
          )}

          <div style={{
            border: '1px solid var(--olive)', borderRadius: 'var(--r-2)',
            background: '#EFF1E0', padding: '12px 14px',
          }}>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              Preview
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 12.5 }}>
              <span style={{ color: 'var(--ink-3)' }}>Empleados activos</span>
              <span className="num" style={{ textAlign: 'right' }}>{empleadosActivos.length}</span>
              <span style={{ fontWeight: 500, borderTop: '1px solid var(--olive)', paddingTop: 4 }}>Monto neto estimado</span>
              <span className="num" style={{ textAlign: 'right', fontWeight: 600, borderTop: '1px solid var(--olive)', paddingTop: 4 }}>
                {Q(montoTotal)}
              </span>
            </div>
            {empleadosActivos.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--wine)', marginTop: 8 }}>
                No hay empleados activos.
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={loading || !valido}>
            {loading ? <><I.Refresh size={13} /> Generando…</> : <><I.Check size={13} /> Generar planilla</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
