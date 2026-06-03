'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { crearEmpleadoAction, editarEmpleadoAction } from '@/app/(app)/empleados/actions';
import type { Empleado } from '@/lib/db/empleados';

interface Props {
  modo: 'crear' | 'editar';
  empleado?: Empleado;
  centros: Array<{ id: string; nombre: string }>;
  departamentos: string[];
  onClose: () => void;
}

const TIPOS_CONTRATO = ['Indefinido', 'Plazo fijo', 'Por obra', 'Honorarios'] as const;

export function ModalEmpleadoForm({ modo, empleado, centros, departamentos, onClose }: Props) {
  const router = useRouter();
  const [nombre, setNombre]               = useState(empleado?.nombre ?? '');
  const [numeroDocumento, setNoDoc]       = useState(empleado?.numeroDocumento ?? '');
  const [fechaIngreso, setFechaIng]       = useState(empleado?.fechaIngreso ?? new Date().toISOString().slice(0, 10));
  const [departamento, setDepto]          = useState(empleado?.departamento ?? '');
  const [centroId, setCentroId]           = useState(empleado?.centroCostoId ?? '');
  const [tipoContrato, setTipoContrato]   = useState(empleado?.tipoContrato ?? 'Indefinido');
  const [salarioBase, setSalarioBase]     = useState((empleado?.salarioBase ?? 0).toFixed(2));
  const [bonificacion, setBonificacion]   = useState((empleado?.bonificacionIncentivo ?? 250).toFixed(2));
  const [bonoVariable, setBonoVariable]   = useState((empleado?.bonoVariable ?? 0).toFixed(2));
  const [cuentaBancaria, setCuentaBancaria] = useState(empleado?.cuentaBancaria ?? '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const parseNum = (s: string) => parseFloat(s.replace(/[^\d.]/g, '')) || 0;
  const salarioBaseNum = parseNum(salarioBase);
  const valido = nombre.trim().length > 0 && !!fechaIngreso && salarioBaseNum > 0;

  const onConfirm = async () => {
    if (!valido) return;
    setLoading(true);
    try {
      const payload = {
        nombre: nombre.trim(),
        numeroDocumento: numeroDocumento.trim() || undefined,
        fechaIngreso,
        departamento: departamento.trim() || undefined,
        centroCostoId: centroId || undefined,
        tipoContrato: tipoContrato || undefined,
        salarioBase: salarioBaseNum,
        bonificacionIncentivo: parseNum(bonificacion),
        bonoVariable: parseNum(bonoVariable),
        cuentaBancaria: cuentaBancaria.trim() || undefined,
      };
      const res = modo === 'crear'
        ? await crearEmpleadoAction(payload)
        : await editarEmpleadoAction(empleado!.id, payload);
      if (res.ok) {
        toast.success(res.mensaje);
        onClose();
        router.refresh();
      } else {
        toast.error(res.error);
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
          width: 'min(640px, 96vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Users size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            {modo === 'crear' ? 'Nuevo empleado' : `Editar · ${empleado?.nombre}`}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="label">Nombre completo *</label>
              <input type="text" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Número de documento</label>
              <input type="text" inputMode="numeric" className="input num" value={numeroDocumento} onChange={(e) => setNoDoc(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Fecha de ingreso *</label>
              <input type="date" className="input num" value={fechaIngreso} onChange={(e) => setFechaIng(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Departamento</label>
              <input type="text" className="input" list="depto-options" value={departamento} onChange={(e) => setDepto(e.target.value)} disabled={loading} />
              <datalist id="depto-options">
                {departamentos.map(d => <option key={d} value={d} />)}
              </datalist>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Centro de costo</label>
              <select className="input" value={centroId} onChange={(e) => setCentroId(e.target.value)} disabled={loading}>
                <option value="">— Sin centro —</option>
                {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="label">Tipo de contrato</label>
              <select className="input" value={tipoContrato} onChange={(e) => setTipoContrato(e.target.value)} disabled={loading}>
                {TIPOS_CONTRATO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4 }}>
              Salario y prestaciones
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Salario base (Q) *</label>
              <input type="text" inputMode="decimal" className="input num" value={salarioBase} onChange={(e) => setSalarioBase(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Bonificación incentivo (Q)</label>
              <input type="text" inputMode="decimal" className="input num" value={bonificacion} onChange={(e) => setBonificacion(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Bono variable mensual (Q)</label>
              <input type="text" inputMode="decimal" className="input num" value={bonoVariable} onChange={(e) => setBonoVariable(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Cuenta bancaria</label>
              <input type="text" className="input" value={cuentaBancaria} onChange={(e) => setCuentaBancaria(e.target.value)} disabled={loading} />
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={loading || !valido}>
            {loading ? <><I.Refresh size={13} /> Guardando…</> : <><I.Check size={13} /> {modo === 'crear' ? 'Crear empleado' : 'Guardar'}</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
