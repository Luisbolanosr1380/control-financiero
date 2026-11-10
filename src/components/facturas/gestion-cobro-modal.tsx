'use client';

/**
 * F-COBRANZA → CENTRO DE COBROS (033): el modal de Pendientes abre el formulario nuevo de gestión (una sola forma de
 * registrar) con los contactos de cobro del cliente y un enlace a la ficha de cobranza.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getContactosClienteAction } from '@/app/(app)/facturacion/pendientes/actions';
import { GestionForm } from '@/components/cobranza/gestion-form';
import type { ContactoCobro } from '@/lib/db/cobranza';

interface FacturaDelCliente { id: string; noFactura: string; saldo: number; diasVencidos: number }
interface Props { custId: string; cliente: string; facturas: FacturaDelCliente[]; onClose: () => void }

export function GestionCobroModal({ custId, cliente, facturas, onClose }: Props) {
  const router = useRouter();
  const [contactos, setContactos] = useState<ContactoCobro[] | null>(null);
  useEffect(() => { let vivo = true; getContactosClienteAction(custId).then(c => { if (vivo) setContactos(c); }).catch(() => { if (vivo) setContactos([]); }); return () => { vivo = false; }; }, [custId]);
  if (contactos === null) return null;
  return (
    <GestionForm clienteId={custId} clienteNombre={cliente} contactos={contactos} facturas={facturas.map(f => ({ noFactura: f.noFactura, saldo: f.saldo, diasVencidos: f.diasVencidos }))}
      onClose={onClose} onListo={msg => { onClose(); toast.success(msg); router.refresh(); }} />
  );
}
