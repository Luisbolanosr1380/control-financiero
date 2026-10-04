/**
 * F-GESTION-USUARIOS — validador de permisos.
 *
 *  A. Auditoría estática: CADA export de cada archivo 'use server' valida
 *     permiso como primera instrucción, con la acción esperada.
 *  B. La matriz coincide con la del brief.
 *  C. Escenarios con usuarios simulados contra decidirAcceso (la MISMA
 *     función que usa el guard del servidor), en golden y en hit.
 *  D. Ida y vuelta real con Clerk: usuario descartable con accesos
 *     {golden: admin, hit: auxiliar} → se lee de Clerk y se decide → se borra.
 *
 * Uso: npx tsx scripts/validate-permisos.ts [--sin-clerk]
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); if (!(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim();
}

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => { if (cond) { pass++; console.log(`  🟢 ${msg}`); } else { fail++; console.log(`  🔴 ${msg}`); } };

function archivosUseServer(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...archivosUseServer(p));
    else if (/\.(ts|tsx)$/.test(e.name) && /^'use server';/m.test(fs.readFileSync(p, 'utf8'))) out.push(p);
  }
  return out;
}

(async () => {
  const R = await import('../src/lib/auth/roles');
  const { MATRIZ, decidirAcceso, aplicarCambioAccesos, empresasSinAdmin, accesosDeMetadata } = R;

  /* ───────────── A. Auditoría estática ───────────── */
  console.log('\nA. Cada server action valida permiso como primera instrucción');
  const ESPERADO: Record<string, string> = {
    aprobarFacturaAction: 'aprobar_gasto',
    registrarPagoDeudaAction: 'pagar',
    registrarPagoEmpleadoAction: 'pagar',
    anularPagoDeudaAction: 'anular',
    anularCobroAction: 'anular',
    anularNotaCreditoAction: 'anular',
    emitirNotaCreditoAction: 'anular',
    crearFacturaAction: 'emitir_factura',
    registrarCobroAction: 'registrar_cobro',
    procesarFacturasAction: 'registrar_gasto',
    generarAsientoPlanillaAction: 'cerrar_periodo',
    aprobarPeriodoAction: 'planilla',
    crearBancoAction: 'catalogos',
    crearDeudaAction: 'gestionar_deudas',
    conciliarAction: 'conciliar',
    deshacerConciliacionAction: 'conciliar',
    contabilizarMovimientoAction: 'conciliar',
    importarMovimientosAction: 'registrar_movimiento',
    cederFacturasAction: 'ceder_factura',
    cambiarEstadoCesionAction: 'factoraje',
    contabilizarFactorajeAction: 'factoraje',
  };
  const sinGuard: string[] = [];
  let totalActions = 0;
  const accionDe = new Map<string, Set<string>>();
  for (const f of archivosUseServer(path.join(process.cwd(), 'src'))) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /^export async function (\w+)\s*\(/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      totalActions++;
      const fn = m[1];
      // cuerpo: desde el primer '{' de fin de firma
      let i = src.indexOf(') {', m.index); const j = src.indexOf('):', m.index);
      if (j !== -1 && (i === -1 || j < i)) i = src.indexOf('{\n', j);
      else i = i + 2;
      const cuerpo = src.slice(i, i + 400).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//') && l !== '{');
      const primera = cuerpo[0] ?? '';
      const g = primera.match(/(?:autorizar|exigir)\('(\w+)'\)/);
      const viaHelper = /^const (auth|ctx) = await (exigirAdmin|contexto)\(\);/.test(primera);
      if (!g && !viaHelper) { sinGuard.push(`${path.relative(process.cwd(), f)} · ${fn} → "${primera.slice(0, 70)}"`); continue; }
      const acc = g ? g[1] : (primera.includes('exigirAdmin') ? 'configurar_empresa' : 'gestionar_usuarios');
      if (!accionDe.has(fn)) accionDe.set(fn, new Set());
      accionDe.get(fn)!.add(acc);
    }
  }
  ok(sinGuard.length === 0, `${totalActions} server actions, ${totalActions - sinGuard.length} con guard en la primera línea`);
  for (const s of sinGuard) console.log(`     ✗ ${s}`);
  for (const [fn, acc] of Object.entries(ESPERADO)) {
    const got = [...(accionDe.get(fn) ?? [])];
    ok(got.length > 0 && got.every(a => a === acc), `${fn} → ${acc}${got.length && !got.every(a => a === acc) ? ` (encontrado: ${got.join(',')})` : ''}`);
  }
  for (const fn of ['invitarUsuarioAction', 'actualizarAccesosAction', 'bloquearUsuarioAction', 'revocarInvitacionAction']) {
    ok(accionDe.get(fn)?.has('gestionar_usuarios') ?? false, `${fn} → gestionar_usuarios (solo admin)`);
  }
  const usuariosActions = fs.readFileSync('src/app/(app)/admin/usuarios/actions.ts', 'utf8');
  ok(/async function contexto\(\) \{\n  const permiso = await autorizar\('gestionar_usuarios'\);/.test(usuariosActions), 'helper contexto() exige gestionar_usuarios antes de todo');
  for (const [p, acc] of [['planillas', 'planilla'], ['empleados', 'planilla'], ['facturacion/nueva', 'emitir_factura'], ['admin/catalogos', 'catalogos']] as const) {
    const s = fs.readFileSync(`src/app/(app)/${p}/page.tsx`, 'utf8');
    ok(s.includes(`exigirPagina('${acc}')`), `página /${p} exige '${acc}'`);
  }
  const usuariosPage = fs.readFileSync('src/app/(app)/admin/usuarios/page.tsx', 'utf8');
  ok(usuariosPage.includes("puede(rol, 'gestionar_usuarios')"), 'página /admin/usuarios solo para gestionar_usuarios (admin)');

  /* ───────────── B. Matriz del brief ───────────── */
  console.log('\nB. Matriz = brief');
  const BRIEF: Array<[string, string, boolean, boolean, boolean, boolean]> = [
    ['ver', 'Ver reportes/dashboard', true, true, true, true],
    ['emitir_factura', 'Emitir facturas', true, true, true, false],
    ['registrar_cobro', 'Registrar cobros', true, true, true, false],
    ['registrar_gasto', 'Registrar/meter gastos', true, true, true, false],
    ['aprobar_gasto', 'APROBAR gastos', true, true, false, false],
    ['pagar', 'Hacer PAGOS', true, true, false, false],
    ['anular', 'Anular', true, true, false, false],
    ['planilla', 'Procesar planilla', true, true, false, false],
    ['cerrar_periodo', 'Cerrar períodos / asientos', true, true, false, false],
    ['catalogos', 'Crear/editar catálogos', true, true, false, false],
    ['gestionar_usuarios', 'Gestionar usuarios', true, false, false, false],
    ['configurar_empresa', 'Configurar empresa', true, false, false, false],
  ];
  for (const [acc, label, ad, co, au, le] of BRIEF) {
    const m = MATRIZ[acc as keyof typeof MATRIZ];
    const real = [m.includes('admin'), m.includes('contador'), m.includes('auxiliar'), m.includes('lectura')];
    ok(JSON.stringify(real) === JSON.stringify([ad, co, au, le]), `${label}: ${real.map(x => (x ? '✓' : '✗')).join(' ')}`);
  }

  /* ───────────── C. Escenarios ───────────── */
  const legacy = {
    rolesExplicitos: { 'luis@goldentalent.org': 'admin', 'rcontreras@goldentalent.org': 'admin' } as Record<string, 'admin'>,
    allowedEmails: ['luisbolanosr1380@gmail.com'],
    allowedDomain: 'goldentalent.org',
  };
  const NOMBRES: Record<string, string> = { golden: 'Golden Talent', hit: 'High Impact Talent' };
  const decide = (meta: unknown, email: string, accion: Parameters<typeof decidirAcceso>[0]['accion'], slug: string, banned = false) =>
    decidirAcceso({ usuario: { id: 'u1', banned, email, meta }, accion, slugDeploy: slug, nombreEmpresa: NOMBRES[slug], legacy });

  console.log('\nC1. Auxiliar en HIT: registra pero NO aprueba ni paga');
  const aux = { accesos: [{ empresa_slug: 'hit', rol: 'auxiliar' }] };
  for (const a of ['emitir_factura', 'registrar_cobro', 'registrar_gasto'] as const) ok(decide(aux, 'aux@x.com', a, 'hit').ok, `auxiliar/HIT puede ${a}`);
  for (const a of ['aprobar_gasto', 'pagar', 'anular', 'planilla', 'cerrar_periodo', 'catalogos', 'gestionar_usuarios'] as const) {
    const d = decide(aux, 'aux@x.com', a, 'hit');
    ok(!d.ok, `auxiliar/HIT rechazado en ${a}`);
  }
  const msg = decide(aux, 'aux@x.com', 'aprobar_gasto', 'hit');
  ok(!msg.ok && msg.error.includes('Auxiliar') && msg.error.includes('aprobar gastos') && msg.error.includes('High Impact Talent'), `mensaje claro: "${!msg.ok ? msg.error : ''}"`);
  ok(!decide(aux, 'aux@x.com', 'ver', 'golden').ok, 'auxiliar de HIT no entra a Golden (aislamiento)');

  console.log('\nC2. Contador SÍ aprueba y paga');
  const cont = { accesos: [{ empresa_slug: 'golden', rol: 'contador' }] };
  for (const a of ['aprobar_gasto', 'pagar', 'anular', 'planilla', 'cerrar_periodo', 'catalogos'] as const) ok(decide(cont, 'c@x.com', a, 'golden').ok, `contador/Golden puede ${a}`);
  ok(!decide(cont, 'c@x.com', 'gestionar_usuarios', 'golden').ok, 'contador NO gestiona usuarios');

  console.log('\nC3. Admin en Golden + auxiliar en HIT');
  const mixto = { accesos: [{ empresa_slug: 'golden', rol: 'admin' }, { empresa_slug: 'hit', rol: 'auxiliar' }] };
  ok(decide(mixto, 'm@x.com', 'aprobar_gasto', 'golden').ok && decide(mixto, 'm@x.com', 'gestionar_usuarios', 'golden').ok, 'en Golden: aprueba y gestiona usuarios');
  ok(!decide(mixto, 'm@x.com', 'aprobar_gasto', 'hit').ok && !decide(mixto, 'm@x.com', 'gestionar_usuarios', 'hit').ok, 'en HIT: NO aprueba ni gestiona usuarios');
  ok(decide(mixto, 'm@x.com', 'emitir_factura', 'hit').ok, 'en HIT: sí factura');

  console.log('\nC4. Solo lectura no registra nada');
  const lec = { accesos: [{ empresa_slug: 'golden', rol: 'lectura' }] };
  ok(decide(lec, 'l@x.com', 'ver', 'golden').ok, 'lectura ve reportes');
  for (const a of ['emitir_factura', 'registrar_cobro', 'registrar_gasto', 'etiquetar', 'aprobar_gasto', 'pagar', 'anular'] as const) ok(!decide(lec, 'l@x.com', a, 'golden').ok, `lectura rechazado en ${a}`);

  console.log('\nC5. Bordes de seguridad');
  ok(!decide({ accesos: [{ empresa_slug: 'hit', rol: 'admin' }] }, 'luis@goldentalent.org', 'ver', 'golden').ok, 'accesos presente es autoritativo: admin del allowlist sin entrada golden → sin acceso a Golden');
  ok(!decide({ accesos: 'admin' }, 'x@x.com', 'ver', 'golden').ok, 'accesos malformado → sin acceso (fail-closed)');
  ok(accesosDeMetadata({ accesos: [{ empresa_slug: 'golden', rol: 'superadmin' }] })!.length === 0, 'rol desconocido se descarta (no se interpreta)');
  ok(!decide({ accesos: [] }, 'x@x.com', 'ver', 'golden').ok, 'accesos vacío → sin acceso');
  ok(!decide(cont, 'c@x.com', 'ver', 'golden', true).ok, 'usuario bloqueado → rechazado');
  ok(!decidirAcceso({ usuario: null, accion: 'ver', slugDeploy: 'golden', nombreEmpresa: 'G', legacy }).ok, 'sin sesión → rechazado');

  console.log('\nC6. Compatibilidad (usuarios aún sin accesos)');
  const leg = (email: string, slug = 'golden', meta: unknown = {}) => { const d = decide(meta, email, 'ver', slug); return d.ok ? d.rol : null; };
  ok(leg('luis@goldentalent.org') === 'admin', 'email explícito admin → admin');
  ok(leg('alejandra.dieguez@goldentalent.org') === 'lectura', 'solo por dominio → lectura (mínimo privilegio hasta que un admin le asigne rol)');
  ok(leg('extrano@gmail.com') === null, 'fuera del allowlist → sin acceso');
  ok(leg('luis@goldentalent.org', 'golden', { empresas: [{ slug: 'hit' }] }) === null, 'viejo metadata.empresas sigue aislando');

  console.log('\nC7. Reglas de gestión (anti-escalada / último admin)');
  const soloGolden = [{ empresa_slug: 'golden', rol: 'admin' as const }];
  ok(!aplicarCambioAccesos({ accesosActor: soloGolden, accesosDestinoActuales: [], accesosDestinoNuevos: [{ empresa_slug: 'hit', rol: 'admin' }] }).ok, 'admin solo de Golden NO puede dar acceso a HIT');
  ok(aplicarCambioAccesos({ accesosActor: soloGolden, accesosDestinoActuales: [{ empresa_slug: 'hit', rol: 'auxiliar' }], accesosDestinoNuevos: [{ empresa_slug: 'hit', rol: 'auxiliar' }, { empresa_slug: 'golden', rol: 'contador' }] }).ok, 'puede dar Golden sin tocar el HIT existente');
  ok(!aplicarCambioAccesos({ accesosActor: soloGolden, accesosDestinoActuales: [{ empresa_slug: 'hit', rol: 'auxiliar' }], accesosDestinoNuevos: [] }).ok, 'NO puede quitar el acceso a HIT que no administra');
  const us = [{ id: 'a', activo: true, accesos: soloGolden }, { id: 'b', activo: true, accesos: [{ empresa_slug: 'golden', rol: 'contador' as const }] }];
  ok(empresasSinAdmin({ usuarios: us, destinoId: 'a', nuevosAccesos: [{ empresa_slug: 'golden', rol: 'contador' }] }).includes('golden'), 'bajar al único admin → Golden quedaría sin admin (bloqueado)');
  ok(empresasSinAdmin({ usuarios: us, destinoId: 'a', nuevosAccesos: null }).includes('golden'), 'bloquear al único admin → bloqueado');
  ok(empresasSinAdmin({ usuarios: us, destinoId: 'b', nuevosAccesos: [] }).length === 0, 'quitar a un contador no deja huérfana a la empresa');

  /* ───────────── D. Clerk real ───────────── */
  if (!process.argv.includes('--sin-clerk')) {
    console.log('\nD. Ida y vuelta con Clerk (usuario descartable)');
    const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
    const c = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
    const email = `validador.permisos+${Date.now()}@example.com`;
    let id: string | null = null;
    try {
      const u = await c.users.createUser({ emailAddress: [email], skipPasswordRequirement: true, firstName: 'Validador', lastName: 'Permisos' });
      id = u.id;
      await c.users.updateUserMetadata(u.id, { publicMetadata: { accesos: mixto.accesos } });
      const leido = await c.users.getUser(u.id);
      const meta = leido.publicMetadata;
      ok(JSON.stringify(accesosDeMetadata(meta)) === JSON.stringify(mixto.accesos), 'accesos persistidos y leídos de Clerk tal cual');
      const dg = decidirAcceso({ usuario: { id: u.id, banned: leido.banned, email, meta }, accion: 'pagar', slugDeploy: 'golden', nombreEmpresa: 'Golden Talent', legacy });
      const dh = decidirAcceso({ usuario: { id: u.id, banned: leido.banned, email, meta }, accion: 'pagar', slugDeploy: 'hit', nombreEmpresa: 'High Impact Talent', legacy });
      ok(dg.ok && !dh.ok, 'mismo usuario de Clerk: paga en Golden (admin), rechazado en HIT (auxiliar)');
      await c.users.banUser(u.id);
      const ban = await c.users.getUser(u.id);
      ok(!decidirAcceso({ usuario: { id: u.id, banned: ban.banned, email, meta: ban.publicMetadata }, accion: 'ver', slugDeploy: 'golden', nombreEmpresa: 'G', legacy }).ok, 'bloqueado en Clerk → sin acceso');
    } catch (err) {
      ok(false, `Clerk: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (id) { await c.users.deleteUser(id); console.log('     (usuario descartable borrado)'); }
    }

    console.log('\nD2. Invitación con accesos (sin enviar email) → listado → revocar');
    let invId: string | null = null;
    try {
      const invEmail = `validador.invitacion+${Date.now()}@example.com`;
      const inv = await c.invitations.createInvitation({ emailAddress: invEmail, publicMetadata: { accesos: aux.accesos, nombre_invitado: 'Validador' }, notify: false });
      invId = inv.id;
      const pend = await c.invitations.getInvitationList({ status: 'pending', limit: 100 });
      const enLista = pend.data.find((i: { id: string }) => i.id === inv.id);
      ok(!!enLista && JSON.stringify(accesosDeMetadata(enLista.publicMetadata)) === JSON.stringify(aux.accesos), 'invitación pendiente con accesos {hit: auxiliar}');
      await c.invitations.revokeInvitation(inv.id); invId = null;
      ok(true, 'invitación revocada');
    } catch (err) {
      ok(false, `Clerk invitación: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (invId) await c.invitations.revokeInvitation(invId).catch(() => {});
    }

    console.log('\nD3. Usuarios reales migrados (rol efectivo por empresa)');
    const ESPERA: Record<string, { golden: string | null; hit: string | null }> = {
      'luis@goldentalent.org':              { golden: 'admin',    hit: 'admin' },
      'rcontreras@goldentalent.org':        { golden: 'admin',    hit: 'admin' },
      'alejandra.dieguez@goldentalent.org': { golden: 'contador', hit: null },
    };
    const { data } = await c.users.getUserList({ limit: 200 });
    for (const u of data) {
      const email = (u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? '').toLowerCase();
      const esp = ESPERA[email]; if (!esp) continue;
      const rol = (slug: string) => { const d = decidirAcceso({ usuario: { id: u.id, banned: u.banned, email, meta: u.publicMetadata }, accion: 'ver', slugDeploy: slug, nombreEmpresa: slug, legacy }); return d.ok ? d.rol : null; };
      ok(rol('golden') === esp.golden && rol('hit') === esp.hit, `${email}: golden=${rol('golden') ?? '—'}, hit=${rol('hit') ?? '—'}`);
    }
  }

  console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
