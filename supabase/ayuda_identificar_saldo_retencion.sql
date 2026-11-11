-- IDENTIFICAR PAGO: BUSCAR TAMBIÉN POR SALDO Y POR NETO CON RETENCIÓN DE IVA · una línea en la ayuda de Cobros
-- (artículo «Conciliación bancaria — paso a paso», categoría Cobros y Retenciones; Identificar pago es la conciliación inversa).
-- No es una migración numerada (sin cambios de esquema): es contenido. Aplicada en HIT; en Golden la aplica el CFO.
-- Idempotente: si la línea ya está, no hace nada.
update ayuda
   set contenido = contenido || E'\n\n**Identificar pago busca también por saldo y por el neto después de la retención de IVA:** en Cobros → Identificar pago, el depósito se compara con el **total** de cada factura abierta, con su **saldo** (total − cobros − notas de crédito) y con el **neto con retención** (saldo − la retención de IVA que ese cliente suele hacer: 15 %, 30 % u 80 % del IVA, según su historial de cobros; si nunca retuvo se prueba el 15 % general y la coincidencia sale como *posible*). *Buscar sobre* elige la base (Automático compara las tres) y la columna *Calza por* dice con cuál calzó y cuánto fue la retención (por ejemplo «Neto con retención IVA 15 % (−Q7.23)»). *Registrar cobro* abre la factura con el depósito y la retención ya cargados como componentes.',
       updated_at = now()
 where slug = 'conciliacion-bancaria-paso-a-paso' and contenido not like '%Identificar pago busca también por saldo%';
