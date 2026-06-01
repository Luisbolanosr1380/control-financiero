'use client';

import { useState } from 'react';
import { I } from '@/components/common/icons';
import { DeudaFormModal } from '@/components/deudas/deuda-form-modal';
import type { Acreedor, Deuda } from '@/lib/db/deudas';

interface Props {
  deuda: Deuda;
  acreedores: Acreedor[];
  centros: Array<{ id: string; nombre: string }>;
  numPagos: number;
}

export function EditarDeudaButton({ deuda, acreedores, centros, numPagos }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-secondary" onClick={() => setOpen(true)} title="Editar datos de la deuda">
        <I.Edit size={13} /> Editar
      </button>
      {open && (
        <DeudaFormModal
          acreedores={acreedores}
          centros={centros}
          modo="editar"
          deudaActual={deuda}
          numPagos={numPagos}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
