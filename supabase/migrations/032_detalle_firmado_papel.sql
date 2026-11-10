-- 032 · SUBIR EL DETALLE FIRMADO EN PAPEL (escaneo o foto) AL DETALLE (brief del CFO, 10-nov-2026)
--
-- Por qué: muchos clientes no usan el link: imprimen el detalle, lo firman y lo devuelven escaneado o en foto. Ese
-- papel firmado es el respaldo de la aprobación y tiene que quedar guardado EN el detalle, a la vista de quien vaya a
-- facturar o a cobrar. Hoy no hay dónde guardarlo.
--
-- Qué hace:
--  1. aprobado_canal admite 'papel' (junto a correo, link y otro): aprobar con el papel firmado revoca el link digital.
--  2. Tabla detalle_facturacion_archivo (RLS, solo service_role): un archivo por fila con path, nombre, mime, bytes y
--     sha256; quién firmó, cargo, fecha de firma y notas; quién lo subió; y la trazabilidad del reemplazo
--     (reemplazado_por / reemplazado_en / motivo_reemplazo): el archivo anterior NUNCA se borra.
--  3. Bucket PRIVADO `detalles-firmados` (NO el bucket público `adjuntos`: el detalle lleva nombres de candidatos y la
--     firma del cliente): 15 MB por archivo, solo PDF / JPG / PNG / HEIC. Sin políticas de storage: solo service_role
--     (anon y authenticated no leen ni escriben). La descarga va por URL firmada de 5 minutos que genera el servidor
--     después de validar el permiso; la subida por URL firmada de subida (una por archivo, a un path fijo).
--  4. Ayuda del detalle: «Si el cliente lo devuelve firmado en papel: Subir detalle firmado» (idempotente).
--
-- El tipo real del archivo se valida en el servidor por sus primeros bytes (nunca por la extensión) al confirmar la
-- subida; allowed_mime_types del bucket es solo el primer filtro.
-- No toca: el flujo del link (029/031) salvo revocar el link al aprobar en papel; el IVA (030) ni la huella.
-- Idempotente; sin drop de tablas / funciones (solo drop constraint, patrón 018), sin delete, truncate, begin/commit.

-- ── 1. canal 'papel' ─────────────────────────────────────────────────────────────────────────────
alter table detalle_facturacion drop constraint if exists detalle_facturacion_aprobado_canal_check;
alter table detalle_facturacion add constraint detalle_facturacion_aprobado_canal_check check (aprobado_canal is null or aprobado_canal in ('correo', 'link', 'otro', 'papel'));

-- ── 2. archivos del detalle ──────────────────────────────────────────────────────────────────────
create table if not exists detalle_facturacion_archivo (
  id                uuid primary key default gen_random_uuid(),
  detalle_id        uuid not null references detalle_facturacion(id) on delete cascade,
  tipo              text not null default 'firmado_papel' check (tipo in ('firmado_papel')),
  path              text not null unique,
  nombre            text not null,
  mime              text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')),
  bytes             integer not null check (bytes > 0 and bytes <= 15728640),
  sha256            text not null check (length(sha256) = 64),
  firmado_por       text not null,
  firmado_cargo     text,
  firmado_fecha     date not null default current_date,
  notas             text,
  subido_por        text not null,
  subido_en         timestamptz not null default now(),
  reemplazado_por   uuid references detalle_facturacion_archivo(id) on delete set null,
  reemplazado_en    timestamptz,
  motivo_reemplazo  text
);
comment on table detalle_facturacion_archivo is '032: detalle firmado en papel (PDF / foto) en el bucket privado detalles-firmados. Un reemplazo o una quita marca reemplazado_en (+ reemplazado_por si hay archivo nuevo): el anterior no se borra.';
create index if not exists idx_detalle_archivo_detalle on detalle_facturacion_archivo (detalle_id, subido_en desc);
alter table detalle_facturacion_archivo enable row level security;
revoke all on table detalle_facturacion_archivo from public, anon, authenticated;
grant all on table detalle_facturacion_archivo to service_role;

-- ── 3. bucket privado ────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('detalles-firmados', 'detalles-firmados', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic'])
on conflict (id) do update set public = false, file_size_limit = 15728640, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/heic'];

-- ── 4. ayuda del detalle (idempotente) ───────────────────────────────────────────────────────────
update ayuda
   set contenido = contenido || E'\n\n**Si el cliente lo devuelve firmado en papel: *Subir detalle firmado*** (en el detalle, con el detalle enviado, con observaciones, aprobado o ya facturado). Acepta PDF, JPG, PNG y HEIC, hasta 5 archivos de 15 MB; se anota quién firmó, el cargo, la fecha y notas. Si el detalle está enviado o con observaciones, la misma acción lo marca **aprobado** con canal *papel* y revoca el link digital. El archivo queda en el detalle (Ver / Descargar, solo con sesión) y el imprimible dice «Firmado en papel por … · respaldo en el sistema». Reemplazar o quitar un archivo (admin y contador, con motivo) conserva el anterior como versión anterior.',
       updated_at = now()
 where slug = 'detalle-de-facturacion-armar-el-corte' and contenido not like '%Subir detalle firmado%';
