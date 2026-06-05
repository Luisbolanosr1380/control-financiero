'use client';

/**
 * F-047 — Botón "Generar todas las boletas pagadas" del header de planilla.
 *
 * Encadena server actions en serie (Airtable rate-limit safe) y muestra el
 * resultado consolidado en un toast. NO bloquea el resto de la UI con una
 * progress bar elaborada: por la naturaleza de server actions, el cliente
 * no recibe progreso intermedio. Si en el futuro queremos progress en vivo,
 * mover a un endpoint streaming.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { generarBoletasMasivoAction } from '@/app/(app)/planillas/boletas-actions';

interface Props {
  periodoId: string;
  cantidadPagadas: number;
}

export function BoletasBulkButton({ periodoId, cantidadPagadas }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  if (cantidadPagadas === 0) return null;

  const ejecutar = async () => {
    setLoading(true);
    setConfirmando(false);
    try {
      const res = await generarBoletasMasivoAction(periodoId);
      const msg = `${res.generadas} generadas, ${res.regeneradas} regeneradas, ${res.fallidas.length} fallidas`;
      if (res.ok) {
        toast.success(`✓ Boletas listas — ${msg}`, { duration: 6000 });
      } else {
        toast.warning(`Bulk con errores — ${msg}. Revisá las que fallaron en /planillas/[id].`, { duration: 10000 });
        for (const f of res.fallidas.slice(0, 3)) {
          toast.error(`${f.empleadoNombre ?? f.lineaId}: ${f.error}`, { duration: 8000 });
        }
      }
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red.');
    } finally { setLoading(false); }
  };

  if (confirmando) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          ¿Generar {cantidadPagadas} boleta{cantidadPagadas === 1 ? '' : 's'}? Las que ya existen se regenerarán.
        </span>
        <button className="btn btn-primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={ejecutar} disabled={loading}>
          {loading ? 'Procesando…' : 'Confirmar'}
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setConfirmando(false)} disabled={loading}>
          Cancelar
        </button>
      </span>
    );
  }

  return (
    <button
      className="btn btn-secondary"
      onClick={() => setConfirmando(true)}
      disabled={loading}
      title={`Generar boletas de las ${cantidadPagadas} líneas Pagadas del período`}
    >
      <I.Download size={13} /> Generar todas las boletas ({cantidadPagadas})
    </button>
  );
}
