'use server';

import { autorizar, exigir } from '@/lib/auth/guard';
import { revalidatePath } from 'next/cache';
import { actualizarNombresCliente, cambiarNitCliente, crearCliente, verificarNitCliente, type CambioNitResult, type CrearClienteInput, type CrearClienteResult, type NitDuplicado, type NombresClienteInput, type NombresClienteResult, type ObjetivoNit } from '@/lib/db/clientes';
import { reclasificar } from '@/lib/db/facturacion-agenda';

export async function crearClienteAction(input: CrearClienteInput): Promise<CrearClienteResult> {
  const permiso = await autorizar('emitir_factura');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const result = await crearCliente(input);
  if (result.ok) {
    revalidatePath('/clientes', 'layout');       // lista + /clientes/[id]
    revalidatePath('/facturacion/nueva');        // el picker debe verlo de inmediato
    revalidatePath('/por-facturar', 'layout');   // el buscador del mapeo lo ve de inmediato
    revalidatePath('/dashboard');
  }
  return result;
}

/** 020: nombre comercial + otros nombres / marcas de un cliente existente (mismo permiso que el alta). */
export async function editarNombresClienteAction(clienteId: string, input: NombresClienteInput): Promise<NombresClienteResult> {
  const permiso = await autorizar('emitir_factura');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const result = await actualizarNombresCliente(clienteId, input);
  if (result.ok) {
    revalidatePath('/clientes', 'layout');
    revalidatePath('/por-facturar', 'layout');
    revalidatePath('/facturacion/nueva');
  }
  return result;
}

/**
 * 023 · CAMBIAR NIT: simula el cambio (conteo por tabla, NIT compartido, choques de llave)
 * sin escribir. Mismo permiso que editar el cliente. `forzar` = el usuario ya aceptó compartir el NIT.
 */
export async function previsualizarCambioNitAction(objetivo: ObjetivoNit, nitNuevo: string, forzar = false): Promise<CambioNitResult> {
  const permiso = await autorizar('emitir_factura');
  if (!permiso.ok) return { ok: false, codigo: 'otro', error: permiso.error };
  return cambiarNitCliente(objetivo, nitNuevo, permiso.email, { simular: true, forzar });
}

/**
 * 023 · CAMBIAR NIT con arrastre (RPC transaccional) y después re-resolver la cola de la
 * Agenda del NIT nuevo (como al mapear): los expedientes toman las tarifas en el NIT nuevo.
 * Fail-soft en la re-resolución: el cambio ya quedó aplicado.
 */
export async function cambiarNitClienteAction(objetivo: ObjetivoNit, nitNuevo: string, forzar = false): Promise<CambioNitResult> {
  const permiso = await autorizar('emitir_factura');
  if (!permiso.ok) return { ok: false, codigo: 'otro', error: permiso.error };
  const r = await cambiarNitCliente(objetivo, nitNuevo, permiso.email, { forzar });
  if (!r.ok) return r;
  let reclasificados = 0;
  try { reclasificados = await reclasificar({ nit: r.nitNuevo }); } catch (e) { console.error('re-resolver tras cambiar NIT:', e); }
  revalidatePath('/clientes', 'layout');
  revalidatePath('/tarifario', 'layout');
  revalidatePath('/por-facturar', 'layout');
  revalidatePath('/facturacion/nueva');
  return { ...r, reclasificados, mensaje: reclasificados ? `${r.mensaje} ${reclasificados} expediente${reclasificados === 1 ? '' : 's'} de la Agenda re-resuelto${reclasificados === 1 ? '' : 's'}.` : r.mensaje };
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
