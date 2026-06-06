'use client';

/**
 * F-049 — Drop zone + procesamiento de N PDFs de factura.
 *
 * Decisión: drag-drop HTML5 nativo sin react-dropzone. La feature es ~30
 * líneas con onDragOver/onDrop sobre un div; agregar una dep nueva para
 * eso (con sus dependents) no compensa para esta escala. Cuando hagamos
 * paste-from-clipboard, virtualizado de previews grandes, etc., evaluamos.
 *
 * Flujo cliente:
 *   1. Usuario arrastra o clickea para seleccionar PDFs.
 *   2. Preview con lista; permite quitar individuales antes de procesar.
 *   3. Click "Procesar N facturas" → submit del FormData al server action.
 *   4. Toast con resumen (creadas/duplicadas/errores).
 *   5. Modal de detalles si hubo errores o duplicadas — el resumen del toast
 *      es liviano; el detalle vive en el modal para no abarrotar.
 */

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { HelpButton } from '@/components/ayuda/help-button';
import { procesarFacturasAction, type ResultadoProcesamiento } from '@/app/(app)/gastos/_actions/procesar-facturas';

interface ArchivoSeleccionado {
  archivo: File;
  id: string;     // key estable para React (los File no tienen id propio)
}

function bytesLegibles(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadFacturas() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [arch, setArch] = useState<ArchivoSeleccionado[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<ResultadoProcesamiento | null>(null);
  const [showDetalle, setShowDetalle] = useState(false);

  const totalBytes = useMemo(() => arch.reduce((s, a) => s + a.archivo.size, 0), [arch]);

  const agregar = (lista: FileList | File[]) => {
    const nuevos: ArchivoSeleccionado[] = [];
    const filtrados = Array.from(lista).filter(f => {
      if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
        toast.error(`${f.name}: solo PDFs.`);
        return false;
      }
      return true;
    });
    for (const f of filtrados) {
      nuevos.push({ archivo: f, id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 8)}` });
    }
    if (nuevos.length === 0) return;
    setArch(prev => [...prev, ...nuevos]);
  };

  const quitar = (id: string) => setArch(prev => prev.filter(a => a.id !== id));
  const limpiar = () => setArch([]);

  const procesar = async () => {
    if (arch.length === 0) return;
    setLoading(true);
    setResultado(null);
    try {
      const fd = new FormData();
      for (const a of arch) fd.append('archivos', a.archivo);
      const res = await procesarFacturasAction(fd);
      setResultado(res);
      const totalProcesados = res.creadas.length + res.duplicadas.length + res.errores.length;
      const msg = `${res.creadas.length} creada${res.creadas.length === 1 ? '' : 's'} · ${res.duplicadas.length} duplicada${res.duplicadas.length === 1 ? '' : 's'} · ${res.errores.length} error${res.errores.length === 1 ? '' : 'es'}`;
      if (res.errores.length === 0 && res.duplicadas.length === 0) {
        toast.success(`✓ ${msg}`, { duration: 5000 });
      } else if (res.creadas.length === 0) {
        toast.error(`Sin facturas nuevas — ${msg}`, { duration: 8000 });
      } else {
        toast.warning(`${msg} de ${totalProcesados}. Revisá detalles.`, { duration: 8000 });
      }
      // Limpiar selección solo si no hubo errores — si los hubo, dejamos los
      // archivos para que el usuario pueda reintentar tras revisar.
      if (res.errores.length === 0) setArch([]);
      if (res.errores.length > 0 || res.duplicadas.length > 0) setShowDetalle(true);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red al procesar.');
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (loading) return;
    if (e.dataTransfer.files?.length) agregar(e.dataTransfer.files);
  };

  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">
        <div className="card-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Cargar facturas
          <HelpButton tag="factura-in-upload" />
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); if (!loading) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => { if (!loading) inputRef.current?.click(); }}
          style={{
            border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--line-2)'}`,
            background: dragging ? 'var(--paper-2)' : 'transparent',
            borderRadius: 8,
            padding: 32,
            textAlign: 'center',
            cursor: loading ? 'wait' : 'pointer',
            transition: 'border-color 120ms, background 120ms',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={(e) => { if (e.target.files) agregar(e.target.files); e.target.value = ''; }}
          />
          <div style={{ fontSize: 28, marginBottom: 8 }}>📥</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: 4 }}>
            {dragging ? 'Soltá los PDFs acá' : 'Arrastrá facturas PDF o hacé click para seleccionar'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
            Múltiples archivos OK. Solo PDFs. Procesamiento ≈5-30 s por factura.
          </div>
        </div>

        {/* Lista de seleccionados */}
        {arch.length > 0 && (
          <div style={{ marginTop: 14, border: '1px solid var(--line-3)', borderRadius: 6, padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {arch.length} archivo{arch.length === 1 ? '' : 's'} · {bytesLegibles(totalBytes)}
              </span>
              <button
                type="button"
                onClick={limpiar}
                disabled={loading}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11 }}
              >
                Limpiar todo
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {arch.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--paper-2)', borderRadius: 4 }}>
                  <span style={{ fontSize: 13 }}>📄</span>
                  <span style={{ fontSize: 12, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.archivo.name}>
                    {a.archivo.name}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{bytesLegibles(a.archivo.size)}</span>
                  <button
                    type="button"
                    onClick={() => quitar(a.id)}
                    disabled={loading}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 12 }}
                    title="Quitar"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={procesar}
                disabled={loading || arch.length === 0}
              >
                {loading
                  ? <><I.Refresh size={13} /> Procesando — puede tardar 5-30 s por factura…</>
                  : <>Procesar {arch.length} factura{arch.length === 1 ? '' : 's'}</>}
              </button>
            </div>
          </div>
        )}

        {/* Botón de re-abrir detalle si ya hubo resultado */}
        {resultado && !showDetalle && (resultado.duplicadas.length > 0 || resultado.errores.length > 0) && (
          <button
            type="button"
            onClick={() => setShowDetalle(true)}
            style={{ marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11.5 }}
          >
            Ver detalle del último procesamiento →
          </button>
        )}
      </div>

      {showDetalle && resultado && (
        <DetalleResultadoModal resultado={resultado} onClose={() => setShowDetalle(false)} />
      )}
    </div>
  );
}

function DetalleResultadoModal({ resultado, onClose }: { resultado: ResultadoProcesamiento; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 94vw)', maxHeight: '88vh', overflow: 'auto',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Resultado del procesamiento</div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} title="Cerrar">
            <I.X size={14} />
          </button>
        </div>
        <div style={{ padding: 18 }}>
          {resultado.creadas.length > 0 && (
            <Seccion titulo={`✓ Creadas (${resultado.creadas.length})`} colorTitulo="var(--olive)">
              {resultado.creadas.map(c => (
                <li key={c.facturaInId} style={{ fontSize: 12, color: 'var(--ink)' }}>
                  <strong>{c.proveedor}</strong> — Q{c.total.toFixed(2)} · <span style={{ color: 'var(--ink-4)' }}>{c.nombreArchivo}</span>
                </li>
              ))}
            </Seccion>
          )}
          {resultado.duplicadas.length > 0 && (
            <Seccion titulo={`Duplicadas (${resultado.duplicadas.length})`} colorTitulo="var(--ink-2)">
              {resultado.duplicadas.map((d, i) => (
                <li key={i} style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  {d.nombreArchivo} — <span style={{ color: 'var(--ink-4)' }}>{d.motivo === 'hash' ? 'mismo PDF (hash)' : 'mismo documento (doc_key)'}</span>
                </li>
              ))}
            </Seccion>
          )}
          {resultado.errores.length > 0 && (
            <Seccion titulo={`Errores (${resultado.errores.length})`} colorTitulo="var(--wine)">
              {resultado.errores.map((e, i) => (
                <li key={i} style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  <strong>{e.nombreArchivo}</strong>: {e.motivo}
                </li>
              ))}
            </Seccion>
          )}
        </div>
      </div>
    </div>
  );
}

function Seccion({ titulo, colorTitulo, children }: { titulo: string; colorTitulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: colorTitulo, marginBottom: 6 }}>{titulo}</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</ul>
    </div>
  );
}
