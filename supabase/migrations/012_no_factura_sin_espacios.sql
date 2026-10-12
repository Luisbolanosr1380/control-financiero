-- ============================================================
-- 012 · NO.FACTURA sin espacios (fix del match exacto por no_factura)
--
-- Corre en AMBAS bases vía scripts/migrar-todas.ts. SIN begin/commit
-- propio y sin delete/drop (el runner aporta la transacción).
--
-- Un espacio heredado de la importación (" 803358639") hacía que la
-- factura "no existiera" para los lookups por NO.FACTURA y que sus
-- líneas no se consolidaran con las de la misma factura. La app ya
-- recorta al leer y al escribir; esto es la defensa a nivel de base:
--  1) limpieza idempotente de lo que quede,
--  2) trigger BEFORE INSERT/UPDATE que recorta SIEMPRE (incluye lo que
--     entre por SQL o por una importación, no solo por la app).
-- Recorta espacio, tab, CR/LF y el espacio duro (U+00A0).
-- ============================================================

create or replace function no_factura_limpio(t text) returns text
language sql immutable as $$
  select btrim(t, E' \t\r\n' || chr(160))
$$;

update facturas_clientes
   set no_factura = no_factura_limpio(no_factura)
 where no_factura is not null and no_factura <> no_factura_limpio(no_factura);

create or replace function facturas_clientes_recortar_no_factura() returns trigger
language plpgsql as $$
begin
  if new.no_factura is not null then
    new.no_factura := no_factura_limpio(new.no_factura);
  end if;
  return new;
end
$$;

create or replace trigger trg_facturas_clientes_no_factura
  before insert or update of no_factura on facturas_clientes
  for each row execute function facturas_clientes_recortar_no_factura();
