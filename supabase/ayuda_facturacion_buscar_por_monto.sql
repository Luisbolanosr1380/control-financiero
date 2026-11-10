-- BUSCAR FACTURAS POR MONTO · línea en la ayuda de Facturación (artículo con el tag modulo-facturacion).
-- No es una migración numerada (sin cambios de esquema): es contenido. Aplicada en HIT; en Golden la aplica el CFO.
-- Idempotente: si la línea ya está, no hace nada.
update ayuda
   set contenido = contenido || E'\n\n**Buscar por monto:** en Facturación escribí el monto o un rango en el buscador (`8000`, `Q9,450`, `8 mil`, `8000-10000`) y Enter: busca en **todas** las facturas, de cualquier mes, con ±Q1 de tolerancia. *Más filtros* permite elegir sobre qué monto (total con IVA, subtotal o saldo pendiente), el estado (todas, pagadas, pendientes, cobro parcial, anuladas) y fechas de emisión; la búsqueda queda en la dirección de la página y se puede exportar a CSV. Desde Cobros → Identificar, «Buscar facturas por este monto» abre la búsqueda con el monto del depósito.',
       updated_at = now()
 where slug = 'como-emitir-una-factura-paso-a-paso' and contenido not like '%Buscar por monto:%';
