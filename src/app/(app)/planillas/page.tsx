import { getPeriodos, previewGeneracion } from '@/lib/db/planillas';
import { PlanillasListClient } from '@/components/planillas/planillas-list-client';

export const revalidate = 60;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function siguienteQuincenaNoCreada(
  existentes: Array<{ quincena: 1 | 2; mes: number; anio: number }>,
  hoy: Date,
): { quincena: 1 | 2; mes: number; anio: number; nombre: string } {
  const set = new Set(existentes.map(p => `${p.anio}-${p.mes}-${p.quincena}`));
  let y = hoy.getFullYear();
  let m = hoy.getMonth() + 1;
  let q: 1 | 2 = hoy.getDate() <= 15 ? 1 : 2;
  for (let i = 0; i < 24; i++) {
    if (!set.has(`${y}-${m}-${q}`)) {
      return { quincena: q, mes: m, anio: y, nombre: `Q${q}-${MESES[m - 1]}-${y}` };
    }
    if (q === 1) { q = 2; }
    else {
      q = 1;
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }
  return { quincena: q, mes: m, anio: y, nombre: `Q${q}-${MESES[m - 1]}-${y}` };
}

export default async function PlanillasPage() {
  const [periodos, preview] = await Promise.all([
    getPeriodos({ estado: 'todos' }),
    previewGeneracion(),
  ]);

  const periodosExistentes = periodos.map(p => ({
    quincena: p.quincena as 1 | 2,
    mes: p.mes,
    anio: p.anio,
  }));
  const proxima = siguienteQuincenaNoCreada(periodosExistentes, new Date());

  return (
    <PlanillasListClient
      periodos={periodos}
      empleadosActivos={preview.empleados}
      periodosExistentes={periodosExistentes}
      proximaPlanilla={proxima}
    />
  );
}
