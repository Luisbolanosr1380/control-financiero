/**
 * CENTRO DE COBROS · PR 2 (035: recordatorios propuestos + estado de cuenta) — validador.
 *
 *  A. Estático: migración 035 (tres tablas con RLS y sin anon, seeds que no pisan lo editado, ayuda por upsert, sin
 *     drop / delete / begin), permiso configurar_cobranza = admin + contador (cobranza no), acciones con autorizar
 *     (enviar / omitir / estado de cuenta → gestionar_cobranza; plantillas / reglas → configurar_cobranza), páginas con
 *     exigirPagina, NINGÚN cron ni envío automático (nada sale sin «Enviar»), reply-to = quien envía, correo sin recursos
 *     externos, el módulo puro sin IO, los recordatorios solo miran facturas (nunca pruebas / expedientes: una cubierta por
 *     paquete no genera cobro), sin diálogos del navegador.
 *  B. Puro: cada regla (por vencer, vencida con repetición, promesa incumplida, confirmación), bloqueos (disputa abierta,
 *     promesa vigente; la confirmación no se bloquea por la promesa), destinatario (preferido → pagos → primero con
 *     correo), cedidas y sin saldo fuera, omisiones, orden, resumen, plantillas (variables, render, validación), envío
 *     (bloqueado exige motivo), estado de cuenta (saldo real, tramos, cedidas aparte, paquetes) y el correo armado.
 *  C. HIT (datos sembrados, CORREO_MOCK=1): dos clientes, facturas con cobro parcial y NC (saldo real), promesa que pasa a
 *     incumplida, disputa en el segundo; borradores propuestos; enviar (mock) → evento correo_enviado con el texto y el
 *     resultado; el enviado deja de proponerse; bloqueado sin motivo → rechazado, con motivo → sale y queda «forzado»;
 *     omitir hasta; «ya no aplica»; plantilla con variable inválida → rechazada; editar plantilla y regla (y restaurar);
 *     estado de cuenta con paquete prepagado (remanente) y sin la factura cobrada; limpieza.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-cobranza-recordatorios.ts hit [--conservar | --solo-limpiar]
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ClienteRecordatorio, ReglaRecordatorio, FacturaRecordatorio } from '../src/lib/cobranza/recordatorios';

const BASE = (process.argv[2] ?? 'hit').toLowerCase();
if (BASE !== 'hit') { console.error('Este validador siembra datos: solo corre contra HIT.'); process.exit(2); }
const CONSERVAR = process.argv.includes('--conservar'), SOLO_LIMPIAR = process.argv.includes('--solo-limpiar');
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.hit.vercel'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
process.env.CORREO_MOCK = '1';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const NIT1 = '99990044K', NIT2 = '99990045K', PREFIJO = 'CR-E2E-', APP1 = 'sbwCRE2E01', APP2 = 'sbwCRE2E02', ACTOR = { email: 'cobranza@cr-e2e.example', nombre: 'Rita Cobros' };

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Estático');
  const m35 = rd('supabase/migrations/035_cobranza_recordatorios.sql'), sin35 = m35.replace(/--.*$/gm, '');
  const roles = rd('src/lib/auth/roles.ts'), acts = rd('src/app/(app)/cobranza/actions.ts'), perm = rd('scripts/validate-permisos.ts');
  const pR = rd('src/app/(app)/cobranza/recordatorios/page.tsx'), pP = rd('src/app/(app)/cobranza/plantillas/page.tsx'), pI = rd('src/app/imprimir/estado-cuenta/[id]/page.tsx'), pB = rd('src/app/(app)/cobranza/page.tsx');
  const puro = rd('src/lib/cobranza/recordatorios.ts'), correo = rd('src/lib/cobranza/correo.ts'), db = rd('src/lib/db/cobranza-recordatorios.ts'), resend = rd('src/lib/correo/resend.ts');
  const uiR = rd('src/components/cobranza/recordatorios-client.tsx'), uiP = rd('src/components/cobranza/plantillas-client.tsx'), uiE = rd('src/components/cobranza/estado-cuenta-enviar.tsx'), uiI = rd('src/components/cobranza/estado-cuenta-imprimible.tsx'), fic = rd('src/components/cobranza/ficha-client.tsx'), ban = rd('src/components/cobranza/bandeja-client.tsx'), side = rd('src/components/shell/sidebar.tsx');
  ok(['cobranza_plantilla', 'cobranza_regla_recordatorio', 'cobranza_recordatorio_omision'].every(t => new RegExp(`create table if not exists ${t}`).test(m35) && new RegExp(`alter table ${t} enable row level security`).test(m35) && new RegExp(`revoke all on table ${t} from public, anon, authenticated`).test(m35) && new RegExp(`grant all on table ${t} to service_role`).test(m35)) && (m35.match(/on conflict \(clave\) do nothing/g) ?? []).length === 2 && /on conflict \(slug\) do update set/.test(m35) && !/\bdrop\s+(table|function)\b/i.test(sin35) && !/\bdelete\s+from\b/i.test(sin35) && !/^\s*(begin|commit)\s*;/im.test(sin35) && /where tipo = 'correo_enviado'/.test(m35), '035: tres tablas con RLS, sin anon / authenticated y solo service_role; seeds de plantillas y reglas que NO pisan lo editado (do nothing); ayuda por upsert; índice de correos enviados; sin drop / delete / begin / commit');
  ok(/\('por_vencer', 'Por vencer', [^,]+, 3, null, 'por_vencer'\)/.test(m35) && /\('vencida', 'Vencida', [^,]+, 1, 7, 'vencida'\)/.test(m35) && /\('promesa_incumplida', 'Promesa incumplida', [^,]+, 1, null, 'promesa_incumplida'\)/.test(m35) && /\('confirmacion_promesa', 'Confirmación de promesa', [^,]+, 1, null, 'confirmacion_promesa'\)/.test(m35) && ['por_vencer', 'vencida', 'promesa_incumplida', 'confirmacion_promesa', 'estado_cuenta', 'datos_pago'].every(k => new RegExp(`\\('${k}', '`).test(m35)) && /\{\{estado_cuenta\}\}/.test(m35) && /\{\{datos_pago\}\}/.test(m35), '035: las 4 reglas del brief (3 días antes · día 1 y cada 7 · al día siguiente · 1 día antes) y las 6 plantillas (4 recordatorios, estado de cuenta, datos para pagar) con {{estado_cuenta}} y {{datos_pago}}');
  ok(/\| 'configurar_cobranza'/.test(roles) && /configurar_cobranza: CONTROL/.test(roles) && /gestionar_cobranza: COBRANZA/.test(roles) && /const CONTROL: readonly Rol\[\] = \['admin', 'contador'\]/.test(roles) && /configurar_cobranza', 'Centro de Cobros \(035\)/.test(perm), 'permisos: configurar_cobranza (plantillas y reglas) = admin + contador; cobranza sigue solo con ver / ver_cobranza / gestionar_cobranza; validate-permisos lo conoce');
  const conGuard = (nombre: string, accion: string) => new RegExp(`export async function ${nombre}\\([\\s\\S]*?\\{\\n  const permiso = await autorizar\\('${accion}'\\);`).test(acts);
  ok(conGuard('enviarRecordatorioAction', 'gestionar_cobranza') && conGuard('enviarRecordatoriosAction', 'gestionar_cobranza') && conGuard('omitirRecordatorioAction', 'gestionar_cobranza') && conGuard('enviarEstadoCuentaAction', 'gestionar_cobranza') && conGuard('prepararEstadoCuentaAction', 'ver_cobranza') && conGuard('editarPlantillaCobranzaAction', 'configurar_cobranza') && conGuard('editarReglaCobranzaAction', 'configurar_cobranza') && /exigirPagina\('ver_cobranza'\)/.test(pR) && /exigirPagina\('ver_cobranza'\)/.test(pP) && /exigirPagina\('ver_cobranza'\)/.test(pI), 'acciones: enviar (uno / seleccionados), omitir y estado de cuenta con gestionar_cobranza; preparar con ver_cobranza; plantillas y reglas con configurar_cobranza; las 3 páginas con exigirPagina(ver_cobranza)');
  const apiDir = path.join(process.cwd(), 'src/app/api'); const apis = fs.readdirSync(apiDir, { recursive: true }) as string[];
  const vercelJson = rd('vercel.json');
  ok(!apis.some(f => /recordatorio|cobranza-correo|estado-cuenta/i.test(String(f))) && !/recordatorio/i.test(vercelJson) && !/setInterval|cron\(|schedule/i.test(db.replace(/\/\*\*[\s\S]*?\*\//, '')) && /nada sale sin «Enviar»|Nada sale sin/i.test(db + pR) && /enviarRecordatorio\(String\(id/.test(acts) && /find\(x => x\.id === id\)/.test(db) && /validarEnvio\(input, !!b\.bloqueo\)/.test(db), 'nada sale solo: ningún cron ni ruta API de recordatorios; el envío es una acción de la persona y el servidor vuelve a calcular el borrador y a exigir el motivo si está bloqueado');
  ok(/respuestaA: actor\.email/.test(db) && /reply_to: c\.respuestaA/.test(resend) && !/https?:\/\//.test(correo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\*.*$/gm, '')) && !/<img|<script|<link/.test(correo) && /esc\(/.test(correo) && /tipo: 'correo_enviado'/.test(db) && /cuerpo: correo\.texto/.test(db) && /resultado: res\.ok \? 'enviado' : 'error'/.test(db) && /forzadoMotivo: envio\.forzarMotivo/.test(db), 'correo: reply-to = quien envía; HTML sin recursos externos (ni imágenes ni scripts) y todo escapado; cada envío deja un evento correo_enviado con destinatarios, asunto, cuerpo, resultado de Resend y el motivo si se forzó');
  ok(!/from '@\/lib\/(supabase|db)/.test(puro) && !/from '@\/lib\/(supabase|db)/.test(correo) && !/facturacion_componente|facturacion_expediente|cubiertaPor|pruebas/i.test(puro.replace(/\/\*\*[\s\S]*?\*\//, '')) && !/facturacion_componente|facturacion_expediente/.test(db) && /leerFilasBusqueda\(\)/.test(db) && /consolidarParaBusqueda\(filas, cobros, ncs, hoy\)/.test(db) && /getCesionesActivasPorFactura/.test(db) && /listarPaquetes/.test(db), 'el módulo puro no tiene IO; los recordatorios y el estado de cuenta se arman SOLO desde facturas (saldo real del #51: total − cobros − NC; cedidas aparte) y nunca desde pruebas o expedientes: una cubierta por paquete no genera cobro; el remanente del paquete se informa');
  ok(/data-accion="enviar"/.test(uiR) && /data-accion="enviar-seleccionados"/.test(uiR) && /data-accion="omitir"/.test(uiR) && /data-campo="forzar-motivo"/.test(uiR) && /data-campo="cuerpo"/.test(uiR) && /data-accion="guardar-plantilla"/.test(uiP) && /data-accion="guardar-regla"/.test(uiP) && /usePuede\(\)\('configurar_cobranza'\)/.test(uiP) && /data-accion="enviar-estado-cuenta"/.test(fic) && /data-accion="estado-cuenta-pdf"/.test(fic) && /data-accion="confirmar-enviar-ec"/.test(uiE) && /data-recordatorios-propuestos/.test(ban) && /\/cobranza\/recordatorios/.test(side) && /data-estado-cuenta=/.test(uiI) && /data-logo/.test(uiI) && !/window\.(confirm|alert|prompt)/.test(uiR + uiP + uiE + fic + ban), 'pantallas: recordatorios con enviar / seleccionados / omitir / motivo para forzar / cuerpo editable; plantillas y reglas con guardar solo para configurar_cobranza; ficha con «Estado de cuenta» (PDF con logo) y «Enviar estado de cuenta»; atajo en la bandeja y en el menú; sin diálogos del navegador');

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Puro');
  const R = await import('../src/lib/cobranza/recordatorios');
  const CO = await import('../src/lib/cobranza/correo');
  const hoy = '2026-11-11';
  const E = await import('../src/lib/cobranza/estado');
  const sd = (n: number) => E.sumarDias(hoy, n);
  const fac = (no: string, venceEn: number, saldo = 1000, extra: Partial<FacturaRecordatorio> = {}): FacturaRecordatorio => ({ noFactura: no, facturaId: `r${no}`, saldo, total: saldo, cobrado: 0, ncs: 0, fechaEmision: sd(venceEn - 30), fechaVencimiento: sd(venceEn), diasVencida: -venceEn, cedida: false, ...extra });
  const cli = (extra: Partial<ClienteRecordatorio>): ClienteRecordatorio => ({ clienteId: 'c1', clienteUuid: 'u1', nombre: 'ACME', nit: '123', responsable: 'ana@golden.example', contactos: [{ id: 'k1', nombre: 'Marta', rol: 'otro', correo: 'marta@acme.example', preferido: true }], facturas: [], promesas: [], gestiones: [], enviados: [], omisiones: [], ...extra });
  const reglas: ReglaRecordatorio[] = R.REGLAS_POR_DEFECTO;
  const prop = (c: Partial<ClienteRecordatorio>, rg = reglas) => R.proponerRecordatorios([cli(c)], rg, hoy, { nombre: 'Golden Talent', nit: '1-1' }, 'Rita');
  const claves = (c: Partial<ClienteRecordatorio>, rg = reglas) => prop(c, rg).filter(b => !b.omitidoHasta).map(b => `${b.regla}:${b.facturas.join('+')}`).join(',');
  ok(claves({ facturas: [fac('A', 3)] }) === 'por_vencer:A' && claves({ facturas: [fac('A', 4)] }) === '' && claves({ facturas: [fac('A', 0)] }) === 'por_vencer:A' && claves({ facturas: [fac('A', 2)], enviados: [{ regla: 'por_vencer', facturas: ['A'], fecha: sd(-1), promesaId: null, resultado: 'enviado' }] }) === '' && claves({ facturas: [fac('A', 2)], enviados: [{ regla: 'por_vencer', facturas: ['A'], fecha: sd(-1), promesaId: null, resultado: 'error' }] }) === 'por_vencer:A' && claves({ facturas: [fac('A', 2), fac('B', 3), fac('C', 9)] }) === 'por_vencer:A+B', 'por vencer: vence en ≤ 3 días (incluido hoy) → se propone; en 4 no; ya enviado no (un envío fallido no cuenta); agrupa las que vencen en la ventana');
  const env = (regla: 'vencida', fecha: string, facturas: string[]) => ({ regla, facturas, fecha, promesaId: null, resultado: 'enviado' as const });
  ok(claves({ facturas: [fac('A', -1)] }) === 'vencida:A' && claves({ facturas: [fac('A', 0)] }) === 'por_vencer:A' && claves({ facturas: [fac('A', -8)], enviados: [env('vencida', sd(0), ['A'])] }) === '' && claves({ facturas: [fac('A', -8)], enviados: [env('vencida', sd(-7), ['A'])] }) === 'vencida:A' && claves({ facturas: [fac('A', -8)], enviados: [env('vencida', sd(-3), ['A'])] }) === '' && claves({ facturas: [fac('A', -8)], enviados: [env('vencida', sd(-30), ['A'])] }, reglas.map(r => (r.clave === 'vencida' ? { ...r, cadaDias: null } : r))) === '' && claves({ facturas: [fac('A', -40), fac('B', -2), fac('C', 5)], enviados: [env('vencida', sd(-1), ['A'])] }) === 'vencida:A+B', 'vencida: desde el día 1; enviada hoy no; hace 7 sí (cada 7); hace 3 no; sin repetición solo una vez; el correo lista TODAS las vencidas aunque solo una dispare');
  const pr = (id: string, fecha: string, estado: 'pendiente' | 'incumplida' | 'cumplida', facturas: string[] = ['A'], monto: number | null = 500) => ({ id, fecha, monto, estado, facturas });
  ok(claves({ facturas: [fac('A', -10)], promesas: [pr('p1', sd(-1), 'incumplida')], enviados: [env('vencida', sd(0), ['A'])] }) === 'promesa_incumplida:A' && claves({ facturas: [fac('A', -10)], promesas: [pr('p1', sd(0), 'pendiente')], enviados: [env('vencida', sd(0), ['A'])] }) === 'confirmacion_promesa:A' && claves({ facturas: [fac('A', -10)], promesas: [pr('p1', sd(-1), 'pendiente')], enviados: [env('vencida', sd(0), ['A'])] }) === 'promesa_incumplida:A' && claves({ facturas: [fac('A', -10)], promesas: [pr('p1', sd(-1), 'incumplida')], enviados: [env('vencida', sd(0), ['A']), { regla: 'promesa_incumplida', facturas: ['A'], fecha: sd(0), promesaId: 'p1', resultado: 'enviado' }] }) === '' && claves({ facturas: [fac('A', -10)], promesas: [pr('p1', sd(-1), 'cumplida')], enviados: [env('vencida', sd(0), ['A'])] }) === '' && claves({ facturas: [], promesas: [pr('p1', sd(-1), 'incumplida')] }) === '', 'promesa incumplida: al día siguiente de la fecha (incumplida, o pendiente que ya pasó); no si ya se mandó para ESA promesa; cumplida no; sin saldo no hay qué recordar');
  ok(claves({ facturas: [fac('A', 20)], promesas: [pr('p1', sd(1), 'pendiente')] }) === 'confirmacion_promesa:A' && claves({ facturas: [fac('A', 20)], promesas: [pr('p1', sd(2), 'pendiente')] }) === '' && claves({ facturas: [fac('A', 20)], promesas: [pr('p1', sd(1), 'pendiente')], enviados: [{ regla: 'confirmacion_promesa', facturas: ['A'], fecha: sd(0), promesaId: 'p1', resultado: 'enviado' }] }) === '' && prop({ facturas: [fac('A', 20)], promesas: [pr('p1', sd(1), 'pendiente', ['A'], 777)] })[0].vars.monto_promesa === 'Q777.00', 'confirmación de promesa: 1 día antes (o el mismo día); en 2 días no; ya confirmada no; {{monto_promesa}} = lo prometido');
  const bloq = (c: Partial<ClienteRecordatorio>) => prop(c).map(b => `${b.regla}:${b.bloqueo?.tipo ?? 'ok'}`).join(',');
  ok(bloq({ facturas: [fac('A', -5)], gestiones: [{ fecha: sd(-2) + 'T12:00:00Z', resultado: 'disputa', facturas: ['A'] }] }) === 'vencida:disputa' && bloq({ facturas: [fac('A', -5)], gestiones: [{ fecha: sd(-2) + 'T12:00:00Z', resultado: 'disputa', facturas: ['A'] }, { fecha: sd(-1) + 'T12:00:00Z', resultado: 'contactado', facturas: [] }] }) === 'vencida:ok' && bloq({ facturas: [fac('A', -5)], gestiones: [{ fecha: sd(-2) + 'T12:00:00Z', resultado: 'disputa', facturas: ['B'] }] }) === 'vencida:ok' && bloq({ facturas: [fac('A', -5)], promesas: [pr('p1', sd(5), 'pendiente')] }) === 'vencida:promesa_vigente' && bloq({ facturas: [fac('A', -5)], promesas: [pr('p1', sd(1), 'pendiente')] }) === 'vencida:promesa_vigente,confirmacion_promesa:ok' && bloq({ facturas: [fac('A', 2)], promesas: [pr('p1', sd(0), 'pendiente')] }) === 'confirmacion_promesa:ok,por_vencer:promesa_vigente', 'bloqueos: disputa abierta (la última gestión que cubre la factura; una gestión posterior la levanta; una disputa de otra factura no); promesa vigente bloquea vencida y por vencer, nunca la confirmación');
  const dest = (contactos: ClienteRecordatorio['contactos']) => prop({ facturas: [fac('A', -5)], contactos })[0];
  ok(dest([{ id: '1', nombre: 'Sin', rol: 'pagos', correo: '', preferido: true }, { id: '2', nombre: 'Luis', rol: 'otro', correo: 'luis@x.com', preferido: false }]).destinatario?.nombre === 'Luis' && dest([{ id: '1', nombre: 'Ana', rol: 'otro', correo: 'ana@x.com', preferido: false }, { id: '2', nombre: 'Tesorera', rol: 'pagos', correo: 'pagos@x.com', preferido: false }]).destinatario?.nombre === 'Tesorera' && dest([{ id: '1', nombre: 'Ana', rol: 'otro', correo: 'ana@x.com', preferido: true }, { id: '2', nombre: 'Tesorera', rol: 'pagos', correo: 'pagos@x.com', preferido: false }]).destinatario?.nombre === 'Ana' && dest([]).destinatario === null && dest([]).vars.contacto === 'Estimados' && dest([]).cc.join() === 'ana@golden.example' && prop({ facturas: [fac('A', -5)], responsable: 'sin-correo' })[0].cc.length === 0, 'destinatario: preferido con correo → rol pagos → el primero con correo; sin contacto con correo queda «Sin correo» (saludo «Estimados»); CC = responsable si es un correo');
  ok(claves({ facturas: [fac('A', -5, 1000, { cedida: true })] }) === '' && claves({ facturas: [fac('A', -5, 0)] }) === '' && claves({ facturas: [fac('A', -5, 1000, { fechaVencimiento: '' })] }) === '' && prop({ facturas: [fac('A', -5)], omisiones: [{ regla: 'vencida', hasta: sd(0), motivo: 'x' }] })[0].omitidoHasta === sd(0) && claves({ facturas: [fac('A', -5)], omisiones: [{ regla: 'vencida', hasta: sd(-1), motivo: 'x' }] }) === 'vencida:A', 'fuera: cedidas a factoraje, sin saldo, sin fecha de vencimiento; omitida hasta hoy → marcada (no se propone); una omisión vencida ya no cuenta');
  const todo = R.proponerRecordatorios([cli({ clienteId: 'a', nombre: 'A', facturas: [fac('A', 1)] }), cli({ clienteId: 'b', nombre: 'B', facturas: [fac('B', -3, 50)] }), cli({ clienteId: 'c', nombre: 'C', facturas: [fac('C', -3, 900)] }), cli({ clienteId: 'd', nombre: 'D', facturas: [fac('D', 10)], promesas: [pr('p', sd(-2), 'incumplida', ['D'])] }), cli({ clienteId: 'e', nombre: 'E', facturas: [fac('E', 10)], promesas: [pr('p2', sd(1), 'pendiente', ['E'])] })], reglas, hoy, { nombre: 'G', nit: '1' }, 'R');
  const res = R.resumenBorradores(todo);
  ok(todo.map(b => `${b.regla}:${b.clienteNombre}`).join(',') === 'promesa_incumplida:D,vencida:C,vencida:B,confirmacion_promesa:E,por_vencer:A' && res.total === 5 && res.listos === 5 && res.porRegla.vencida === 2 && todo[1].id === 'vencida:c:C' && todo[0].id === 'promesa_incumplida:d:p' && /Vence mañana/.test(todo[4].motivo) && /hace 3 días · sin recordatorio todavía/.test(todo[1].motivo), 'orden de trabajo: promesas incumplidas → vencidas (monto mayor primero) → confirmaciones → por vencer; ids estables; motivos legibles; resumen');
  // plantillas
  ok(R.variablesDesconocidas('Hola {{cliente}} {{ saldo }} {{nada}}').join() === 'nada' && R.renderPlantilla('{{cliente}} debe {{saldo}} · {{estado_cuenta}} · {{x}}', { cliente: 'ACME', saldo: 'Q1.00' }) === 'ACME debe Q1.00 · {{estado_cuenta}} · {{x}}' && !R.validarPlantilla('vencida', { asunto: 'x', cuerpo: 'Hola {{clientee}}' }).ok && !R.validarPlantilla('vencida', { asunto: 'Asunto', cuerpo: '<script>x</script> hola' }).ok && R.validarPlantilla('datos_pago', { asunto: '', cuerpo: 'Banco X cuenta 123' }).ok && !R.validarPlantilla('otra', { asunto: 'a', cuerpo: 'b' }).ok && R.validarRegla({ dias: 3, cadaDias: '' }).ok && !R.validarRegla({ dias: -1 }).ok && !R.validarRegla({ dias: 2, cadaDias: 0 }).ok, 'plantillas: variables desconocidas detectadas, render deja {{estado_cuenta}} para el envío, variable inválida o HTML → rechazada, datos_pago sin asunto; reglas: días 0–365, cada ≥ 1 o vacío');
  ok(!R.validarEnvio({ para: 'x@y.com', asunto: 'Asunto', cuerpo: 'Cuerpo largo de prueba' }, true).ok && R.validarEnvio({ para: 'x@y.com', asunto: 'Asunto', cuerpo: 'Cuerpo largo de prueba', forzarMotivo: 'el cliente lo pidió' }, true).ok && !R.validarEnvio({ para: 'no-es-correo', asunto: 'Asunto', cuerpo: 'Cuerpo largo de prueba' }, false).ok && !R.validarEnvio({ para: '', asunto: 'Asunto', cuerpo: 'Cuerpo largo de prueba' }, false).ok && (() => { const v = R.validarEnvio({ para: 'A@Y.com, b@y.com', cc: 'a@y.com; c@y.com', asunto: 'Asunto', cuerpo: 'Cuerpo largo de prueba' }, false); return v.ok && v.envio.para.join() === 'a@y.com,b@y.com' && v.envio.cc.join() === 'c@y.com'; })(), 'validarEnvio: bloqueado exige motivo (≥ 5 letras); correo inválido o vacío → rechazado; normaliza y quita de CC los que ya van en Para');
  // estado de cuenta + correo
  const ec = R.armarEstadoCuenta({ clienteId: 'c1', clienteUuid: 'u1', nombre: 'ACME', nit: '123', diasCredito: 30 }, [fac('A', -40, 1000), fac('B', -5, 1500, { total: 3000, cobrado: 1000, ncs: 500 }), fac('C', 10, 200), fac('D', -3, 300, { cedida: true }), fac('E', -3, 0)], [{ correlativo: 'PAQ-0007', nombre: 'Pre empleo', usadas: 63, cantidad: 100, remanente: 37, venceEn: '2026-12-31', estado: 'activo' }], 'Banco X · cuenta 123', hoy);
  ok(ec.totales.saldo === 2700 && ec.totales.vencido === 2500 && ec.totales.porVencer === 200 && ec.totales.n === 3 && ec.facturas.map(f => f.noFactura).join() === 'A,B,C' && ec.facturas[0].tramo === '31-60' && ec.facturas[1].tramo === '1-30' && ec.facturas[2].tramo === 'por_vencer' && ec.aging.find(a => a.tramo === '31-60')!.monto === 1000 && ec.cedidas.length === 1 && ec.paquetes[0].remanente === 37 && /B \| .* \| Q3,000\.00 \| Q1,500\.00/.test(R.textoEstadoCuenta(ec)) && /PAQ-0007 · Pre empleo: 63 usadas de 100 · 37 restantes/.test(R.textoEstadoCuenta(ec)) && R.csvEstadoCuenta(ec).split('\n').length === 5 && /B,.*,3000\.00,1000\.00,500\.00,1500\.00/.test(R.csvEstadoCuenta(ec)), 'estado de cuenta: saldo real por factura (3,000 − 1,000 cobrado − 500 NC = 1,500), totales y tramos, la cedida aparte y la sin saldo fuera, paquete con remanente; texto y CSV');
  const cm = CO.correoCobranza({ asunto: 'Factura vencida · {{facturas}} · {{emisor}}', cuerpo: 'Estimado/a {{contacto}}:\n\nDebe {{saldo}}.\n\n{{estado_cuenta}}\n\n{{datos_pago}}\n\nGracias <b>no html</b>', ec, datosPago: 'Pagar a {{emisor}} NIT {{nit_emisor}}', vars: { contacto: 'Marta', facturas: 'A, B', saldo: 'Q2,500.00', emisor: 'Golden Talent', nit_emisor: '1-1', cliente: 'ACME' }, emisor: 'Golden Talent', remitente: 'Rita' });
  ok(cm.asunto === 'Factura vencida · A, B · Golden Talent' && /<table/.test(cm.html) && /Q1,500\.00/.test(cm.html) && /PAQ-0007/.test(cm.html) && /Pagar a Golden Talent NIT 1-1/.test(cm.html) && /&lt;b&gt;no html&lt;\/b&gt;/.test(cm.html) && !/\{\{/.test(cm.html) && !/src=|https?:\/\//.test(cm.html) && /ESTADO DE CUENTA · ACME/.test(cm.texto) && /Pagar a Golden Talent/.test(cm.texto) && /Rita · Golden Talent/.test(cm.texto), 'correo armado: asunto y cuerpo renderizados, {{estado_cuenta}} → tabla con los saldos reales y el paquete, {{datos_pago}} → bloque, el texto de la persona escapado, sin variables sueltas ni recursos externos; versión texto con el bloque');
  ok(claves({ facturas: [fac('A', -5), fac('B', 2)] }, reglas.map(r => ({ ...r, activo: false }))) === '' && claves({ facturas: [fac('A', -5), fac('B', 2)] }, reglas.map(r => (r.clave === 'por_vencer' ? { ...r, dias: 1 } : r))) === 'vencida:A', 'reglas de la tabla mandan: desactivada no propone; con «por vencer» a 1 día la que vence en 2 no entra');

  /* ───────────── C. HIT ───────────── */
  console.log(`\nC. HIT${CONSERVAR ? ' (--conservar)' : SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const limpiar = async () => {
    const { data: cl } = await sb.from('clientes').select('id').in('nit', [NIT1, NIT2]);
    const ids = (cl ?? []).map(c => c.id as string);
    if (ids.length) {
      const { data: pq } = await sb.from('paquete').select('id').in('cliente_id', ids);
      const pids = (pq ?? []).map(p => p.id as string);
      if (pids.length) { await sb.from('paquete_linea').delete().in('paquete_id', pids); await sb.from('paquete').delete().in('id', pids); }
      const { data: fs2 } = await sb.from('facturas_clientes').select('id').in('cliente_id', ids);
      const fids = (fs2 ?? []).map(f => f.id as string);
      if (fids.length) { await sb.from('cobros_clientes').delete().in('factura_id', fids); await sb.from('notas_credito').delete().in('factura_id', fids); await sb.from('facturas_clientes').delete().in('id', fids); }
      await sb.from('clientes').delete().in('id', ids);   // cascada a contactos, eventos y omisiones
    }
    const { count } = await sb.from('clientes').select('id', { count: 'exact', head: true }).in('nit', [NIT1, NIT2]);
    return count ?? 0;
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: clientes de prueba borrados con facturas, cobros, NC, paquete, eventos, contactos y omisiones'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();
  const hoyR = (await import('../src/lib/utils/fechas')).obtenerFechaHoyGuatemala();
  const dr = (n: number) => E.sumarDias(hoyR, n);
  const { data: c1 } = await sb.from('clientes').insert({ airtable_id: APP1, nombre_empresa: 'CR E2E RECORDATORIOS', razon_social: 'CR E2E RECORDATORIOS, S.A.', nit: NIT1, activo: true, dias_credito: 30, responsable_cobro: ACTOR.email }).select('id').single();
  const { data: c2 } = await sb.from('clientes').insert({ airtable_id: APP2, nombre_empresa: 'CR E2E DISPUTA', razon_social: 'CR E2E DISPUTA, S.A.', nit: NIT2, activo: true, dias_credito: 30 }).select('id').single();
  const U1 = String(c1?.id ?? ''), U2 = String(c2?.id ?? '');
  await sb.from('cliente_contacto').insert([
    { cliente_id: U1, nombre: 'Marta Pagos', rol: 'pagos', correo: 'pagos@cr-e2e.example', preferido: false, creado_por: 'seed' },
    { cliente_id: U1, nombre: 'Andrea Blanco', rol: 'cuentas_por_pagar', correo: 'andrea@cr-e2e.example', preferido: true, creado_por: 'seed' },
    { cliente_id: U1, nombre: 'Sin correo', rol: 'otro', telefono: '2222', preferido: false, creado_por: 'seed' },
    { cliente_id: U2, nombre: 'Pedro Pagos', rol: 'pagos', correo: 'pedro@cr-e2e.example', preferido: true, creado_por: 'seed' },
  ]);
  const F = (no: string, fecha: string, total: number, estado: string, cliente: string, i: number) => ({ airtable_id: `recCRE2E${String(i).padStart(3, '0')}`, no_factura: no, cliente_id: cliente, fecha_emision: fecha, subtotal: Math.round(total / 1.12 * 100) / 100, iva: Math.round((total - total / 1.12) * 100) / 100, total, estado });
  const { data: insF, error: eF } = await sb.from('facturas_clientes').insert([
    F(`${PREFIJO}001`, dr(-31), 1000, 'EMITIDA', U1, 1),            // vencida hace 1 día → regla vencida
    F(`${PREFIJO}002`, dr(-27), 2000, 'EMITIDA', U1, 2),            // vence en 3 → por vencer
    F(`${PREFIJO}003`, dr(-10), 3000, 'COBRADO PARCIAL ', U1, 3),   // al día; cobro 1,000 + NC 500 → saldo 1,500 (solo en el estado de cuenta)
    F(`${PREFIJO}004`, dr(-60), 700, 'COBRADO ', U1, 4),            // cobrada: fuera
    F(`${PREFIJO}101`, dr(-45), 5000, 'EMITIDA', U2, 5),            // vencida hace 15 días, con disputa → bloqueada
  ]).select('id, no_factura');
  const fid = (no: string) => (insF ?? []).find(r => r.no_factura === no)?.id as string;
  const { error: eCob } = await sb.from('cobros_clientes').insert([{ factura_id: fid(`${PREFIJO}003`), monto_cobrado: 1000, monto_cobro_gtq: 1000, fecha_cobro: dr(-2), estado_cobro: 'Activo', metodo: 'Transferencia', estado: 'Pendiente' }, { factura_id: fid(`${PREFIJO}004`), monto_cobrado: 700, monto_cobro_gtq: 700, fecha_cobro: dr(-20), estado_cobro: 'Activo', metodo: 'Transferencia', estado: 'Pendiente' }]);
  const { error: eNc } = await sb.from('notas_credito').insert({ numero_nc: `${PREFIJO}NC1`, factura_id: fid(`${PREFIJO}003`), cliente_id: U1, fecha_emision: dr(-3), monto: 500, motivo: 'Descuento', estado: 'Activa', emitida_por: 'seed' });
  // promesa de ayer sobre la 001 (pasa a incumplida al cerrar) y disputa en el cliente 2
  await sb.from('cobranza_evento').insert([
    { cliente_id: U1, tipo: 'promesa', origen: 'manual', fecha: `${dr(-5)}T18:00:00.000Z`, facturas: [`${PREFIJO}001`], monto: 1000, fecha_promesa: dr(-1), promesa_estado: 'pendiente', creado_por: 'seed' },
    { cliente_id: U2, tipo: 'gestion', origen: 'manual', fecha: `${dr(-2)}T18:00:00.000Z`, canal: 'correo', resultado: 'disputa', comentario: 'No reconocen la línea 2', disputa_motivo: 'línea 2', facturas: [`${PREFIJO}101`], proximo_seguimiento: dr(5), creado_por: 'seed' },
  ]);
  // paquete prepagado del cliente 1 (034): solo informa remanente en el estado de cuenta; nunca genera cobro
  const { data: pq } = await sb.from('paquete').insert({ nit: NIT1, cliente_id: U1, nombre: 'Paquete E2E', fecha_inicio: dr(-30), estado: 'activo', creado_por: 'seed' }).select('id, correlativo').single();
  if (pq) await sb.from('paquete_linea').insert({ paquete_id: pq.id, servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', cantidad: 40, precio_unitario: 400 });
  ok(!!U1 && !!U2 && !eF && !eCob && !eNc && (insF ?? []).length === 5 && !!pq, `sembrado: 2 clientes (${NIT1} con 3 contactos y paquete ${pq?.correlativo ?? '—'}; ${NIT2} con disputa), 5 facturas, 2 cobros, 1 NC, 1 promesa de ayer${eF ? ' · ' + eF.message : ''}${eCob ? ' · ' + eCob.message : ''}${eNc ? ' · ' + eNc.message : ''}`);
  const C = await import('../src/lib/db/cobranza');
  const DB = await import('../src/lib/db/cobranza-recordatorios');
  const RS = await import('../src/lib/correo/resend');
  await C.cerrarPromesas();
  const reglasHit = await DB.getReglas();
  const plantillasHit = await DB.getPlantillas();
  ok(reglasHit.disponible && reglasHit.reglas.length === 4 && reglasHit.reglas.find(r => r.clave === 'vencida')?.cadaDias === 7 && !!plantillasHit && Object.keys(plantillasHit).length === 6 && /\{\{estado_cuenta\}\}/.test(plantillasHit!.vencida.cuerpo), 'HIT: 4 reglas y 6 plantillas de la 035 leídas de la tabla');
  const d0 = await DB.getDatosRecordatorios({ email: 'admin@x.com', nombre: 'Admin', rol: 'admin' });
  const mios = (dd: typeof d0) => dd.borradores.filter(b => b.clienteId === APP1 || b.clienteId === APP2);
  const b0 = mios(d0);
  const bV = b0.find(b => b.regla === 'vencida' && b.clienteId === APP1), bPV = b0.find(b => b.regla === 'por_vencer'), bPI = b0.find(b => b.regla === 'promesa_incumplida'), bD = b0.find(b => b.clienteId === APP2);
  ok(d0.disponible && b0.length === 4 && !!bV && bV.facturas.join() === `${PREFIJO}001` && bV.monto === 1000 && !!bPV && bPV.facturas.join() === `${PREFIJO}002` && !!bPI && bPI.promesa?.fecha === dr(-1) && !!bD && bD.regla === 'vencida' && bD.bloqueo?.tipo === 'disputa' && !bV.bloqueo && !b0.some(b => b.facturas.includes(`${PREFIJO}003`) || b.facturas.includes(`${PREFIJO}004`)), `borradores de hoy: vencida (001), por vencer (002), promesa incumplida (001) para ${APP1}; vencida BLOQUEADA por disputa para ${APP2}; la parcial al día y la cobrada no entran (${b0.map(b => `${b.regla}${b.bloqueo ? '!' : ''}`).join(', ')})`);
  ok(bV!.destinatario?.correo === 'andrea@cr-e2e.example' && bV!.destinatariosPosibles.length === 2 && bV!.cc.join() === ACTOR.email && /CR-E2E-001/.test(bV!.asunto) && /Estimado\/a Andrea Blanco/.test(bV!.cuerpo) && /\{\{estado_cuenta\}\}/.test(bV!.cuerpo) && /Datos para pagar/.test(bV!.cuerpo) && !/\{\{datos_pago\}\}/.test(bV!.cuerpo) && /hace 1 días|hace 1 día/.test(bV!.motivo), 'borrador preparado: destinatario = la preferida con correo (2 posibles; la sin correo no), CC = responsable, asunto con la factura, cuerpo con el saludo, {{estado_cuenta}} como marcador y «Datos para pagar» ya resuelto');
  const dCob = await DB.getDatosRecordatorios({ email: ACTOR.email, rol: 'cobranza' });
  const dAjena = await DB.getDatosRecordatorios({ email: 'otra@x.com', rol: 'cobranza' });
  ok(mios(dCob).some(b => b.clienteId === APP1) && mios(dCob).some(b => b.clienteId === APP2) && !mios(dAjena).some(b => b.clienteId === APP1) && mios(dAjena).some(b => b.clienteId === APP2), '«mis clientes» del rol cobranza: ve los suyos y los sin responsable; otra persona no ve los del cliente asignado');
  // enviar (mock): evento + ya no se propone
  const envMal = await DB.enviarRecordatorio(bV!.id, { para: 'no-es-correo', asunto: bV!.asunto, cuerpo: bV!.cuerpo }, ACTOR);
  const env1 = await DB.enviarRecordatorio(bV!.id, { para: bV!.destinatario!.correo, cc: bV!.cc, asunto: bV!.asunto, cuerpo: bV!.cuerpo.replace('Le escribimos', 'Hola, le escribimos') }, ACTOR);
  const mock1 = RS.ultimosMock[RS.ultimosMock.length - 1];
  const evs1 = await C.getEventos(U1);
  const evCorreo = evs1.find(e => e.tipo === 'correo_enviado');
  const dCorreo = (evCorreo?.datos ?? {}) as Record<string, unknown>;
  ok(!envMal.ok && env1.ok && env1.modo === 'mock' && !!mock1 && mock1.para.join() === 'andrea@cr-e2e.example' && (mock1.cc ?? []).join() === ACTOR.email && mock1.respuestaA === ACTOR.email && /<table/.test(mock1.html) && /CR-E2E-003/.test(mock1.html) && /1,500\.00/.test(mock1.html) && !/CR-E2E-004/.test(mock1.html) && /Hola, le escribimos/.test(mock1.html) && new RegExp(pq!.correlativo).test(mock1.html) && !/https?:\/\//.test(mock1.html), 'enviar (mock): correo inválido rechazado; el bueno sale a la preferida con copia al responsable y reply-to = quien envía; el HTML lleva la tabla del estado de cuenta con el saldo real de la parcial (1,500), sin la cobrada, con el remanente del paquete, el texto editado y sin recursos externos');
  ok(!!evCorreo && evCorreo.origen === 'automatico' && evCorreo.creadoPor === ACTOR.email && evCorreo.facturas.join() === `${PREFIJO}001` && dCorreo.regla === 'vencida' && dCorreo.resultado === 'enviado' && dCorreo.modo === 'mock' && /ESTADO DE CUENTA/.test(String(dCorreo.cuerpo)) && /Recordatorio «vencida» enviado a andrea@cr-e2e\.example/.test(evCorreo.comentario), 'evento correo_enviado en el historial del cliente: regla, destinatarios, cuerpo con el estado de cuenta, resultado y quién lo mandó');
  const d1 = await DB.getDatosRecordatorios({ email: 'admin@x.com', rol: 'admin' });
  const envRepe = await DB.enviarRecordatorio(bV!.id, { para: 'andrea@cr-e2e.example', asunto: 'x', cuerpo: 'cuerpo de prueba largo' }, ACTOR);
  ok(!mios(d1).some(b => b.regla === 'vencida' && b.clienteId === APP1) && mios(d1).some(b => b.regla === 'por_vencer') && mios(d1).some(b => b.regla === 'promesa_incumplida') && !envRepe.ok && /ya no aplica/.test(envRepe.error), 'después de enviar, la «vencida» ya no se propone (hasta dentro de 7 días); las otras siguen; mandarla de nuevo → «ya no aplica»');
  // bloqueado: sin motivo no, con motivo sí (queda forzado)
  const envBloq = await DB.enviarRecordatorio(bD!.id, { para: 'pedro@cr-e2e.example', asunto: bD!.asunto, cuerpo: bD!.cuerpo }, ACTOR);
  const envForz = await DB.enviarRecordatorio(bD!.id, { para: 'pedro@cr-e2e.example', asunto: bD!.asunto, cuerpo: bD!.cuerpo, forzarMotivo: 'el cliente pidió el recordatorio igual' }, ACTOR);
  const ev2 = (await C.getEventos(U2)).find(e => e.tipo === 'correo_enviado');
  ok(!envBloq.ok && /bloqueado/i.test(envBloq.error) && envForz.ok && !!ev2 && (ev2.datos as { forzadoMotivo?: string }).forzadoMotivo === 'el cliente pidió el recordatorio igual' && (ev2.datos as { bloqueo?: string }).bloqueo === 'disputa' && /forzado:/.test(ev2.comentario), 'bloqueado por disputa: sin motivo → rechazado en el servidor; con motivo → sale y el evento guarda el motivo y el bloqueo');
  // omitir
  const om = await DB.omitirRecordatorio(U1, 'promesa_incumplida', dr(3), 'ya hablé con Andrea, paga el viernes', ACTOR.email);
  const omMal = await DB.omitirRecordatorio(U1, 'promesa_incumplida', dr(-1), 'x', ACTOR.email);
  const d2 = await DB.getDatosRecordatorios({ email: 'admin@x.com', rol: 'admin' });
  const bOm = mios(d2).find(b => b.regla === 'promesa_incumplida');
  ok(om.ok && !omMal.ok && bOm?.omitidoHasta === dr(3) && d2.resumen.total === d0.resumen.total - 3 && d2.resumen.omitidos >= 1, 'omitir hasta una fecha con motivo: el borrador queda marcado y fuera del total; fecha pasada o sin motivo → rechazado');
  // plantillas y reglas: editar (y restaurar)
  const pMal = await DB.editarPlantilla('por_vencer', { asunto: 'Hola {{clientee}}', cuerpo: 'x'.repeat(10) }, ACTOR.email);
  const pOrig = plantillasHit!.por_vencer;
  const pOk = await DB.editarPlantilla('por_vencer', { asunto: 'Aviso de vencimiento · {{facturas}} · {{emisor}}', cuerpo: pOrig.cuerpo }, ACTOR.email);
  const d3 = await DB.getDatosRecordatorios({ email: 'admin@x.com', rol: 'admin' });
  const bPV3 = mios(d3).find(b => b.regla === 'por_vencer');
  const rOk = await DB.editarRegla('por_vencer', { activo: true, dias: 1, cadaDias: null }, ACTOR.email);
  const d4 = await DB.getDatosRecordatorios({ email: 'admin@x.com', rol: 'admin' });
  const rRest = await DB.editarRegla('por_vencer', { activo: true, dias: 3, cadaDias: null }, ACTOR.email);
  const pRest = await DB.editarPlantilla('por_vencer', { asunto: pOrig.asunto, cuerpo: pOrig.cuerpo }, ACTOR.email);
  const plantRest = await DB.getPlantillas();
  ok(!pMal.ok && /clientee/.test(pMal.error) && pOk.ok && bPV3?.asunto === `Aviso de vencimiento · ${PREFIJO}002 · ${(await import('../src/lib/config/empresa')).empresaConfig().nombre}` && rOk.ok && !mios(d4).some(b => b.regla === 'por_vencer') && rRest.ok && pRest.ok && plantRest!.por_vencer.asunto === pOrig.asunto && plantRest!.por_vencer.updatedPor === ACTOR.email, 'plantilla con variable inválida → rechazada; editada → el próximo borrador usa el asunto nuevo; regla «por vencer» a 1 día → la que vence en 3 ya no se propone; restauradas (quedan con quién las editó)');
  // estado de cuenta
  const ecD = await DB.getEstadoCuenta(APP1, ACTOR);
  const ecS = await DB.enviarEstadoCuenta(APP1, { para: 'pagos@cr-e2e.example', asunto: ecD!.asunto, cuerpo: ecD!.cuerpo }, ACTOR);
  const mock2 = RS.ultimosMock[RS.ultimosMock.length - 1];
  const evEC = (await C.getEventos(U1)).find(e => e.tipo === 'correo_enviado' && (e.datos as { tipo?: string }).tipo === 'estado_cuenta');
  const sqlEstado = async (no: string) => { const { data } = await sb.rpc('cobranza_estado_factura', { p_no_factura: no, p_hoy: hoyR }); return (data as { estado: string; modificadores: string[] }) ?? { estado: '?', modificadores: [] }; };
  const s1 = await sqlEstado(`${PREFIJO}001`), s2 = await sqlEstado(`${PREFIJO}002`), s3 = await sqlEstado(`${PREFIJO}003`);
  ok(!!ecD && ecD.ec.totales.saldo === 4500 && ecD.ec.totales.vencido === 1000 && ecD.ec.totales.n === 3 && ecD.ec.facturas.find(f => f.noFactura === `${PREFIJO}003`)?.saldo === 1500 && ecD.ec.facturas.find(f => f.noFactura === `${PREFIJO}003`)?.cobrado === 1000 && ecD.ec.facturas.find(f => f.noFactura === `${PREFIJO}003`)?.ncs === 500 && !ecD.ec.facturas.some(f => f.noFactura === `${PREFIJO}004`) && ecD.ec.paquetes[0]?.correlativo === pq!.correlativo && ecD.ec.paquetes[0].remanente === 40 && /Datos para pagar/.test(ecD.ec.datosPago) && ecD.destinatario?.correo === 'andrea@cr-e2e.example' && /Estado de cuenta al/.test(ecD.asunto), `estado de cuenta: saldo real 4,500 (1,000 + 2,000 + 1,500 de la parcial con cobro y NC), vencido 1,000, sin la cobrada, paquete ${pq!.correlativo} con 40 restantes, datos para pagar, correo propuesto`);
  ok(s1.estado === 'vencida' && s1.modificadores.includes('promesa_incumplida') && s2.estado === 'por_vencer' && s3.estado === 'al_dia' && s3.modificadores.includes('cobrada_parcial'), `coherencia con el estado SQL de la 033: 001 ${s1.estado}+${s1.modificadores.join('+')} (vencida + promesa incumplida), 002 ${s2.estado}, 003 ${s3.estado}+${s3.modificadores.join('+')}`);
  ok(ecS.ok && mock2.para.join() === 'pagos@cr-e2e.example' && /Estado de cuenta/.test(mock2.asunto) && /CR-E2E-003/.test(mock2.html) && /4,500\.00/.test(mock2.html) && !!evEC && evEC.monto === 4500 && evEC.facturas.length === 3 && /Estado de cuenta enviado a pagos@cr-e2e\.example/.test(evEC.comentario), 'enviar estado de cuenta desde la ficha: sale al contacto elegido con la tabla y el total; evento correo_enviado tipo estado_cuenta con las 3 facturas y el monto');
  // nada automático: un segundo getDatos no manda nada
  const antes = RS.ultimosMock.length; await DB.getDatosRecordatorios({ email: 'admin@x.com', rol: 'admin' }); await DB.getEstadoCuenta(APP1, ACTOR);
  ok(RS.ultimosMock.length === antes, 'cargar la pantalla o el estado de cuenta no manda nada: solo «Enviar» envía');
  if (!CONSERVAR) ok((await limpiar()) === 0, 'limpieza verificada: clientes de prueba borrados con facturas, cobros, NC, paquete, eventos, contactos y omisiones');
  else {
    // para el E2E: que los borradores vuelvan a proponerse (se borran los envíos y la omisión de la corrida; el seed queda)
    await sb.from('cobranza_evento').delete().in('cliente_id', [U1, U2]).eq('tipo', 'correo_enviado');
    await sb.from('cobranza_recordatorio_omision').delete().in('cliente_id', [U1, U2]);
    await sb.from('clientes').update({ responsable_cobro: null }).eq('id', U1);   // sin responsable: el usuario cobranza del E2E lo ve en «mis clientes»
    console.log(`  ⚪ --conservar: quedan ${APP1} (${NIT1}: vencida, por vencer, promesa incumplida, paquete ${pq?.correlativo}) y ${APP2} (${NIT2}: vencida bloqueada por disputa) sin envíos ni omisiones, para el E2E en Chrome (borrar con --solo-limpiar)`);
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
