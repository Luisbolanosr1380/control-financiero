-- 028 · DETALLE DE FACTURACIÓN: título del corte + "Dirigido a" (brief "Detalle digital", PR 1: filtros + impresión)
--
-- Por qué: el cliente pide cortes por persona ("a esta mandale los polígrafos de rutina; a esta otra los socios").
-- Al generar el detalle desde los filtros (servicio, categoría, territorio, solicitante, mes) se guarda un título
-- del corte opcional y editable ("Polígrafos rutina · Solicitante ADELA CEBALLOS · Oct 2026") y a quién va dirigido
-- del lado del cliente. Los dos salen en el documento imprimible y, en el PR 2, en el correo y el link de aprobación.
--
-- Solo dos columnas (la RPC detalle_facturacion_crear_pruebas no cambia: la app las guarda con un update al crear
-- y con "editar encabezado" después). Idempotente; sin drop, delete, truncate, begin/commit; sin tocar datos.
-- El artículo de ayuda va por upsert de slug (llega a ambas bases con la migración).

alter table detalle_facturacion add column if not exists titulo text;
alter table detalle_facturacion add column if not exists dirigido_a text;

comment on column detalle_facturacion.titulo is '028: título del corte (opcional, editable): qué incluye el detalle, propuesto desde los filtros al generarlo.';
comment on column detalle_facturacion.dirigido_a is '028: a quién va dirigido el detalle del lado del cliente (nombre de la persona), opcional.';

insert into ayuda (titulo, slug, categoria, descripcion_corta, contenido, orden, activo, tags_contextuales)
values (
  'Detalle de facturación — armar el corte, imprimirlo y que el cliente lo apruebe',
  'detalle-de-facturacion-armar-el-corte',
  'Facturación',
  'Cómo armar un detalle de servicios por servicio, categoría, territorio o solicitante, ponerle título y destinatario, imprimirlo con casillas y firma, y seguir el flujo hasta facturar.',
  E'## Qué es\n\nEl **detalle de servicios** (pre-liquidación) es la lista de pruebas con precio que se le manda al cliente para que la apruebe **antes** de emitir la factura. Se arma desde **Por facturar → el cliente**, eligiendo las pruebas y presionando *Generar detalle*.\n\n## Armar el corte con filtros\n\nAdemás de los filtros por mes de ingreso, mes de terminación y estado de cobro, la lista del cliente filtra por:\n\n- **Servicio**: polígrafo, polígrafo basic, socioeconómico, socio virtual, fee de visita, Infornet… (solo los que el cliente tiene).\n- **Categoría**: pre empleo, rutina, específico.\n- **Territorio**: metro o depto.\n- **Solicitante**: la persona del cliente que pidió la evaluación (viene de la Agenda). Los vacíos aparecen como *Sin solicitante*.\n\nLos filtros trabajan **por prueba**: en un COMPLETO, si filtrás *Polígrafo* solo se ve y se selecciona el polígrafo. *Seleccionar todo* marca solo lo visible y cobrable. Los filtros quedan en la dirección de la página, así que al volver atrás no se pierden.\n\n## Título y destinatario\n\nAl generar el detalle se propone un **título del corte** a partir de los filtros («Polígrafos rutina · Solicitante ADELA CEBALLOS · Oct 2026») y un campo **Dirigido a** con el nombre de la persona del cliente. Los dos son opcionales, se pueden editar después desde el detalle y salen en el documento impreso.\n\n## El documento imprimible\n\n*Imprimir / PDF* abre el documento: una línea por prueba con persona, solicitante, ingreso, prueba y resultado, categoría, territorio y monto sin IVA, con letra compacta (entran más de 30 líneas por hoja carta). Cada línea trae casillas **☐ Sí ☐ No** y una columna de **Observaciones** en blanco para que el cliente marque con lapicero, y al pie va el bloque de **firma** (autorizado por, nombre, cargo, firma y fecha) mientras el detalle no esté facturado.\n\n## El flujo\n\nBorrador → *Marcar como enviada* → *Marcar como aprobada* (quién y por qué canal) → *Facturar (SAT/FEL)*. Un detalle se anula y sus pruebas vuelven a la cola; un detalle facturado no se anula (se anula la factura).',
  25, true, 'detalle de facturacion, pre-liquidacion, corte, solicitante, filtros, imprimir, firma, por facturar, agenda'
)
on conflict (slug) do update set
  titulo = excluded.titulo, categoria = excluded.categoria, descripcion_corta = excluded.descripcion_corta,
  contenido = excluded.contenido, orden = excluded.orden, activo = excluded.activo,
  tags_contextuales = excluded.tags_contextuales, updated_at = now();
