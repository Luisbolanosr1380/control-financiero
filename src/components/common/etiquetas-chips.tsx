'use client';

/**
 * F-ETIQUETAS — UI reutilizable de etiquetas (facturas Y gastos).
 *
 * <EtiquetasChips>   controlado: chips + autocompletar + crear sobre la
 *                    marcha (estilo Gmail/Trello). Lo usan el alta de
 *                    factura y el modal de aprobación de gasto.
 * <EtiquetasEditor>  autónomo: carga las etiquetas del documento, y
 *                    guarda en cada cambio. Lo usa el detalle de factura.
 * <ChipEtiqueta>     chip de solo lectura para listados.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { usePuede } from '@/components/auth/permisos';
import {
  getEtiquetasAction, getEtiquetasDeDocumentoAction, setEtiquetasDocumentoAction,
} from '@/app/(app)/etiquetas-actions';
import { colorEtiqueta, type Etiqueta, type TipoDocumentoEtiqueta } from '@/lib/db/etiquetas';

export function ChipEtiqueta({ etiqueta, size = 10.5 }: { etiqueta: Etiqueta; size?: number }) {
  const color = colorEtiqueta(etiqueta);
  return (
    <span className="badge" style={{
      color, background: `color-mix(in srgb, ${color} 12%, transparent)`,
      fontSize: size, padding: '2px 7px', whiteSpace: 'nowrap',
    }}>
      {etiqueta.nombre}
    </span>
  );
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

interface ChipsProps {
  value: string[];                      // nombres seleccionados
  onChange: (nombres: string[]) => void;
  sugerencias: Etiqueta[];              // catálogo existente (autocompletar)
  disabled?: boolean;
  placeholder?: string;
}

export function EtiquetasChips({ value, onChange, sugerencias, disabled, placeholder }: ChipsProps) {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const disponibles = useMemo(() => {
    const elegidas = new Set(value.map(norm));
    const base = sugerencias.filter(e => !elegidas.has(norm(e.nombre)));
    const q = norm(texto);
    return q ? base.filter(e => norm(e.nombre).includes(q)) : base;
  }, [sugerencias, value, texto]);

  const existeExacta = useMemo(
    () => sugerencias.some(e => norm(e.nombre) === norm(texto)) || value.some(v => norm(v) === norm(texto)),
    [sugerencias, value, texto]);

  const agregar = (nombre: string) => {
    const limpio = nombre.replace(/\s+/g, ' ').trim();
    if (!limpio) return;
    if (!value.some(v => norm(v) === norm(limpio))) onChange([...value, limpio]);
    setTexto('');
  };

  useEffect(() => {
    const cerrar = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        className="input"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 34, cursor: 'text', padding: '4px 8px' }}
        onClick={() => !disabled && setAbierto(true)}
      >
        {value.map(n => {
          const existente = sugerencias.find(e => norm(e.nombre) === norm(n));
          return (
            <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <ChipEtiqueta etiqueta={existente ?? { id: n, nombre: n, color: null }} size={11} />
              {!disabled && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onChange(value.filter(v => v !== n)); }}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11, padding: 0 }}
                  title="Quitar">×</button>
              )}
            </span>
          );
        })}
        <input
          value={texto}
          disabled={disabled}
          placeholder={value.length === 0 ? (placeholder ?? 'Etiquetas (ej. iglesia, donación)…') : ''}
          onChange={e => { setTexto(e.target.value); setAbierto(true); }}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ',') && texto.trim()) { e.preventDefault(); agregar(texto); }
            if (e.key === 'Backspace' && !texto && value.length) onChange(value.slice(0, -1));
          }}
          style={{ flex: 1, minWidth: 90, border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5 }}
        />
      </div>
      {abierto && !disabled && (disponibles.length > 0 || (texto.trim() && !existeExacta)) && (
        <div style={{
          position: 'absolute', zIndex: 60, top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
          maxHeight: 180, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
        }}>
          {texto.trim() && !existeExacta && (
            <button type="button" onMouseDown={e => { e.preventDefault(); agregar(texto); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', fontSize: 12, fontWeight: 500, color: 'var(--olive)', background: 'transparent', border: 'none', borderBottom: disponibles.length ? '1px solid var(--line-3)' : 'none', cursor: 'pointer' }}>
              ＋ Crear etiqueta «{texto.trim()}»
            </button>
          )}
          {disponibles.slice(0, 12).map(e => (
            <button type="button" key={e.id} onMouseDown={ev => { ev.preventDefault(); agregar(e.nombre); }}
              style={{ display: 'flex', gap: 6, width: '100%', textAlign: 'left', padding: '6px 10px', background: 'transparent', border: 'none', cursor: 'pointer', alignItems: 'center' }}>
              <ChipEtiqueta etiqueta={e} size={11} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Editor autónomo: carga las etiquetas del documento y guarda en cada cambio. */
export function EtiquetasEditor({ tipo, docAppId, disabled }: {
  tipo: TipoDocumentoEtiqueta; docAppId: string; disabled?: boolean;
}) {
  const puedeEtiquetar = usePuede()('etiquetar');   // lectura: ve los chips, no edita
  const [sugerencias, setSugerencias] = useState<Etiqueta[]>([]);
  const [nombres, setNombres] = useState<string[]>([]);
  const [cargado, setCargado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([getEtiquetasAction(), getEtiquetasDeDocumentoAction(tipo, docAppId)])
      .then(([todas, propias]) => {
        if (!vivo) return;
        setSugerencias(todas);
        setNombres(propias.map(e => e.nombre));
        setCargado(true);
      })
      .catch(() => setCargado(true));
    return () => { vivo = false; };
  }, [tipo, docAppId]);

  const onChange = async (nuevos: string[]) => {
    setNombres(nuevos);
    setGuardando(true);
    try {
      const res = await setEtiquetasDocumentoAction(tipo, docAppId, nuevos);
      if (!res.ok) toast.error(res.error);
      else setSugerencias(prev => {
        const porNorm = new Map(prev.map(e => [norm(e.nombre), e]));
        for (const e of res.etiquetas) porNorm.set(norm(e.nombre), e);
        return [...porNorm.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
      });
    } finally {
      setGuardando(false);
    }
  };

  if (!cargado) return <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>Cargando etiquetas…</div>;
  return <EtiquetasChips value={nombres} onChange={onChange} sugerencias={sugerencias} disabled={disabled || guardando || !puedeEtiquetar} />;
}
