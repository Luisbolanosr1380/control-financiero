/**
 * F-GESTION-USUARIOS — migración del metadata de Clerk al formato `accesos`.
 *
 * Para cada usuario SIN publicMetadata.accesos, calcula los accesos que
 * preservan lo que hoy puede hacer (esquema viejo):
 *   · golden: email explícito en ROLES_USUARIOS → su rol mapeado (admin→admin);
 *             entra por ALLOWED_EMAILS/ALLOWED_DOMAIN → 'contador' (el viejo
 *             'operativo' registraba, aprobaba y pagaba — no se le quita nada).
 *   · hit:    solo los emails explícitos de ROLES_USUARIOS (dueños) —
 *             mínimo privilegio en una empresa nueva; los demás se agregan
 *             desde Admin → Usuarios y accesos.
 *   · si el viejo metadata.empresas restringía empresas, se respeta.
 * Usuarios que ya tienen `accesos` no se tocan. No borra claves viejas
 * (rollback = quitar `accesos`).
 *
 * Uso: npx tsx scripts/migrar-accesos.ts            (simulación)
 *      npx tsx scripts/migrar-accesos.ts --aplicar  (escribe en Clerk)
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); if (!(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim();
}

(async () => {
  const aplicar = process.argv.includes('--aplicar');
  const { ROLES_USUARIOS, configLegacy } = await import('../src/lib/auth/allowlist');
  const { accesosDeMetadata, mapearRolLegacy } = await import('../src/lib/auth/roles');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const c = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const legacy = configLegacy();
  const dom = legacy.allowedDomain ? (legacy.allowedDomain.startsWith('@') ? legacy.allowedDomain : '@' + legacy.allowedDomain).toLowerCase() : '';

  const { data } = await c.users.getUserList({ limit: 200 });
  console.log(`\n${aplicar ? 'APLICANDO' : 'SIMULACIÓN'} — ${data.length} usuarios en Clerk\n`);
  let cambios = 0;
  for (const u of data) {
    const email = (u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? '').toLowerCase();
    if (accesosDeMetadata(u.publicMetadata) !== null) { console.log(`  = ${email}: ya tiene accesos, no se toca`); continue; }
    const viejasEmpresas = Array.isArray((u.publicMetadata as { empresas?: unknown })?.empresas)
      ? ((u.publicMetadata as { empresas: Array<{ slug?: string }> }).empresas).map(e => String(e.slug ?? '').toLowerCase())
      : null;
    const permitida = (slug: string) => viejasEmpresas === null || viejasEmpresas.includes(slug);
    const explicito = ROLES_USUARIOS[email];
    const porAllowlist = legacy.allowedEmails.includes(email) || (dom !== '' && email.endsWith(dom));
    const accesos: Array<{ empresa_slug: string; rol: string }> = [];
    if (permitida('golden') && (explicito || porAllowlist)) accesos.push({ empresa_slug: 'golden', rol: explicito ? mapearRolLegacy(explicito) : 'contador' });
    if (permitida('hit') && explicito) accesos.push({ empresa_slug: 'hit', rol: mapearRolLegacy(explicito) });
    if (accesos.length === 0) { console.log(`  · ${email}: sin acceso hoy → sin cambios`); continue; }
    console.log(`  → ${email}: ${accesos.map(a => `${a.empresa_slug}=${a.rol}`).join(', ')}`);
    cambios++;
    if (aplicar) await c.users.updateUserMetadata(u.id, { publicMetadata: { accesos } });
  }
  console.log(`\n${cambios} usuario(s) ${aplicar ? 'migrados' : 'a migrar'}${aplicar ? '' : ' — correr con --aplicar para escribir'}.\n`);
})();
