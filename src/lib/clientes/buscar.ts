/**
 * BÚSQUEDA DE CLIENTES — lógica PURA (sin IO). La usan la lista de Clientes,
 * el buscador del panel de mapeo (Por facturar → Mapear, individual y en lote)
 * y la auto-sugerencia de mapeo de la Agenda.
 *
 * Un cliente se encuentra por CUALQUIERA de sus nombres: nombre de la empresa,
 * razón social, nombre comercial, otros nombres / marcas (aliases, 020) y los
 * nombres con los que aparece en la Agenda (empresas ya mapeadas a su NIT).
 * También por NIT. Sin tildes ni mayúsculas en los dos lados: "cuscatlán",
 * "cuscatlan" y "CUSCATLAN" dan lo mismo.
 *
 * La razón social sigue siendo la que va en la factura: esto solo cambia cómo
 * se lo UBICA, no cómo se lo factura.
 */

/** Sin tildes, minúsculas, puntuación → espacio, espacios colapsados. */
export function normalizarBusqueda(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[.,;:'"()/\\\-_&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Solo dígitos y letras (NIT "1234567-8" ≡ "12345678"). */
const nitPlano = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[^0-9a-z]/g, '');

/** Lo mínimo que necesita el buscador de un cliente. */
export interface ClienteBuscable {
  id: string;
  /** Nombre de la empresa (el que se muestra). */
  name: string;
  nit?: string | null;
  razonSocial?: string | null;
  nombreComercial?: string | null;
  aliases?: readonly string[] | null;
  /** Nombres con los que aparece en la Agenda (empresas mapeadas a este cliente). */
  nombresAgenda?: readonly string[] | null;
}

/** Todos los nombres por los que se puede encontrar al cliente (sin repetir, sin vacíos). */
export function nombresDe(c: ClienteBuscable): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const n of [c.name, c.razonSocial, c.nombreComercial, ...(c.aliases ?? []), ...(c.nombresAgenda ?? [])]) {
    const t = String(n ?? '').replace(/\s+/g, ' ').trim();
    const k = normalizarBusqueda(t);
    if (!t || !k || vistos.has(k)) continue;
    vistos.add(k); out.push(t);
  }
  return out;
}

/** Nombres normalizados (precalculables para listas grandes). */
export function terminosDe(c: ClienteBuscable): string[] {
  return nombresDe(c).map(normalizarBusqueda);
}

/**
 * Puntaje de coincidencia (0 = no coincide). Todas las palabras de la consulta
 * tienen que aparecer en alguno de los nombres (o la consulta en el NIT).
 * Más alto = más relevante: igual exacto > empieza con > contiene; y el nombre
 * principal pesa más que un alias.
 */
export function puntajeCliente(c: ClienteBuscable, consulta: string, terminos?: readonly string[]): number {
  const q = normalizarBusqueda(consulta);
  if (!q) return 1;
  const ts = terminos ?? terminosDe(c);
  const qNit = nitPlano(consulta);
  const nit = nitPlano(c.nit);
  if (qNit.length >= 3 && nit && nit.includes(qNit)) return nit === qNit ? 100 : 60;
  const palabras = q.split(' ');
  let mejor = 0;
  ts.forEach((t, i) => {
    if (!t) return;
    const pesoPrincipal = i === 0 ? 5 : 0;   // el primero es el nombre de la empresa
    if (t === q) { mejor = Math.max(mejor, 90 + pesoPrincipal); return; }
    if (t.startsWith(q)) { mejor = Math.max(mejor, 70 + pesoPrincipal); return; }
    if (t.includes(q)) { mejor = Math.max(mejor, 50 + pesoPrincipal); return; }
  });
  if (mejor) return mejor;
  // Palabras sueltas: cada una tiene que estar en ALGÚN nombre ("banco cuscatlan" → nombre de la Agenda "BANCO CUSCATLAN" o nombre "CUSCATLAN TCU" + alias "banco").
  const todo = ts.join(' | ');
  const hits = palabras.filter(p => todo.includes(p)).length;
  return hits === palabras.length ? 30 : 0;
}

export interface OpcionesBusqueda {
  /** Máximo de resultados (por defecto, todos). */
  limite?: number;
  /** Términos precalculados por id (para no normalizar en cada tecla). */
  terminos?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Filtra y ordena por relevancia. Con consulta vacía devuelve la lista completa
 * ordenada por nombre. NUNCA corta por defecto: el tope de 60 del panel viejo
 * escondía clientes.
 */
export function buscarClientes<T extends ClienteBuscable>(clientes: readonly T[], consulta: string, opts: OpcionesBusqueda = {}): T[] {
  const q = normalizarBusqueda(consulta);
  const ordenNombre = (a: T, b: T) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  let out: T[];
  if (!q) out = [...clientes].sort(ordenNombre);
  else {
    const con = clientes.map(c => ({ c, p: puntajeCliente(c, consulta, opts.terminos?.get(c.id)) })).filter(x => x.p > 0);
    con.sort((a, b) => b.p - a.p || ordenNombre(a.c, b.c));
    out = con.map(x => x.c);
  }
  return opts.limite && opts.limite > 0 ? out.slice(0, opts.limite) : out;
}

/** ¿Coincide la consulta con el cliente? (atajo para filtros en listas). */
export function coincideCliente(c: ClienteBuscable, consulta: string, terminos?: readonly string[]): boolean {
  return puntajeCliente(c, consulta, terminos) > 0;
}

/** Por qué nombre se encontró (para mostrar "marca Calzado Chicote" junto al cliente), o '' si fue por el principal / NIT. */
export function nombreQueCoincide(c: ClienteBuscable, consulta: string): string {
  const q = normalizarBusqueda(consulta);
  if (!q) return '';
  const nombres = nombresDe(c);
  if (normalizarBusqueda(nombres[0] ?? '').includes(q)) return '';
  return nombres.slice(1).find(n => normalizarBusqueda(n).includes(q)) ?? '';
}

/** Lista limpia de aliases: sin vacíos, sin repetidos (sin tildes/mayúsculas), recortados a 80. */
export function limpiarAliases(aliases: readonly (string | null | undefined)[] | null | undefined, excluir: readonly (string | null | undefined)[] = []): string[] {
  const fuera = new Set(excluir.map(normalizarBusqueda).filter(Boolean));
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const a of aliases ?? []) {
    const t = String(a ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const k = normalizarBusqueda(t);
    if (!t || !k || vistos.has(k) || fuera.has(k)) continue;
    vistos.add(k); out.push(t);
  }
  return out.slice(0, 20);
}
