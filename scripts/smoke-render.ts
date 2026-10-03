/**
 * Smoke test de RENDER: carga rutas de la app con una sesión real de Clerk
 * contra un servidor Next (local `next start` o un deploy) y verifica que
 * respondan 200 con el contenido esperado. Es lo que faltaba cuando
 * /conciliacion pasó el E2E de datos pero cayó con 500 al renderizar.
 *
 * Cómo consigue sesión sin contraseña de nadie: crea un usuario
 * DESCARTABLE en Clerk (misma instancia que usan los deploys) con accesos
 * {golden: contador, hit: contador}, le crea una sesión por la Backend
 * API (sin contraseña ni 2FA; fallback: sign-in token por la FAPI) y usa
 * el JWT de sesión como cookie `__session`. Al terminar borra el usuario, pase lo que pase.
 *
 * Uso:
 *   npx tsx scripts/smoke-render.ts [--base http://localhost:3000] [--rutas /conciliacion,/dashboard]
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); if (!(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim();
}
const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:3000').replace(/\/$/, '');
const RUTAS = arg('--rutas', '/conciliacion,/reportes/facturacion,/cobros,/dashboard').split(',');

const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
const FAPI = 'https://' + Buffer.from(pk.replace(/^pk_(test|live)_/, ''), 'base64').toString('utf8').replace(/\$$/, '');

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };

(async () => {
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const email = `smoke.render+${Date.now()}@example.com`;
  const password = `Smoke-${Date.now()}-${Math.random().toString(36).slice(2)}!Aa9`;
  let userId: string | null = null;

  console.log(`\nSmoke render contra ${BASE} (Clerk FAPI ${FAPI})`);
  try {
    const u = await clerk.users.createUser({
      emailAddress: [email], password, firstName: 'Smoke', lastName: 'Render', skipPasswordChecks: true,
      publicMetadata: { accesos: [{ empresa_slug: 'golden', rol: 'contador' }, { empresa_slug: 'hit', rol: 'contador' }] },
    });
    userId = u.id;

    // Sesión vía Backend API (sin contraseña ni 2FA): sessions.createSession.
    // Fallback: sign-in token consumido por la FAPI (strategy=ticket).
    const db = await fetch(`${FAPI}/v1/dev_browser`, { method: 'POST' }).then(r => r.json()).catch(() => ({})) as { token?: string };
    let sesionId: string | null = null;
    try {
      const se = await clerk.sessions.createSession({ userId: u.id });
      sesionId = se.id;
      ok(true, `sesión creada por Backend API para usuario descartable ${email}`);
    } catch (e) {
      console.log(`  · createSession no disponible (${e instanceof Error ? e.message.slice(0, 80) : e}); probando sign-in token…`);
      const tk = await clerk.signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 300 });
      const si = await fetch(`${FAPI}/v1/client/sign_ins${db.token ? `?__clerk_db_jwt=${db.token}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ strategy: 'ticket', ticket: tk.token }),
      }).then(r => r.json()) as { response?: { status?: string; created_session_id?: string }; errors?: Array<{ long_message?: string; message?: string }> };
      if (si.errors?.length) throw new Error(`Sign-in ticket: ${si.errors[0].long_message ?? si.errors[0].message}`);
      sesionId = si.response?.created_session_id ?? null;
      if (!sesionId) throw new Error(`Sign-in ticket sin sesión (status ${si.response?.status}).`);
      ok(true, `sesión creada por sign-in token para usuario descartable ${email}`);
    }
    const sesion = { id: sesionId };

    const tokenSesion = async () => {
      const t = await clerk.sessions.getToken(sesion.id, '');   // JWT fresco de la sesión (dura 60 s)
      return (t as { jwt?: string }).jwt ?? String(t);
    };

    // Pedir como navegador: así un fallo de AUTENTICACIÓN en el middleware de
    // Clerk se ve como redirect a sign-in/handshake (3xx) y no como un 404
    // indistinguible de un not-found de la app. El JWT recién acuñado puede
    // caer fuera de la tolerancia de reloj del edge (nbf): breve espera y, solo
    // ante 3xx, reintento con token fresco. Un 404/500 de la app NO se reintenta.
    const pedir = async (ruta: string) => {
      for (let intento = 1; intento <= 3; intento++) {
        const jwt = await tokenSesion();
        await new Promise(r => setTimeout(r, 1500));
        const res = await fetch(`${BASE}${ruta}`, {
          redirect: 'manual',
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'User-Agent': 'Mozilla/5.0 smoke-render',
            Cookie: `__session=${jwt}; __client_uat=${Math.floor(Date.now() / 1000)}; __clerk_db_jwt=${db.token ?? ''}`,
          },
        });
        if (res.status >= 300 && res.status < 400 && intento < 3) {
          console.log(`  · ${ruta}: ${res.status} → ${res.headers.get('location')} (autenticación; reintento ${intento})`);
          continue;
        }
        return res;
      }
      throw new Error('inalcanzable');
    };

    for (const ruta of RUTAS) {
      const res = await pedir(ruta);
      const html = await res.text();
      const digest = html.match(/digest["']?\s*[:=]\s*["']?(\d{6,})/)?.[1];
      const titulo = html.match(/<h1[^>]*>([^<]*)/)?.[1]?.trim();
      const sel = ruta === '/conciliacion' ? html.includes('Conciliación bancaria') && (html.includes('Cuadre al') || html.includes('No hay bancos activos')) : true;
      ok(res.status === 200 && !digest && sel, `${ruta} → HTTP ${res.status}${digest ? ` · error digest ${digest}` : ''}${titulo ? ` · h1 "${titulo}"` : ''}${res.status >= 300 && res.status < 400 ? ` · redirige a ${res.headers.get('location')}` : ''}`);
      if (ruta === '/conciliacion' && res.status === 200) {
        ok(html.includes('<select') && html.includes('Saldo según banco'), '/conciliacion muestra selector de banco y panel de cuadre');
      }
    }
  } catch (err) {
    ok(false, err instanceof Error ? err.message : String(err));
  } finally {
    if (userId) { await clerk.users.deleteUser(userId).catch(() => {}); console.log('  (usuario descartable borrado)'); }
  }
  console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
  process.exit(fail ? 1 : 0);
})();
