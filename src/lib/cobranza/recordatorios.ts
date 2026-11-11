/**
 * CENTRO DE COBROS · PR 2 (035) · recordatorios propuestos y estado de cuenta — reglas PURAS, sin IO.
 *
 * El sistema PROPONE borradores de recordatorio según reglas que viven en una tabla (cobranza_regla_recordatorio) y
 * plantillas editables (cobranza_plantilla); la persona revisa y presiona «Enviar». Nada sale solo. Acá vive:
 *  - el catálogo de reglas y de variables de plantilla, y el render de una plantilla ({{cliente}}, {{saldo}}…);
 *  - `proponerRecordatorios`: a partir de la cartera abierta de cada cliente (saldo REAL = total − cobros − NC, como el
 *    #51), sus promesas, su última gestión, los correos ya enviados y las omisiones, arma los borradores de hoy:
 *      por_vencer           → la factura vence en N días o menos y no recibió este recordatorio;
 *      vencida              → vencida hace N días o más; se repite cada `cadaDias` mientras siga vencida;
 *      promesa_incumplida   → la fecha prometida pasó hace N días o más sin cobro;
 *      confirmacion_promesa → la promesa vence en N días o menos (se confirma antes).
 *    Un borrador queda BLOQUEADO (se avisa; se manda solo con motivo) si el cliente tiene una disputa abierta (la última
 *    gestión que cubre esas facturas fue «disputa») o una promesa de pago vigente (salvo la confirmación, que es para eso).
 *  - el estado de cuenta del cliente: facturas abiertas con antigüedad, saldo real, totales por tramo y, si tiene,
 *    los paquetes prepagados con su remanente (034). Una prueba cubierta por un paquete nunca es factura: no entra.
 */
import { diasEntre, sumarDias, type EstadoPromesa, type ResultadoGestion } from './estado';

/* ───────────── reglas ───────────── */

export const REGLAS_RECORDATORIO = ['por_vencer', 'vencida', 'promesa_incumplida', 'confirmacion_promesa'] as const;
export type ReglaClave = (typeof REGLAS_RECORDATORIO)[number];
export const esRegla = (v: unknown): v is ReglaClave => (REGLAS_RECORDATORIO as readonly string[]).includes(String(v));
export const ETIQUETA_REGLA: Record<ReglaClave, string> = { por_vencer: 'Por vencer', vencida: 'Vencida', promesa_incumplida: 'Promesa incumplida', confirmacion_promesa: 'Confirmación de promesa' };
/** Qué significan los días de cada regla (para la pantalla de reglas). */
export const EXPLICACION_DIAS: Record<ReglaClave, (dias: number, cada: number | null) => string> = {
  por_vencer: d => `se propone cuando la factura vence en ${d} día${d === 1 ? '' : 's'} o menos`,
  vencida: (d, c) => `se propone desde el día ${d} de vencida${c ? ` y se repite cada ${c} días mientras siga vencida` : ' (una sola vez)'}`,
  promesa_incumplida: d => `se propone ${d === 0 ? 'el mismo día' : `${d} día${d === 1 ? '' : 's'} después`} de la fecha prometida sin cobro`,
  confirmacion_promesa: d => `se propone cuando faltan ${d} día${d === 1 ? '' : 's'} o menos para la fecha prometida`,
};
/** Orden de trabajo: lo que ya falló primero, después lo que vence. */
export const ORDEN_REGLA: ReglaClave[] = ['promesa_incumplida', 'vencida', 'confirmacion_promesa', 'por_vencer'];
export const BADGE_REGLA: Record<ReglaClave, string> = { promesa_incumplida: 'badge-wine', vencida: 'badge-wine', confirmacion_promesa: 'badge-warn', por_vencer: 'badge-olive' };

export interface ReglaRecordatorio { clave: ReglaClave; nombre: string; descripcion: string; activo: boolean; dias: number; cadaDias: number | null; plantillaClave: string }
/** Las de la 035 (si la tabla no está, la app las usa para mostrar, pero no propone nada: sin la 035 no hay recordatorios). */
export const REGLAS_POR_DEFECTO: ReglaRecordatorio[] = [
  { clave: 'por_vencer', nombre: 'Por vencer', descripcion: 'Factura que vence en N días o menos y todavía no recibió este recordatorio.', activo: true, dias: 3, cadaDias: null, plantillaClave: 'por_vencer' },
  { clave: 'vencida', nombre: 'Vencida', descripcion: 'Factura vencida hace N días o más; se vuelve a proponer cada «cada_dias» días mientras siga vencida.', activo: true, dias: 1, cadaDias: 7, plantillaClave: 'vencida' },
  { clave: 'promesa_incumplida', nombre: 'Promesa incumplida', descripcion: 'Promesa de pago cuya fecha pasó hace N días o más sin que entrara el cobro.', activo: true, dias: 1, cadaDias: null, plantillaClave: 'promesa_incumplida' },
  { clave: 'confirmacion_promesa', nombre: 'Confirmación de promesa', descripcion: 'Promesa de pago que vence en N días o menos: se confirma antes.', activo: true, dias: 1, cadaDias: null, plantillaClave: 'confirmacion_promesa' },
];
export function validarRegla(input: { activo?: unknown; dias?: unknown; cadaDias?: unknown }): { ok: true; regla: { activo: boolean; dias: number; cadaDias: number | null } } | { ok: false; error: string } {
  const dias = Number(input.dias);
  if (!Number.isInteger(dias) || dias < 0 || dias > 365) return { ok: false, error: 'Los días tienen que ser un entero entre 0 y 365.' };
  const cadaRaw = input.cadaDias === null || input.cadaDias === undefined || input.cadaDias === '' ? null : Number(input.cadaDias);
  if (cadaRaw !== null && (!Number.isInteger(cadaRaw) || cadaRaw < 1 || cadaRaw > 365)) return { ok: false, error: '«Cada N días» tiene que ser un entero entre 1 y 365, o vacío para una sola vez.' };
  return { ok: true, regla: { activo: input.activo !== false, dias, cadaDias: cadaRaw } };
}

/* ───────────── plantillas ───────────── */

export const PLANTILLAS_CLAVES = ['por_vencer', 'vencida', 'promesa_incumplida', 'confirmacion_promesa', 'estado_cuenta', 'datos_pago'] as const;
export type PlantillaClave = (typeof PLANTILLAS_CLAVES)[number];
export const esPlantillaClave = (v: unknown): v is PlantillaClave => (PLANTILLAS_CLAVES as readonly string[]).includes(String(v));
export interface Plantilla { clave: PlantillaClave; nombre: string; descripcion: string; asunto: string; cuerpo: string; activo: boolean; updatedAt: string | null; updatedPor: string }

export const VARIABLES_PLANTILLA: ReadonlyArray<{ clave: string; descripcion: string }> = [
  { clave: 'cliente', descripcion: 'nombre del cliente' }, { clave: 'contacto', descripcion: 'nombre del destinatario (o «Estimados» si no hay)' },
  { clave: 'facturas', descripcion: 'números de factura del recordatorio' }, { clave: 'saldo', descripcion: 'saldo de esas facturas (Q)' },
  { clave: 'fecha_vencimiento', descripcion: 'vencimiento de la factura (la más próxima si son varias)' }, { clave: 'dias_vencida', descripcion: 'días desde el vencimiento (la más vieja)' },
  { clave: 'fecha_promesa', descripcion: 'fecha prometida' }, { clave: 'monto_promesa', descripcion: 'monto prometido (o el saldo si no lo dieron)' },
  { clave: 'fecha', descripcion: 'fecha de hoy' }, { clave: 'emisor', descripcion: 'nombre de la empresa' }, { clave: 'nit_emisor', descripcion: 'NIT de la empresa' }, { clave: 'remitente', descripcion: 'quien envía' },
  { clave: 'estado_cuenta', descripcion: 'la tabla del estado de cuenta (se arma al enviar)' }, { clave: 'datos_pago', descripcion: 'el bloque «Datos para pagar»' },
];
const VARS = new Set(VARIABLES_PLANTILLA.map(v => v.clave));
const RE_VAR = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Variables que la plantilla usa y no existen (para rechazar al guardar). */
export function variablesDesconocidas(texto: string): string[] {
  const out = new Set<string>();
  for (const m of String(texto ?? '').matchAll(RE_VAR)) if (!VARS.has(m[1])) out.add(m[1]);
  return [...out];
}
/** Reemplaza {{var}} por su valor; las que no vienen en `vars` quedan como están (p. ej. {{estado_cuenta}} hasta el envío). */
export function renderPlantilla(texto: string, vars: Record<string, string | undefined>): string {
  return String(texto ?? '').replace(RE_VAR, (m, k: string) => (vars[k] === undefined ? m : vars[k]!));
}
export function validarPlantilla(clave: string, input: { asunto?: unknown; cuerpo?: unknown; nombre?: unknown }): { ok: true; plantilla: { asunto: string; cuerpo: string; nombre: string | null } } | { ok: false; error: string } {
  if (!esPlantillaClave(clave)) return { ok: false, error: 'La plantilla no existe.' };
  const asunto = String(input.asunto ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const cuerpo = String(input.cuerpo ?? '').replace(/\r\n/g, '\n').trim().slice(0, 6000);
  const nombre = input.nombre === undefined ? null : String(input.nombre).trim().slice(0, 120);
  if (clave !== 'datos_pago' && asunto.length < 3) return { ok: false, error: 'El asunto es obligatorio.' };
  if (cuerpo.length < 3) return { ok: false, error: 'El cuerpo es obligatorio.' };
  const raras = [...new Set([...variablesDesconocidas(asunto), ...variablesDesconocidas(cuerpo)])];
  if (raras.length) return { ok: false, error: `Variables que no existen: ${raras.map(r => `{{${r}}}`).join(', ')}. Las válidas: ${VARIABLES_PLANTILLA.map(v => v.clave).join(', ')}.` };
  if (/<\s*(script|iframe|img|link|style)\b/i.test(asunto + cuerpo)) return { ok: false, error: 'La plantilla es texto: no lleva etiquetas HTML.' };
  if (nombre !== null && nombre.length < 2) return { ok: false, error: 'El nombre es muy corto.' };
  return { ok: true, plantilla: { asunto, cuerpo, nombre } };
}

/* ───────────── entradas ───────────── */

export interface FacturaRecordatorio { noFactura: string; facturaId: string; saldo: number; total: number; cobrado: number; ncs: number; fechaEmision: string; fechaVencimiento: string; diasVencida: number; cedida: boolean }
export interface ContactoRecordatorio { id: string; nombre: string; rol: string; correo: string; preferido: boolean }
export interface PromesaRecordatorio { id: string; fecha: string; monto: number | null; estado: EstadoPromesa; facturas: string[] }
export interface GestionRecordatorio { fecha: string; resultado: ResultadoGestion; facturas: string[] }
/** Un correo ya enviado desde la app (evento correo_enviado con datos.tipo = 'recordatorio' | 'estado_cuenta'). */
export interface EnvioPrevio { regla: ReglaClave | 'estado_cuenta'; facturas: string[]; fecha: string; promesaId: string | null; resultado: 'enviado' | 'error' }
export interface OmisionRecordatorio { regla: ReglaClave; hasta: string; motivo: string }
export interface ClienteRecordatorio {
  clienteId: string; clienteUuid: string; nombre: string; nit: string; responsable: string | null;
  contactos: ContactoRecordatorio[]; facturas: FacturaRecordatorio[]; promesas: PromesaRecordatorio[]; gestiones: GestionRecordatorio[]; enviados: EnvioPrevio[]; omisiones: OmisionRecordatorio[];
}

/* ───────────── borradores ───────────── */

export type TipoBloqueo = 'disputa' | 'promesa_vigente';
export interface Bloqueo { tipo: TipoBloqueo; detalle: string }
export const ETIQUETA_BLOQUEO: Record<TipoBloqueo, string> = { disputa: 'Disputa abierta', promesa_vigente: 'Promesa de pago vigente' };
export interface Borrador {
  /** estable entre cargas: regla + cliente + (promesa | facturas) */ id: string;
  regla: ReglaClave; clienteId: string; clienteUuid: string; clienteNombre: string; nit: string;
  facturas: string[]; monto: number; motivo: string; fechaClave: string | null;
  promesa: { id: string; fecha: string; monto: number | null } | null;
  destinatario: ContactoRecordatorio | null; destinatariosPosibles: ContactoRecordatorio[]; cc: string[];
  bloqueo: Bloqueo | null;
  /** si está omitido hasta una fecha (la pantalla lo esconde por defecto) */ omitidoHasta: string | null;
  /** variables ya resueltas para la plantilla (menos estado_cuenta / datos_pago, que se arman al enviar) */ vars: Record<string, string>;
}

const fmtQ = (n: number) => `Q${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fechaLarga = (iso: string): string => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(d)} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(m) - 1]} de ${y}`; };
const fechaCorta = (iso: string, hoy: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(d)}-${MESES[Number(m) - 1]}${y !== hoy.slice(0, 4) ? '-' + y : ''}`; };
const hace = (n: number) => `hace ${n} día${n === 1 ? '' : 's'}`;
const cubre = (facturas: string[], nf: string) => facturas.length === 0 || facturas.includes(nf);
const cubreAlguna = (facturas: string[], nfs: string[]) => facturas.length === 0 || nfs.some(nf => facturas.includes(nf));
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Destinatario propuesto: el preferido con correo → el de rol pagos con correo → el primero con correo. */
export function destinatarioPropuesto(contactos: ContactoRecordatorio[]): { destinatario: ContactoRecordatorio | null; posibles: ContactoRecordatorio[] } {
  const posibles = contactos.filter(c => CORREO.test(c.correo));
  return { destinatario: posibles.find(c => c.preferido) ?? posibles.find(c => c.rol === 'pagos') ?? posibles[0] ?? null, posibles };
}

/** Bloqueos: disputa abierta (la última gestión que cubre esas facturas fue «disputa») y promesa vigente (pendiente, fecha ≥ hoy). */
export function bloqueoDe(c: Pick<ClienteRecordatorio, 'gestiones' | 'promesas'>, facturas: string[], regla: ReglaClave, hoy: string): Bloqueo | null {
  const g = [...c.gestiones].filter(x => cubreAlguna(x.facturas, facturas)).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  if (g?.resultado === 'disputa') return { tipo: 'disputa', detalle: `La última gestión (${fechaCorta(g.fecha, hoy)}) quedó en disputa / reclamo.` };
  if (regla !== 'confirmacion_promesa') {
    const p = c.promesas.filter(x => x.estado === 'pendiente' && x.fecha >= hoy && cubreAlguna(x.facturas, facturas)).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
    if (p) return { tipo: 'promesa_vigente', detalle: `El cliente prometió pagar${p.monto ? ` ${fmtQ(p.monto)}` : ''} el ${fechaCorta(p.fecha, hoy)}.` };
  }
  return null;
}

/** Arma los borradores de hoy para todos los clientes (puro). Las facturas cedidas a factoraje y sin saldo no cuentan. */
export function proponerRecordatorios(clientes: ClienteRecordatorio[], reglas: ReglaRecordatorio[], hoy: string, emisor: { nombre: string; nit: string }, remitente: string): Borrador[] {
  const R = Object.fromEntries(reglas.map(r => [r.clave, r])) as Record<ReglaClave, ReglaRecordatorio | undefined>;
  const out: Borrador[] = [];
  for (const c of clientes) {
    const abiertas = c.facturas.filter(f => !f.cedida && f.saldo > 0.005 && /^\d{4}-\d{2}-\d{2}$/.test(f.fechaVencimiento));
    if (!abiertas.length && !c.promesas.length) continue;
    const enviadosOk = c.enviados.filter(e => e.resultado === 'enviado');
    const { destinatario, posibles } = destinatarioPropuesto(c.contactos);
    const cc = c.responsable && CORREO.test(c.responsable) ? [c.responsable.toLowerCase()] : [];
    const omision = (regla: ReglaClave) => c.omisiones.filter(o => o.regla === regla && o.hasta >= hoy).sort((a, b) => b.hasta.localeCompare(a.hasta))[0]?.hasta ?? null;
    const base = (regla: ReglaClave, facturas: string[], monto: number, motivo: string, fechaClave: string | null, promesa: Borrador['promesa'], varsExtra: Record<string, string>): Borrador => {
      const fs = abiertas.filter(f => facturas.includes(f.noFactura));
      const vence = fs.map(f => f.fechaVencimiento).sort()[0] ?? '';
      const maxDv = Math.max(0, ...fs.map(f => f.diasVencida));
      return {
        id: `${regla}:${c.clienteId}:${promesa ? promesa.id : facturas.join('+')}`, regla, clienteId: c.clienteId, clienteUuid: c.clienteUuid, clienteNombre: c.nombre, nit: c.nit,
        facturas, monto: Math.round(monto * 100) / 100, motivo, fechaClave, promesa, destinatario, destinatariosPosibles: posibles, cc,
        bloqueo: bloqueoDe(c, facturas, regla, hoy), omitidoHasta: omision(regla),
        vars: { cliente: c.nombre, contacto: destinatario?.nombre ?? 'Estimados', facturas: facturas.join(', '), saldo: fmtQ(monto), fecha_vencimiento: vence ? fechaLarga(vence) : '—', dias_vencida: String(maxDv), fecha: fechaLarga(hoy), emisor: emisor.nombre, nit_emisor: emisor.nit, remitente, fecha_promesa: '—', monto_promesa: fmtQ(monto), ...varsExtra },
      };
    };
    // por vencer: vence en ≤ N días (y todavía no venció) y ninguna de ellas recibió este recordatorio
    const rPV = R.por_vencer;
    if (rPV?.activo) {
      const fs = abiertas.filter(f => { const faltan = -f.diasVencida; return faltan >= 0 && faltan <= rPV.dias && !enviadosOk.some(e => e.regla === 'por_vencer' && e.facturas.includes(f.noFactura)); });
      if (fs.length) { const prox = [...fs].sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento))[0]; const faltan = -prox.diasVencida; out.push(base('por_vencer', fs.map(f => f.noFactura), fs.reduce((s, f) => s + f.saldo, 0), fs.length === 1 ? `Vence ${faltan === 0 ? 'hoy' : faltan === 1 ? 'mañana' : `en ${faltan} días`} (${fechaCorta(prox.fechaVencimiento, hoy)})` : `${fs.length} facturas vencen en los próximos ${rPV.dias} días (la primera el ${fechaCorta(prox.fechaVencimiento, hoy)})`, prox.fechaVencimiento, null, {})); }
    }
    // vencida: alguna vencida hace ≥ N días sin recordatorio «vencida», o con el último hace ≥ cadaDias; el correo lista TODAS las vencidas
    const rV = R.vencida;
    if (rV?.activo) {
      const vencidas = abiertas.filter(f => f.diasVencida >= Math.max(1, rV.dias));
      const ultimoEnvio = (nf: string) => enviadosOk.filter(e => e.regla === 'vencida' && e.facturas.includes(nf)).map(e => e.fecha.slice(0, 10)).sort().pop() ?? null;
      const disparan = vencidas.filter(f => { const u = ultimoEnvio(f.noFactura); return !u || (rV.cadaDias !== null && diasEntre(u, hoy) >= rV.cadaDias); });
      if (disparan.length) {
        const vieja = [...vencidas].sort((a, b) => b.diasVencida - a.diasVencida)[0];
        const u = vencidas.map(f => ultimoEnvio(f.noFactura)).filter((x): x is string => !!x).sort().pop() ?? null;
        out.push(base('vencida', vencidas.map(f => f.noFactura), vencidas.reduce((s, f) => s + f.saldo, 0), `${vencidas.length === 1 ? 'Vencida' : `${vencidas.length} facturas vencidas; la más vieja`} ${hace(vieja.diasVencida)} · ${u ? `último recordatorio ${hace(diasEntre(u, hoy))}` : 'sin recordatorio todavía'}`, vieja.fechaVencimiento, null, {}));
      }
    }
    // promesa incumplida: fecha pasada hace ≥ N días (incumplida, o pendiente que ya pasó) y sin recordatorio para ESA promesa
    const rPI = R.promesa_incumplida;
    if (rPI?.activo) {
      for (const p of c.promesas) {
        const pasada = p.estado === 'incumplida' || (p.estado === 'pendiente' && p.fecha < hoy);
        if (!pasada || diasEntre(p.fecha, hoy) < rPI.dias) continue;
        if (enviadosOk.some(e => e.regla === 'promesa_incumplida' && e.promesaId === p.id)) continue;
        const fs = abiertas.filter(f => cubre(p.facturas, f.noFactura));
        if (!fs.length) continue;   // ya no hay saldo: no hay qué recordar
        const monto = p.monto ?? fs.reduce((s, f) => s + f.saldo, 0);
        out.push(base('promesa_incumplida', fs.map(f => f.noFactura), fs.reduce((s, f) => s + f.saldo, 0), `Prometió ${p.monto ? fmtQ(p.monto) : 'pagar'} el ${fechaCorta(p.fecha, hoy)} (${hace(diasEntre(p.fecha, hoy))}) y no entró el cobro`, p.fecha, { id: p.id, fecha: p.fecha, monto: p.monto }, { fecha_promesa: fechaLarga(p.fecha), monto_promesa: fmtQ(monto) }));
      }
    }
    // confirmación de promesa: pendiente, vence en ≤ N días, sin confirmación para ESA promesa
    const rCP = R.confirmacion_promesa;
    if (rCP?.activo) {
      for (const p of c.promesas) {
        if (p.estado !== 'pendiente' || p.fecha < hoy || diasEntre(hoy, p.fecha) > rCP.dias) continue;
        if (enviadosOk.some(e => e.regla === 'confirmacion_promesa' && e.promesaId === p.id)) continue;
        const fs = abiertas.filter(f => cubre(p.facturas, f.noFactura));
        if (!fs.length) continue;
        const monto = p.monto ?? fs.reduce((s, f) => s + f.saldo, 0);
        out.push(base('confirmacion_promesa', fs.map(f => f.noFactura), fs.reduce((s, f) => s + f.saldo, 0), `Promesa de ${p.monto ? fmtQ(p.monto) : 'pago'} para ${p.fecha === hoy ? 'hoy' : p.fecha === sumarDias(hoy, 1) ? 'mañana' : fechaCorta(p.fecha, hoy)}: confirmar`, p.fecha, { id: p.id, fecha: p.fecha, monto: p.monto }, { fecha_promesa: fechaLarga(p.fecha), monto_promesa: fmtQ(monto) }));
      }
    }
  }
  const prio = (b: Borrador) => ORDEN_REGLA.indexOf(b.regla);
  return out.sort((a, b) => prio(a) - prio(b) || b.monto - a.monto || a.clienteNombre.localeCompare(b.clienteNombre, 'es'));
}

/** Resumen para la bandeja: cuántos hay, cuántos bloqueados, cuántos sin correo, cuántos omitidos. */
export function resumenBorradores(bs: Borrador[]): { total: number; listos: number; bloqueados: number; sinCorreo: number; omitidos: number; porRegla: Record<ReglaClave, number> } {
  const vivos = bs.filter(b => !b.omitidoHasta);
  const porRegla = { por_vencer: 0, vencida: 0, promesa_incumplida: 0, confirmacion_promesa: 0 } as Record<ReglaClave, number>;
  for (const b of vivos) porRegla[b.regla]++;
  return { total: vivos.length, listos: vivos.filter(b => !b.bloqueo && b.destinatario).length, bloqueados: vivos.filter(b => b.bloqueo).length, sinCorreo: vivos.filter(b => !b.destinatario).length, omitidos: bs.length - vivos.length, porRegla };
}

/** Validación de lo que la persona manda a enviar (puro; el servidor vuelve a calcular el borrador). */
export function validarEnvio(input: { para?: unknown; cc?: unknown; asunto?: unknown; cuerpo?: unknown; forzarMotivo?: unknown }, bloqueado: boolean): { ok: true; envio: { para: string[]; cc: string[]; asunto: string; cuerpo: string; forzarMotivo: string } } | { ok: false; error: string } {
  const lista = (v: unknown) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map(x => String(x).trim().toLowerCase()).filter(Boolean))];
  const para = lista(input.para), cc = lista(input.cc).filter(x => !para.includes(x));
  if (!para.length) return { ok: false, error: 'Falta el destinatario: elegí un contacto con correo o agregalo en la ficha del cliente.' };
  const malos = [...para, ...cc].filter(x => !CORREO.test(x));
  if (malos.length) return { ok: false, error: `Correo inválido: ${malos.join(', ')}.` };
  if (para.length > 5 || cc.length > 5) return { ok: false, error: 'Hasta 5 destinatarios y 5 copias.' };
  const asunto = String(input.asunto ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const cuerpo = String(input.cuerpo ?? '').replace(/\r\n/g, '\n').trim().slice(0, 8000);
  if (asunto.length < 3) return { ok: false, error: 'El asunto es obligatorio.' };
  if (cuerpo.length < 10) return { ok: false, error: 'El cuerpo es muy corto.' };
  const forzarMotivo = String(input.forzarMotivo ?? '').trim().slice(0, 300);
  if (bloqueado && forzarMotivo.length < 5) return { ok: false, error: 'Este recordatorio está bloqueado (disputa abierta o promesa vigente): para mandarlo igual, escribí el motivo.' };
  return { ok: true, envio: { para, cc, asunto, cuerpo, forzarMotivo } };
}

/* ───────────── estado de cuenta ───────────── */

export type TramoEC = 'por_vencer' | '1-30' | '31-60' | '61-90' | '90+';
export const ETIQUETA_TRAMO: Record<TramoEC, string> = { por_vencer: 'Por vencer', '1-30': '1–30 días', '31-60': '31–60 días', '61-90': '61–90 días', '90+': 'Más de 90 días' };
export const TRAMOS_EC: TramoEC[] = ['por_vencer', '1-30', '31-60', '61-90', '90+'];
export const tramoDe = (diasVencida: number): TramoEC => (diasVencida <= 0 ? 'por_vencer' : diasVencida <= 30 ? '1-30' : diasVencida <= 60 ? '31-60' : diasVencida <= 90 ? '61-90' : '90+');

export interface PaqueteEC { correlativo: string; nombre: string; usadas: number; cantidad: number; remanente: number; venceEn: string | null; estado: string }
export interface FilaEC extends FacturaRecordatorio { tramo: TramoEC; estado: 'vencida' | 'por_vencer' | 'al_dia' }
export interface EstadoCuenta {
  hoy: string; cliente: { clienteId: string; clienteUuid: string; nombre: string; nit: string; diasCredito: number };
  facturas: FilaEC[]; totales: { saldo: number; vencido: number; porVencer: number; n: number; nVencidas: number };
  aging: Array<{ tramo: TramoEC; etiqueta: string; monto: number; n: number }>;
  /** cedidas a factoraje: se informan aparte, no suman (las cobra el financiador) */ cedidas: FacturaRecordatorio[];
  paquetes: PaqueteEC[]; datosPago: string;
}

export function armarEstadoCuenta(cliente: EstadoCuenta['cliente'], facturas: FacturaRecordatorio[], paquetes: PaqueteEC[], datosPago: string, hoy: string): EstadoCuenta {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const vivas = facturas.filter(f => f.saldo > 0.005);
  const propias = vivas.filter(f => !f.cedida).map((f): FilaEC => ({ ...f, tramo: tramoDe(f.diasVencida), estado: f.diasVencida > 0 ? 'vencida' : f.diasVencida >= -5 ? 'por_vencer' : 'al_dia' })).sort((a, b) => b.diasVencida - a.diasVencida || a.noFactura.localeCompare(b.noFactura));
  const aging = TRAMOS_EC.map(t => { const fs = propias.filter(f => f.tramo === t); return { tramo: t, etiqueta: ETIQUETA_TRAMO[t], monto: r2(fs.reduce((s, f) => s + f.saldo, 0)), n: fs.length }; });
  const vencido = r2(propias.filter(f => f.diasVencida > 0).reduce((s, f) => s + f.saldo, 0));
  const saldo = r2(propias.reduce((s, f) => s + f.saldo, 0));
  return { hoy, cliente, facturas: propias, totales: { saldo, vencido, porVencer: r2(saldo - vencido), n: propias.length, nVencidas: propias.filter(f => f.diasVencida > 0).length }, aging, cedidas: vivas.filter(f => f.cedida), paquetes, datosPago };
}

/** Texto plano del estado de cuenta (para la versión texto del correo y el CSV). */
export function textoEstadoCuenta(ec: EstadoCuenta): string {
  const L: string[] = [`ESTADO DE CUENTA · ${ec.cliente.nombre} · NIT ${ec.cliente.nit || '—'} · al ${fechaLarga(ec.hoy)}`, ''];
  L.push('Factura | Emisión | Vence | Días | Total | Saldo');
  for (const f of ec.facturas) L.push(`${f.noFactura} | ${f.fechaEmision} | ${f.fechaVencimiento} | ${f.diasVencida > 0 ? `${f.diasVencida} vencida` : f.diasVencida === 0 ? 'vence hoy' : `vence en ${-f.diasVencida}`} | ${fmtQ(f.total)} | ${fmtQ(f.saldo)}`);
  if (!ec.facturas.length) L.push('Sin facturas pendientes.');
  L.push('', `Saldo pendiente: ${fmtQ(ec.totales.saldo)} (${ec.totales.n} factura${ec.totales.n === 1 ? '' : 's'}) · Vencido: ${fmtQ(ec.totales.vencido)} · Por vencer: ${fmtQ(ec.totales.porVencer)}`);
  const tramos = ec.aging.filter(a => a.n > 0);
  if (tramos.length) L.push(`Antigüedad: ${tramos.map(a => `${a.etiqueta} ${fmtQ(a.monto)}`).join(' · ')}`);
  if (ec.paquetes.length) L.push('', ...ec.paquetes.map(p => `Paquete prepagado ${p.correlativo} · ${p.nombre}: ${p.usadas} usadas de ${p.cantidad} · ${p.remanente} restantes${p.venceEn ? ` · vence ${p.venceEn}` : ''}`));
  return L.join('\n');
}

export function csvEstadoCuenta(ec: EstadoCuenta): string {
  const esc = (s: string | number) => { const t = String(s); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const L = [['Factura', 'Emisión', 'Vence', 'Días vencida', 'Total', 'Cobrado', 'Notas de crédito', 'Saldo', 'Tramo'].join(',')];
  for (const f of ec.facturas) L.push([f.noFactura, f.fechaEmision, f.fechaVencimiento, f.diasVencida, f.total.toFixed(2), f.cobrado.toFixed(2), f.ncs.toFixed(2), f.saldo.toFixed(2), ETIQUETA_TRAMO[f.tramo]].map(esc).join(','));
  L.push(['TOTAL', '', '', '', '', '', '', ec.totales.saldo.toFixed(2), ''].join(','));
  return L.join('\n');
}
