'use client';

import { useMemo, useState } from 'react';
import { CXC_INTERCOMPANY } from '@/lib/contabilidad/cuentas-sistema';
import {
  MARGEN_INTERCOMPANY_PCT,
  GENERAR_ASIENTO_INTERCOMPANY,
} from '@/lib/contabilidad/intercompany-config';
import { proyectarAsientoRecuperacionIntercompany } from '@/lib/planilla/proyectar-asiento-recuperacion-intercompany';
import { MontoInput } from '@/components/ui/monto-input';
import { PreviewRecuperacionIntercompany } from './preview-recuperacion';

const EMPRESAS = Object.keys(CXC_INTERCOMPANY) as Array<keyof typeof CXC_INTERCOMPANY>;

export function IntercompanyPreviewClient() {
  const [empresa, setEmpresa]   = useState<string>(EMPRESAS[0] ?? 'HIT');
  const [monto, setMonto]       = useState<number | null>(10000);
  // Override en porcentaje humano (0..100). Default = MARGEN global.
  const [margenStr, setMargenStr] = useState<string>(String((MARGEN_INTERCOMPANY_PCT * 100).toFixed(1)));

  const margenPct = useMemo(() => {
    const n = Number(margenStr.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) return MARGEN_INTERCOMPANY_PCT;
    return n / 100;
  }, [margenStr]);

  const proyeccion = useMemo(() => {
    return proyectarAsientoRecuperacionIntercompany({
      empresa,
      montoAdelantadoQ: monto ?? 0,
      margenPct,
    });
  }, [empresa, monto, margenPct]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Intercompany · Preview de <em>recuperación</em></h1>
          <p className="page-subtitle">
            Asiento que se generaría al cobrar la factura intercompany. Estructura pendiente de validación contable —{' '}
            <code>GENERAR_ASIENTO_INTERCOMPANY</code>{' '}
            está {GENERAR_ASIENTO_INTERCOMPANY
              ? <strong style={{ color: 'var(--olive)' }}>ON</strong>
              : <strong style={{ color: 'var(--amber)' }}>OFF</strong>}.
            Esta vista no escribe a libros.
          </p>
        </div>
      </header>

      {/* Controles */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <Field label="Empresa hermana">
            <select
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              className="input"
            >
              {EMPRESAS.map(emp => (
                <option key={emp} value={emp}>{emp}</option>
              ))}
            </select>
          </Field>

          <Field label="Monto adelantado (Q)" hint="Saldo de CxC a cancelar con este cobro.">
            <MontoInput
              value={monto}
              onChange={setMonto}
              prefix="Q"
              placeholder="0.00"
            />
          </Field>

          <Field
            label="Margen %"
            hint={`Default global = ${(MARGEN_INTERCOMPANY_PCT * 100).toFixed(1)}%. Acá podés probar otros sin tocar la constante.`}
          >
            <input
              type="text"
              inputMode="decimal"
              value={margenStr}
              onChange={(e) => setMargenStr(e.target.value)}
              className="input"
              placeholder="0"
            />
          </Field>
        </div>
      </div>

      {/* Preview */}
      <PreviewRecuperacionIntercompany proyeccion={proyeccion} />

      {/* Nota fuera de scope */}
      <div style={{ marginTop: 16, fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5 }}>
        <strong style={{ color: 'var(--ink-3)' }}>Fuera de scope (F-056.1):</strong>{' '}
        IVA débito fiscal sobre el fee (queda como hook comentado en el motor
        hasta confirmación del contador). Conciliación automática factura
        emitida ↔ CxC ↔ cobro. Generador real del asiento de planilla (F-056.2).
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{hint}</span>}
    </label>
  );
}
