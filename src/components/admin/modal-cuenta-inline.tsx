'use client';

/**
 * F-BANCO-INLINE — Crear una cuenta contable SIN salir del formulario
 * que la necesita (alta de banco, y reutilizable donde haga falta).
 *
 * REUSA el creador inteligente existente, no lo duplica:
 *  · sugerencia de código y naturaleza: contabilidad/plan-cuentas (puro)
 *  · creación + triple barrera anti-duplicado: crearCuentaContableAction
 *    (validación en vivo acá + revalidación server + unique de DB).
 * El padre viene fijado por el contexto (p.ej. 1-1-2 "Bancos").
 */

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { crearCuentaContableAction } from '@/app/(app)/admin/catalogos/actions';
import { naturalezaDeCodigo, sugerirSiguienteCodigo } from '@/lib/contabilidad/plan-cuentas';

export interface CuentaMin {
  id: string;
  codigo: string;
  nombre: string;
}

interface Props {
  /** Padre fijado por el contexto (ej. '1-1-2'). Debe existir en `cuentas`. */
  parentPath: string;
  cuentas: CuentaMin[];                 // plan actual (para sugerir y validar dup)
  titulo?: string;                      // encabezado del modal
  placeholderNombre?: string;
  onCreada: (cuenta: CuentaMin) => void;
  onClose: () => void;
}

export function ModalCuentaInline({ parentPath, cuentas, titulo, placeholderNombre, onCreada, onClose }: Props) {
  const codigos = useMemo(() => cuentas.map(c => c.codigo), [cuentas]);
  const porCodigo = useMemo(() => new Map(cuentas.map(c => [c.codigo, c])), [cuentas]);
  const padre = porCodigo.get(parentPath);

  const [codigo, setCodigo] = useState(() => sugerirSiguienteCodigo(parentPath, codigos));
  const [nombre, setNombre] = useState('');
  const [loading, setLoading] = useState(false);

  // Misma validación en vivo del creador (el código es editable).
  const validacion = useMemo(() => {
    const cod = codigo.trim();
    if (!/^\d+(-\d+)*$/.test(cod)) return { ok: false as const, error: 'Formato inválido — ej. 1-1-2-4.' };
    const nat = naturalezaDeCodigo(cod);
    if (!nat) return { ok: false as const, error: 'El primer dígito debe ser una naturaleza del plan (1-6).' };
    const dup = porCodigo.get(cod);
    if (dup) return { ok: false as const, error: `El código ${cod} ya existe: "${dup.nombre}".` };
    const segs = cod.split('-');
    const pp = segs.length > 1 ? segs.slice(0, -1).join('-') : null;
    if (pp && !porCodigo.get(pp)) return { ok: false as const, error: `La cuenta padre ${pp} no existe.` };
    return { ok: true as const, naturaleza: nat, nivel: segs.length };
  }, [codigo, porCodigo]);

  const listo = validacion.ok && nombre.trim().length > 0;

  const onConfirm = async () => {
    if (!listo) return;
    setLoading(true);
    try {
      const res = await crearCuentaContableAction({ codigoPath: codigo.trim(), nombre: nombre.trim() });
      if (res.ok) {
        toast.success(res.mensaje);
        onCreada({ id: res.id, codigo: codigo.trim(), nombre: nombre.trim() });
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setLoading(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      onClick={() => { if (!loading) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(20,18,16,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw' }}
    >
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(440px, 96vw)', background: 'var(--paper)', borderRadius: 'var(--r-3)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Journal size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500 }}>{titulo ?? 'Nueva cuenta contable'}</div>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading}><I.X size={15} /></button>
        </div>

        <div style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
            Dentro de: <span className="num" style={{ fontWeight: 600 }}>{parentPath}</span>{' '}
            <span style={{ fontWeight: 500 }}>{padre?.nombre ?? ''}</span>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">Código (sugerido — siguiente libre)</label>
            <input className="input num" value={codigo} onChange={e => setCodigo(e.target.value)} disabled={loading}
              style={{ fontWeight: 600, borderColor: validacion.ok ? 'var(--olive)' : 'var(--wine)' }} />
            {!validacion.ok && <div style={{ fontSize: 11.5, color: 'var(--wine)', marginTop: 4 }}>{validacion.error}</div>}
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">Nombre de la cuenta *</label>
            <input className="input" placeholder={placeholderNombre ?? 'ej. BANCO BAM (Q)'} value={nombre}
              onChange={e => setNombre(e.target.value)} disabled={loading} autoFocus />
          </div>
          {validacion.ok && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', padding: '8px 10px', background: 'var(--olive-bg)', borderRadius: 'var(--r-1)' }}>
              Se creará <span className="num" style={{ fontWeight: 600 }}>{codigo.trim()}</span> · <b>{nombre.trim() || '[nombre]'}</b>
              {' '}— {validacion.naturaleza.nombre} ({validacion.naturaleza.esAcreedora ? 'acreedora' : 'deudora'}) · nivel {validacion.nivel}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={loading || !listo}>
            {loading ? <><I.Refresh size={13} /> Creando…</> : <><I.Check size={13} /> Crear y seleccionar</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
