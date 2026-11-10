/**
 * CENTRO DE COBROS (033) · reglas puras: estado de cobro de una factura (espejo de `cobranza_estado_factura` en SQL),
 * catálogos (canales, resultados, roles de contacto), validación de una gestión, la bandeja del día ordenada por
 * prioridad y el resumen en una línea. Sin IO: va al navegador y al servidor.
 */

export const CANALES_COBRANZA = ['llamada', 'whatsapp', 'correo', 'visita', 'reunion', 'nota'] as const;
export type CanalCobranza = (typeof CANALES_COBRANZA)[number];
export const ETIQUETA_CANAL: Record<CanalCobranza, string> = { llamada: 'Llamada', whatsapp: 'WhatsApp', correo: 'Correo', visita: 'Visita', reunion: 'Reunión', nota: 'Nota interna' };

export const RESULTADOS_GESTION = ['contactado', 'promesa', 'sin_respuesta', 'pide_documentos', 'revision_interna', 'disputa', 'dice_que_pago', 'reprogramar'] as const;
export type ResultadoGestion = (typeof RESULTADOS_GESTION)[number];
export const ETIQUETA_RESULTADO: Record<ResultadoGestion, string> = {
  contactado: 'Contactado · sin novedad', promesa: 'Promesa de pago', sin_respuesta: 'No contestó / sin respuesta', pide_documentos: 'Pide documentos',
  revision_interna: 'En revisión interna del cliente', disputa: 'Disputa / reclamo', dice_que_pago: 'Dice que ya pagó', reprogramar: 'Reprogramar',
};
export const DESCRIPCION_RESULTADO: Record<ResultadoGestion, string> = {
  contactado: 'Se habló y no hay nada nuevo.', promesa: 'Dio monto y fecha de pago.', sin_respuesta: 'No contestó llamada, WhatsApp ni correo.',
  pide_documentos: 'Factura física, contraseña, orden de compra o detalle.', revision_interna: 'Lo están revisando o aprobando adentro.',
  disputa: 'No reconoce el cobro o reclama algo (dejá el motivo).', dice_que_pago: 'Según el cliente ya pagó: contador lo verifica en bancos.', reprogramar: '«Llamen en 2 semanas».',
};
export const esResultado = (v: unknown): v is ResultadoGestion => (RESULTADOS_GESTION as readonly string[]).includes(String(v));
export const esCanal = (v: unknown): v is CanalCobranza => (CANALES_COBRANZA as readonly string[]).includes(String(v));

export const ROLES_CONTACTO = ['pagos', 'cuentas_por_pagar', 'aprobador', 'solicitante', 'otro'] as const;
export type RolContacto = (typeof ROLES_CONTACTO)[number];
export const ETIQUETA_ROL_CONTACTO: Record<RolContacto, string> = { pagos: 'Pagos (tesorería)', cuentas_por_pagar: 'Cuentas por pagar', aprobador: 'Aprobador', solicitante: 'Solicitante', otro: 'Otro' };
export const esRolContacto = (v: unknown): v is RolContacto => (ROLES_CONTACTO as readonly string[]).includes(String(v));

export const FORMAS_PAGO = ['transferencia', 'cheque', 'deposito'] as const;
export type FormaPago = (typeof FORMAS_PAGO)[number];
export const ETIQUETA_FORMA_PAGO: Record<FormaPago, string> = { transferencia: 'Transferencia', cheque: 'Cheque', deposito: 'Depósito' };

export type TipoEvento = 'gestion' | 'promesa' | 'correo_enviado' | 'correo_recibido' | 'correo_copiado' | 'factura_emitida' | 'cobro_recibido' | 'detalle_enviado' | 'detalle_aprobado' | 'detalle_observaciones' | 'cambio_condicion';
export const ETIQUETA_TIPO_EVENTO: Record<TipoEvento, string> = {
  gestion: 'Gestión', promesa: 'Promesa de pago', correo_enviado: 'Correo enviado', correo_recibido: 'Correo del cliente', correo_copiado: 'Correo (copia al buzón)',
  factura_emitida: 'Factura emitida', cobro_recibido: 'Cobro recibido', detalle_enviado: 'Detalle enviado', detalle_aprobado: 'Detalle aprobado', detalle_observaciones: 'Detalle con observaciones', cambio_condicion: 'Cambio de condición',
};
export type EstadoPromesa = 'pendiente' | 'cumplida' | 'incumplida' | 'reprogramada';
export const ETIQUETA_PROMESA: Record<EstadoPromesa, string> = { pendiente: 'pendiente', cumplida: 'cumplida', incumplida: 'incumplida', reprogramada: 'reprogramada' };

/* ───────────── estado de cobro de una factura (espejo de cobranza_estado_factura) ───────────── */

export type EstadoBase = 'cobrada' | 'vencida' | 'por_vencer' | 'al_dia' | 'anulada';
export type Modificador = 'cobrada_parcial' | 'con_promesa' | 'promesa_incumplida' | 'en_disputa' | 'pide_documentos' | 'dice_que_pago';
export interface EstadoFactura { estado: EstadoBase; vence: string | null; diasVencida: number; cobrada: boolean; modificadores: Modificador[]; promesaFecha: string | null; promesaEstado: EstadoPromesa | null }
export const ETIQUETA_ESTADO_BASE: Record<EstadoBase, string> = { cobrada: 'Cobrada', vencida: 'Vencida', por_vencer: 'Por vencer', al_dia: 'Al día', anulada: 'Anulada' };
export const ETIQUETA_MODIFICADOR: Record<Modificador, string> = { cobrada_parcial: 'cobrada parcial', con_promesa: 'con promesa', promesa_incumplida: 'promesa incumplida', en_disputa: 'en disputa', pide_documentos: 'pide documentos', dice_que_pago: 'dice que ya pagó' };
export const BADGE_ESTADO_BASE: Record<EstadoBase, string> = { cobrada: 'badge-olive', vencida: 'badge-wine', por_vencer: 'badge-warn', al_dia: 'badge-outline', anulada: 'badge-mute' };
export const DIAS_POR_VENCER = 5;

export interface EntradaEstado {
  fechaEmision: string; diasCredito: number; cobrada: boolean; parcial: boolean; viva?: boolean;
  /** la última promesa que cubre la factura (o todo el cliente) */ ultimaPromesa?: { fecha: string; estado: EstadoPromesa } | null;
  /** la última gestión que cubre la factura (o todo el cliente) */ ultimaGestion?: { resultado: ResultadoGestion } | null;
}

export const sumarDias = (iso: string, dias: number): string => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
export const diasEntre = (desde: string, hasta: string): number => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);

export function estadoFactura(e: EntradaEstado, hoy: string): EstadoFactura {
  if (e.viva === false) return { estado: 'anulada', vence: null, diasVencida: 0, cobrada: false, modificadores: [], promesaFecha: null, promesaEstado: null };
  const vence = sumarDias(e.fechaEmision, e.diasCredito);
  const dv = diasEntre(vence, hoy);
  const estado: EstadoBase = e.cobrada ? 'cobrada' : dv > 0 ? 'vencida' : dv >= -DIAS_POR_VENCER ? 'por_vencer' : 'al_dia';
  const mods: Modificador[] = [];
  if (!e.cobrada) {
    if (e.parcial) mods.push('cobrada_parcial');
    const p = e.ultimaPromesa;
    if (p && (p.estado === 'incumplida' || (p.estado === 'pendiente' && p.fecha < hoy))) mods.push('promesa_incumplida');
    else if (p && p.estado === 'pendiente') mods.push('con_promesa');
    const g = e.ultimaGestion?.resultado;
    if (g === 'disputa') mods.push('en_disputa'); else if (g === 'pide_documentos') mods.push('pide_documentos'); else if (g === 'dice_que_pago') mods.push('dice_que_pago');
  }
  return { estado, vence, diasVencida: dv, cobrada: e.cobrada, modificadores: mods, promesaFecha: e.ultimaPromesa?.fecha ?? null, promesaEstado: e.ultimaPromesa?.estado ?? null };
}

export const textoEstado = (s: EstadoFactura): string => [ETIQUETA_ESTADO_BASE[s.estado], ...s.modificadores.map(m => ETIQUETA_MODIFICADOR[m])].join(' · ');

/* ───────────── validación de una gestión ───────────── */

export interface GestionInput {
  canal: string; resultado: string; comentario?: string; contactoId?: string | null; contactoTexto?: string; facturas?: string[];
  promesaMonto?: number | null; promesaFecha?: string | null; proximoSeguimiento?: string | null; disputaMotivo?: string; fecha?: string | null;
}
export type GestionValida = { ok: true; gestion: { canal: CanalCobranza; resultado: ResultadoGestion; comentario: string; contactoId: string | null; contactoTexto: string; facturas: string[]; promesaMonto: number | null; promesaFecha: string | null; proximoSeguimiento: string; disputaMotivo: string; fecha: string | null } } | { ok: false; error: string };

const esFecha = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Regla de oro: toda gestión exige fecha de próximo seguimiento (no hay «pago confirmado» en la lista: eso lo confirma contador en bancos). */
export function validarGestion(input: GestionInput, hoy: string): GestionValida {
  if (!esCanal(input.canal)) return { ok: false, error: 'Elegí el canal (llamada, WhatsApp, correo, visita, reunión o nota).' };
  if (!esResultado(input.resultado)) return { ok: false, error: 'Elegí el resultado de la gestión.' };
  const comentario = String(input.comentario ?? '').trim().slice(0, 2000);
  const facturas = [...new Set((input.facturas ?? []).map(f => String(f).trim()).filter(Boolean))].slice(0, 50);
  const seguimiento = String(input.proximoSeguimiento ?? '').trim();
  if (!esFecha(seguimiento)) return { ok: false, error: 'La fecha de próximo seguimiento es obligatoria: si el cliente dice «en 2 semanas», ponela a esa fecha y el sistema te la trae ese día.' };
  if (seguimiento < hoy) return { ok: false, error: 'El próximo seguimiento no puede ser una fecha pasada.' };
  let promesaMonto: number | null = null, promesaFecha: string | null = null;
  if (input.resultado === 'promesa') {
    if (!esFecha(input.promesaFecha)) return { ok: false, error: 'Una promesa de pago lleva fecha prometida.' };
    promesaFecha = input.promesaFecha;
    const m = Number(input.promesaMonto);
    promesaMonto = Number.isFinite(m) && m > 0 ? Math.round(m * 100) / 100 : null;
  }
  const disputaMotivo = String(input.disputaMotivo ?? '').trim().slice(0, 500);
  if (input.resultado === 'disputa' && disputaMotivo.length < 3 && comentario.length < 3) return { ok: false, error: 'Una disputa lleva el motivo.' };
  if (!comentario && input.resultado !== 'promesa' && input.resultado !== 'sin_respuesta' && !(input.resultado === 'disputa' && disputaMotivo.length >= 3)) return { ok: false, error: 'Contá qué pasó en el comentario.' };
  const fecha = input.fecha && esFecha(input.fecha) && input.fecha <= hoy ? input.fecha : null;
  return { ok: true, gestion: { canal: input.canal, resultado: input.resultado, comentario, contactoId: input.contactoId || null, contactoTexto: String(input.contactoTexto ?? '').trim().slice(0, 200), facturas, promesaMonto, promesaFecha, proximoSeguimiento: seguimiento, disputaMotivo, fecha } };
}

/* ───────────── la bandeja del día ───────────── */

export type CategoriaBandeja = 'seguimiento' | 'promesa_incumplida' | 'promesa_por_vencer' | 'vencida_sin_gestion' | 'por_vencer' | 'dice_que_pago';
export const ETIQUETA_CATEGORIA: Record<CategoriaBandeja, string> = {
  seguimiento: 'Seguimientos para hoy o atrasados', promesa_incumplida: 'Promesas incumplidas', promesa_por_vencer: 'Promesas que vencen hoy o mañana',
  vencida_sin_gestion: 'Vencidas sin gestión en 7 días', por_vencer: 'Por vencer esta semana', dice_que_pago: '«Dice que ya pagó» por verificar',
};
export const ORDEN_CATEGORIA: CategoriaBandeja[] = ['seguimiento', 'promesa_incumplida', 'promesa_por_vencer', 'vencida_sin_gestion', 'por_vencer', 'dice_que_pago'];

export interface FacturaAbiertaBandeja { noFactura: string; facturaId: string; saldo: number; total: number; fechaEmision: string; diasCredito: number; parcial: boolean; cedida?: boolean }
export interface ClienteBandeja {
  clienteId: string; clienteUuid: string; nombre: string; responsable: string | null; facturas: FacturaAbiertaBandeja[];
  contactoPreferido: { id: string; nombre: string; correo: string | null; telefono: string | null; whatsapp: string | null } | null;
  ultimaGestion: { fecha: string; canal: CanalCobranza; contacto: string; resultado: ResultadoGestion; comentario: string } | null;
  promesas: Array<{ id: string; fecha: string; monto: number | null; estado: EstadoPromesa; facturas: string[] }>;
  seguimientos: Array<{ id: string; fecha: string; resultado: ResultadoGestion; comentario: string }>;
}
export interface ItemBandeja {
  categoria: CategoriaBandeja; clienteId: string; clienteUuid: string; nombre: string; responsable: string | null;
  facturas: string[]; monto: number; diasAtraso: number; detalle: string; fechaClave: string | null;
  ultimoContacto: string; contactoPreferido: ClienteBandeja['contactoPreferido'];
}

const fmtQ = (n: number) => `Q${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtFecha = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(d)}-${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(m) - 1]}${Number(y) !== new Date().getUTCFullYear() ? '-' + y : ''}`; };

export function textoUltimoContacto(g: ClienteBandeja['ultimaGestion'], hoy: string): string {
  if (!g) return 'sin gestión';
  const dias = diasEntre(g.fecha.slice(0, 10), hoy);
  const cuando = dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`;
  return `${cuando}, ${ETIQUETA_CANAL[g.canal].toLowerCase()}${g.contacto ? ` a ${g.contacto}` : ''}: ${ETIQUETA_RESULTADO[g.resultado].toLowerCase()}${g.comentario ? ` · ${g.comentario.slice(0, 80)}` : ''}`;
}

/** Arma la bandeja: una fila por cliente y categoría, en el orden de prioridad del brief. */
export function armarBandeja(clientes: ClienteBandeja[], hoy: string): ItemBandeja[] {
  const manana = sumarDias(hoy, 1), enSieteDias = sumarDias(hoy, 7), haceSiete = sumarDias(hoy, -7);
  const out: ItemBandeja[] = [];
  for (const c of clientes) {
    const abiertas = c.facturas.filter(f => !f.cedida);
    const vencidas = abiertas.filter(f => diasEntre(sumarDias(f.fechaEmision, f.diasCredito), hoy) > 0);
    const base = { clienteId: c.clienteId, clienteUuid: c.clienteUuid, nombre: c.nombre, responsable: c.responsable, ultimoContacto: textoUltimoContacto(c.ultimaGestion, hoy), contactoPreferido: c.contactoPreferido };
    const maxAtraso = Math.max(0, ...vencidas.map(f => diasEntre(sumarDias(f.fechaEmision, f.diasCredito), hoy)));
    const sumaSaldo = (nfs: string[]) => abiertas.filter(f => nfs.length === 0 || nfs.includes(f.noFactura)).reduce((s, f) => s + f.saldo, 0);
    // 1. seguimientos para hoy o atrasados
    const seg = c.seguimientos.filter(s => s.fecha <= hoy).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
    if (seg) out.push({ ...base, categoria: 'seguimiento', facturas: abiertas.map(f => f.noFactura), monto: sumaSaldo([]), diasAtraso: maxAtraso, fechaClave: seg.fecha, detalle: `${seg.fecha < hoy ? `Atrasado desde el ${fmtFecha(seg.fecha)}` : 'Para hoy'} · ${ETIQUETA_RESULTADO[seg.resultado].toLowerCase()}${seg.comentario ? ` · ${seg.comentario.slice(0, 80)}` : ''}` });
    // 2. promesas incumplidas · 3. promesas que vencen hoy o mañana
    for (const p of c.promesas) {
      const incumplida = p.estado === 'incumplida' || (p.estado === 'pendiente' && p.fecha < hoy);
      if (incumplida) out.push({ ...base, categoria: 'promesa_incumplida', facturas: p.facturas, monto: p.monto ?? sumaSaldo(p.facturas), diasAtraso: Math.max(0, diasEntre(p.fecha, hoy)), fechaClave: p.fecha, detalle: `Prometió ${p.monto ? fmtQ(p.monto) : 'pagar'} el ${fmtFecha(p.fecha)} y no entró el cobro` });
      else if (p.estado === 'pendiente' && p.fecha >= hoy && p.fecha <= manana) out.push({ ...base, categoria: 'promesa_por_vencer', facturas: p.facturas, monto: p.monto ?? sumaSaldo(p.facturas), diasAtraso: maxAtraso, fechaClave: p.fecha, detalle: `Promesa de ${p.monto ? fmtQ(p.monto) : 'pago'} para ${p.fecha === hoy ? 'hoy' : 'mañana'}: confirmar` });
    }
    // 4. vencidas sin gestión en 7 días (de la más vieja a la más nueva)
    const sinGestion = !c.ultimaGestion || c.ultimaGestion.fecha.slice(0, 10) < haceSiete;
    if (vencidas.length && sinGestion && !c.promesas.some(p => p.estado === 'pendiente' && p.fecha >= hoy)) {
      const masVieja = [...vencidas].sort((a, b) => a.fechaEmision.localeCompare(b.fechaEmision))[0];
      out.push({ ...base, categoria: 'vencida_sin_gestion', facturas: vencidas.map(f => f.noFactura), monto: vencidas.reduce((s, f) => s + f.saldo, 0), diasAtraso: maxAtraso, fechaClave: masVieja.fechaEmision, detalle: `${vencidas.length === 1 ? '1 factura vencida' : `${vencidas.length} facturas vencidas`} · la más vieja del ${fmtFecha(masVieja.fechaEmision)}` });
    }
    // 5. por vencer esta semana
    const porVencer = abiertas.filter(f => { const v = sumarDias(f.fechaEmision, f.diasCredito); return v >= hoy && v <= enSieteDias; });
    if (porVencer.length) out.push({ ...base, categoria: 'por_vencer', facturas: porVencer.map(f => f.noFactura), monto: porVencer.reduce((s, f) => s + f.saldo, 0), diasAtraso: 0, fechaClave: sumarDias(porVencer[0].fechaEmision, porVencer[0].diasCredito), detalle: `${porVencer.length === 1 ? 'Vence' : `${porVencer.length} vencen`} esta semana · candidata a recordatorio` });
    // 6. dice que ya pagó
    if (c.ultimaGestion?.resultado === 'dice_que_pago' && abiertas.length) out.push({ ...base, categoria: 'dice_que_pago', facturas: abiertas.map(f => f.noFactura), monto: sumaSaldo([]), diasAtraso: maxAtraso, fechaClave: c.ultimaGestion.fecha.slice(0, 10), detalle: 'El cliente dice que ya pagó: verificar en bancos' });
  }
  const prio = (i: ItemBandeja) => ORDEN_CATEGORIA.indexOf(i.categoria);
  return out.sort((a, b) => prio(a) - prio(b) || (a.categoria === 'vencida_sin_gestion' ? (a.fechaClave ?? '').localeCompare(b.fechaClave ?? '') : (a.fechaClave ?? '').localeCompare(b.fechaClave ?? '')) || b.monto - a.monto);
}

/* ───────────── resumen en una línea (datos, no IA) ───────────── */

export function resumenUnaLinea(c: Pick<ClienteBandeja, 'ultimaGestion' | 'promesas' | 'seguimientos'>, hoy: string): string {
  const partes: string[] = [];
  const g = c.ultimaGestion;
  partes.push(g ? `Último contacto: ${fmtFecha(g.fecha.slice(0, 10))}, ${ETIQUETA_CANAL[g.canal].toLowerCase()}${g.contacto ? ` a ${g.contacto}` : ''}${g.resultado !== 'contactado' && g.resultado !== 'promesa' ? ` (${ETIQUETA_RESULTADO[g.resultado].toLowerCase()})` : ''}.` : 'Sin gestiones registradas.');
  const p = c.promesas.filter(x => x.estado === 'pendiente' || x.estado === 'incumplida').sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  if (p) partes.push(`${p.estado === 'incumplida' || p.fecha < hoy ? 'Incumplió la promesa de pagar' : 'Prometió pagar'}${p.facturas.length ? ` la ${p.facturas.length === 1 ? 'F-' : ''}${p.facturas.join(', ')}` : ''} el ${fmtFecha(p.fecha)}${p.monto ? ` (${fmtQ(p.monto)})` : ''}.`);
  const s = c.seguimientos.sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
  partes.push(s ? `Próximo seguimiento: ${fmtFecha(s.fecha)}${s.fecha < hoy ? ' (atrasado)' : ''}.` : 'Sin próximo seguimiento.');
  return partes.join(' ');
}
