/**
 * Frontera servidor/cliente — chequeo ESTÁTICO.
 *
 * Un server component (page/layout sin 'use client') o una server action
 * ('use server') NO puede importar VALORES (funciones, constantes) de un
 * módulo que empieza con 'use client': Next.js lo compila pero revienta
 * en runtime ("Attempted to call X() from the server but X is on the
 * client"). Así cayó /conciliacion en producción con 500 — tsc y
 * `next build` no lo detectan. Esto sí.
 *
 * Reglas:
 *  · Importar un COMPONENTE cliente para renderizarlo en JSX está bien
 *    (eso es la frontera normal). Importar y LLAMAR una función no.
 *    Como estáticamente no distinguimos uso, la regla es: desde servidor,
 *    de un módulo cliente solo se importan identificadores PascalCase
 *    (componentes) o tipos. Cualquier helper camelCase/const → error.
 *  · `import type` y especificadores `type X` se ignoran.
 *
 * Uso: npx tsx scripts/validate-frontera-cliente.ts   (exit 1 si hay violaciones)
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...archivos(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const directiva = (src: string): 'client' | 'server' | null => {
  const m = src.match(/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use (client|server)['"]/);
  return m ? (m[1] as 'client' | 'server') : null;
};

function resolver(desde: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(desde), spec);
  else return null;   // paquete externo
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

interface Violacion { archivo: string; linea: number; modulo: string; nombres: string[] }

const todos = archivos(SRC);
const fuente = new Map(todos.map(f => [f, fs.readFileSync(f, 'utf8')]));
const esCliente = new Set(todos.filter(f => directiva(fuente.get(f)!) === 'client'));

// Lado servidor: pages/layouts/templates sin directiva + archivos 'use server'.
const ladoServidor = todos.filter(f => {
  const d = directiva(fuente.get(f)!);
  if (d === 'server') return true;
  if (d === 'client') return false;
  return /\/app\/.*\/(page|layout|template|default|loading|error|not-found)\.tsx?$/.test(f) || /\/app\/(page|layout)\.tsx?$/.test(f);
});

const violaciones: Violacion[] = [];
const importRe = /^import\s+(type\s+)?(\{[^}]*\}|[\w$]+|\*\s+as\s+[\w$]+)(?:\s*,\s*(\{[^}]*\}))?\s+from\s+['"]([^'"]+)['"]/gm;

for (const f of ladoServidor) {
  const src = fuente.get(f)!;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src))) {
    const [, soloTipos, clause, clause2, spec] = m;
    if (soloTipos) continue;
    const destino = resolver(f, spec);
    if (!destino || !esCliente.has(destino)) continue;
    const nombres: string[] = [];
    for (const c of [clause, clause2].filter(Boolean) as string[]) {
      if (c.startsWith('{')) {
        for (const parte of c.slice(1, -1).split(',')) {
          const t = parte.trim();
          if (!t || t.startsWith('type ')) continue;
          nombres.push(t.split(/\s+as\s+/)[0].trim());
        }
      } else if (!c.startsWith('*')) nombres.push(c.trim());   // default import
    }
    const sospechosos = nombres.filter(n => !/^[A-Z]/.test(n));   // camelCase/const = helper, no componente
    if (sospechosos.length) {
      violaciones.push({ archivo: path.relative(process.cwd(), f), linea: src.slice(0, m.index).split('\n').length, modulo: spec, nombres: sospechosos });
    }
  }
}

console.log(`\nFrontera servidor/cliente: ${ladoServidor.length} archivos de servidor revisados contra ${esCliente.size} módulos cliente.`);
if (violaciones.length === 0) {
  console.log('  🟢 ningún server component / server action importa helpers de un módulo \'use client\'\n');
  process.exit(0);
}
for (const v of violaciones) {
  console.log(`  🔴 ${v.archivo}:${v.linea} importa { ${v.nombres.join(', ')} } de '${v.modulo}' (módulo 'use client')`);
  console.log('     → mover el helper a un módulo sin \'use client\' y re-exportarlo desde el componente si hace falta.');
}
console.log('');
process.exit(1);
