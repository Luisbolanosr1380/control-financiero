'use server';

import { autorizar, exigir } from '@/lib/auth/guard';
import { revalidatePath } from 'next/cache';
import { crearCliente, verificarNitCliente, type CrearClienteInput, type CrearClienteResult, type NitDuplicado } from '@/lib/db/clientes';

export async function crearClienteAction(input: CrearClienteInput): Promise<CrearClienteResult> {
  const permiso = await autorizar('emitir_factura');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const result = await crearCliente(input);
  if (result.ok) {
    revalidatePath('/clientes', 'layout');       // lista + /clientes/[id]
    revalidatePath('/facturacion/nueva');        // el picker debe verlo de inmediato
    revalidatePath('/dashboard');
  }
  return result;
}

/**
 * F-CXC-SELECTOR: datos para el alta de cliente — las cuentas CxC
 * (hijas directas de 1-1-3, con nombre) y las empresas hermanas del
 * catálogo (para sugerir Partes Relacionadas). Reusa getCatalogos y
 * getEmpresasRelacionadas; fail-soft al default histórico.
 */
export interface DatosAltaCliente {
  cuentasCxc: Array<{ codigo: string; nombre: string }>;
  hermanas: string[];
}

export async function getDatosAltaClienteAction(): Promise<DatosAltaCliente> {
  await exigir('ver');
  try {
    const [{ getCatalogos }, { getEmpresasRelacionadas }] = await Promise.all([
      import('@/lib/db/catalogos'),
      import('@/lib/db/empresas-relacionadas'),
    ]);
    const [{ cuentas }, empresas] = await Promise.all([getCatalogos(), getEmpresasRelacionadas()]);
    const cuentasCxc = cuentas
      .filter(c => c.codigo.startsWith('1-1-3-') && c.codigo.split('-').length === 4)
      .map(c => ({ codigo: c.codigo, nombre: c.nombre.replace(/\s+/g, ' ').trim() }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
    const hermanas = empresas.filter(e => !e.esPrincipal && e.activo && e.nombre !== 'Otra').map(e => e.nombre);
    return {
      cuentasCxc: cuentasCxc.length > 0 ? cuentasCxc : [{ codigo: '1-1-3-1', nombre: 'CxC Clientes Nacionales' }],
      hermanas,
    };
  } catch {
    return { cuentasCxc: [{ codigo: '1-1-3-1', nombre: 'CxC Clientes Nacionales' }], hermanas: [] };
  }
}

/**
 * AVISO-NIT: ¿otro cliente ACTIVO ya tiene este NIT? Es solo el aviso al
 * salir del campo; el alta (crearCliente) vuelve a verificar y pide la
 * confirmación en el servidor. `excluirId` = el cliente que se edita.
 */
export async function verificarNitClienteAction(nit: string, excluirId?: string): Promise<NitDuplicado | null> {
  await exigir('ver');
  return verificarNitCliente(nit, excluirId);
}
