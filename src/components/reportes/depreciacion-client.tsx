'use client';

/**
 * F-057b — UI de depreciación mensual.
 *
 * Tres bloques:
 *  1. KPIs del mes (cuota total contable, cuota fiscal, # activos
 *     depreciándose, # totalmente depreciados).
 *  2. Tabla por activo: cuota, deprec acumulada antes/después, valor
 *     en libros, estado, advertencias.
 *  3. Preview del ASIENTO que se generaría (Dr cuenta de gasto por
 *     cuenta+CC / Cr cuenta de acumulada). Banner ámbar persistente
 *     mientras el flag GENERAR_ASIENTO_DEPRECIACION esté off.
 *
 * No escribe a Airtable. Lo único accionable hoy es el preview;
 * cuando el contador valide tasas + estructura, se prende el flag
 * y se enchufa el generador.
 */

import { Q } from '@/lib/utils';
import { etiquetaMes } from '@/lib/utils/mes-activo';
import { GENERAR_ASIENTO_DEPRECIACION, ORIGEN_ASIENTO_DEPRECIACION } from '@/lib/contabilidad/depreciacion-config';
import type { DepreciacionMes, CuotaActivo, PartidaProyectada } from '@/lib/contabilidad/depreciacion';

interface Props {
  dep: DepreciacionMes;
  periodo: string;
}

export function DepreciacionClient({ dep, periodo }: Props) {
  const vacio = dep.activos.length === 0;

  return (
    <div className="page">
      <header className="page-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title">Depreciación <em>mensual</em></h1>
          <p className="page-subtitle">
            {etiquetaMes(periodo)} · {dep.activos.length} activos en catálogo · fecha del asiento:{' '}
            {new Date(dep.fechaAsiento + 'T00:00:00').toLocaleDateString('es-GT')}
          </p>
        </div>
        <FlagBadge />
      </header>

      {/* Banner persistente del flag */}
      {!GENERAR_ASIENTO_DEPRECIACION && (
        <div
          role="status"
          style={{
            border: '1px solid var(--amber)',
            background: 'var(--amber-bg)',
            borderRadius: 'var(--r-2, 5px)',
            padding: '10px 12px',
            fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5,
            marginBottom: 12,
          }}
        >
          <strong>Generación deshabilitada — pendiente validación contable.</strong>{' '}
          El motor calcula y muestra el preview; nadie escribe a libros mientras{' '}
          <code>GENERAR_ASIENTO_DEPRECIACION = false</code>. El contador debe
          validar las tasas fiscales y el tratamiento del asiento antes de
          activarlo.
        </div>
      )}

      {/* Banner si ya se generó el mes (idempotencia) */}
      {dep.yaGeneradoEnPeriodo && (
        <div className="card card-pad" style={{
          background: 'var(--wine-bg)', borderColor: 'var(--wine)',
          marginBottom: 12, fontSize: 12.5, color: 'var(--ink-2)',
        }}>
          <strong>Ya existe un asiento con ORIGEN=&apos;{ORIGEN_ASIENTO_DEPRECIACION}&apos; en {periodo}.</strong>{' '}
          La idempotencia impide duplicarlo. Si necesitás re-correr el cálculo,
          anulá el asiento existente primero.
        </div>
      )}

      {/* Advertencias globales */}
      {dep.advertencias.filter(a => !a.startsWith('Ya existe')).map((a, i) => (
        <div key={i} className="card card-pad" style={{
          background: 'var(--paper-2)', borderColor: 'var(--line-2)',
          marginBottom: 8, fontSize: 12.5, color: 'var(--ink-3)',
        }}>
          {a}
        </div>
      ))}

      {vacio ? <EmptyState /> : (
        <>
          {/* KPIs */}
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 18 }}>
            <Kpi label="Cuota contable del mes" valor={dep.cuotaTotalQ} />
            <Kpi label="Cuota fiscal del mes" valor={dep.cuotaFiscalTotalQ} hintFiscal />
            <Kpi label="Activos depreciándose" entero={dep.activosDepreciando} />
            <Kpi label="Totalmente depreciados" entero={dep.activosTotalmenteDepreciados} />
          </div>

          {/* Tabla de activos */}
          <div className="card" style={{ padding: 0, marginBottom: 18 }}>
            <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="card-title">Activos del catálogo</div>
              <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 'auto' }}>
                Línea recta · cuota = (costo − residual) / vida útil
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--paper-tint)' }}>
                  <Th align="left">Activo</Th>
                  <Th align="left">Categoría</Th>
                  <Th align="right">Costo</Th>
                  <Th align="right">Vida (m)</Th>
                  <Th align="right">Cuota mes</Th>
                  <Th align="right">Acum. antes</Th>
                  <Th align="right">Acum. después</Th>
                  <Th align="right">Valor en libros</Th>
                  <Th align="left">Estado</Th>
                </tr>
              </thead>
              <tbody>
                {dep.activos.map(a => <FilaActivo key={a.activoId} a={a} />)}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--ink)', background: 'var(--paper-tint)', fontWeight: 600 }}>
                  <td style={{ padding: '8px 12px' }} colSpan={4}>Total cuota del mes</td>
                  <Money n={dep.cuotaTotalQ} />
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Preview del asiento */}
          <PreviewAsiento partidas={dep.partidasProyectadas} balanceado={dep.balanceado} />
        </>
      )}
    </div>
  );
}

/* =========================================================================
 * Subcomponentes
 * ========================================================================= */

function FlagBadge() {
  const on = GENERAR_ASIENTO_DEPRECIACION;
  return (
    <div
      title={on
        ? 'Generación de asiento HABILITADA (validado por contador).'
        : 'Generación de asiento deshabilitada — pendiente de validación contable.'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px',
        borderRadius: 6,
        fontSize: 12.5, fontWeight: 500,
        background: on ? 'var(--olive-bg)' : 'var(--amber-bg)',
        color:      on ? 'var(--olive)'    : 'var(--amber)',
      }}
    >
      {on ? '✓ Generación habilitada' : '⚠ Generación deshabilitada'}
    </div>
  );
}

function FilaActivo({ a }: { a: CuotaActivo }) {
  const conAdvertencia = a.advertencias.length > 0;
  return (
    <tr style={{ borderBottom: '1px solid var(--line-3)' }}>
      <td style={{ padding: '7px 12px' }}>
        <span style={{ fontWeight: 500 }}>{a.nombre}</span>
        {conAdvertencia && (
          <span title={a.advertencias.join(' · ')} style={{ marginLeft: 6, color: 'var(--amber)', fontSize: 11 }}>⚠</span>
        )}
      </td>
      <td style={{ padding: '7px 12px', color: 'var(--ink-3)' }}>{a.categoria || '—'}</td>
      <Money n={a.costo} muted />
      <td style={{ padding: '7px 12px', textAlign: 'right', color: 'var(--ink-3)' }} className="num">
        {a.vidaUtilMeses || '—'}
      </td>
      <Money n={a.cuotaMes} highlight={a.cuotaMes > 0} />
      <Money n={a.depreciacionAcumuladaAntes} muted />
      <Money n={a.depreciacionAcumuladaDespues} />
      <Money n={a.valorEnLibrosDespues} />
      <td style={{ padding: '7px 12px' }}>
        <EstadoChip estado={a.estado} llegaAlTope={a.llegaAlTope} />
      </td>
    </tr>
  );
}

function EstadoChip({ estado, llegaAlTope }: { estado: string; llegaAlTope: boolean }) {
  const label = llegaAlTope ? 'Llega al tope' : (estado || 'Activo');
  const colores =
    llegaAlTope            ? { bg: 'var(--amber-bg)', fg: 'var(--amber)' } :
    /total/i.test(estado)  ? { bg: 'var(--paper-tint)', fg: 'var(--ink-3)' } :
    /baja|vendido/i.test(estado) ? { bg: 'var(--wine-bg)', fg: 'var(--wine)' } :
                                   { bg: 'var(--olive-bg)', fg: 'var(--olive)' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 500,
      background: colores.bg,
      color:      colores.fg,
    }}>
      {label}
    </span>
  );
}

function PreviewAsiento({ partidas, balanceado }: { partidas: PartidaProyectada[]; balanceado: boolean }) {
  if (partidas.length === 0) {
    return (
      <div className="card card-pad" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
        No hay partidas para proyectar este mes (sin activos depreciables o sin cuentas configuradas).
      </div>
    );
  }
  const totalDr = partidas.filter(p => p.tipo === 'Dr').reduce((s, p) => s + p.montoQ, 0);
  const totalCr = partidas.filter(p => p.tipo === 'Cr').reduce((s, p) => s + p.montoQ, 0);
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="card-title">Asiento que se generaría</div>
        <span style={{
          marginLeft: 'auto', fontSize: 11.5, fontWeight: 500,
          color: balanceado ? 'var(--olive)' : 'var(--wine)',
        }}>
          {balanceado ? '✓ Balanceado (Dr = Cr)' : '⚠ NO balanceado'}
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
          {partidas.map((p, i) => {
            const esDr = p.tipo === 'Dr';
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--line-3)' }}>
                <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                  <span style={{
                    display: 'inline-block', width: 24,
                    padding: '1px 4px', borderRadius: 3,
                    fontSize: 10.5, fontWeight: 600,
                    background: esDr ? 'var(--indigo-bg)' : 'var(--olive-bg)',
                    color:      esDr ? 'var(--indigo)'    : 'var(--olive)',
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
                <Money n={p.montoQ} />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--ink)', background: 'var(--paper-tint)', fontWeight: 600 }}>
            <td style={{ padding: '8px 12px', textAlign: 'center' }}>Σ</td>
            <td style={{ padding: '8px 12px' }} colSpan={2}>
              Total Dr / Cr
            </td>
            <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className="num">
              {Q(totalDr)} / {Q(totalCr)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Kpi({ label, valor, entero, hintFiscal }: {
  label: string; valor?: number; entero?: number; hintFiscal?: boolean;
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: 'var(--ink)' }}>
        {entero != null ? entero : (valor != null ? Q(valor) : '—')}
      </div>
      {hintFiscal && valor === 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 4 }}>
          Tasas pendientes del contador
        </div>
      )}
    </div>
  );
}

function Money({ n, muted, highlight }: { n: number; muted?: boolean; highlight?: boolean }) {
  return (
    <td style={{
      padding: '7px 12px',
      textAlign: 'right',
      color: highlight ? 'var(--ink)' : (muted ? 'var(--ink-3)' : 'var(--ink-2)'),
      fontWeight: highlight ? 600 : 400,
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    }} className="num">
      {n === 0 ? '—' : Q(n)}
    </td>
  );
}

function Th({ align, children }: { align: 'left' | 'right' | 'center'; children: React.ReactNode }) {
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

function EmptyState() {
  return (
    <div className="card card-pad" style={{
      textAlign: 'center', padding: 40, color: 'var(--ink-3)', lineHeight: 1.6,
    }}>
      <div style={{ fontSize: 22, color: 'var(--ink-2)', marginBottom: 6 }}>🗂️</div>
      <div style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 500, marginBottom: 4 }}>
        No hay activos en el catálogo
      </div>
      <div style={{ fontSize: 12.5, maxWidth: 460, margin: '0 auto' }}>
        ACTIVOS_FIJOS en Airtable está vacío. Cargá los activos depreciables
        (con COSTO, VIDA_UTIL_MESES, Cuenta_Activo y Cuenta_Depreciacion) y
        este reporte se llenará automáticamente.
      </div>
    </div>
  );
}
