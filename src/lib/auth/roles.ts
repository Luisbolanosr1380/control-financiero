/**
 * F-GESTION-USUARIOS — Roles por empresa + matriz de permisos.
 *
 * Módulo PURO (sin IO): toda decisión de "quién puede qué" pasa por acá,
 * y el guard del servidor (guard.ts) y la UI leen la MISMA matriz.
 *
 * Fuente de verdad: Clerk `publicMetadata.accesos` (compartido entre
 * deploys, viaja en la sesión):
 *
 *   { "accesos": [ { "empresa_slug": "golden", "rol": "admin" },
 *                  { "empresa_slug": "hit",    "rol": "auxiliar" } ] }
 *
 * El rol es POR EMPRESA y se evalúa contra EMPRESA_SLUG del deploy.
 *
 * Reglas de resolución (rolEnEmpresa):
 *  1. `accesos` presente → AUTORITATIVO. Sin entrada para esta empresa
 *     = sin acceso (aunque el email esté en el allowlist).
 *  2. `accesos` ausente → esquema anterior (usuarios pre-migración):
 *     metadata.empresas como guard + allowlist por email. Emails
 *     explícitos en ROLES_USUARIOS conservan su rol mapeado; los que
 *     entran solo por ALLOWED_EMAILS/ALLOWED_DOMAIN quedan en LECTURA
 *     (mínimo privilegio: un admin les asigna el rol desde la pantalla).
 */

export const ROLES = ['admin', 'contador', 'auxiliar', 'lectura'] as const;
export type Rol = (typeof ROLES)[number];

export const ROL_LABEL: Record<Rol, string> = {
  admin:    'Admin',
  contador: 'Contador',
  auxiliar: 'Auxiliar',
  lectura:  'Solo lectura',
};

export const ROL_DESCRIPCION: Record<Rol, string> = {
  admin:    'Todo, más gestión de usuarios y configuración de la empresa.',
  contador: 'Registra, aprueba, paga, anula, planilla, cierres, catálogos y reportes.',
  auxiliar: 'Registra facturas, cobros y gastos. No aprueba, no paga, no anula.',
  lectura:  'Solo ve reportes y dashboard. No registra ni edita nada.',
};

export type Accion =
  | 'ver'
  | 'emitir_factura'
  | 'registrar_cobro'
  | 'registrar_gasto'
  | 'etiquetar'
  | 'aprobar_gasto'
  | 'pagar'
  | 'anular'
  | 'planilla'
  | 'cerrar_periodo'
  | 'catalogos'
  | 'gestionar_deudas'
  | 'registrar_movimiento'
  | 'conciliar'
  | 'ceder_factura'
  | 'factoraje'
  | 'flujo'
  | 'gestionar_usuarios'
  | 'configurar_empresa';

const TODOS: readonly Rol[] = ['admin', 'contador', 'auxiliar', 'lectura'];
const REGISTRAN: readonly Rol[] = ['admin', 'contador', 'auxiliar'];
const CONTROL: readonly Rol[] = ['admin', 'contador'];   // aprobar / pagar / anular: separación de funciones
const SOLO_ADMIN: readonly Rol[] = ['admin'];

/** Matriz confirmada (brief F-GESTION-USUARIOS). */
export const MATRIZ: Record<Accion, readonly Rol[]> = {
  ver:                TODOS,
  emitir_factura:     REGISTRAN,
  registrar_cobro:    REGISTRAN,
  registrar_gasto:    REGISTRAN,
  etiquetar:          REGISTRAN,   // metadata sin efecto contable sobre lo que se registra
  aprobar_gasto:      CONTROL,
  pagar:              CONTROL,
  anular:             CONTROL,
  planilla:           CONTROL,
  cerrar_periodo:     CONTROL,
  catalogos:          CONTROL,
  gestionar_deudas:   CONTROL,     // pasivos/préstamos: no es "meter gastos"
  registrar_movimiento: REGISTRAN, // cargar movimientos del banco (manual / estado de cuenta)
  conciliar:          CONTROL,     // conciliar / deshacer / contabilizar movimiento: separación de funciones
  ceder_factura:      REGISTRAN,   // registrar la cesión de facturas a un factoraje (tracking)
  factoraje:          CONTROL,     // crear factoraje, liberar/recomprar/pagar cesiones, contabilizar
  flujo:              CONTROL,     // ver flujo de caja proyectado (posición de caja y compromisos)
  gestionar_usuarios: SOLO_ADMIN,
  configurar_empresa: SOLO_ADMIN,
};

export const ACCION_LABEL: Record<Accion, string> = {
  ver:                'ver reportes',
  emitir_factura:     'emitir facturas',
  registrar_cobro:    'registrar cobros',
  registrar_gasto:    'registrar gastos',
  etiquetar:          'etiquetar documentos',
  aprobar_gasto:      'aprobar gastos',
  pagar:              'hacer pagos',
  anular:             'anular',
  planilla:           'procesar planilla',
  cerrar_periodo:     'cerrar períodos y asientos',
  catalogos:          'crear o editar catálogos',
  gestionar_deudas:   'gestionar deudas',
  registrar_movimiento: 'cargar movimientos bancarios',
  conciliar:          'conciliar movimientos bancarios',
  ceder_factura:      'ceder facturas a factoraje',
  factoraje:          'gestionar factorajes',
  flujo:              'ver el flujo de caja proyectado',
  gestionar_usuarios: 'gestionar usuarios',
  configurar_empresa: 'configurar la empresa',
};

export function puede(rol: Rol | null | undefined, accion: Accion): boolean {
  if (!rol) return false;
  return MATRIZ[accion].includes(rol);
}

export function esRol(v: unknown): v is Rol {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

/* ============================================================
 * Metadata `accesos`
 * ============================================================ */

export interface Acceso {
  empresa_slug: string;
  rol: Rol;
}

/**
 * - null  → el metadata NO define accesos (usuario pre-migración).
 * - []    → define accesos y es vacío: sin acceso a ninguna empresa.
 * - [...] → accesos válidos (entradas inválidas o duplicadas se descartan;
 *           un rol desconocido NO se interpreta — fail-closed).
 */
export function accesosDeMetadata(meta: unknown): Acceso[] | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = (meta as { accesos?: unknown }).accesos;
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return [];   // accesos malformado = sin acceso (nunca adivinar permisos)
  const out: Acceso[] = [];
  const vistos = new Set<string>();
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const slug = String((e as { empresa_slug?: unknown }).empresa_slug ?? '').trim().toLowerCase();
    const rol = (e as { rol?: unknown }).rol;
    if (!slug || !esRol(rol) || vistos.has(slug)) continue;
    vistos.add(slug);
    out.push({ empresa_slug: slug, rol });
  }
  return out;
}

/* ============================================================
 * Esquema legacy (pre-migración)
 * ============================================================ */

export type RolLegacy = 'admin' | 'gerencia' | 'operativo';

/**
 * Mapeo de roles viejos para emails explícitos en código. gerencia y
 * operativo podían registrar, aprobar y pagar → contador (no se les
 * quita nada que ya hacían).
 */
export function mapearRolLegacy(r: RolLegacy): Rol {
  return r === 'admin' ? 'admin' : 'contador';
}

export interface ConfigLegacy {
  rolesExplicitos: Record<string, RolLegacy>;
  allowedEmails: string[];
  allowedDomain: string;   // '' = sin dominio
}

/** Slugs del viejo publicMetadata.empresas (null si no lo define). */
function slugsLegacy(meta: unknown): string[] | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = (meta as { empresas?: unknown }).empresas;
  if (!Array.isArray(raw)) return null;
  return raw
    .map(e => (e && typeof e === 'object' ? String((e as { slug?: unknown }).slug ?? '').trim().toLowerCase() : ''))
    .filter(Boolean);
}

/* ============================================================
 * Resolución final
 * ============================================================ */

export function rolEnEmpresa(args: {
  meta: unknown;
  email: string | null | undefined;
  slugDeploy: string;
  legacy: ConfigLegacy;
}): Rol | null {
  const slug = args.slugDeploy.trim().toLowerCase();
  const accesos = accesosDeMetadata(args.meta);
  if (accesos !== null) {
    return accesos.find(a => a.empresa_slug === slug)?.rol ?? null;
  }

  const email = (args.email ?? '').trim().toLowerCase();
  if (!email) return null;
  const empresas = slugsLegacy(args.meta);
  if (empresas !== null && !empresas.includes(slug)) return null;

  const explicito = args.legacy.rolesExplicitos[email];
  if (explicito) return mapearRolLegacy(explicito);

  if (args.legacy.allowedEmails.includes(email)) return 'lectura';
  const dom = args.legacy.allowedDomain.trim().toLowerCase();
  if (dom) {
    const d = dom.startsWith('@') ? dom : '@' + dom;
    if (email.endsWith(d)) return 'lectura';
  }
  return null;
}

/** Slugs de empresas a las que el usuario tiene acceso (para el selector). null = esquema legacy sin empresas. */
export function slugsConAcceso(meta: unknown): string[] | null {
  const accesos = accesosDeMetadata(meta);
  if (accesos !== null) return accesos.map(a => a.empresa_slug);
  return slugsLegacy(meta);
}

/* ============================================================
 * Reglas de la gestión de usuarios (anti-escalada)
 * ============================================================ */

/**
 * Un admin solo puede otorgar, cambiar o quitar accesos de empresas
 * donde ÉL es admin. Devuelve el nuevo set de accesos del usuario
 * destino, o un error si el cambio toca empresas fuera de su alcance.
 */
export function aplicarCambioAccesos(args: {
  accesosActor: Acceso[];
  accesosDestinoActuales: Acceso[];
  accesosDestinoNuevos: Acceso[];
}): { ok: true; accesos: Acceso[] } | { ok: false; error: string } {
  const adminDe = new Set(args.accesosActor.filter(a => a.rol === 'admin').map(a => a.empresa_slug));
  const actual = new Map(args.accesosDestinoActuales.map(a => [a.empresa_slug, a.rol]));
  const nuevo = new Map<string, Rol>();
  for (const a of args.accesosDestinoNuevos) {
    if (!esRol(a.rol)) return { ok: false, error: `Rol inválido: ${String(a.rol)}` };
    nuevo.set(a.empresa_slug.trim().toLowerCase(), a.rol);
  }
  const tocadas = new Set<string>();
  for (const [slug, rol] of nuevo) if (actual.get(slug) !== rol) tocadas.add(slug);
  for (const slug of actual.keys()) if (!nuevo.has(slug)) tocadas.add(slug);
  const fuera = [...tocadas].filter(s => !adminDe.has(s));
  if (fuera.length) {
    return { ok: false, error: `No sos admin de: ${fuera.join(', ')}. Solo podés asignar o quitar accesos en empresas donde sos admin.` };
  }
  return { ok: true, accesos: [...nuevo].map(([empresa_slug, rol]) => ({ empresa_slug, rol })).sort((a, b) => a.empresa_slug.localeCompare(b.empresa_slug)) };
}

/**
 * Empresas que se quedarían SIN ningún admin activo si al usuario
 * `destinoId` se le aplican `nuevosAccesos` (null = se lo bloquea).
 * Solo cuentan usuarios reales no bloqueados (no invitaciones).
 */
export function empresasSinAdmin(args: {
  usuarios: Array<{ id: string; activo: boolean; accesos: Acceso[] }>;
  destinoId: string;
  nuevosAccesos: Acceso[] | null;
}): string[] {
  const antes = new Set<string>();
  const despues = new Map<string, number>();
  for (const u of args.usuarios) {
    if (!u.activo) continue;
    for (const a of u.accesos) if (a.rol === 'admin') antes.add(a.empresa_slug);
    const acc = u.id === args.destinoId ? (args.nuevosAccesos ?? []) : u.accesos;
    for (const a of acc) if (a.rol === 'admin') despues.set(a.empresa_slug, (despues.get(a.empresa_slug) ?? 0) + 1);
  }
  return [...antes].filter(s => !despues.get(s));
}

/* ============================================================
 * Decisión del guard (pura — guard.ts la usa tal cual)
 * ============================================================ */

export interface UsuarioSesion {
  id: string;
  banned: boolean;
  email: string;
  meta: unknown;
}

export type Decision = { ok: true; rol: Rol } | { ok: false; error: string };

export function decidirAcceso(args: {
  usuario: UsuarioSesion | null;
  accion: Accion;
  slugDeploy: string;
  nombreEmpresa: string;
  legacy: ConfigLegacy;
}): Decision {
  const u = args.usuario;
  if (!u) return { ok: false, error: 'Tu sesión expiró. Volvé a iniciar sesión.' };
  if (u.banned) return { ok: false, error: 'Tu usuario está bloqueado.' };
  const rol = rolEnEmpresa({ meta: u.meta, email: u.email, slugDeploy: args.slugDeploy, legacy: args.legacy });
  if (!rol) return { ok: false, error: `No tenés acceso a ${args.nombreEmpresa}.` };
  if (!puede(rol, args.accion)) {
    return {
      ok: false,
      error: `Tu rol (${ROL_LABEL[rol]}) no permite ${ACCION_LABEL[args.accion]} en ${args.nombreEmpresa}. Pedíselo a un contador o admin.`,
    };
  }
  return { ok: true, rol };
}
