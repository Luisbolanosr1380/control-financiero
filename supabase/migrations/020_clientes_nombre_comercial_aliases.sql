-- 020 · CLIENTES: nombre comercial + otros nombres / marcas (aliases)
--
-- Una empresa legal ("Distribuidora Suprema, S.A.") opera una marca ("Calzado
-- Chicote"). Hay que poder UBICAR al cliente por cualquiera de sus nombres:
-- lista de Clientes, buscador del mapeo de la Agenda y la auto-sugerencia.
-- La RAZÓN SOCIAL sigue siendo la que va en la factura; el tarifario sigue
-- cruzando por NIT. Esto solo agrega formas de encontrar al cliente.
--
-- Idempotente (if not exists). Sin drop / delete / begin / commit.
-- Se aplica en ambas bases (Golden y HIT) por el conector.

alter table clientes add column if not exists nombre_comercial text;
alter table clientes add column if not exists aliases text[] not null default '{}';

comment on column clientes.nombre_comercial is 'Marca / nombre comercial con el que opera (la factura sigue saliendo con razon_social).';
comment on column clientes.aliases is 'Otros nombres o marcas con los que se lo conoce (búsqueda y sugerencia de mapeo).';

-- Búsqueda por alias: GIN sobre el arreglo (operadores @>, &&).
create index if not exists idx_clientes_aliases on clientes using gin (aliases);
