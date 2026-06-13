'use client';

/**
 * F-058b — UI del Estado de Resultados.
 *
 * Tres elementos clave:
 *  · Toggle modo: Operativo | Fiscal (con tooltip explicando la diferencia).
 *  · Filtro de centro de costo (línea de negocio).
 *  · Tabla con 3 columnas: mes · mes anterior · YTD + variación %.
 *
 * Las líneas calculadas (Utilidad Bruta, EBITDA, U.Op, U.Neta) se
 * resaltan visualmente. Subtotales con fondo cremoso, U.Neta con borde
 * superior reforzado.
 *
 * Estado vacío elegante cuando el período tiene pocas/cero partidas.
 */

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Q } from '@/lib/utils';
import { etiquetaMes } from '@/lib/utils/mes-activo';
import type { EstadoResultados, LineaER, ModoER } from '@/lib/contabilidad/estado-resultados';

interface Props {
  er: EstadoResultados;
  centros: Array<{ id: string; nombre: string }>;
  periodoActivo: string;
  modoActivo: ModoER;
  centroCostoActivo?: string;
}

export function EstadoResultadosClient({
  er, centros, periodoActivo, modoActivo, centroCostoActivo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const cambiar = (clave: 'modo' | 'cc', valor: string | undefined) => {
    const next = new URLSearchParams(searchParams.toString());
    if (valor) next.set(clave, valor);
    else       next.delete(clave);
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };

  const nombreCC = centroCostoActivo
    ? (centros.find(c => c.id === centroCostoActivo)?.nombre ?? '—')
    : 'Todas las líneas';

  // El estado vacío aplica cuando el mes activo tiene 0 partidas Y el
  // YTD tampoco — recién arrancando la contabilidad.
  const esVacio = er.conteos.partidasMes === 0 && er.conteos.partidasYTD === 0;

  return (
    <div className="page">
      <header className="page-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title">Estado de <em>Resultados</em></h1>
          <p className="page-subtitle">
            {etiquetaMes(periodoActivo)} · <strong>{nombreCC}</strong> · modo{' '}
            <strong>{modoActivo === 'fiscal' ? 'Fiscal' : 'Operativo'}</strong>
          </p>
        </div>
        <div className="page-actions">
          <ModoToggle modo={modoActivo} onChange={(m) => cambiar('modo', m === 'fiscal' ? undefined : m)} />
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

      {/* Banner si no cuadra */}
      {!er.control.cuadra && (
        <div className="card card-pad" style={{
          background: 'var(--wine-bg)', borderColor: 'var(--wine)',
          marginBottom: 12, fontSize: 12.5, color: 'var(--ink)',
        }}>
          <strong>Balance de comprobación NO cuadra:</strong>{' '}
          Σdebe = {Q(er.control.totalDebe)} · Σhaber = {Q(er.control.totalHaber)} ·{' '}
          Δ = <span className="num">{Q(er.control.diferencia)}</span>.
          Revisar asientos del período antes de tomar decisiones sobre estas cifras.
        </div>
      )}

      {/* Advertencias varias */}
      {er.advertencias.filter(a => !a.startsWith('Balance')).map((a, i) => (
        <div key={i} className="card card-pad" style={{
          background: 'var(--amber-bg)', borderColor: 'var(--amber)',
          marginBottom: 12, fontSize: 12.5, color: 'var(--ink-2)',
        }}>
          {a}
        </div>
      ))}

      {esVacio ? (
        <EmptyState periodo={periodoActivo} />
      ) : (
        <>
          {/* Márgenes resumen */}
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 18 }}>
            <Kpi label="Margen bruto" pct={er.margenes.brutoPct} />
            <Kpi label="Margen operativo" pct={er.margenes.operativoPct} />
            <Kpi label="Margen neto" pct={er.margenes.netoPct} />
          </div>

          {/* Tabla */}
          <div className="card" style={{ padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--paper-tint)' }}>
                  <Th align="left">Línea</Th>
                  <Th align="right">{etiquetaMes(periodoActivo)}</Th>
                  <Th align="right">{etiquetaMes(er.periodoAnterior)}</Th>
                  <Th align="right">YTD</Th>
                  <Th align="right">Δ vs mes anterior</Th>
                </tr>
              </thead>
              <tbody>
                {er.lineas.map((l) => <FilaLinea key={`${l.orden}-${l.nombre}`} linea={l} />)}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-4)' }}>
            {er.conteos.partidasMes} partidas en {etiquetaMes(periodoActivo)} ·{' '}
            {er.conteos.partidasYTD} acumuladas YTD.
            {modoActivo === 'operativo' && (
              <> · Modo operativo: excluye partidas de gastos No Operativo.</>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================================
 * Componentes auxiliares
 * ========================================================================= */

function ModoToggle({ modo, onChange }: { modo: ModoER; onChange: (m: ModoER) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Modo del Estado de Resultados"
      title="Operativo: excluye gastos no-operativos. Fiscal: incluye todo (SAT)."
      style={{
        display: 'inline-flex',
        border: '1px solid var(--line)',
        borderRadius: 6,
        overflow: 'hidden',
        background: 'var(--paper-2)',
      }}
    >
      {(['operativo', 'fiscal'] as const).map(m => {
        const activo = m === modo;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={activo}
            onClick={() => onChange(m)}
            style={{
              all: 'unset', cursor: 'pointer',
              padding: '6px 14px',
              fontSize: 12.5,
              fontWeight: activo ? 600 : 400,
              background: activo ? 'var(--ink)' : 'transparent',
              color:      activo ? 'var(--paper)' : 'var(--ink-2)',
            }}
          >
            {m === 'fiscal' ? 'Fiscal' : 'Operativo'}
          </button>
        );
      })}
    </div>
  );
}

function Kpi({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: 'var(--ink)' }}>
        {pct == null ? '—' : `${pct.toFixed(1)}%`}
      </div>
    </div>
  );
}

function FilaLinea({ linea }: { linea: LineaER }) {
  const esCalculada = linea.tipo === 'Calculada';
  const esNeta = /utilidad\s+neta/i.test(linea.nombre);
  const styleFila: React.CSSProperties = esCalculada
    ? {
        background: esNeta ? 'var(--paper-tint)' : 'var(--paper-2)',
        borderTop: esNeta ? '2px solid var(--ink)' : '1px solid var(--line)',
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
      <Money n={linea.mes} />
      <Money n={linea.mesAnterior} muted />
      <Money n={linea.ytd} muted />
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

function Money({ n, muted }: { n: number; muted?: boolean }) {
  return (
    <td style={{
      padding: '7px 12px',
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
      textAlign: 'center',
      padding: 40,
      color: 'var(--ink-3)',
      lineHeight: 1.6,
    }}>
      <div style={{ fontSize: 22, color: 'var(--ink-2)', marginBottom: 6 }}>📊</div>
      <div style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 500, marginBottom: 4 }}>
        Aún hay pocos asientos en este período
      </div>
      <div style={{ fontSize: 12.5, maxWidth: 460, margin: '0 auto' }}>
        La contabilidad de {etiquetaMes(periodo)} todavía no tiene partidas registradas
        en el libro diario. El motor calcula desde PARTIDAS reales — a medida que se
        aprueben facturas (F-050), cobros y planillas, las líneas del ER se irán llenando.
      </div>
    </div>
  );
}
