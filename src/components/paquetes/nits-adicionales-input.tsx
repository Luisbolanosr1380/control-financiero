'use client';

/**
 * PAQUETE DE VARIOS NIT (036) · campo «También lo usan»: las otras empresas del mismo grupo que consumen del paquete.
 * Busca clientes por nombre (cualquiera de sus nombres, sin tildes) o NIT con la lógica de src/lib/clientes/buscar.ts
 * (en el servidor) y muestra cada NIT elegido con su nombre. El titular (quien pagó) no se puede agregar acá.
 */
import { useEffect, useRef, useState } from 'react';
import { I } from '@/components/common/icons';
import { buscarClientesPaqueteAction } from '@/app/(app)/paquetes/actions';
import type { ClientePaquete } from '@/lib/db/paquetes';

export function NitsAdicionalesInput({ titularNit, value, onChange, disabled }: { titularNit: string; value: ClientePaquete[]; onChange: (v: ClientePaquete[]) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<ClientePaquete[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const turno = useRef(0);
  const excluir = [titularNit, ...value.map(v => v.nit)].join(',');

  useEffect(() => {
    const consulta = q.trim();
    if (consulta.length < 2) { setRes(null); return; }
    const mio = ++turno.current;
    const t = setTimeout(async () => {
      setBuscando(true);
      try { const r = await buscarClientesPaqueteAction(consulta, excluir.split(',')); if (turno.current === mio) setRes(r); }
      catch { if (turno.current === mio) setRes([]); }
      finally { if (turno.current === mio) setBuscando(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, excluir]);

  const agregar = (c: ClientePaquete) => { onChange([...value, c]); setQ(''); setRes(null); };

  return (
    <div className="field" style={{ margin: 0 }} data-campo-grupo="tambien-lo-usan" data-nits={value.map(v => v.nit).join(',')}>
      <label className="label">También lo usan <span className="cell-mute" style={{ fontWeight: 400 }}>· otras empresas del mismo grupo (opcional)</span></label>
      {value.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {value.map(v => (
            <span key={v.nit} className="badge badge-outline" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }} data-nit-adicional={v.nit}>
              <span>{v.razonSocial || v.nombre || 'Sin cliente con ese NIT'} · <span className="num">{v.nit}</span></span>
              <button type="button" className="btn btn-ghost" style={{ padding: '0 2px', lineHeight: 1 }} onClick={() => onChange(value.filter(x => x.nit !== v.nit))} disabled={disabled} aria-label={`Quitar ${v.razonSocial || v.nit}`} data-accion="quitar-nit"><I.X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div style={{ position: 'relative', maxWidth: 420 }}>
        <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente por nombre o NIT" disabled={disabled} data-campo="buscar-nit-adicional" autoComplete="off" />
        {q.trim().length >= 2 && (
          <div className="card" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4, maxHeight: 240, overflowY: 'auto' }} data-resultados-nit={res?.length ?? ''}>
            {res === null || buscando ? <div className="card-pad cell-mute" style={{ fontSize: 12 }}>Buscando…</div>
              : res.length === 0 ? <div className="card-pad cell-mute" style={{ fontSize: 12 }}>Ningún cliente activo con NIT coincide con «{q.trim()}».</div>
              : res.map(c => (
                <button key={c.nit} type="button" onClick={() => agregar(c)} data-opcion-nit={c.nit} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', background: 'none', border: 'none', borderBottom: '1px solid var(--line-3)', cursor: 'pointer', fontSize: 12.5 }}>
                  <span className="cell-strong">{c.nombre}</span> <span className="num cell-mute">· NIT {c.nit}</span>
                  {c.razonSocial && c.razonSocial !== c.nombre && <div className="cell-mute" style={{ fontSize: 11 }}>{c.razonSocial}</div>}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
