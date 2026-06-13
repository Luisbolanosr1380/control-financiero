'use client';

/**
 * F-056.1 — Preview del asiento de recuperación intercompany.
 *
 * Mostrar dónde se registre la liquidación intercompany. Render-only
 * (acepta el resultado del motor + opcionalmente la cuenta de banco
 * que va a usarse). NO escribe.
 *
 * Banner ámbar persistente mientras GENERAR_ASIENTO_INTERCOMPANY=false:
 * "Estructura pendiente de validación contable — generación deshabilitada".
 */

import { Q } from '@/lib/utils';
import { GENERAR_ASIENTO_INTERCOMPANY } from '@/lib/contabilidad/intercompany-config';
import type { AsientoRecuperacionProyectado } from '@/lib/planilla/proyectar-asiento-recuperacion-intercompany';

interface Props {
  /** Resultado del motor (`proyectarAsientoRecuperacionIntercompany`). */
  proyeccion: AsientoRecuperacionProyectado;
  /** Texto a mostrar para la cuenta de banco (la concreta la elige el caller). */
  bancoLabel?: string;
}

export function PreviewRecuperacionIntercompany({ proyeccion, bancoLabel }: Props) {
  const { empresa, margenPct, baseQ, feeQ, cobroQ, partidas, balanceado, advertencias } = proyeccion;

  return (
    <div
      style={{
        border: '1px solid var(--line-2)',
        background: 'var(--paper-2)',
        borderRadius: 'var(--r-3, 8px)',
        padding: '14px 16px',
        fontSize: 12.5,
        color: 'var(--ink-2)',
        lineHeight: 1.5,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{
          fontSize: 11, fontWeight: 500,
          textTransform: 'uppercase', letterSpacing: '0.08em',
          color: 'var(--ink-4)',
        }}>
          Asiento de recuperación · {empresa ?? '—'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          Margen intercompany:{' '}
          <strong style={{ color: 'var(--ink-2)' }}>
            {(margenPct * 100).toFixed(margenPct === 0 ? 0 : 1)}%
          </strong>{' '}
          <span style={{ color: 'var(--ink-4)' }}>(configurable)</span>
        </div>
      </div>

      {/* Flag deshabilitado — banner ámbar visible HASTA que el contador valide. */}
      {!GENERAR_ASIENTO_INTERCOMPANY && (
        <div
          role="status"
          style={{
            border: '1px solid var(--amber)',
            background: 'var(--amber-bg)',
            borderRadius: 'var(--r-2, 5px)',
            padding: '8px 10px',
            fontSize: 11.5,
            color: 'var(--ink-2)',
            marginBottom: 10,
            lineHeight: 1.45,
          }}
        >
          <strong>Estructura pendiente de validación contable.</strong>{' '}
          La generación del asiento intercompany está deshabilitada
          (<code>GENERAR_ASIENTO_INTERCOMPANY = false</code>). El preview
          se muestra para revisión; nada se escribe a libros.
        </div>
      )}

      {/* Resumen numérico cuando hay margen > 0. */}
      {feeQ > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 12, rowGap: 2, marginBottom: 10, fontSize: 12 }}>
          <span style={{ color: 'var(--ink-3)' }}>Base (CxC adelantada)</span>
          <span className="num" style={{ textAlign: 'right' }}>{Q(baseQ)}</span>
          <span style={{ color: 'var(--ink-3)' }}>Fee ({(margenPct * 100).toFixed(1)}%)</span>
          <span className="num" style={{ textAlign: 'right' }}>{Q(feeQ)}</span>
          <span style={{ fontWeight: 500, borderTop: '1px solid var(--line-3)', paddingTop: 3 }}>Cobro a facturar</span>
          <span className="num" style={{ textAlign: 'right', fontWeight: 600, borderTop: '1px solid var(--line-3)', paddingTop: 3 }}>
            {Q(cobroQ)}
          </span>
        </div>
      )}

      {/* Asiento */}
      {partidas.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line-3)' }}>
              <th style={th(36)}>Tipo</th>
              <th style={th(undefined, 'left')}>Cuenta</th>
              <th style={th(undefined, 'left')}>Descripción</th>
              <th style={th(96, 'right')}>Monto</th>
            </tr>
          </thead>
          <tbody>
            {partidas.map((p, i) => {
              const isDr = p.tipo === 'Dr';
              const cuenta = p.categoria === 'banco'
                ? (bancoLabel || 'Banco · pendiente de elegir')
                : `${p.cuentaCodigo ?? ''} · ${nombreCuenta(p.categoria, p.empresa)}`;
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--line-3)' }}>
                  <td style={td(36, 'center')}>
                    <span style={{
                      display: 'inline-block',
                      width: 22, padding: '1px 4px',
                      borderRadius: 3, fontSize: 10.5, fontWeight: 500,
                      background: isDr ? 'var(--indigo-bg)' : 'var(--olive-bg)',
                      color: isDr ? 'var(--indigo)' : 'var(--olive)',
                    }}>{p.tipo}</span>
                  </td>
                  <td style={td()}>{cuenta}</td>
                  <td style={{ ...td(), color: 'var(--ink-3)' }}>{p.descripcion}</td>
                  <td style={{ ...td(96, 'right') }} className="num">{Q(p.montoQ)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--ink-4)', padding: 8 }}>
          Sin partidas — revisá las advertencias.
        </div>
      )}

      {/* Balance */}
      {partidas.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11.5, textAlign: 'right' }}>
          {balanceado ? (
            <span style={{ color: 'var(--olive)' }}>✓ Asiento balanceado (Dr = Cr)</span>
          ) : (
            <span style={{ color: 'var(--wine)', fontWeight: 500 }}>⚠ Asiento NO balanceado</span>
          )}
        </div>
      )}

      {/* Advertencias */}
      {advertencias.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11.5, color: 'var(--wine)' }}>
          {advertencias.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}
    </div>
  );
}

function nombreCuenta(categoria: 'cxc_intercompany' | 'ingreso_intercompany' | 'banco', empresa?: string): string {
  if (categoria === 'banco') return 'Banco';
  if (categoria === 'cxc_intercompany') return `CxC Intercompany — ${empresa ?? ''}`.trim();
  return `Ingresos Servicios Admin. — ${empresa ?? ''}`.trim();
}

const th = (width?: number, align: 'left' | 'right' | 'center' = 'center'): React.CSSProperties => ({
  textAlign: align,
  width,
  padding: '6px 8px',
  fontSize: 10.5,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--ink-4)',
});

const td = (width?: number, align: 'left' | 'right' | 'center' = 'left'): React.CSSProperties => ({
  textAlign: align,
  width,
  padding: '6px 8px',
});
