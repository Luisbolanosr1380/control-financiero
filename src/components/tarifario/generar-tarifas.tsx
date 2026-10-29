'use client';

/**
 * TARIFARIO · "Generar tarifas" para un cliente: pide el plan al servidor (plantilla
 * polígrafo + socio, más los servicios que la empresa pide en la Agenda, según la
 * FORMA de cada uno: matriz / por territorio / por categoría / único), lo muestra para confirmar y
 * crea las filas en Q0. Confirmación en línea, sin diálogos del navegador.
 * Se usa en el detalle del tarifario, en el hub (con NIT a mano) y en "Por facturar".
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { generarTarifasClienteAction, planGenerarTarifasAction } from '@/app/(app)/tarifario/actions';
import { ETIQUETA_FORMA, dimTexto } from '@/lib/tarifario/canon';
import { nitComparable } from '@/lib/clientes/nit';
import type { PlanGenerarCliente } from '@/lib/db/tarifario';

interface Props {
  nit?: string; razonSocial?: string;
  /** Texto del botón. */
  etiqueta?: string;
  /** 'boton' = botón que abre la tarjeta de confirmación; 'tarjeta' = ya desplegado (hub: pide el NIT). */
  modo?: 'boton' | 'tarjeta';
  /** Tras crear, ir al detalle del tarifario del NIT. */
  irAlDetalle?: boolean;
  compacto?: boolean;
}

export function GenerarTarifas({ nit: nitInicial = '', razonSocial: razonInicial = '', etiqueta = 'Generar tarifas faltantes', modo = 'boton', irAlDetalle = false, compacto = false }: Props) {
  const router = useRouter();
  const puede = usePuede();
  const [abierto, setAbierto] = useState(modo === 'tarjeta');
  const [nit, setNit] = useState(nitInicial);
  const [razon, setRazon] = useState(razonInicial);
  const [plan, setPlan] = useState<PlanGenerarCliente | null>(null);
  const [busy, setBusy] = useState(false);
  if (!puede('catalogos')) return null;

  const pedirPlan = async () => {
    const k = nitComparable(nit); if (!k) { toast.error('Ingresá el NIT del cliente.'); return; }
    setBusy(true);
    try {
      const p = await planGenerarTarifasAction(k);
      if ('error' in p) { toast.error(p.error); return; }
      setPlan(p); if (!razon && p.razonSocial) setRazon(p.razonSocial);
    } finally { setBusy(false); }
  };
  const confirmar = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await generarTarifasClienteAction({ nit: plan.nit, razonSocial: razon || undefined });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`${r.creadas} tarifa${r.creadas === 1 ? '' : 's'} creada${r.creadas === 1 ? '' : 's'} en Q0${r.omitidas ? ` · ${r.omitidas} ya existían` : ''}: ${r.resumen}`);
      setPlan(null); if (modo === 'boton') setAbierto(false);
      if (irAlDetalle) router.push(`/tarifario/${encodeURIComponent(r.nit)}`); else router.refresh();
    } finally { setBusy(false); }
  };

  if (!abierto) return <button className={'btn ' + (compacto ? 'btn-ghost' : 'btn-secondary')} style={compacto ? { fontSize: 12 } : undefined} onClick={() => { setAbierto(true); void pedirPlan(); }} data-accion="generar-tarifas"><I.Plus size={13} /> {etiqueta}</button>;

  return (
    <div className="card" role="region" aria-label="Generar tarifas" data-generar-tarifas style={{ borderColor: 'var(--olive)', marginBottom: 14 }}>
      <div className="card-head"><div className="card-title">Generar tarifas en Q0 para un cliente</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>plantilla polígrafo + socio, más lo que la empresa pide en la Agenda, según la forma de precio de cada servicio</span></div></div>
      <div className="card-pad" style={{ fontSize: 13, display: 'grid', gap: 10 }}>
        {(modo === 'tarjeta' || !nitInicial) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input num" placeholder="NIT del cliente" value={nit} onChange={e => { setNit(e.target.value); setPlan(null); }} aria-label="NIT para generar tarifas" style={{ width: 160 }} disabled={busy} />
            <input className="input" placeholder="Razón social (opcional)" value={razon} onChange={e => setRazon(e.target.value)} aria-label="Razón social para generar tarifas" style={{ minWidth: 260 }} disabled={busy} />
            <button className="btn btn-secondary" onClick={() => void pedirPlan()} disabled={busy || !nitComparable(nit)}>{busy && !plan ? 'Calculando…' : 'Ver qué se crearía'}</button>
          </div>
        )}
        {plan && (
          <>
            <div data-plan-resumen>
              Se crearían <strong>{plan.filas.length}</strong> tarifa{plan.filas.length === 1 ? '' : 's'} en Q0 para <strong>{razon || plan.razonSocial || `NIT ${plan.nit}`}</strong>{plan.omitidas.length ? <span className="cell-mute"> · {plan.omitidas.length} ya existen</span> : null}.
              {plan.tiposAgenda.length > 0 && <div className="cell-mute" style={{ fontSize: 12, marginTop: 2 }}>Servicios que pide en la Agenda: {plan.tiposAgenda.join(', ')}.</div>}
            </div>
            {plan.filas.length > 0 && (
              <table className="table" style={{ fontSize: 12 }}>
                <thead><tr><th>Servicio</th><th>Forma de precio</th><th className="num">Filas</th><th>Detalle</th></tr></thead>
                <tbody>
                  {Object.entries(plan.porTipo).map(([tipo, n]) => { const fs = plan.filas.filter(f => f.tipoPrueba === tipo); const forma = fs[0]?.forma ?? 'matriz'; return (
                    <tr key={tipo}><td className="cell-strong">{tipo}</td><td>{ETIQUETA_FORMA[forma]}</td><td className="num">{n}</td><td className="cell-mute">{fs.map(f => [dimTexto(f.categoria), dimTexto(f.territorio)].filter(x => x !== '—').join(' · ') || 'precio único').join(' / ')}{fs.some(f => f.origen === 'agenda') ? ' · (pedido en la Agenda)' : ''}</td></tr>
                  ); })}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              {plan.filas.length === 0 && plan.existentes > 0 && <Link href={`/tarifario/${encodeURIComponent(plan.nit)}`} style={{ fontSize: 12.5, marginRight: 'auto' }}>Ver el tarifario del cliente →</Link>}
              <button className="btn btn-ghost" onClick={() => { setPlan(null); if (modo === 'boton') setAbierto(false); }} disabled={busy}>Cancelar</button>
              <button className="btn btn-primary" onClick={() => void confirmar()} disabled={busy || plan.filas.length === 0} data-accion="confirmar-generar">{busy ? <><I.Refresh size={13} /> Creando…</> : <><I.Check size={13} /> Crear {plan.filas.length} en Q0</>}</button>
            </div>
          </>
        )}
        {!plan && busy && <div className="cell-mute">Calculando el plan…</div>}
      </div>
    </div>
  );
}
