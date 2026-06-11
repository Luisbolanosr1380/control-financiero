'use client';

import { useState } from 'react';
import { I } from '@/components/common/icons';
import {
  TIPOS_OBLIGACION,
  FRECUENCIAS_OBLIGACION,
  PRIORIDADES_OBLIGACION,
  type TipoObligacion,
  type FrecuenciaObligacion,
  type PrioridadObligacion,
} from '@/lib/airtable/obligaciones-recurrentes-fields';
import type { ObligacionRecurrente } from '@/lib/flujo/obligaciones';
import {
  crearObligacion,
  actualizarObligacion,
  type ObligacionInput,
} from '@/app/(app)/flujo/_actions/obligaciones';

interface Props {
  obligacion: ObligacionRecurrente | null;
  onCerrar: () => void;
  onGuardado: () => void;
}

export function ModalObligacionForm({ obligacion, onCerrar, onGuardado }: Props) {
  const editando = !!obligacion;
  const [nombre, setNombre]               = useState(obligacion?.nombre ?? '');
  const [tipo, setTipo]                   = useState<TipoObligacion>(obligacion?.tipo ?? 'Renta');
  const [monto, setMonto]                 = useState(obligacion?.montoEstimado ?? 0);
  const [diaPago, setDiaPago]             = useState(obligacion?.diaPago ?? 1);
  const [frecuencia, setFrecuencia]       = useState<FrecuenciaObligacion>(obligacion?.frecuencia ?? 'Mensual');
  const [prioridad, setPrioridad]         = useState<PrioridadObligacion>(obligacion?.prioridad ?? 'Media');
  const [mesReferencia, setMesReferencia] = useState(obligacion?.mesReferencia ?? '');
  const [notas, setNotas]                 = useState(obligacion?.notas ?? '');
  const [guardando, setGuardando]         = useState(false);
  const [error, setError]                 = useState('');

  const necesitaAncla = frecuencia === 'Bimestral' || frecuencia === 'Trimestral' || frecuencia === 'Anual';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (necesitaAncla && !mesReferencia) {
      setError('Mes de referencia es requerido para frecuencias bimestral, trimestral y anual.');
      return;
    }
    const input: ObligacionInput = {
      nombre, tipo, montoEstimado: Number(monto), diaPago: Number(diaPago),
      frecuencia, prioridad,
      mesReferencia: necesitaAncla && mesReferencia ? mesReferencia : undefined,
      notas: notas.trim() || undefined,
      activo: obligacion?.activo ?? true,
    };
    setGuardando(true);
    const r = editando
      ? await actualizarObligacion(obligacion!.id, input)
      : await crearObligacion(input);
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onGuardado();
  };

  return (
    <div
      onClick={onCerrar}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: 'var(--paper, white)',
          borderRadius: 8,
          padding: 24,
          width: '90%',
          maxWidth: 480,
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            {editando ? 'Editar obligación' : 'Nueva obligación recurrente'}
          </h2>
          <button type="button" onClick={onCerrar} style={{ all: 'unset', cursor: 'pointer' }}>
            <I.X size={18} />
          </button>
        </div>

        <Field label="Nombre">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            placeholder="Ej: Renta oficina zona 10"
            style={inputStyle}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Tipo">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoObligacion)} style={inputStyle}>
              {TIPOS_OBLIGACION.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Prioridad">
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as PrioridadObligacion)} style={inputStyle}>
              {PRIORIDADES_OBLIGACION.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Monto estimado (Q)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(Number(e.target.value))}
              required
              style={inputStyle}
            />
          </Field>
          <Field label="Día de pago (1-31)">
            <input
              type="number"
              min="1"
              max="31"
              value={diaPago}
              onChange={(e) => setDiaPago(Number(e.target.value))}
              required
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="Frecuencia">
          <select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as FrecuenciaObligacion)} style={inputStyle}>
            {FRECUENCIAS_OBLIGACION.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>

        {necesitaAncla && (
          <Field label="Mes de referencia (ancla del ciclo)">
            <input
              type="date"
              value={mesReferencia}
              onChange={(e) => setMesReferencia(e.target.value)}
              style={inputStyle}
            />
            <small style={{ color: 'var(--ink-3)', fontSize: 11 }}>
              Para {frecuencia.toLowerCase()}: fecha de un pago conocido. Los siguientes se calculan sumando el ciclo.
            </small>
          </Field>
        )}

        <Field label="Notas (opcional)">
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' as const }}
          />
        </Field>

        {error && (
          <div style={{ color: 'var(--wine)', fontSize: 12, background: 'rgba(180,60,60,0.08)', padding: 8, borderRadius: 4 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" onClick={onCerrar} disabled={guardando} style={btnGhost}>Cancelar</button>
          <button type="submit" disabled={guardando} style={btnPrimary}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear obligación'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--ink-1)',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'inherit',
  background: 'var(--paper, white)',
  color: 'var(--ink)',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderRadius: 6,
  background: 'var(--ink)',
  color: 'var(--paper)',
  cursor: 'pointer',
  fontSize: 13,
};

const btnGhost: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid var(--ink-1)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--ink)',
  cursor: 'pointer',
  fontSize: 13,
};
