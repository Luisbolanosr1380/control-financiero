'use client';

/**
 * F-045 — Pantalla /notas-credito.
 *
 * Listado consolidado con KPIs (año actual), tabs por estado, filtros
 * (fecha/cliente/motivo), tabla con acciones (aprobar si admin, anular si
 * activa), export CSV. No incluye botón "+ Emitir NC" — la emisión es
 * siempre desde el detalle de la factura origen.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { formatearFecha } from '@/lib/utils/fechas';
import { HelpButton } from '@/components/ayuda/help-button';
import { aprobarNotaCreditoAction, anularNotaCreditoAction } from '@/app/(app)/facturacion/[id]/actions';
import type {
  NotaCredito,
  KPIsNotasCredito,
  EstadoNotaCredito,
  MotivoNC,
} from '@/lib/db/notas-credito';
import { MOTIVOS_NC } from '@/lib/db/notas-credito';

export type FiltroEstadoNC = 'todas' | 'activas' | 'pendientes' | 'anuladas';

interface Props {
  notas: NotaCredito[];
  kpis: KPIsNotasCredito;
  esAdmin: boolean;
  initialTab?: FiltroEstadoNC;
}

const ESTADO_BADGE: Record<EstadoNotaCredito, { cls: string; text: string }> = {
  'Borrador':             { cls: 'badge-mute',    text: 'Borrador' },
  'Pendiente Aprobación': { cls: 'badge-warn',    text: 'Pendiente' },
  'Aprobada':             { cls: 'badge-outline', text: 'Aprobada' },
  'Activa':               { cls: 'badge-olive',   text: 'Activa' },
  'Anulada':              { cls: 'badge-wine',    text: 'Anulada' },
};

function matchTab(n: NotaCredito, tab: FiltroEstadoNC): boolean {
  switch (tab) {
    case 'todas':       return true;
    case 'activas':     return n.estado === 'Activa';
    case 'pendientes':  return n.estado === 'Pendiente Aprobación';
    case 'anuladas':    return n.estado === 'Anulada';
  }
}

export function NotasCreditoClient({ notas, kpis, esAdmin, initialTab = 'todas' }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<FiltroEstadoNC>(initialTab);
  const [search, setSearch] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [motivoFiltro, setMotivoFiltro] = useState<MotivoNC | ''>('');
  const [clienteFiltro, setClienteFiltro] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [anulandoId, setAnulandoId] = useState<string | null>(null);
  const [motivoAnul, setMotivoAnul] = useState('');

  // Refresca tab si cambia el query param (vuelve desde un deep-link).
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const clientes = useMemo(
    () => [...new Set(notas.map(n => n.clienteNombre).filter(Boolean))].sort(),
    [notas],
  );

  const counts = useMemo(() => ({
    todas:      notas.length,
    activas:    notas.filter(n => n.estado === 'Activa').length,
    pendientes: notas.filter(n => n.estado === 'Pendiente Aprobación').length,
    anuladas:   notas.filter(n => n.estado === 'Anulada').length,
  }), [notas]);

  const filtradas = useMemo(() => {
    let r = notas.filter(n => matchTab(n, tab));
    if (desde)         r = r.filter(n => n.fechaEmision >= desde);
    if (hasta)         r = r.filter(n => n.fechaEmision <= hasta);
    if (motivoFiltro)  r = r.filter(n => n.motivo === motivoFiltro);
    if (clienteFiltro) r = r.filter(n => n.clienteNombre === clienteFiltro);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(n =>
        n.numeroNC.toLowerCase().includes(q) ||
        n.facturaNumero.toLowerCase().includes(q) ||
        n.clienteNombre.toLowerCase().includes(q) ||
        n.descripcion.toLowerCase().includes(q),
      );
    }
    return r;
  }, [notas, tab, desde, hasta, motivoFiltro, clienteFiltro, search]);

  const aprobar = async (nc: NotaCredito) => {
    setBusyId(nc.id);
    try {
      const res = await aprobarNotaCreditoAction(nc.id);
      if (res.ok) { toast.success(`NC ${nc.numeroNC} aprobada · saldo recalculado`); router.refresh(); }
      else toast.error(res.error ?? 'No se pudo aprobar.');
    } finally { setBusyId(null); }
  };

  const confirmarAnular = async (nc: NotaCredito) => {
    if (!motivoAnul.trim()) { toast.error('Ingresá un motivo.'); return; }
    setBusyId(nc.id);
    try {
      const res = await anularNotaCreditoAction(nc.id, motivoAnul.trim());
      if (res.ok) {
        toast.success(`NC ${nc.numeroNC} anulada`);
        setAnulandoId(null); setMotivoAnul('');
        router.refresh();
      } else toast.error(res.error ?? 'No se pudo anular.');
    } finally { setBusyId(null); }
  };

  const exportCSV = () => {
    const headers = ['Numero_NC', 'Fecha_Emision', 'Cliente', 'Factura', 'Motivo', 'Monto', 'Estado', 'Emitida_Por', 'Descripcion'];
    const rows = filtradas.map(n => [
      n.numeroNC,
      n.fechaEmision,
      `"${n.clienteNombre.replace(/"/g, '""')}"`,
      n.facturaNumero,
      n.motivo,
      n.monto.toFixed(2),
      n.estado,
      n.emitidaPor,
      `"${n.descripcion.replace(/"/g, '""').replace(/\n/g, ' ')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notas-credito-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Notas de Crédito
            <HelpButton tag="modulo-notas-credito" />
          </h1>
          <div className="page-subtitle">
            Año {kpis.anio} · <span className="num">{kpis.totalActivas}</span> activas por <span className="num">{Q(kpis.montoActivasAnio)}</span>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={exportCSV} disabled={filtradas.length === 0}>
            <I.Download size={13} /> Exportar CSV
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 22 }}>
        <Kpi label="📊 Activas año" value={String(kpis.totalActivas)} hint={Q(kpis.montoActivasAnio)} />
        <Kpi label="💰 Monto activas" value={Q(kpis.montoActivasAnio)} hint="reducen saldo cobrable" />
        <Kpi
          label="⏸ Pendientes aprobación"
          value={String(kpis.pendientesAprobacion)}
          hint={kpis.pendientesAprobacion > 0 ? `${Q(kpis.montoPendientesAprobacion)} en espera` : 'todas aprobadas'}
          alarma={kpis.pendientesAprobacion > 0 && esAdmin}
        />
        <Kpi label="✗ Anuladas año" value={String(kpis.anuladasAnio)} hint={Q(kpis.montoAnuladasAnio)} />
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 14 }}>
        {(['todas', 'activas', 'pendientes', 'anuladas'] as const).map(t => (
          <button key={t} className={'tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {t === 'todas' ? 'Todas' : t === 'activas' ? 'Activas' : t === 'pendientes' ? 'Pendientes' : 'Anuladas'}
            <span className="tab-count num">{counts[t]}</span>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="card" style={{ padding: 0, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={selectStyle} title="Desde" />
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={selectStyle} title="Hasta" />
          <select value={motivoFiltro} onChange={(e) => setMotivoFiltro((e.target.value || '') as MotivoNC | '')} style={selectStyle}>
            <option value="">Motivo (todos)</option>
            {MOTIVOS_NC.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={clienteFiltro} onChange={(e) => setClienteFiltro(e.target.value)} style={selectStyle}>
            <option value="">Cliente (todos)</option>
            {clientes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="toolbar-search" style={{ marginLeft: 'auto' }}>
            <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
            <input placeholder="NC, factura, cliente, descripción…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">{filtradas.length} NC{filtradas.length === 1 ? '' : 's'}</div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Número</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Factura origen</th>
              <th>Motivo</th>
              <th className="num">Monto</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 ? (
              <tr><td colSpan={8} style={{ height: 160, textAlign: 'center', color: 'var(--ink-4)' }}>
                <I.Receipt size={26} style={{ opacity: 0.4, marginBottom: 6 }} />
                <div style={{ fontSize: 13 }}>Sin notas de crédito bajo los filtros actuales</div>
              </td></tr>
            ) : filtradas.map(nc => {
              const badge = ESTADO_BADGE[nc.estado];
              const enAnulacion = anulandoId === nc.id;
              return (
                <tr key={nc.id} style={{ opacity: nc.estado === 'Anulada' ? 0.6 : 1 }}>
                  <td className="num cell-strong">{nc.numeroNC}</td>
                  <td className="cell-mute" style={{ whiteSpace: 'nowrap' }}>{formatearFecha(nc.fechaEmision)}</td>
                  <td className="cell-strong">{nc.clienteNombre || '—'}</td>
                  <td>
                    {nc.facturaId ? (
                      <Link href={`/facturacion/${nc.facturaId}`} className="num" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                        {nc.facturaNumero || '—'}
                      </Link>
                    ) : <span className="cell-mute">—</span>}
                  </td>
                  <td className="cell-mute" style={{ fontSize: 11 }}>{nc.motivo}</td>
                  <td className="num cell-strong" style={{ color: nc.estado === 'Anulada' ? 'var(--ink-4)' : 'var(--wine)' }}>
                    {Q(nc.monto)}
                  </td>
                  <td><span className={'badge ' + badge.cls} style={{ fontSize: 10 }}>{badge.text}</span></td>
                  <td>
                    {enAnulacion ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          type="text"
                          className="input"
                          placeholder="Motivo…"
                          value={motivoAnul}
                          onChange={(e) => setMotivoAnul(e.target.value)}
                          style={{ fontSize: 11, padding: '2px 6px', width: 140 }}
                          autoFocus
                        />
                        <button className="btn btn-danger" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => confirmarAnular(nc)} disabled={busyId === nc.id || !motivoAnul.trim()}>OK</button>
                        <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => { setAnulandoId(null); setMotivoAnul(''); }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        {esAdmin && nc.estado === 'Pendiente Aprobación' && (
                          <button className="btn btn-primary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => aprobar(nc)} disabled={busyId === nc.id}>
                            Aprobar
                          </button>
                        )}
                        {(nc.estado === 'Activa' || nc.estado === 'Aprobada') && (
                          <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 8px', color: 'var(--wine)' }} onClick={() => { setAnulandoId(nc.id); setMotivoAnul(''); }}>
                            Anular
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, alarma }: { label: string; value: string; hint?: string; alarma?: boolean }) {
  return (
    <div className="kpi" style={alarma ? { borderColor: 'var(--warn)' } : undefined}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-delta"><span className="vs">{hint}</span></div>}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 8px', borderRadius: 4,
  border: '1px solid var(--line-2)', background: 'var(--paper-2)',
  color: 'var(--ink)', fontFamily: 'inherit',
};
