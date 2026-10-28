'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { reintentarWritebackAction } from '@/app/(app)/por-facturar/actions';

/** Reintenta el write-back de una factura a la Agenda (re-lee, concilia y vuelve a postear). Sin loop: un click = un intento. */
export function ReintentarWritebackButton({ noFactura, compacto = false }: { noFactura: string; compacto?: boolean }) {
  const router = useRouter();
  const puede = usePuede();
  const [busy, setBusy] = useState(false);
  if (!puede('facturar_agenda')) return null;
  const reintentar = async () => {
    setBusy(true);
    try {
      const r = await reintentarWritebackAction(noFactura);
      if (r.estado === 'confirmado') toast.success(r.detalle); else if (r.estado === 'conflicto') toast.warning(r.detalle); else toast.error(r.detalle);
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <button className={'btn ' + (compacto ? 'btn-ghost' : 'btn-secondary')} style={compacto ? { fontSize: 11, padding: '2px 8px' } : undefined} onClick={() => void reintentar()} disabled={busy} aria-label={`Reintentar envío a la Agenda de ${noFactura}`}>
      <I.Refresh size={12} /> {busy ? 'Enviando…' : 'Reintentar envío a Agenda'}
    </button>
  );
}
