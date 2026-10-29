'use client';

/**
 * CHIPS · entrada de varios nombres / marcas (020: "Otros nombres / marcas" del
 * cliente). Enter o coma agregan; Backspace con el campo vacío quita el último;
 * la × quita uno. Sin repetidos (sin tildes ni mayúsculas).
 */
import { useState, type KeyboardEvent } from 'react';
import { I } from '@/components/common/icons';
import { normalizarBusqueda } from '@/lib/clientes/buscar';

interface Props {
  valores: string[];
  onChange: (valores: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
  /** Nombres que no tiene sentido repetir como marca (el nombre y la razón social). */
  excluir?: readonly (string | undefined)[];
}

export function ChipsInput({ valores, onChange, placeholder = 'Escribí y Enter…', disabled, excluir = [], ...rest }: Props) {
  const [texto, setTexto] = useState('');

  const agregar = (crudo: string) => {
    const partes = crudo.split(',').map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!partes.length) return;
    const vistos = new Set([...valores, ...excluir.filter((x): x is string => !!x)].map(normalizarBusqueda));
    const nuevos: string[] = [];
    for (const p of partes) { const k = normalizarBusqueda(p); if (k && !vistos.has(k)) { vistos.add(k); nuevos.push(p.slice(0, 80)); } }
    if (nuevos.length) onChange([...valores, ...nuevos].slice(0, 20));
    setTexto('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); agregar(texto); }
    else if (e.key === 'Backspace' && texto === '' && valores.length) { e.preventDefault(); onChange(valores.slice(0, -1)); }
  };

  return (
    <div className="input" data-chips style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: 36, height: 'auto', padding: '4px 8px', cursor: 'text' }} onClick={e => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      {valores.map(v => (
        <span key={v} className="badge badge-mute" data-chip style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, textTransform: 'none', letterSpacing: 0 }}>
          {v}
          {!disabled && <button type="button" onClick={e => { e.stopPropagation(); onChange(valores.filter(x => x !== v)); }} aria-label={`Quitar ${v}`} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0, display: 'inline-flex', color: 'inherit' }}><I.X size={11} /></button>}
        </span>
      ))}
      <input
        type="text" value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={onKey} onBlur={() => agregar(texto)}
        placeholder={valores.length ? '' : placeholder} disabled={disabled} aria-label={rest['aria-label'] ?? 'Otros nombres o marcas'}
        style={{ flex: 1, minWidth: 120, border: 0, outline: 0, background: 'transparent', font: 'inherit', color: 'inherit', padding: 0 }}
      />
    </div>
  );
}
