'use client';

import { useState } from 'react';
import { I } from '@/components/common/icons';
import { DeudaFormModal } from '@/components/deudas/deuda-form-modal';
import type { Acreedor } from '@/lib/db/deudas';

interface Props {
  acreedores: Acreedor[];
  centros: Array<{ id: string; nombre: string }>;
}

export function NuevaDeudaButton({ acreedores, centros }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <I.Plus size={13} /> Nueva deuda
      </button>
      {open && (
        <DeudaFormModal
          acreedores={acreedores}
          centros={centros}
          modo="crear"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
