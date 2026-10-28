'use client';

/**
 * TARIFARIO · hub: KPIs globales, el simulador de precio y dos modos —
 * "Por empresa" (maestro: una fila por NIT con semáforo → detalle) y
 * "Ver todas" (el listado plano con sus filtros, para comparar un mismo
 * tipo de prueba entre clientes).
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { resolverTarifaAction } from '@/app/(app)/tarifario/actions';
import { CATEGORIAS, TERRITORIOS, TIPOS_PRUEBA, canonTipoPrueba, esSinTarifa } from '@/lib/tarifario/canon';
import { tarifasDuplicadas, type ResultadoLookup, type Tarifa } from '@/lib/tarifario/lookup';
import type { EmpresaTarifario } from '@/lib/tarifario/resumen';
import { EmpresasLista } from './empresas-lista';
import { TarifasTabla } from './tarifas-tabla';

interface Props { disponible: boolean; tarifas: Tarifa[]; empresas: EmpresaTarifario[] }
type Modo = 'empresas' | 'todas';

export function TarifarioClient({ disponible, tarifas, empresas }: Props) {
  const [modo, setModo] = useState<Modo>('empresas');
  const activas = tarifas.filter(t => t.activo);
  const kpis = {
    empresas: empresas.length,
    tarifas: activas.length,
    sinTarifa: activas.filter(t => esSinTarifa(t.monto)).length,
    pendientes: activas.filter(t => !t.aprobadoEn && !esSinTarifa(t.monto)).length,
    duplicadas: tarifasDuplicadas(tarifas).size,
    conAccion: empresas.filter(e => e.semaforo !== 'verde').length,
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tarifario</h1>
          <div className="page-subtitle">Precio pactado con cada cliente (NIT) por tipo de prueba, categoría y territorio. Montos <strong>sin IVA</strong>; Q0 = sin tarifa definida.</div>
        </div>
        <div className="page-actions" role="tablist" aria-label="Modo">
          <button role="tab" aria-selected={modo === 'empresas'} className={'btn ' + (modo === 'empresas' ? 'btn-secondary' : 'btn-ghost')} onClick={() => setModo('empresas')}>Por empresa</button>
          <button role="tab" aria-selected={modo === 'todas'} className={'btn ' + (modo === 'todas' ? 'btn-secondary' : 'btn-ghost')} onClick={() => setModo('todas')}>Ver todas</button>
        </div>
      </div>

      {!disponible && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }}>
          <div className="card-pad" style={{ fontSize: 13 }}>Falta aplicar la migración <strong>014_tarifario</strong> en esta base.</div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 14 }}>
        <div className="kpi"><div className="kpi-label">Empresas</div><div className="kpi-value">{kpis.empresas}</div><div className="kpi-delta"><span className="vs">{kpis.conAccion} requieren acción</span></div></div>
        <div className="kpi"><div className="kpi-label">Tarifas activas</div><div className="kpi-value">{kpis.tarifas}</div><div className="kpi-delta"><span className="vs">{kpis.tarifas - kpis.pendientes - kpis.sinTarifa} aprobadas</span></div></div>
        <div className="kpi"><div className="kpi-label">Pendientes de aprobación</div><div className="kpi-value" style={{ color: kpis.pendientes ? 'var(--burnt, #b5651d)' : undefined }}>{kpis.pendientes}</div><div className="kpi-delta"><span className="vs">con monto, sin aprobar</span></div></div>
        <div className="kpi"><div className="kpi-label">Sin tarifa (Q0)</div><div className="kpi-value" style={{ color: kpis.sinTarifa ? 'var(--wine)' : undefined }}>{kpis.sinTarifa}</div><div className="kpi-delta"><span className="vs">no es gratis: falta pactar</span></div></div>
        <div className="kpi"><div className="kpi-label">Combinaciones repetidas</div><div className="kpi-value" style={{ color: kpis.duplicadas ? 'var(--wine)' : undefined }}>{kpis.duplicadas}</div><div className="kpi-delta"><span className="vs">misma llave, distinta grafía</span></div></div>
      </div>

      <Simulador />

      {modo === 'empresas'
        ? <EmpresasLista empresas={empresas} />
        : <TarifasTabla disponible={disponible} tarifas={tarifas} />}
    </div>
  );
}

/** Corre el motor con los mismos datos que trae un expediente de la Agenda. */
function Simulador() {
  const [empresa, setEmpresa] = useState('');
  const [nit, setNit] = useState('');
  const [tipo, setTipo] = useState('POLIGRAFO');
  const [categoria, setCategoria] = useState('PRE EMPLEO');
  const [territorio, setTerritorio] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ResultadoLookup | null>(null);
  const correr = async () => {
    setBusy(true);
    try { setRes(await resolverTarifaAction({ nit: nit || undefined, empresa: empresa || undefined, tipoPrueba: tipo, categoria, territorio: territorio || undefined })); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };
  const color = res?.estado === 'ok' ? 'var(--olive)' : res?.estado === 'sin_tarifa' || res?.estado === 'ambigua' ? 'var(--burnt, #b5651d)' : 'var(--wine)';
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-head"><div className="card-title">Probar un precio (como lo resolvería un expediente de la Agenda)</div></div>
      <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
        <input className="input" placeholder="Empresa (como en la Agenda)" value={empresa} onChange={e => setEmpresa(e.target.value)} style={{ minWidth: 200 }} aria-label="Empresa" />
        <input className="input num" placeholder="o NIT" value={nit} onChange={e => setNit(e.target.value)} style={{ width: 120 }} aria-label="NIT" />
        <select className="input" value={tipo} onChange={e => setTipo(e.target.value)} aria-label="Tipo de prueba">{TIPOS_PRUEBA.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <select className="input" value={categoria} onChange={e => setCategoria(e.target.value)} aria-label="Categoría">{CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <select className="input" value={territorio} onChange={e => setTerritorio(e.target.value)} aria-label="Territorio"><option value="">Territorio (no indicado)</option>{TERRITORIOS.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <button className="btn btn-secondary" onClick={() => void correr()} disabled={busy || (!empresa.trim() && !nit.trim())}>{busy ? 'Buscando…' : 'Resolver precio'}</button>
      </div>
      {res && (
        <div role="status" className="card-pad" style={{ borderTop: '1px solid var(--line-2)', fontSize: 13, color }}>
          {res.estado === 'ok' && <>
            <strong>Q{res.monto.toFixed(2)} sin IVA</strong> · IVA Q{res.iva.toFixed(2)} · total <strong>Q{res.total.toFixed(2)}</strong> · NIT {res.nit} · {res.tarifa.razonSocial}
            {res.componentes && <span className="cell-mute"> ({res.componentes.map(c => `${canonTipoPrueba(c.tipoPrueba)} Q${c.monto.toFixed(2)}`).join(' + ')})</span>}
            {!res.aprobada && <span className="badge badge-warn" style={{ fontSize: 10, marginLeft: 8 }}>Tarifa no aprobada</span>}
            {res.avisos.filter(a => !/no está aprobada/.test(a)).map(a => <div key={a} style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>· {a}</div>)}
          </>}
          {res.estado === 'sin_tarifa' && <><strong>Sin tarifa definida.</strong> {res.mensaje}</>}
          {res.estado === 'ambigua' && <><strong>Ambigua.</strong> {res.mensaje}</>}
          {res.estado === 'no_encontrada' && <><strong>No encontrada.</strong> {res.mensaje}</>}
          {res.estado === 'cliente_no_identificado' && <><strong>Cliente no identificado.</strong> {res.mensaje}</>}
        </div>
      )}
    </div>
  );
}
