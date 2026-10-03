'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { crearMovimientoAction } from '@/app/(app)/conciliacion/actions';
import type { BancoConciliacion } from '@/lib/db/conciliacion';
import type { TipoMov } from '@/lib/conciliacion/motor';
import { ModalBase } from './modal-base';

const hoy = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

export function ModalNuevoMovimiento({ banco, onClose, onListo }: { banco: BancoConciliacion; onClose: () => void; onListo: () => void }) {
  const [fecha, setFecha] = useState(hoy());
  const [tipo, setTipo] = useState<TipoMov>('Ingreso');
  const [monto, setMonto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [referencia, setReferencia] = useState('');
  const [busy, setBusy] = useState(false);
  const montoNum = Number(monto.replace(/[^\d.]/g, ''));

  const guardar = async () => {
    setBusy(true);
    try {
      const r = await crearMovimientoAction({ bancoId: banco.id, fecha, tipo, monto: montoNum, descripcion, referencia });
      if (r.ok) { toast.success(r.mensaje); onListo(); } else toast.error(r.error);
    } finally { setBusy(false); }
  };

  return (
    <ModalBase titulo={`Movimiento del banco · ${banco.nombre}`} onClose={onClose}
      pie={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar} disabled={busy || !(montoNum > 0) || !descripcion.trim()}>{busy ? 'Guardando…' : 'Registrar'}</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label className="label">Tipo</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['Ingreso', 'Egreso'] as const).map(t => (
              <button key={t} type="button" className={'btn ' + (tipo === t ? 'btn-primary' : 'btn-secondary')} style={{ flex: 1 }} onClick={() => setTipo(t)}>
                {t === 'Ingreso' ? '↓ Entra plata' : '↑ Sale plata'}
              </button>
            ))}
          </div>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="label">Fecha</label>
          <input type="date" className="input num" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="label">Monto ({banco.moneda}) — siempre positivo</label>
          <input className="input num" inputMode="decimal" placeholder="0.00" value={monto} onChange={e => setMonto(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="label">Referencia (no. de documento del banco)</label>
          <input className="input" value={referencia} onChange={e => setReferencia(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
          <label className="label">Descripción (como aparece en el estado de cuenta) *</label>
          <input className="input" value={descripcion} onChange={e => setDescripcion(e.target.value)} />
        </div>
      </div>
    </ModalBase>
  );
}
