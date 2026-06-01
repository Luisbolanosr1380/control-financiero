'use client';

import { I } from '@/components/common/icons';
import type { Role } from '@/lib/auth/allowlist';
import type { TotalesMes } from '@/lib/db/uso-auros';

interface UsuarioRow {
  email: string;
  rol: Role;
  consultas: number;
  analisisManual: number;
  costoTotalUsd: number;
  ultimoUso: string | null;
  tokensInput: number;
  tokensOutput: number;
  limite: number;
}

interface Props {
  usuarios: UsuarioRow[];
  totales: TotalesMes;
  miEmail: string;
}

const ROL_BADGE: Record<Role, { cls: string; label: string }> = {
  admin:     { cls: 'badge-wine',    label: 'Admin' },
  gerencia:  { cls: 'badge-warn',    label: 'Gerencia' },
  operativo: { cls: 'badge-outline', label: 'Operativo' },
};

const fmtUSD = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
};

export function AdminUsuariosClient({ usuarios, totales, miEmail }: Props) {
  const topPorConsultas = [...usuarios].filter(u => u.consultas > 0).sort((a, b) => b.consultas - a.consultas).slice(0, 5);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Usuarios y uso de AI</h1>
          <div className="page-subtitle">
            Gestión de roles y monitoreo del consumo de Auros + análisis. Mes actual.
          </div>
        </div>
      </div>

      {/* KPIs del mes */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 22 }}>
        <div className="kpi">
          <div className="kpi-label">Costo total del mes</div>
          <div className="kpi-value">{fmtUSD(totales.costoTotalUsd)}</div>
          <div className="kpi-delta">
            <span className="vs">{totales.diasTranscurridos} de {totales.diasMes} días</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Costo proyectado al cierre</div>
          <div className="kpi-value">{fmtUSD(totales.costoProyectadoUsd)}</div>
          <div className="kpi-delta"><span className="vs">Extrapolación lineal por días</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Consultas de chat</div>
          <div className="kpi-value">{totales.consultasChat}</div>
          <div className="kpi-delta"><span className="vs">Auros (chat) — pagas por uso</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Análisis generados</div>
          <div className="kpi-value">{totales.analisisManual + totales.analisisSemanal}</div>
          <div className="kpi-delta">
            <span className="vs">{totales.analisisManual} manual · {totales.analisisSemanal} cron</span>
          </div>
        </div>
      </div>

      {/* Top usuarios por consultas */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Top usuarios por consultas (chat)</div>
        </div>
        {topPorConsultas.length === 0 ? (
          <div className="card-pad" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-4)' }}>
            <I.Users size={26} style={{ opacity: 0.4, marginBottom: 6 }} />
            <div style={{ fontSize: 13 }}>Sin actividad de chat este mes</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th style={{ width: 110 }}>Rol</th>
                <th className="num" style={{ width: 130 }}>Consultas</th>
                <th className="num" style={{ width: 110 }}>Costo</th>
              </tr>
            </thead>
            <tbody>
              {topPorConsultas.map(u => (
                <tr key={u.email}>
                  <td className="cell-strong">{u.email}{u.email === miEmail && <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--ink-4)' }}>(vos)</span>}</td>
                  <td><span className={'badge ' + ROL_BADGE[u.rol].cls}>{ROL_BADGE[u.rol].label}</span></td>
                  <td className="num cell-strong">{u.consultas}{Number.isFinite(u.limite) && u.limite > 0 ? ` / ${u.limite}` : ''}</td>
                  <td className="num">{fmtUSD(u.costoTotalUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Usuarios autorizados (registro completo) */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Usuarios autorizados</div>
          <div className="card-actions" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            {usuarios.length} usuario{usuarios.length === 1 ? '' : 's'}
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th style={{ width: 110 }}>Rol</th>
              <th className="num" style={{ width: 130 }}>Consultas</th>
              <th className="num" style={{ width: 90 }}>Análisis</th>
              <th className="num" style={{ width: 100 }}>Costo</th>
              <th style={{ width: 150 }}>Último uso</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map(u => {
              const limiteTxt = !Number.isFinite(u.limite)
                ? '∞'
                : u.limite === 0
                  ? 'sin chat'
                  : `${u.consultas} / ${u.limite}`;
              const alarmaLimite = Number.isFinite(u.limite) && u.limite > 0 && u.consultas >= u.limite;
              return (
                <tr key={u.email}>
                  <td className="cell-strong">
                    {u.email}
                    {u.email === miEmail && <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--ink-4)' }}>(vos)</span>}
                  </td>
                  <td><span className={'badge ' + ROL_BADGE[u.rol].cls}>{ROL_BADGE[u.rol].label}</span></td>
                  <td className="num" style={{ color: alarmaLimite ? 'var(--wine)' : 'var(--ink)', fontWeight: alarmaLimite ? 600 : 400 }}>
                    {limiteTxt}
                  </td>
                  <td className="num cell-mute">{u.analisisManual || '—'}</td>
                  <td className="num cell-mute">{u.costoTotalUsd > 0 ? fmtUSD(u.costoTotalUsd) : '—'}</td>
                  <td className="cell-mute" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmtDateTime(u.ultimoUso)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Nota administrativa */}
      <div className="card" style={{ background: 'var(--paper-2)' }}>
        <div className="card-pad" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          <I.Info size={14} style={{ color: 'var(--ink-3)', flexShrink: 0, marginTop: 2 }} />
          <div>
            Para <strong>agregar o quitar usuarios</strong> o <strong>cambiar roles</strong>, editar
            {' '}<code style={{ fontSize: 11.5, background: 'var(--paper)', padding: '1px 5px', borderRadius: 3 }}>src/lib/auth/allowlist.ts</code>
            {' '}(map <code>ROLES_USUARIOS</code>) y desplegar. Los usuarios que entran por dominio sin estar en el map quedan como <strong>operativo</strong> automáticamente.
          </div>
        </div>
      </div>
    </div>
  );
}
