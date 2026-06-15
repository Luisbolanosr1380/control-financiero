'use client';

/**
 * F-056.2 — Modal de generación de asiento de planilla.
 *
 * Flujo:
 *  1. Usuario selecciona banco de pago.
 *  2. Click "Calcular preview" → trae el asiento proyectado (server action).
 *  3. Muestra desglose por empresa (banner F-051.7/F-056) + tabla Dr/Cr.
 *  4. Indicador ✓ balanceado / ⚠ no balanceado.
 *  5. Botón "Generar asiento":
 *      · flag off → deshabilitado, tooltip explica que está pendiente.
 *      · flag on  → ejecuta la action; al éxito, link al asiento creado.
 *  6. Idempotencia: si la planilla ya tiene asiento, se muestra eso y
 *     se bloquea la generación.
 *
 * NO escribe nada hasta que el usuario hace click en "Generar asiento" Y
 * el flag está en true. Mientras tanto es seguro abrirlo y revisarlo.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import {
  previewAsientoPlanillaAction,
  generarAsientoPlanillaAction,
} from '@/app/(app)/planillas/actions';
import { GENERAR_ASIENTO_PLANILLA } from '@/lib/planilla/planilla-config';
import type { PreviewAsientoPlanilla } from '@/lib/planilla/generar-asiento-planilla';
import { esGolden } from '@/lib/empleados/empresa';

interface Props {
  periodoId: string;
  periodoNombre: string;
  bancos: Array<{ id: string; nombre: string }>;
  onClose: () => void;
}

export function ModalGenerarAsientoPlanilla({ periodoId, periodoNombre, bancos, onClose }: Props) {
  const [bancoId, setBancoId] = useState(bancos[0]?.id ?? '');
  const [preview, setPreview] = useState<PreviewAsientoPlanilla | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [asientoGeneradoId, setAsientoGeneradoId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !generating) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, generating]);

  const calcular = async () => {
    if (!bancoId) return;
    setError('');
    setPreview(null);
    setLoading(true);
    try {
      const r = await previewAsientoPlanillaAction({ periodoId, bancoId });
      if (r.ok) setPreview(r.preview);
      else      setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const generar = async () => {
    if (!preview || !GENERAR_ASIENTO_PLANILLA) return;
    setError('');
    setGenerating(true);
    try {
      const r = await generarAsientoPlanillaAction({ periodoId, bancoId });
      if (r.ok) {
        setAsientoGeneradoId(r.asientoId);
        toast.success(`Asiento ${r.asientoId.slice(-6)} generado con ${r.numPartidas} partidas.`);
      } else {
        setError(r.error);
        toast.error(r.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      onClick={() => { if (!generating) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(14, 42, 36, 0.5)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(780px, 96vw)', maxHeight: '92vh',
          background: 'var(--paper-2)', borderRadius: 12,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 48px -12px rgba(14, 42, 36, 0.35)',
          border: '1px solid var(--line)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line-3)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: 18, color: 'var(--ink)' }}>
              Generar asiento de planilla
            </h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
              {periodoNombre} · multi-empresa (Golden + intercompany)
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={generating} style={{ all: 'unset', cursor: 'pointer', color: 'var(--ink-3)' }}>
            <I.X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 22px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Flag warning */}
          {!GENERAR_ASIENTO_PLANILLA && (
            <Banner kind="amber" titulo="Generación deshabilitada — pendiente validación contable">
              El motor calcula el preview pero NADIE escribe a libros mientras{' '}
              <code>GENERAR_ASIENTO_PLANILLA = false</code>. Validá la estructura
              del primer asiento real con el contador antes de prender el flag.
            </Banner>
          )}

          {/* Banco selector + acción */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 500, marginBottom: 4, display: 'block' }}>
                Banco de pago (Cr)
              </label>
              <select
                value={bancoId}
                onChange={(e) => { setBancoId(e.target.value); setPreview(null); }}
                disabled={loading || generating || !!asientoGeneradoId}
                className="input"
                style={{ width: '100%' }}
              >
                {bancos.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </div>
            <button
              type="button"
              onClick={calcular}
              disabled={!bancoId || loading || generating || !!asientoGeneradoId}
              className="btn btn-secondary"
              style={{ minWidth: 140 }}
            >
              {loading ? 'Calculando…' : 'Calcular preview'}
            </button>
          </div>

          {error && (
            <Banner kind="wine" titulo="Error">
              {error}
            </Banner>
          )}

          {/* Idempotencia */}
          {preview?.yaContabilizada && (
            <Banner kind="wine" titulo="Ya está contabilizada">
              Esta planilla tiene un asiento <code>{preview.asientoExistenteId}</code>{' '}
              vinculado con ORIGEN=PLANILLA. La idempotencia impide generar otro.
              Anulalo primero si necesitás re-generar.
            </Banner>
          )}

          {/* Desglose por empresa */}
          {preview && preview.porEmpresa.length > 0 && (
            <div style={{ background: 'var(--paper)', border: '1px solid var(--line-3)', borderRadius: 6, padding: '10px 12px', fontSize: 12.5 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
                Desglose por empresa empleadora
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {preview.porEmpresa.map(d => (
                  <li key={d.empresa} style={{ marginBottom: 2 }}>
                    {esGolden(d.empresa) ? (
                      <>
                        <strong>{Q(d.totalQ)}</strong> a cuentas de nómina <strong>{d.empresa}</strong>{' '}
                        <span style={{ color: 'var(--ink-3)' }}>({d.numLineas} líneas)</span>
                      </>
                    ) : (
                      <>
                        <strong>{Q(d.totalQ)}</strong> a CxC <strong>{d.empresa}</strong>{' '}
                        <span style={{ color: 'var(--ink-3)' }}>(intercompany · {d.numLineas} líneas)</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Advertencias */}
          {preview && preview.advertencias.length > 0 && (
            <Banner kind="amber" titulo="Advertencias">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {preview.advertencias.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </Banner>
          )}

          {/* Partidas */}
          {preview && preview.partidas.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="card-title">Asiento proyectado</div>
                <span style={{
                  marginLeft: 'auto', fontSize: 11.5, fontWeight: 500,
                  color: preview.balanceado ? 'var(--olive)' : 'var(--wine)',
                }}>
                  {preview.balanceado ? '✓ Balanceado (Dr = Cr)' : '⚠ NO balanceado'}
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--paper-tint)' }}>
                    <Th align="center">Tipo</Th>
                    <Th align="left">Cuenta</Th>
                    <Th align="left">Descripción</Th>
                    <Th align="right">Monto</Th>
                  </tr>
                </thead>
                <tbody>
                  {preview.partidas.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line-3)' }}>
                      <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', width: 22,
                          padding: '1px 4px', borderRadius: 3,
                          fontSize: 10.5, fontWeight: 600,
                          background: p.tipo === 'Dr' ? 'var(--indigo-bg)' : 'var(--olive-bg)',
                          color:      p.tipo === 'Dr' ? 'var(--indigo)'    : 'var(--olive)',
                        }}>
                          {p.tipo}
                        </span>
                      </td>
                      <td style={{ padding: '6px 12px', fontVariantNumeric: 'tabular-nums' }}>
                        {p.cuentaCodigo}
                      </td>
                      <td style={{ padding: '6px 12px', color: 'var(--ink-3)' }}>
                        {p.descripcion}
                      </td>
                      <td className="num" style={{ padding: '6px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {Q(p.montoQ)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--ink)', background: 'var(--paper-tint)', fontWeight: 600 }}>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>Σ</td>
                    <td style={{ padding: '8px 12px' }} colSpan={2}>Total Dr / Cr</td>
                    <td className="num" style={{ padding: '8px 12px', textAlign: 'right' }}>
                      {Q(preview.totalDr)} / {Q(preview.totalCr)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {asientoGeneradoId && (
            <Banner kind="olive" titulo="✓ Asiento generado">
              <code>{asientoGeneradoId}</code> · planilla marcada como contabilizada.
            </Banner>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 22px', borderTop: '1px solid var(--line-3)',
          background: 'var(--bg)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button type="button" onClick={onClose} disabled={generating} style={btnGhost}>
            {asientoGeneradoId ? 'Cerrar' : 'Cancelar'}
          </button>
          <button
            type="button"
            onClick={generar}
            disabled={
              !preview
              || !preview.balanceado
              || preview.yaContabilizada
              || generating
              || !GENERAR_ASIENTO_PLANILLA
              || !!asientoGeneradoId
            }
            title={
              !GENERAR_ASIENTO_PLANILLA
                ? 'Generación deshabilitada hasta validación contable.'
                : !preview
                  ? 'Calcular preview primero.'
                  : preview.yaContabilizada
                    ? 'Idempotencia: ya está contabilizada.'
                    : !preview.balanceado
                      ? 'Asiento no balanceado.'
                      : undefined
            }
            style={{
              ...btnPrimary,
              opacity: (!preview || !preview.balanceado || preview.yaContabilizada || !GENERAR_ASIENTO_PLANILLA || !!asientoGeneradoId)
                ? 0.5 : 1,
              cursor: (!preview || !preview.balanceado || preview.yaContabilizada || !GENERAR_ASIENTO_PLANILLA || !!asientoGeneradoId)
                ? 'not-allowed' : 'pointer',
            }}
          >
            {generating ? 'Generando…' : 'Generar asiento'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ========================================================================= */

function Banner({ kind, titulo, children }: { kind: 'amber' | 'wine' | 'olive'; titulo: string; children: React.ReactNode }) {
  const colores =
    kind === 'amber' ? { bg: 'var(--amber-bg)', bd: 'var(--amber)', fg: 'var(--ink-2)' } :
    kind === 'wine'  ? { bg: 'var(--wine-bg)',  bd: 'var(--wine)',  fg: 'var(--ink-2)' } :
                       { bg: 'var(--olive-bg)', bd: 'var(--olive)', fg: 'var(--ink)'   };
  return (
    <div style={{
      border: `1px solid ${colores.bd}`,
      background: colores.bg,
      borderRadius: 'var(--r-2, 5px)',
      padding: '10px 12px',
      fontSize: 12.5,
      color: colores.fg,
      lineHeight: 1.5,
    }}>
      <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{titulo}</div>
      <div>{children}</div>
    </div>
  );
}

function Th({ align, children }: { align: 'left' | 'right' | 'center'; children: React.ReactNode }) {
  return (
    <th style={{
      padding: '10px 12px', textAlign: align,
      fontSize: 11, fontWeight: 500,
      textTransform: 'uppercase', letterSpacing: 0.6,
      color: 'var(--ink-4)',
    }}>
      {children}
    </th>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 18px', border: 'none', borderRadius: 8,
  background: 'var(--ink)', color: 'var(--paper)',
  fontSize: 13, fontWeight: 500,
};

const btnGhost: React.CSSProperties = {
  padding: '8px 16px', border: '1px solid var(--line)', borderRadius: 8,
  background: 'transparent', color: 'var(--ink-2)',
  cursor: 'pointer', fontSize: 13,
};
