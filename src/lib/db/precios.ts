/**
 * MAPA DE PRECIOS (027) · loader de SOLO LECTURA, SOLO ADMIN.
 *
 * Seguridad en el servidor, en tres capas: (1) la página redirige a /no-acceso si el rol no es admin;
 * (2) este loader vuelve a exigir `ver_mapa_precios` (permitida solo a admin en la matriz de roles.ts) y
 * lanza si no; (3) la RPC `precios_mapa` solo la puede ejecutar service_role (la llave pública del
 * navegador recibe "permission denied"). Nada de esto se expone en /api ni en una server action.
 */
import 'server-only';
import { exigir, PermisoDenegadoError } from '@/lib/auth/guard';
import { supabase } from '@/lib/supabase/client';
import { parseMapa, type FiltrosMapa, type MapaPrecios } from '@/lib/precios/mapa';

const rpcNoExiste = (e: { code?: string; message: string }) => e.code === 'PGRST202' || /could not find the function|function .* does not exist/i.test(e.message);

/** El mapa completo para el rango y los umbrales dados. null si falta la migración 027 (la página avisa). */
export async function getMapaPrecios(f: FiltrosMapa): Promise<MapaPrecios | null> {
  const { rol } = await exigir('ver_mapa_precios');
  if (rol !== 'admin') throw new PermisoDenegadoError('El mapa de precios es solo para admin.');
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc('precios_mapa', { p_desde: f.desde, p_hasta: f.hasta, p_umbral_vol: f.umbralVol, p_umbral_idx: f.umbralIdx });
  if (error) { if (rpcNoExiste(error)) return null; throw new Error(`precios_mapa: ${error.message}`); }
  return parseMapa(data);
}
