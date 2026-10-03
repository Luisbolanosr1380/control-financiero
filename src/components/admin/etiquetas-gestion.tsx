'use client';

/**
 * F-ETIQUETAS — gestión del catálogo de etiquetas (solo admin, vive en
 * /admin/catalogos). Renombrar, cambiar color y borrar; el borrado con
 * uso pide confirmación explícita (los vínculos caen en cascada, los
 * documentos NO se tocan — las etiquetas son metadata pura).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { editarEtiquetaAction, borrarEtiquetaAction } from '@/app/(app)/etiquetas-actions';
import { ChipEtiqueta } from '@/components/common/etiquetas-chips';
import { colorEtiqueta, type Etiqueta } from '@/lib/db/etiquetas';

interface Props {
  etiquetas: Etiqueta[];
  uso: Record<string, { facturas: number; gastos: number }>;
}

export function EtiquetasGestion({ etiquetas, uso }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [busy, setBusy] = useState(false);

  const guardarNombre = async (e: Etiqueta) => {
    const limpio = nombre.replace(/\s+/g, ' ').trim();
    setEditando(null);
    if (!limpio || limpio === e.nombre) return;
    setBusy(true);
    try {
      const res = await editarEtiquetaAction(e.id, { nombre: limpio });
      if (res.ok) { toast.success(`Etiqueta renombrada a "${limpio}".`); router.refresh(); }
      else toast.error(res.error);
    } finally { setBusy(false); }
  };

  const cambiarColor = async (e: Etiqueta, color: string) => {
    setBusy(true);
    try {
      const res = await editarEtiquetaAction(e.id, { color });
      if (res.ok) router.refresh();
      else toast.error(res.error);
    } finally { setBusy(false); }
  };

  const borrar = async (e: Etiqueta) => {
    const u = uso[e.id] ?? { facturas: 0, gastos: 0 };
    const total = u.facturas + u.gastos;
    const msg = total > 0
      ? `"${e.nombre}" está en uso (${u.facturas} factura(s), ${u.gastos} gasto(s)). Se quita de esos documentos — los documentos NO se tocan. ¿Borrar?`
      : `¿Borrar la etiqueta "${e.nombre}"?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const res = await borrarEtiquetaAction(e.id);
      if (res.ok) { toast.success(`Etiqueta "${e.nombre}" borrada.`); router.refresh(); }
      else toast.error(res.error);
    } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div className="card-pad">
        <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
          Etiquetas · {etiquetas.length}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, marginBottom: 12 }}>
          Metadata libre para facturas y gastos — sin efecto contable. Se crean
          escribiéndolas en el documento; acá se renombran, se les cambia el
          color o se borran.
        </div>
        {etiquetas.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>
            Todavía no hay etiquetas. Creá la primera desde una factura o un gasto.
          </div>
        ) : (
          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'grid', gap: 2 }}>
            {etiquetas.map(e => {
              const u = uso[e.id] ?? { facturas: 0, gastos: 0 };
              return (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--line-3)' }}>
                  {editando === e.id ? (
                    <input
                      className="input" autoFocus value={nombre}
                      onChange={ev => setNombre(ev.target.value)}
                      onBlur={() => guardarNombre(e)}
                      onKeyDown={ev => { if (ev.key === 'Enter') guardarNombre(e); if (ev.key === 'Escape') setEditando(null); }}
                      style={{ flex: 1, fontSize: 12.5, padding: '3px 8px' }}
                    />
                  ) : (
                    <button type="button" disabled={busy} title="Renombrar"
                      onClick={() => { setEditando(e.id); setNombre(e.nombre); }}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, flex: 1, textAlign: 'left' }}>
                      <ChipEtiqueta etiqueta={e} size={11.5} />
                    </button>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
                    {u.facturas} fact · {u.gastos} gastos
                  </span>
                  <input
                    type="color" value={colorEtiqueta(e)} disabled={busy} title="Cambiar color"
                    onChange={ev => cambiarColor(e, ev.target.value)}
                    style={{ width: 22, height: 22, padding: 0, border: '1px solid var(--line-2)', borderRadius: 4, background: 'none', cursor: 'pointer' }}
                  />
                  <button type="button" className="btn btn-ghost" disabled={busy} title="Borrar etiqueta"
                    onClick={() => borrar(e)} style={{ padding: '2px 6px', color: 'var(--wine)' }}>
                    <I.Trash size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
