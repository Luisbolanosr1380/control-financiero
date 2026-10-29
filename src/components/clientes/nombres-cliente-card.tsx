'use client';

/**
 * CLIENTE · "Nombres y marcas" (020): razón social (la que va en la factura, solo
 * lectura acá), nombre comercial y otros nombres / marcas, editables en línea por
 * quien puede crear clientes. Sirve para que "Calzado Chicote" encuentre a
 * "Distribuidora Suprema" en la lista, en el mapeo y en la sugerencia de la Agenda.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { ChipsInput } from '@/components/clientes/chips-input';
import { editarNombresClienteAction } from '@/app/(app)/clientes/actions';
import { CambiarNitModal } from '@/components/clientes/cambiar-nit-modal';
import type { Customer } from '@/lib/types';

export function NombresClienteCard({ cliente }: { cliente: Customer }) {
  const router = useRouter();
  const puede = usePuede();
  const [editando, setEditando] = useState(false);
  const [nombreComercial, setNombreComercial] = useState(cliente.nombreComercial ?? '');
  const [aliases, setAliases] = useState<string[]>(cliente.aliases ?? []);
  const [busy, setBusy] = useState(false);
  // 023: "Cambiar NIT" con arrastre (tarifario, mapeo, expedientes, detalles) — modal con resumen y confirmación.
  const [cambiandoNit, setCambiandoNit] = useState(false);
  const puedeEditar = puede('emitir_factura');

  const guardar = async () => {
    setBusy(true);
    try {
      const r = await editarNombresClienteAction(cliente.id, { nombreComercial, aliases });
      if (r.ok) { toast.success(r.mensaje); setNombreComercial(r.nombreComercial); setAliases(r.aliases); setEditando(false); router.refresh(); }
      else toast.error(r.error);
    } finally { setBusy(false); }
  };
  const cancelar = () => { setNombreComercial(cliente.nombreComercial ?? ''); setAliases(cliente.aliases ?? []); setEditando(false); };

  return (
    <div className="card" data-nombres-cliente style={{ marginBottom: 18 }}>
      {cambiandoNit && <CambiarNitModal objetivo={{ clienteId: cliente.id }} nitActual={cliente.nit} nombre={cliente.name} onClose={() => setCambiandoNit(false)} onHecho={() => router.refresh()} />}
      <div className="card-head">
        <div className="card-title">Nombres y marcas</div>
        <div className="card-actions">
          {puedeEditar && !editando && <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setCambiandoNit(true)} data-accion="cambiar-nit" title="Corregir el NIT en el cliente, su tarifario, el mapeo de la Agenda, los expedientes y los detalles, de una sola vez"><I.Refresh size={12} /> Cambiar NIT</button>}
          {puedeEditar && !editando && <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setEditando(true)} data-accion="editar-nombres"><I.Edit size={12} /> Editar</button>}
        </div>
      </div>
      <div className="card-pad" style={{ fontSize: 13, display: 'grid', gridTemplateColumns: 'minmax(140px, 180px) 1fr', rowGap: 10, columnGap: 14, alignItems: 'start' }}>
        <div className="cell-mute">Razón social (factura)</div>
        <div className="cell-strong">{cliente.razonSocial || cliente.name}{cliente.nit ? <span className="cell-mute num" style={{ marginLeft: 8, fontWeight: 400 }}>NIT {cliente.nit}</span> : null}</div>
        <div className="cell-mute">Nombre comercial / marca</div>
        <div>
          {editando
            ? <input className="input" value={nombreComercial} onChange={e => setNombreComercial(e.target.value)} placeholder='ej. "Calzado Chicote"' disabled={busy} aria-label="Nombre comercial" style={{ maxWidth: 420 }} />
            : (nombreComercial ? nombreComercial : <span className="cell-mute">—</span>)}
        </div>
        <div className="cell-mute">Otros nombres / marcas</div>
        <div>
          {editando
            ? <div style={{ maxWidth: 560 }}><ChipsInput valores={aliases} onChange={setAliases} disabled={busy} excluir={[cliente.name, cliente.razonSocial, nombreComercial]} placeholder="Escribí y Enter (varios)…" /></div>
            : aliases.length
              ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{aliases.map(a => <span key={a} className="badge badge-mute" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11.5 }}>{a}</span>)}</div>
              : <span className="cell-mute">—</span>}
        </div>
        {editando && (
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
            <span className="cell-mute" style={{ fontSize: 11.5, marginRight: 'auto' }}>Solo para ubicarlo (lista, mapeo de la Agenda, sugerencias). La factura sigue saliendo con la razón social.</span>
            <button type="button" className="btn btn-ghost" onClick={cancelar} disabled={busy}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={busy} data-accion="guardar-nombres">{busy ? <><I.Refresh size={13} /> Guardando…</> : <><I.Check size={13} /> Guardar</>}</button>
          </div>
        )}
      </div>
    </div>
  );
}
