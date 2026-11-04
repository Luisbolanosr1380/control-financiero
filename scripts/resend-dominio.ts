/**
 * RESEND · registros DNS del dominio de envío (SPF, DKIM, retorno). Solo lectura sobre la cuenta de Resend.
 * Con RESEND_API_KEY en el entorno: crea (si no existe) o lee el dominio y muestra los registros que pide Resend,
 * para agregarlos en el DNS de golden-talent.com. Nunca imprime la llave.
 *
 * Uso: RESEND_API_KEY=re_… npx tsx scripts/resend-dominio.ts [--dominio golden-talent.com] [--crear]
 */
const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DOMINIO = arg('--dominio', 'golden-talent.com');
const CREAR = process.argv.includes('--crear');
(async () => {
  const key = String(process.env.RESEND_API_KEY ?? '').trim();
  if (!key) { console.error('Falta RESEND_API_KEY en el entorno (no la pongas en el código ni en el repo).'); process.exit(2); }
  const h = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const lista = await fetch('https://api.resend.com/domains', { headers: h }).then(r => r.json()) as { data?: Array<{ id: string; name: string; status: string }> };
  let dom = (lista.data ?? []).find(d => d.name === DOMINIO);
  if (!dom && CREAR) {
    const r = await fetch('https://api.resend.com/domains', { method: 'POST', headers: h, body: JSON.stringify({ name: DOMINIO, region: 'us-east-1' }) });
    const j = await r.json() as { id?: string; name?: string; status?: string; message?: string };
    if (!r.ok || !j.id) { console.error('No se pudo crear el dominio:', j.message ?? r.status); process.exit(1); }
    dom = { id: j.id, name: j.name ?? DOMINIO, status: j.status ?? 'not_started' };
  }
  if (!dom) { console.log(`El dominio ${DOMINIO} no existe en la cuenta. Corré con --crear para crearlo y obtener los registros.`); process.exit(0); }
  const det = await fetch(`https://api.resend.com/domains/${dom.id}`, { headers: h }).then(r => r.json()) as { status: string; records?: Array<{ record: string; name: string; type: string; value: string; ttl?: string; priority?: number; status?: string }> };
  console.log(`\nDominio ${DOMINIO} · estado: ${det.status}\n`);
  console.log('Registros DNS que pide Resend (agregar en el DNS de golden-talent.com):\n');
  for (const r of det.records ?? []) console.log(`  ${r.record.padEnd(6)} ${r.type.padEnd(4)} ${r.name.padEnd(40)} ${r.priority !== undefined ? `prioridad ${r.priority} ` : ''}${r.value}${r.status ? `   [${r.status}]` : ''}`);
  console.log('\nCuando los tres estén verificados en Resend, el envío desde facturacion@golden-talent.com queda habilitado.');
})().catch(e => { console.error(e); process.exit(1); });
