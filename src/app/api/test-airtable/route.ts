import { airtable, TABLES } from '@/lib/db/airtable';

export async function GET() {
  if (!airtable) {
    return Response.json({
      ok: false,
      error: 'Airtable no configurado — revisá .env.local',
    }, { status: 500 });
  }

  try {
    // Leer las primeras 3 facturas para confirmar acceso
    const records = await airtable(TABLES.FACTURAS)
      .select({ maxRecords: 3 })
      .all();

    return Response.json({
      ok: true,
      count: records.length,
      sample: records.map(r => ({
        id: r.id,
        fields: Object.keys(r.fields),
      })),
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
