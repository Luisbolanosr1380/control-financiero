'use client';

/**
 * CENTRO DE COBROS · PR 2 (035) · plantillas de los correos (asunto y cuerpo con variables), «Datos para pagar» y reglas
 * (cuándo se propone cada recordatorio: días, repetición, activa). Quien ve el Centro de Cobros las lee; guardan admin y
 * contador (configurar_cobranza; la acción vuelve a validar). Sin diálogos del navegador.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { HelpButton } from '@/components/ayuda/help-button';
import { editarPlantillaCobranzaAction, editarReglaCobranzaAction } from '@/app/(app)/cobranza/actions';
import { ETIQUETA_REGLA, EXPLICACION_DIAS, ORDEN_REGLA, PLANTILLAS_CLAVES, VARIABLES_PLANTILLA, type Plantilla, type PlantillaClave, type ReglaRecordatorio } from '@/lib/cobranza/recordatorios';

export function PlantillasClient({ plantillas, reglas, disponible }: { plantillas: Record<PlantillaClave, Plantilla> | null; reglas: ReglaRecordatorio[]; disponible: boolean }) {
  const router = useRouter();
  const puedeEditar = usePuede()('configurar_cobranza');
  const [r, setR] = useState<Record<string, { activo: boolean; dias: string; cadaDias: string }>>(Object.fromEntries(reglas.map(x => [x.clave, { activo: x.activo, dias: String(x.dias), cadaDias: x.cadaDias == null ? '' : String(x.cadaDias) }])));
  const [p, setP] = useState<Record<string, { nombre: string; asunto: string; cuerpo: string }>>(Object.fromEntries(PLANTILLAS_CLAVES.map(k => [k, { nombre: plantillas?.[k]?.nombre ?? '', asunto: plantillas?.[k]?.asunto ?? '', cuerpo: plantillas?.[k]?.cuerpo ?? '' }])));
  const [busy, setBusy] = useState<string | null>(null);

  const guardarRegla = async (clave: string) => {
    setBusy(clave);
    try { const x = r[clave]; const res = await editarReglaCobranzaAction(clave, { activo: x.activo, dias: Number(x.dias), cadaDias: x.cadaDias === '' ? null : Number(x.cadaDias) }); if (res.ok) { toast.success(`Regla «${res.regla.nombre}» guardada`); router.refresh(); } else toast.error(res.error); } finally { setBusy(null); }
  };
  const guardarPlantilla = async (clave: string) => {
    setBusy(clave);
    try { const x = p[clave]; const res = await editarPlantillaCobranzaAction(clave, { nombre: x.nombre, asunto: x.asunto, cuerpo: x.cuerpo }); if (res.ok) { toast.success(`Plantilla «${res.plantilla.nombre}» guardada`); router.refresh(); } else toast.error(res.error); } finally { setBusy(null); }
  };
  const ro = !puedeEditar || !disponible || busy !== null;

  return (
    <div className="page" data-plantillas={PLANTILLAS_CLAVES.length} data-puede-editar={puedeEditar}>
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}><Link href="/cobranza/recordatorios" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Recordatorios propuestos</Link></div>
          <h1 className="page-title">Plantillas y reglas de cobranza <HelpButton tag="plantillas" /></h1>
          <div className="page-subtitle">{puedeEditar ? 'Lo que guardés acá cambia los próximos borradores (los ya enviados no).' : 'Solo lectura: las editan admin y contador.'}</div>
        </div>
      </div>
      {!disponible && <div className="card" style={{ marginBottom: 12 }}><div className="card-pad" style={{ color: 'var(--wine)', fontSize: 13 }} role="alert">Falta aplicar la migración 035 en esta base: se muestran los valores por defecto y no se puede guardar.</div></div>}

      <div className="card" style={{ marginBottom: 14 }} data-reglas={reglas.length}>
        <div className="card-head"><div className="card-title">Cuándo se propone cada recordatorio</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>los días se cuentan desde el vencimiento (emisión + crédito) o desde la fecha prometida</span></div></div>
        <div className="card-pad" style={{ display: 'grid', gap: 10, fontSize: 13 }}>
          {ORDEN_REGLA.map(clave => { const reg = reglas.find(x => x.clave === clave); const x = r[clave]; if (!reg || !x) return null; const dias = Number(x.dias), cada = x.cadaDias === '' ? null : Number(x.cadaDias); return (
            <div key={clave} style={{ display: 'grid', gap: 6, gridTemplateColumns: 'minmax(0, 1fr)', borderBottom: '1px solid var(--line-3)', paddingBottom: 10 }} data-regla={clave}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={x.activo} onChange={e => setR({ ...r, [clave]: { ...x, activo: e.target.checked } })} disabled={ro} data-campo="activo" /> <strong>{ETIQUETA_REGLA[clave]}</strong></label>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Días <input className="input num" type="number" min={0} max={365} value={x.dias} onChange={e => setR({ ...r, [clave]: { ...x, dias: e.target.value } })} disabled={ro} style={{ width: 80 }} aria-label="Días" data-campo="dias" /></label>
                {clave === 'vencida' && <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Repetir cada <input className="input num" type="number" min={1} max={365} value={x.cadaDias} onChange={e => setR({ ...r, [clave]: { ...x, cadaDias: e.target.value } })} disabled={ro} style={{ width: 80 }} placeholder="—" aria-label="Cada días" data-campo="cada-dias" /> días</label>}
                {puedeEditar && <button type="button" className="btn btn-secondary" style={{ fontSize: 12, marginLeft: 'auto' }} onClick={() => void guardarRegla(clave)} disabled={ro} data-accion="guardar-regla"><I.Check size={12} /> {busy === clave ? 'Guardando…' : 'Guardar'}</button>}
              </div>
              <div className="cell-mute" style={{ fontSize: 12 }} data-explicacion>{Number.isFinite(dias) ? EXPLICACION_DIAS[clave](dias, cada) : reg.descripcion}{!x.activo ? ' · desactivada: no se propone' : ''} · plantilla «{plantillas?.[reg.plantillaClave as PlantillaClave]?.nombre ?? reg.plantillaClave}»</div>
            </div>
          ); })}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }} data-variables>
        <div className="card-head"><div className="card-title">Variables que podés usar en una plantilla</div></div>
        <div className="card-pad" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
          {VARIABLES_PLANTILLA.map(v => <span key={v.clave} className="badge badge-outline" style={{ fontSize: 11, padding: '3px 8px' }} title={v.descripcion}><span className="num">{`{{${v.clave}}}`}</span> · {v.descripcion}</span>)}
        </div>
      </div>

      {PLANTILLAS_CLAVES.map(clave => { const pl = plantillas?.[clave]; const x = p[clave]; return (
        <div key={clave} className="card" style={{ marginBottom: 14 }} data-plantilla={clave}>
          <div className="card-head"><div className="card-title">{pl?.nombre ?? clave}</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>{pl?.descripcion}{pl?.updatedPor ? ` · última edición: ${pl.updatedPor}` : ''}</span></div></div>
          <div className="card-pad" style={{ display: 'grid', gap: 8, fontSize: 13 }}>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              <label style={{ display: 'grid', gap: 3 }}>Nombre <input className="input" value={x.nombre} onChange={e => setP({ ...p, [clave]: { ...x, nombre: e.target.value } })} maxLength={120} disabled={ro} data-campo="nombre" /></label>
              {clave !== 'datos_pago' && <label style={{ display: 'grid', gap: 3 }}>Asunto <input className="input" value={x.asunto} onChange={e => setP({ ...p, [clave]: { ...x, asunto: e.target.value } })} maxLength={200} disabled={ro} data-campo="asunto" /></label>}
            </div>
            <label style={{ display: 'grid', gap: 3 }}>{clave === 'datos_pago' ? 'Texto del bloque (banco, cuenta, a nombre de quién, qué mandar al pagar)' : 'Cuerpo'} <textarea className="input" value={x.cuerpo} onChange={e => setP({ ...p, [clave]: { ...x, cuerpo: e.target.value } })} rows={clave === 'datos_pago' ? 4 : 10} maxLength={6000} disabled={ro} data-campo="cuerpo" style={{ fontFamily: 'inherit', fontSize: 12.5 }} /></label>
            {puedeEditar && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => void guardarPlantilla(clave)} disabled={ro} data-accion="guardar-plantilla"><I.Check size={12} /> {busy === clave ? 'Guardando…' : 'Guardar plantilla'}</button></div>}
          </div>
        </div>
      ); })}
    </div>
  );
}
