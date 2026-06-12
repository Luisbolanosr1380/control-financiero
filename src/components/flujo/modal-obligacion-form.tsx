'use client';

import { useMemo, useState } from 'react';
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
import { MontoInput, EnteroInput } from '@/components/ui/monto-input';
import { Q } from '@/lib/utils';
import { formatearFecha } from '@/lib/utils/fechas';
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

const PRIORIDAD_DOT: Record<PrioridadObligacion, string> = {
  'Crítica': 'var(--wine)',
  'Alta':    'var(--amber)',
  'Media':   'var(--ink-4)',
  'Baja':    'var(--ink-5)',
};

export function ModalObligacionForm({ obligacion, onCerrar, onGuardado }: Props) {
  const editando = !!obligacion;
  const [nombre, setNombre]               = useState(obligacion?.nombre ?? '');
  const [tipo, setTipo]                   = useState<TipoObligacion>(obligacion?.tipo ?? 'Renta');
  const [monto, setMonto]                 = useState<number | null>(obligacion?.montoEstimado ?? null);
  const [diaPago, setDiaPago]             = useState<number | null>(obligacion?.diaPago ?? null);
  const [frecuencia, setFrecuencia]       = useState<FrecuenciaObligacion>(obligacion?.frecuencia ?? 'Mensual');
  const [prioridad, setPrioridad]         = useState<PrioridadObligacion>(obligacion?.prioridad ?? 'Media');
  const [mesReferencia, setMesReferencia] = useState(obligacion?.mesReferencia ?? '');
  const [fechaInicio, setFechaInicio]     = useState(obligacion?.fechaInicio ?? '');
  const [fechaFin, setFechaFin]           = useState(obligacion?.fechaFin ?? '');
  const [notas, setNotas]                 = useState(obligacion?.notas ?? '');
  const [detallesAbiertos, setDetallesAbiertos] = useState(!!obligacion?.notas);
  const [guardando, setGuardando]         = useState(false);
  const [error, setError]                 = useState('');

  const necesitaAncla = frecuencia === 'Bimestral' || frecuencia === 'Trimestral' || frecuencia === 'Anual';

  // Faltantes para deshabilitar el submit con tooltip.
  const faltantes = useMemo(() => {
    const f: string[] = [];
    if (!nombre.trim())                                   f.push('nombre');
    if (monto == null || !(monto > 0))                    f.push('monto');
    if (diaPago == null || diaPago < 1 || diaPago > 31)   f.push('día de pago');
    if (necesitaAncla && !mesReferencia)                  f.push('mes de referencia');
    return f;
  }, [nombre, monto, diaPago, necesitaAncla, mesReferencia]);

  const puedeGuardar = faltantes.length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
      setError('La fecha "Vigente hasta" no puede ser anterior a "Vigente desde".');
      return;
    }
    if (!puedeGuardar) {
      setError(`Falta: ${faltantes.join(', ')}.`);
      return;
    }
    const input: ObligacionInput = {
      nombre: nombre.trim(),
      tipo,
      montoEstimado: monto!,
      diaPago: diaPago!,
      frecuencia,
      prioridad,
      mesReferencia: necesitaAncla && mesReferencia ? mesReferencia : undefined,
      fechaInicio: fechaInicio || '',
      fechaFin:    fechaFin    || '',
      notas: notas.trim() || undefined,
      activo: obligacion?.activo ?? true,
    };
    setGuardando(true);
    const r = editando
      ? await actualizarObligacion(obligacion!.id, input)
      : await crearObligacion(input);
    setGuardando(false);
    if (!r.ok) { setError(r.error); return; }
    onGuardado();
  };

  return (
    <div
      onClick={onCerrar}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(14, 42, 36, 0.45)',
        backdropFilter: 'blur(2px)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: 'var(--paper-2)',
          borderRadius: 12,
          width: '100%',
          maxWidth: 560,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 48px -12px rgba(14, 42, 36, 0.25)',
          border: '1px solid var(--line)',
          overflow: 'hidden',
        }}
      >
        {/* HEADER */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--line-3)',
          display: 'flex', alignItems: 'flex-start', gap: 16,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{
              margin: 0,
              fontFamily: 'var(--serif)',
              fontWeight: 500,
              fontSize: 20,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              lineHeight: 1.2,
            }}>
              {editando ? 'Editar obligación' : 'Nueva obligación recurrente'}
            </h2>
            <p style={{
              margin: '6px 0 0',
              fontSize: 13,
              color: 'var(--ink-3)',
              lineHeight: 1.4,
            }}>
              Pagos fijos que se proyectan en tu calendario de flujo.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            style={{
              all: 'unset', cursor: 'pointer',
              padding: 6, borderRadius: 6,
              color: 'var(--ink-3)',
              display: 'flex',
            }}
          >
            <I.X size={18} />
          </button>
        </div>

        {/* BODY scrollable */}
        <div style={{ padding: '4px 24px 16px', overflowY: 'auto', flex: 1 }}>

          {/* § IDENTIFICACIÓN */}
          <SectionLabel>Identificación</SectionLabel>
          <Field label="Nombre">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              placeholder="Ej: Renta oficina zona 10"
              style={inputStyle}
            />
          </Field>

          <div style={gridDos}>
            <Field label="Tipo">
              <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoObligacion)} style={inputStyle}>
                {TIPOS_OBLIGACION.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Prioridad">
              <PrioridadSegmented value={prioridad} onChange={setPrioridad} />
            </Field>
          </div>

          {/* § MONTO Y CALENDARIO */}
          <SectionLabel>Monto y calendario</SectionLabel>
          <div style={gridDos}>
            <Field label="Monto estimado">
              <MontoInput
                value={monto}
                onChange={setMonto}
                prefix="Q"
                placeholder="0.00"
                required
                style={inputStyle}
              />
            </Field>
            <Field label="Día de pago">
              <EnteroInput
                value={diaPago}
                onChange={setDiaPago}
                min={1}
                max={31}
                placeholder="1–31"
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
            <Field
              label="Mes de referencia (ancla del ciclo)"
              hint={`Para ${frecuencia.toLowerCase()}: fecha de un pago conocido. Los siguientes se calculan sumando el ciclo.`}
            >
              <input
                type="date"
                value={mesReferencia}
                onChange={(e) => setMesReferencia(e.target.value)}
                style={inputStyle}
              />
            </Field>
          )}

          <div style={gridDos}>
            <Field label="Vigente desde" hint="Dejar vacío = sin límite.">
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Vigente hasta" hint="Dejar vacío = sin límite.">
              <input
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>

          {/* § DETALLES — colapsable */}
          <button
            type="button"
            onClick={() => setDetallesAbiertos(o => !o)}
            style={{
              all: 'unset', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              marginTop: 24, marginBottom: 8,
              fontSize: 11, fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--ink-4)',
            }}
          >
            <I.Chevron
              size={12}
              style={{ transform: detallesAbiertos ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 120ms' }}
            />
            Detalles
          </button>
          {detallesAbiertos && (
            <Field label="Notas (opcional)">
              <textarea
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={3}
                placeholder="Recordatorios, instrucciones de pago, contraparte…"
                style={{ ...inputStyle, resize: 'vertical' as const, minHeight: 64 }}
              />
            </Field>
          )}

          {/* PREVIEW */}
          <PreviewLine
            nombre={nombre}
            monto={monto}
            diaPago={diaPago}
            frecuencia={frecuencia}
            prioridad={prioridad}
            fechaInicio={fechaInicio}
            fechaFin={fechaFin}
          />

          {error && (
            <div style={{
              marginTop: 12,
              color: 'var(--wine)', fontSize: 12,
              background: 'var(--wine-bg)',
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid rgba(138, 42, 42, 0.2)',
            }}>
              {error}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div style={{
          padding: '14px 24px',
          background: 'var(--bg)',
          borderTop: '1px solid var(--line-3)',
          display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center',
        }}>
          {!puedeGuardar && (
            <span style={{ fontSize: 11.5, color: 'var(--ink-4)', marginRight: 'auto' }}>
              Falta: {faltantes.join(', ')}
            </span>
          )}
          <button type="button" onClick={onCerrar} disabled={guardando} style={btnGhost}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando || !puedeGuardar}
            title={!puedeGuardar ? `Falta: ${faltantes.join(', ')}` : undefined}
            style={{
              ...btnPrimary,
              opacity: !puedeGuardar || guardando ? 0.5 : 1,
              cursor: !puedeGuardar || guardando ? 'not-allowed' : 'pointer',
            }}
          >
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear obligación'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* =========================================================================
 * Componentes auxiliares
 * ========================================================================= */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 20, marginBottom: 8,
      fontSize: 11, fontWeight: 500,
      textTransform: 'uppercase', letterSpacing: '0.08em',
      color: 'var(--ink-4)',
    }}>
      {children}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{hint}</span>}
    </label>
  );
}

function PrioridadSegmented({ value, onChange }: { value: PrioridadObligacion; onChange: (p: PrioridadObligacion) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Prioridad"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 0,
        border: '1px solid var(--line)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--paper-2)',
      }}
    >
      {PRIORIDADES_OBLIGACION.map((p, i) => {
        const activo = p === value;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={activo}
            onClick={() => onChange(p)}
            style={{
              all: 'unset', cursor: 'pointer',
              padding: '8px 4px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              fontSize: 12, fontWeight: activo ? 600 : 400,
              background: activo ? 'var(--ink)' : 'transparent',
              color: activo ? 'var(--paper)' : 'var(--ink-2)',
              borderLeft: i === 0 ? 'none' : '1px solid var(--line-3)',
              transition: 'background 100ms',
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: PRIORIDAD_DOT[p],
              flexShrink: 0,
              outline: activo ? '1px solid var(--paper)' : 'none',
              outlineOffset: activo ? 1 : 0,
            }} />
            {p}
          </button>
        );
      })}
    </div>
  );
}

function PreviewLine({
  nombre, monto, diaPago, frecuencia, prioridad, fechaInicio, fechaFin,
}: {
  nombre: string;
  monto: number | null;
  diaPago: number | null;
  frecuencia: FrecuenciaObligacion;
  prioridad: PrioridadObligacion;
  fechaInicio: string;
  fechaFin: string;
}) {
  const visible = nombre.trim().length > 0 && monto != null && monto > 0 && diaPago != null && diaPago >= 1 && diaPago <= 31;
  if (!visible) return null;

  const frecuenciaTexto: Record<FrecuenciaObligacion, string> = {
    'Mensual':    `cada día ${diaPago} del mes`,
    'Quincenal':  `los días 15 y último de cada mes`,
    'Bimestral':  `cada 2 meses (día ${diaPago})`,
    'Trimestral': `cada 3 meses (día ${diaPago})`,
    'Anual':      `cada año (día ${diaPago})`,
  };
  const rangoTexto =
    fechaInicio && fechaFin ? `, de ${formatearFecha(fechaInicio, "MMM yyyy")} a ${formatearFecha(fechaFin, "MMM yyyy")}` :
    fechaInicio             ? `, desde ${formatearFecha(fechaInicio, "MMM yyyy")}` :
    fechaFin                ? `, hasta ${formatearFecha(fechaFin, "MMM yyyy")}` : '';

  return (
    <div style={{
      marginTop: 16,
      background: 'var(--olive-bg)',
      border: '1px solid rgba(90, 106, 46, 0.25)',
      borderRadius: 8,
      padding: '10px 12px',
      fontSize: 12.5,
      color: 'var(--ink-2)',
      lineHeight: 1.5,
    }}>
      <span style={{ marginRight: 6 }} aria-hidden>📅</span>
      Se proyectará <strong style={{ color: 'var(--ink)' }}>{Q(monto!)}</strong>{' '}
      {frecuenciaTexto[frecuencia]}, prioridad{' '}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, color: 'var(--ink)',
      }}>
        <span style={{
          display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
          background: PRIORIDAD_DOT[prioridad],
        }} />
        {prioridad}
      </span>
      {rangoTexto}.
    </div>
  );
}

/* =========================================================================
 * Tokens de estilo
 * ========================================================================= */

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid var(--line)',
  borderRadius: 8,
  fontSize: 13,
  fontFamily: 'inherit',
  background: 'var(--paper-2)',
  color: 'var(--ink)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const gridDos: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 18px',
  border: 'none',
  borderRadius: 8,
  background: 'var(--ink)',
  color: 'var(--paper)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};

const btnGhost: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid var(--line)',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--ink-2)',
  cursor: 'pointer',
  fontSize: 13,
};
