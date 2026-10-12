'use client';

/**
 * 013 — Número de autorización FEL de una NC ("número de constancia"): se
 * muestra y, para quien puede emitir/editar NC, se completa o corrige en
 * línea (Enter guarda, Esc cancela). Lo usan la lista /notas-credito y la
 * sección de NC del detalle de factura. El servidor revalida el permiso.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { editarAutorizacionFelNCAction } from '@/app/(app)/facturacion/[id]/actions';

interface Props { ncId: string; numeroNC: string; valor: string; puedeEditar: boolean; compacto?: boolean }

export function AutorizacionFel({ ncId, numeroNC, valor, puedeEditar, compacto }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor);
  const [busy, setBusy] = useState(false);
  const [mostrado, setMostrado] = useState(valor);

  const guardar = async () => {
    if (busy) return;
    const nuevo = texto.replace(/\s+/g, '').toUpperCase();
    if (nuevo === mostrado) { setEditando(false); return; }
    setBusy(true);
    try {
      const r = await editarAutorizacionFelNCAction(ncId, nuevo);
      if (r.ok) {
        setMostrado(r.numero ?? '');
        setTexto(r.numero ?? '');
        setEditando(false);
        toast.success(r.numero ? `NC ${numeroNC}: autorización FEL ${r.numero}` : `NC ${numeroNC}: autorización FEL quitada`);
        router.refresh();
      } else toast.error(r.error ?? 'No se pudo guardar.');
    } finally { setBusy(false); }
  };

  if (editando) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
        <input
          autoFocus
          aria-label={`Autorización FEL de ${numeroNC}`}
          className="input num"
          value={texto}
          placeholder="Ej. A1B2C3D4-12345678-…"
          disabled={busy}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void guardar(); } if (e.key === 'Escape') { setTexto(mostrado); setEditando(false); } }}
          style={{ fontSize: 11.5, padding: '3px 6px', width: compacto ? 190 : 240 }}
        />
        <button type="button" className="btn btn-primary" style={{ fontSize: 11, padding: '3px 8px' }} disabled={busy} onClick={() => void guardar()}>Guardar</button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 6px' }} disabled={busy} onClick={() => { setTexto(mostrado); setEditando(false); }}>Esc</button>
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minWidth: 0 }} onClick={e => e.stopPropagation()}>
      {mostrado
        ? <span className="num" title="Número de autorización FEL (SAT)" style={{ fontSize: compacto ? 11 : 12 }}>{mostrado}</span>
        : <span className="cell-mute" style={{ fontSize: 11 }}>{puedeEditar ? 'sin número' : '—'}</span>}
      {puedeEditar && (
        <button type="button" className="btn btn-ghost" aria-label={`${mostrado ? 'Editar' : 'Agregar'} autorización FEL de ${numeroNC}`} title={mostrado ? 'Editar número FEL' : 'Agregar número FEL'} style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => setEditando(true)}>
          {mostrado ? '✎' : '+ FEL'}
        </button>
      )}
    </span>
  );
}
