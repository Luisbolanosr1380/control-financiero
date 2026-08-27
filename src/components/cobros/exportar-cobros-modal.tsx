'use client';

/**
 * F-EXPORT-CONFIG: export de cobros por período elegido — mismo selector
 * (presets + mes + rango) que el reporte de facturación. Resumen del
 * período (total, # cobros, por banco) + CSV con BOM para Excel.
 * Anulados excluidos por default; si se incluyen, van MARCADOS.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { PeriodoSelector, rangoDePreset, etiquetaArchivo, type RangoPeriodo } from '@/components/common/periodo-selector';
import { getCobrosParaExportAction } from '@/app/(app)/cobros/actions';
import type { CobroListado } from '@/lib/db/cobros';
import type { Customer } from '@/lib/types';

interface Props {
  clientes: Customer[];
  onClose: () => void;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ExportarCobrosModal({ clientes, onClose }: Props) {
  const [rango, setRango] = useState<RangoPeriodo>(() => ({ preset: 'este_mes', ...rangoDePreset('este_mes') }));
  const [incluirAnulados, setIncluirAnulados] = useState(false);
  const [todos, setTodos] = useState<CobroListado[] | null>(null);

  useEffect(() => {
    let vivo = true;
    getCobrosParaExportAction()
      .then(c => { if (vivo) setTodos(c); })
      .catch(() => { if (vivo) { toast.error('No se pudieron cargar los cobros.'); setTodos([]); } });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const nombreCliente = useMemo(() => new Map(clientes.map(c => [c.id, c.name])), [clientes]);

  const filtrados = useMemo(() => {
    if (!todos) return [];
    return todos.filter(c => {
      const f = c.fechaCobro || '';
      if (rango.desde && f < rango.desde) return false;
      if (rango.hasta && f > rango.hasta) return false;
      if (!incluirAnulados && c.estadoCobro === 'Anulado') return false;
      return true;
    });
  }, [todos, rango.desde, rango.hasta, incluirAnulados]);

  const resumen = useMemo(() => {
    const activos = filtrados.filter(c => c.estadoCobro !== 'Anulado');
    const porBanco = new Map<string, { montoQ: number; n: number }>();
    let totalQ = 0, retIVA = 0, retISR = 0;
    for (const c of activos) {
      totalQ += c.monto;
      retIVA += c.retencionIVA;
      retISR += c.retencionISR;
      const b = porBanco.get(c.bancoNombre || '—') ?? { montoQ: 0, n: 0 };
      b.montoQ += c.monto; b.n++;
      porBanco.set(c.bancoNombre || '—', b);
    }
    return {
      totalQ, numCobros: activos.length, retIVA, retISR,
      anuladosEnRango: filtrados.length - activos.length,
      porBanco: [...porBanco.entries()].map(([banco, v]) => ({ banco, ...v })).sort((a, b) => b.montoQ - a.montoQ),
    };
  }, [filtrados]);

  const exportarCsv = () => {
    const encabezado = [
      'Fecha cobro', 'No. factura(s)', 'Cliente', 'Monto cobrado', 'Banco/cuenta',
      'Forma de pago', 'Retención IVA', 'Retención ISR', 'Estado', 'Estado cobro', 'Referencia',
    ];
    const filas = filtrados.map(c => [
      c.fechaCobro, c.noFactura, nombreCliente.get(c.custId) ?? c.custId ?? '—',
      c.monto.toFixed(2), c.bancoNombre, c.metodo,
      c.retencionIVA > 0 ? c.retencionIVA.toFixed(2) : '', c.retencionISR > 0 ? c.retencionISR.toFixed(2) : '',
      c.estado, c.estadoCobro === 'Anulado' ? `ANULADO${c.motivoAnulacion ? ` (${c.motivoAnulacion})` : ''}` : 'Activo',
      c.referencia,
    ].map(csvEscape).join(','));
    const resumenLineas = [
      `Total cobrado,${resumen.totalQ.toFixed(2)}`,
      `# cobros,${resumen.numCobros}`,
      ...resumen.porBanco.map(b => [`Banco: ${b.banco}`, b.montoQ.toFixed(2), `${b.n} cobros`].map(csvEscape).join(',')),
      '',
    ];
    // BOM para que Excel abra el UTF-8 con acentos bien.
    const blob = new Blob(['﻿' + [...resumenLineas, encabezado.join(','), ...filas].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cobros_${etiquetaArchivo(rango.desde, rango.hasta)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtrados.length} cobros exportados.`);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(720px, 96vw)', maxHeight: '92vh', overflowY: 'auto',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Download size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Exportar cobros</div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '16px 22px' }}>
          <PeriodoSelector value={rango} onChange={setRango} disabled={todos === null} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer', marginTop: 10 }}>
            <input type="checkbox" checked={incluirAnulados} onChange={e => setIncluirAnulados(e.target.checked)} />
            Incluir anulados (van marcados como ANULADO con su motivo)
          </label>

          {todos === null ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-4)', fontSize: 12.5 }}>Cargando cobros…</div>
          ) : (
            <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg-2)', borderRadius: 'var(--r-2)', fontSize: 12.5 }}>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: resumen.porBanco.length ? 8 : 0 }}>
                <span>Total cobrado: <span className="num" style={{ fontWeight: 600 }}>{Q(resumen.totalQ)}</span></span>
                <span><span className="num" style={{ fontWeight: 600 }}>{resumen.numCobros}</span> cobros</span>
                {(resumen.retIVA > 0 || resumen.retISR > 0) && (
                  <span style={{ color: 'var(--ink-3)' }}>Retenciones: IVA <span className="num">{Q(resumen.retIVA)}</span> · ISR <span className="num">{Q(resumen.retISR)}</span></span>
                )}
                {resumen.anuladosEnRango > 0 && (
                  <span style={{ color: 'var(--wine)' }}>{resumen.anuladosEnRango} anulados incluidos</span>
                )}
              </div>
              {resumen.porBanco.length > 0 && (
                <div style={{ color: 'var(--ink-3)', lineHeight: 1.7 }}>
                  {resumen.porBanco.map(b => (
                    <span key={b.banco} style={{ marginRight: 14, whiteSpace: 'nowrap' }}>
                      {b.banco}: <span className="num" style={{ fontWeight: 500 }}>{Q(b.montoQ)}</span> ({b.n})
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={exportarCsv} disabled={todos === null || filtrados.length === 0}>
            <I.Download size={13} /> Exportar CSV ({filtrados.length})
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
