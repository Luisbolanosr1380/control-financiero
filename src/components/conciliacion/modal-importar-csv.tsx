'use client';

/**
 * Importar estado de cuenta CSV: archivo → mapeo de columnas → vista
 * previa (nuevos / duplicados / errores, calculada en el SERVIDOR contra
 * lo ya cargado) → confirmar. El servidor vuelve a calcular todo al
 * confirmar; nunca confía en la vista previa del cliente.
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Q } from '@/lib/utils';
import { normalizarFilas, parsearCsv, sugerirMapeo, type MapeoColumnas, type TablaCsv } from '@/lib/conciliacion/csv';
import { importarMovimientosAction, previsualizarImportacionAction } from '@/app/(app)/conciliacion/actions';
import type { BancoConciliacion, PreviewImportacion } from '@/lib/db/conciliacion';
import { ModalBase } from './modal-base';

export function ModalImportarCsv({ banco, onClose, onListo }: { banco: BancoConciliacion; onClose: () => void; onListo: () => void }) {
  const [tabla, setTabla] = useState<TablaCsv | null>(null);
  const [mapeo, setMapeo] = useState<MapeoColumnas | null>(null);
  const [modoMonto, setModoMonto] = useState<'una' | 'dos'>('una');
  const [preview, setPreview] = useState<PreviewImportacion | null>(null);
  const [busy, setBusy] = useState(false);

  const leer = async (f: File) => {
    const texto = await f.text();
    const t = parsearCsv(texto);
    if (t.encabezados.length < 2 || t.filas.length === 0) { toast.error('No se reconoció el archivo como CSV con encabezados.'); return; }
    const m = sugerirMapeo(t.encabezados);
    setTabla(t); setMapeo(m); setModoMonto(m.monto === null && m.debito !== null ? 'dos' : 'una'); setPreview(null);
  };

  const filas = useMemo(() => (tabla && mapeo ? normalizarFilas(tabla, modoMonto === 'una' ? { ...mapeo, debito: null, credito: null } : { ...mapeo, monto: null }) : []), [tabla, mapeo, modoMonto]);

  const previsualizar = async () => {
    setBusy(true);
    try {
      const r = await previsualizarImportacionAction(banco.id, filas);
      if (r.ok) setPreview(r.preview); else toast.error(r.error);
    } finally { setBusy(false); }
  };
  const confirmar = async () => {
    setBusy(true);
    try {
      const r = await importarMovimientosAction(banco.id, filas);
      if (r.ok) { toast.success(r.mensaje); onListo(); } else toast.error(r.error);
    } finally { setBusy(false); }
  };

  const Col = ({ label, campo, opcional }: { label: string; campo: keyof MapeoColumnas; opcional?: boolean }) => (
    <div className="field" style={{ margin: 0 }}>
      <label className="label">{label}</label>
      <select className="input" value={mapeo?.[campo] === null || mapeo?.[campo] === undefined ? '' : String(mapeo[campo])}
        onChange={e => { setMapeo(prev => prev && ({ ...prev, [campo]: e.target.value === '' ? null : Number(e.target.value) })); setPreview(null); }}>
        {opcional && <option value="">— ninguna —</option>}
        {tabla?.encabezados.map((h, i) => <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>)}
      </select>
    </div>
  );

  return (
    <ModalBase titulo={`Importar estado de cuenta · ${banco.nombre}`} ancho={820} onClose={onClose}
      pie={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        {!preview
          ? <button className="btn btn-secondary" onClick={previsualizar} disabled={busy || filas.length === 0}>{busy ? 'Revisando…' : 'Revisar duplicados'}</button>
          : <button className="btn btn-primary" onClick={confirmar} disabled={busy || preview.nuevos.length === 0}>{busy ? 'Importando…' : `Importar ${preview.nuevos.length} nuevo(s)`}</button>}
      </>}>
      <input type="file" accept=".csv,.txt,text/csv" onChange={e => e.target.files?.[0] && leer(e.target.files[0])} />
      <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 6 }}>
        CSV del banco (separador coma, punto y coma o tab). Montos como 1,234.56 o 1.234,56; fechas dd/mm/aaaa o aaaa-mm-dd.
      </div>

      {tabla && mapeo && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
            <Col label="Fecha" campo="fecha" />
            <Col label="Descripción" campo="descripcion" />
            <Col label="Referencia" campo="referencia" opcional />
          </div>
          <div style={{ display: 'flex', gap: 8, margin: '12px 0 8px' }}>
            <button className={'btn ' + (modoMonto === 'una' ? 'btn-primary' : 'btn-secondary')} style={{ fontSize: 12 }} onClick={() => { setModoMonto('una'); setPreview(null); }}>Una columna Monto (+/−)</button>
            <button className={'btn ' + (modoMonto === 'dos' ? 'btn-primary' : 'btn-secondary')} style={{ fontSize: 12 }} onClick={() => { setModoMonto('dos'); setPreview(null); }}>Débito y Crédito separados</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {modoMonto === 'una' ? (
              <>
                <Col label="Monto (+ entra / − sale)" campo="monto" />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, alignSelf: 'end', paddingBottom: 8 }}>
                  <input type="checkbox" checked={!!mapeo.invertirSigno} onChange={e => { setMapeo({ ...mapeo, invertirSigno: e.target.checked }); setPreview(null); }} />
                  El banco usa + para cargos (invertir)
                </label>
              </>
            ) : (
              <>
                <Col label="Débito (sale plata)" campo="debito" />
                <Col label="Crédito (entra plata)" campo="credito" />
              </>
            )}
          </div>

          <table className="table" style={{ marginTop: 14 }}>
            <thead><tr><th style={{ width: 40 }}>#</th><th style={{ width: 95 }}>Fecha</th><th>Descripción</th><th style={{ width: 110 }}>Referencia</th><th className="num" style={{ width: 120 }}>Monto</th><th style={{ width: 120 }}>Estado</th></tr></thead>
            <tbody>
              {filas.slice(0, 200).map(f => {
                const dup = preview?.duplicados.some(d => d.fila === f.fila);
                return (
                  <tr key={f.fila} style={{ opacity: f.error || dup ? 0.55 : 1 }}>
                    <td className="num cell-mute">{f.fila}</td>
                    <td className="num">{f.fecha || '—'}</td>
                    <td style={{ fontSize: 12 }}>{f.descripcion}</td>
                    <td style={{ fontSize: 12 }}>{f.referencia || '—'}</td>
                    <td className="num" style={{ color: f.tipo === 'Ingreso' ? 'var(--olive)' : 'var(--wine)' }}>{f.error ? '—' : `${f.tipo === 'Ingreso' ? '+' : '−'}${Q(f.monto)}`}</td>
                    <td style={{ fontSize: 11.5 }}>
                      {f.error ? <span style={{ color: 'var(--wine)' }}>{f.error}</span>
                        : dup ? <span className="badge badge-mute">Duplicado</span>
                        : preview ? <span className="badge badge-olive">Nuevo</span> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {preview && (
            <div style={{ marginTop: 10, fontSize: 13, fontWeight: 500 }}>
              {preview.nuevos.length} nuevo(s) · {preview.duplicados.length} duplicado(s) omitido(s){preview.errores.length ? ` · ${preview.errores.length} con error (no se importan)` : ''}
            </div>
          )}
        </>
      )}
    </ModalBase>
  );
}
