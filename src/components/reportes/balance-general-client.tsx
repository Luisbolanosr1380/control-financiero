'use client';

/**
 * F-059b — UI del Balance General + tab de Balance de Comprobación.
 *
 * Dos tabs:
 *  · "Balance General"      — la foto: Activo / Pasivo+Capital con
 *                             comparativo vs mes anterior.
 *  · "Balance de Comprobación" — control duro: lista de cuentas con
 *                             Σdebe, Σhaber y saldo, totales al pie.
 *
 * Indicador grande "✓ Balance cuadrado" / "⚠ Descuadre de Q[x]" en
 * la cabecera. Banners explicativos cuando la ecuación contable o la
 * comprobación no cuadran.
 */

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Q } from '@/lib/utils';
import { etiquetaMes } from '@/lib/utils/mes-activo';
import type { BalanceGeneral, LineaBG } from '@/lib/contabilidad/balance-general';

type Tab = 'balance' | 'comprobacion';

interface Props {
  bg: BalanceGeneral;
  centros: Array<{ id: string; nombre: string }>;
  periodoCorte: string;
  centroCostoActivo?: string;
  tabActiva: Tab;
}

export function BalanceGeneralClient({ bg, centros, periodoCorte, centroCostoActivo, tabActiva }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const cambiar = (clave: 'cc' | 'tab', valor: string | undefined) => {
    const next = new URLSearchParams(searchParams.toString());
    if (valor) next.set(clave, valor);
    else       next.delete(clave);
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };

  const nombreCC = centroCostoActivo
    ? (centros.find(c => c.id === centroCostoActivo)?.nombre ?? '—')
    : 'Todas las líneas';

  const vacio = bg.conteos.partidasAcumuladas === 0;
  const ratios = calcularRatios(bg);

  return (
    <div className="page">
      <header className="page-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title">Balance <em>General</em></h1>
          <p className="page-subtitle">
            Corte al fin de {etiquetaMes(periodoCorte)} · <strong>{nombreCC}</strong>
          </p>
        </div>
        <div className="page-actions">
          <BalanceBadge cuadra={bg.ecuacion.cuadra} diferencia={bg.ecuacion.diferencia} />
          <select
            value={centroCostoActivo ?? ''}
            onChange={(e) => cambiar('cc', e.target.value || undefined)}
            className="input"
            style={{ minWidth: 180 }}
          >
            <option value="">Todas las líneas</option>
            {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 14 }}>
        <TabBtn activo={tabActiva === 'balance'} onClick={() => cambiar('tab', undefined)}>Balance General</TabBtn>
        <TabBtn activo={tabActiva === 'comprobacion'} onClick={() => cambiar('tab', 'comprobacion')}>
          Comprobación{' '}
          <span style={{
            display: 'inline-block', marginLeft: 4, padding: '0 6px',
            borderRadius: 8, fontSize: 10.5, fontWeight: 500,
            background: bg.comprobacion.cuadra ? 'var(--olive-bg)' : 'var(--wine-bg)',
            color:      bg.comprobacion.cuadra ? 'var(--olive)'    : 'var(--wine)',
          }}>
            {bg.comprobacion.cuadra ? '✓' : 'Δ'}
          </span>
        </TabBtn>
      </div>

      {/* Banners de advertencia (no pisan el render) */}
      {bg.advertencias.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {bg.advertencias.map((a, i) => (
            <div
              key={i}
              className="card card-pad"
              style={{
                background: a.toLowerCase().includes('ecuación') ? 'var(--wine-bg)'
                         : a.toLowerCase().includes('comprobación') ? 'var(--wine-bg)'
                         : 'var(--amber-bg)',
                borderColor: a.toLowerCase().includes('cuadra') ? 'var(--wine)' : 'var(--amber)',
                fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5,
              }}
            >
              {a}
            </div>
          ))}
        </div>
      )}

      {vacio ? <EmptyState periodo={periodoCorte} /> : (
        tabActiva === 'balance'
          ? <TabBalance bg={bg} ratios={ratios} />
          : <TabComprobacion bg={bg} />
      )}

      <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--ink-4)' }}>
        {bg.conteos.partidasAcumuladas} partidas acumuladas hasta el corte ·{' '}
        {bg.conteos.cuentasConMovimiento} cuentas con movimiento.
      </div>
    </div>
  );
}

/* =========================================================================
 * Tab Balance General
 * ========================================================================= */

function TabBalance({ bg, ratios }: { bg: BalanceGeneral; ratios: Ratios }) {
  return (
    <>
      {/* KPIs de totales + ratios */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 18 }}>
        <Kpi label="Total Activo" valor={bg.subtotales.totalActivo} />
        <Kpi label="Total Pasivo + Capital" valor={bg.subtotales.totalPasivoCapital} />
        <Kpi label="Liquidez corriente" pct={ratios.liquidezCorriente} />
        <Kpi label="Endeudamiento" pct={ratios.endeudamientoPct} />
      </div>

      {/* Tabla vertical estilo balance clásico */}
      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--paper-tint)' }}>
              <Th align="left">Línea</Th>
              <Th align="right">Corte {etiquetaMes(bg.periodoCorte)}</Th>
              <Th align="right">Cierre {etiquetaMes(bg.periodoAnterior)}</Th>
              <Th align="right">Δ vs anterior</Th>
            </tr>
          </thead>
          <tbody>
            {bg.lineas.map(l => <FilaBG key={`${l.orden}-${l.nombre}`} linea={l} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FilaBG({ linea }: { linea: LineaBG }) {
  const esCalculada = linea.tipo === 'Calculada';
  const esTotalFinal = /total\s+(pasivo\s*[+y]\s*capital|activo)/i.test(linea.nombre);
  const styleFila: React.CSSProperties = esCalculada
    ? {
        background: esTotalFinal ? 'var(--paper-tint)' : 'var(--paper-2)',
        borderTop: esTotalFinal ? '2px solid var(--ink)' : '1px solid var(--line)',
        borderBottom: '1px solid var(--line)',
        fontWeight: 600,
      }
    : { borderBottom: '1px solid var(--line-3)' };
  return (
    <tr style={styleFila}>
      <td style={{ padding: '7px 12px' }}>
        <span style={{ color: 'var(--ink-4)', fontVariantNumeric: 'tabular-nums', marginRight: 8, fontSize: 11 }}>
          {linea.orden}
        </span>
        <span>{linea.nombre}</span>
      </td>
      <Money n={linea.monto} />
      <Money n={linea.montoAnterior} muted />
      <td style={{
        padding: '7px 12px',
        textAlign: 'right',
        color: variacionColor(linea.variacion),
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}>
        {linea.variacion === 0 ? '—' : Q(linea.variacion)}
        {linea.variacionPct != null && (
          <span style={{ fontSize: 10.5, marginLeft: 6, color: 'var(--ink-4)' }}>
            ({linea.variacionPct > 0 ? '+' : ''}{linea.variacionPct.toFixed(1)}%)
          </span>
        )}
      </td>
    </tr>
  );
}

/* =========================================================================
 * Tab Balance de Comprobación
 * ========================================================================= */

function TabComprobacion({ bg }: { bg: BalanceGeneral }) {
  const c = bg.comprobacion;
  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 14 }}>
        <Kpi label="Σ Debe (acumulado)" valor={c.totalDebe} />
        <Kpi label="Σ Haber (acumulado)" valor={c.totalHaber} />
        <div className="kpi">
          <div className="kpi-label">Control</div>
          <div className="kpi-value" style={{ color: c.cuadra ? 'var(--olive)' : 'var(--wine)' }}>
            {c.cuadra ? '✓ Cuadra' : `Δ ${Q(c.diferencia)}`}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--paper-tint)' }}>
              <Th align="left">Código</Th>
              <Th align="left">Cuenta</Th>
              <Th align="right">Σ Debe</Th>
              <Th align="right">Σ Haber</Th>
              <Th align="right">Saldo</Th>
            </tr>
          </thead>
          <tbody>
            {c.cuentas.map(row => (
              <tr key={row.cuentaId} style={{ borderBottom: '1px solid var(--line-3)' }}>
                <td style={{ padding: '6px 12px', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-3)' }}>
                  {row.codigo}
                </td>
                <td style={{ padding: '6px 12px' }}>{row.nombre}</td>
                <Money n={row.totalDebe} />
                <Money n={row.totalHaber} />
                <td style={{
                  padding: '6px 12px',
                  textAlign: 'right',
                  color: row.saldo === 0 ? 'var(--ink-3)' : (row.saldo > 0 ? 'var(--ink)' : 'var(--wine)'),
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }} className="num">
                  {Q(row.saldo)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--ink)', background: 'var(--paper-tint)', fontWeight: 600 }}>
              <td style={{ padding: '8px 12px' }} colSpan={2}>Totales</td>
              <Money n={c.totalDebe} />
              <Money n={c.totalHaber} />
              <td style={{ padding: '8px 12px', textAlign: 'right', color: c.cuadra ? 'var(--olive)' : 'var(--wine)' }} className="num">
                {c.cuadra ? '✓ cuadra' : Q(c.diferencia)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/* =========================================================================
 * Componentes auxiliares
 * ========================================================================= */

function BalanceBadge({ cuadra, diferencia }: { cuadra: boolean; diferencia: number }) {
  return (
    <div
      title={cuadra ? 'Activo = Pasivo + Capital' : `Δ = ${Q(diferencia)}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px',
        borderRadius: 6,
        fontSize: 12.5, fontWeight: 500,
        background: cuadra ? 'var(--olive-bg)' : 'var(--wine-bg)',
        color:      cuadra ? 'var(--olive)'    : 'var(--wine)',
      }}
    >
      {cuadra ? '✓ Balance cuadrado' : `⚠ Descuadre ${Q(diferencia)}`}
    </div>
  );
}

function TabBtn({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset', cursor: 'pointer',
        padding: '8px 14px',
        fontSize: 12.5,
        fontWeight: activo ? 600 : 400,
        color: activo ? 'var(--ink)' : 'var(--ink-3)',
        borderBottom: activo ? '2px solid var(--ink)' : '2px solid transparent',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

function Kpi({ label, valor, pct }: { label: string; valor?: number; pct?: number | null }) {
  const texto = pct != null ? `${pct.toFixed(2)}` : (valor != null ? Q(valor) : '—');
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: 'var(--ink)' }}>{texto}</div>
    </div>
  );
}

function Money({ n, muted }: { n: number; muted?: boolean }) {
  return (
    <td style={{
      padding: '6px 12px',
      textAlign: 'right',
      color: muted ? 'var(--ink-3)' : 'var(--ink)',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    }} className="num">
      {n === 0 ? '—' : Q(n)}
    </td>
  );
}

function Th({ align, children }: { align: 'left' | 'right'; children: React.ReactNode }) {
  return (
    <th style={{
      padding: '10px 12px',
      textAlign: align,
      fontSize: 11,
      fontWeight: 500,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: 'var(--ink-4)',
    }}>
      {children}
    </th>
  );
}

function variacionColor(v: number): string {
  if (v > 0.01)  return 'var(--olive)';
  if (v < -0.01) return 'var(--wine)';
  return 'var(--ink-3)';
}

function EmptyState({ periodo }: { periodo: string }) {
  return (
    <div className="card card-pad" style={{
      textAlign: 'center', padding: 40, color: 'var(--ink-3)', lineHeight: 1.6,
    }}>
      <div style={{ fontSize: 22, color: 'var(--ink-2)', marginBottom: 6 }}>📒</div>
      <div style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 500, marginBottom: 4 }}>
        Aún hay pocos asientos para construir un Balance
      </div>
      <div style={{ fontSize: 12.5, maxWidth: 460, margin: '0 auto' }}>
        Hasta el cierre de {etiquetaMes(periodo)} no hay partidas registradas en el libro diario.
        El motor construye desde PARTIDAS reales — a medida que se aprueben asientos (F-050) las
        líneas del Balance se llenarán. Esto NO es un error: es la realidad de una contabilidad
        que recién arranca.
      </div>
    </div>
  );
}

/* =========================================================================
 * Ratios financieros básicos
 * ========================================================================= */

interface Ratios {
  /** Liquidez corriente = Activo Corriente / Pasivo Corriente. null si no aplica. */
  liquidezCorriente: number | null;
  /** Endeudamiento = Pasivo / Activo × 100. null si activo = 0. */
  endeudamientoPct: number | null;
}

function calcularRatios(bg: BalanceGeneral): Ratios {
  // Activo Corriente vs Pasivo Corriente — los identificamos por nombre
  // normalizado en las líneas Calculada de MAPEO_BS. Si no existen como
  // calculadas, sumamos por rangos de orden (1-9 activo corriente; 30-39
  // pasivo corriente).
  const activoCorriente = lineaPorNombre(bg.lineas, 'activo corriente')
                       ?? rangoMonto(bg.lineas, 1, 9);
  const pasivoCorriente = lineaPorNombre(bg.lineas, 'pasivo corriente')
                       ?? rangoMonto(bg.lineas, 30, 39);

  const liquidezCorriente = pasivoCorriente && Math.abs(pasivoCorriente) > 0.01
    ? Math.round((activoCorriente / pasivoCorriente) * 100) / 100
    : null;

  const endeudamientoPct = bg.subtotales.totalActivo && Math.abs(bg.subtotales.totalActivo) > 0.01
    ? Math.round((bg.subtotales.totalPasivo / bg.subtotales.totalActivo) * 10000) / 100
    : null;

  return { liquidezCorriente, endeudamientoPct };
}

function lineaPorNombre(lineas: ReadonlyArray<{ nombre: string; monto: number }>, needle: string): number | null {
  const q = needle.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const l = lineas.find(x => x.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q));
  return l ? l.monto : null;
}

function rangoMonto(lineas: ReadonlyArray<{ orden: number; tipo: string; monto: number }>, desde: number, hasta: number): number {
  let s = 0;
  for (const l of lineas) {
    if (l.tipo !== 'Suma cuentas') continue;
    if (l.orden < desde || l.orden > hasta) continue;
    s += l.monto;
  }
  return Math.round(s * 100) / 100;
}
