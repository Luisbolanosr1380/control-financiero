'use client';

/**
 * CENTRO DE COBROS (033) · «Hoy»: la bandeja de trabajo, ordenada por prioridad (seguimientos, promesas incumplidas,
 * promesas por vencer, vencidas sin gestión, por vencer, «dice que ya pagó»). KPIs arriba, contacto preferido con un
 * clic (llamar, WhatsApp, correo), «Registrar gestión» ahí mismo, CSV. 390 px: una tarjeta por fila.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { HelpButton } from '@/components/ayuda/help-button';
import { Q, formatDateDDMMYYYY } from '@/lib/utils';
import { csvEscape } from '@/lib/facturacion/reporte-csv';
import { ETIQUETA_CATEGORIA, ORDEN_CATEGORIA, type CategoriaBandeja, type ItemBandeja } from '@/lib/cobranza/estado';
import type { DatosBandeja } from '@/lib/db/cobranza';
import { GestionForm } from './gestion-form';

const COLOR_CATEGORIA: Record<CategoriaBandeja, string> = { seguimiento: 'badge-outline', promesa_incumplida: 'badge-wine', promesa_por_vencer: 'badge-warn', vencida_sin_gestion: 'badge-wine', por_vencer: 'badge-olive', dice_que_pago: 'badge-warn' };
const wa = (n: string) => `https://wa.me/${n.replace(/\D/g, '').replace(/^(\d{8})$/, '502$1')}`;

export function ContactoRapido({ c }: { c: ItemBandeja['contactoPreferido'] }) {
  if (!c) return <span className="cell-mute" style={{ fontSize: 12 }}>sin contacto</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }} data-contacto-preferido={c.id}>
      <span className="cell-strong">{c.nombre}</span>
      {c.telefono && <a className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: 11 }} href={`tel:${c.telefono.replace(/\s/g, '')}`} title={`Llamar al ${c.telefono}`} data-accion="llamar"><I.Phone size={12} /></a>}
      {c.whatsapp && <a className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: 11 }} href={wa(c.whatsapp)} target="_blank" rel="noopener" title={`WhatsApp ${c.whatsapp}`} data-accion="whatsapp">WA</a>}
      {c.correo && <a className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: 11 }} href={`mailto:${c.correo}`} title={c.correo} data-accion="correo"><I.Mail size={12} /></a>}
    </span>
  );
}

export function BandejaClient({ datos, email, recordatorios = null }: { datos: DatosBandeja; email: string; /** 035: resumen de los recordatorios propuestos hoy (null sin la 035) */ recordatorios?: { total: number; listos: number; bloqueados: number; sinCorreo: number } | null }) {
  const router = useRouter();
  const puedeGestionar = usePuede()('gestionar_cobranza');
  const [categoria, setCategoria] = useState<CategoriaBandeja | 'todas'>('todas');
  const [gestion, setGestion] = useState<ItemBandeja | null>(null);
  const items = datos.items.filter(i => categoria === 'todas' || i.categoria === categoria);
  const n = (c: CategoriaBandeja) => datos.items.filter(i => i.categoria === c).length;
  const k = datos.kpis;
  const exportar = () => {
    const L = [['Prioridad', 'Cliente', 'Facturas', 'Monto', 'Días de atraso', 'Fecha clave', 'Detalle', 'Último contacto', 'Contacto', 'Teléfono', 'WhatsApp', 'Correo', 'Responsable'].map(csvEscape).join(',')];
    for (const i of datos.items) L.push([ETIQUETA_CATEGORIA[i.categoria], i.nombre, i.facturas.join(' '), i.monto.toFixed(2), String(i.diasAtraso), i.fechaClave ?? '', i.detalle, i.ultimoContacto, i.contactoPreferido?.nombre ?? '', i.contactoPreferido?.telefono ?? '', i.contactoPreferido?.whatsapp ?? '', i.contactoPreferido?.correo ?? '', i.responsable ?? ''].map(csvEscape).join(','));
    const blob = new Blob(['﻿' + L.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cobranza_hoy_${datos.hoy}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="page" data-bandeja={datos.items.length}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Centro de Cobros · Hoy <HelpButton tag="modulo-cobranza" /></h1>
          <div className="page-subtitle">{formatDateDDMMYYYY(datos.hoy)} · {datos.misClientes ? 'mis clientes y los sin responsable' : 'todos los clientes'} · {k.clientesConCartera} clientes con cartera{datos.cerradas.cumplidas + datos.cerradas.incumplidas > 0 ? ` · promesas cerradas hoy: ${datos.cerradas.cumplidas} cumplidas, ${datos.cerradas.incumplidas} incumplidas` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={() => router.push(datos.misClientes ? '/cobranza?todos=1' : '/cobranza')} data-accion="alternar-mios">{datos.misClientes ? 'Ver todos' : 'Ver mis clientes'}</button>
          <button type="button" className="btn btn-secondary" onClick={exportar} disabled={datos.items.length === 0} data-accion="exportar-csv"><I.Download size={13} /> CSV</button>
        </div>
      </div>
      <div className="kpi-grid" style={{ marginBottom: 14 }} data-kpis>
        <div className="kpi" data-kpi="cartera"><div className="kpi-label">Cartera total</div><div className="kpi-value">{Q(k.carteraTotal)}</div><div className="kpi-delta"><span className="vs">{k.clientesConCartera} clientes</span></div></div>
        <div className="kpi" data-kpi="vencida"><div className="kpi-label">Vencida</div><div className="kpi-value" style={{ color: k.vencida > 0 ? 'var(--wine)' : undefined }}>{Q(k.vencida)}</div><div className="kpi-delta"><span className="vs">más de 60 días: {Q(k.masDe60)}</span></div></div>
        <div className="kpi" data-kpi="promesas"><div className="kpi-label">Promesas de esta semana</div><div className="kpi-value">{Q(k.promesasSemana)}</div><div className="kpi-delta"><span className="vs">{k.promesasSemanaN} {k.promesasSemanaN === 1 ? 'promesa' : 'promesas'}</span></div></div>
        <div className="kpi" data-kpi="cumplidas"><div className="kpi-label">Promesas cumplidas del mes</div><div className="kpi-value">{k.pctCumplidas === null ? '—' : `${k.pctCumplidas} %`}</div><div className="kpi-delta"><span className="vs">{k.cumplidasMes} de {k.cerradasMes} cerradas</span></div></div>
      </div>
      {recordatorios && (
        <div className="card" style={{ marginBottom: 12 }} data-recordatorios-propuestos={recordatorios.total}>
          <div className="card-pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            <I.Mail size={16} style={{ opacity: .7 }} />
            <span><strong>{recordatorios.total}</strong> recordatorio{recordatorios.total === 1 ? '' : 's'} propuesto{recordatorios.total === 1 ? '' : 's'} para hoy{recordatorios.total ? <span className="cell-mute"> · {recordatorios.listos} listos{recordatorios.bloqueados ? ` · ${recordatorios.bloqueados} bloqueados (disputa o promesa vigente)` : ''}{recordatorios.sinCorreo ? ` · ${recordatorios.sinCorreo} sin correo` : ''}</span> : <span className="cell-mute"> · nada que recordar</span>}</span>
            <Link href="/cobranza/recordatorios" className="btn btn-secondary" style={{ fontSize: 12, marginLeft: 'auto' }} data-accion="ver-recordatorios"><I.Send size={12} /> Revisar y enviar</Link>
          </div>
        </div>
      )}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <button type="button" className={'btn ' + (categoria === 'todas' ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setCategoria('todas')} data-filtro="todas">Todo ({datos.items.length})</button>
          {ORDEN_CATEGORIA.map((c, i) => <button key={c} type="button" className={'btn ' + (categoria === c ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setCategoria(c)} data-filtro={c}>{i + 1}. {ETIQUETA_CATEGORIA[c]} ({n(c)})</button>)}
        </div>
      </div>
      <div className="card" data-lista-bandeja>
        {items.length === 0 && <div className="card-pad" style={{ textAlign: 'center', padding: 36, color: 'var(--ink-4)' }}><I.Check size={26} style={{ opacity: .4, marginBottom: 8 }} /><div style={{ fontSize: 13 }}>{datos.items.length === 0 ? 'Nada pendiente para hoy.' : 'Nada en esta prioridad.'}</div></div>}
        {items.map((it, idx) => (
          <div key={`${it.categoria}-${it.clienteId}-${idx}`} className="card-pad" style={{ borderTop: idx ? '1px solid var(--line-3)' : 'none', display: 'grid', gap: 6, gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'start' }} data-item={it.categoria} data-cliente={it.clienteId}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={'badge ' + COLOR_CATEGORIA[it.categoria]} style={{ fontSize: 10.5 }}>{ETIQUETA_CATEGORIA[it.categoria]}</span>
                <Link href={`/cobranza/${encodeURIComponent(it.clienteId)}`} className="cell-strong" style={{ textDecoration: 'none', color: 'var(--ink)', fontSize: 14 }} data-accion="abrir-ficha">{it.nombre}</Link>
                {it.diasAtraso > 0 && <span className="num" style={{ color: it.diasAtraso > 60 ? 'var(--wine)' : 'var(--ink-3)', fontSize: 12 }}>{it.diasAtraso} d de atraso</span>}
                {it.responsable && <span className="cell-mute" style={{ fontSize: 11 }}>· {it.responsable === email ? 'mío' : it.responsable}</span>}
              </div>
              <div style={{ fontSize: 12.5, marginTop: 2 }}>{it.detalle} · <span className="num cell-strong">{Q(it.monto)}</span>{it.facturas.length ? <span className="cell-mute"> · {it.facturas.slice(0, 6).join(', ')}{it.facturas.length > 6 ? ` +${it.facturas.length - 6}` : ''}</span> : null}</div>
              <div className="cell-mute" style={{ fontSize: 12, marginTop: 2 }} data-ultimo-contacto>Último contacto: {it.ultimoContacto}</div>
              <div style={{ marginTop: 4 }}><ContactoRapido c={it.contactoPreferido} /></div>
            </div>
            {puedeGestionar && <button type="button" className="btn btn-primary" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => setGestion(it)} data-accion="registrar-gestion"><I.Plus size={12} /> Registrar gestión</button>}
          </div>
        ))}
      </div>
      {gestion && (
        <GestionForm clienteId={gestion.clienteId} clienteNombre={gestion.nombre} contactos={datos.clientes[gestion.clienteId]?.contactos ?? []} facturas={datos.clientes[gestion.clienteId]?.facturas ?? []} facturasPre={gestion.facturas} resultadoPre={gestion.categoria === 'promesa_por_vencer' ? 'contactado' : undefined}
          onClose={() => setGestion(null)} onListo={msg => { setGestion(null); toast.success(msg); router.refresh(); }} />
      )}
    </div>
  );
}
