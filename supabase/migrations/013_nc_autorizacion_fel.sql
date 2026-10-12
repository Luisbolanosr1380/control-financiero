-- ============================================================
-- 013 · Notas de crédito — número de autorización FEL
--
-- Corre en AMBAS bases vía scripts/migrar-todas.ts. SIN begin/commit
-- propio y sin delete/drop (el runner aporta la transacción).
--
-- El identificador del documento electrónico de la NC en SAT (la
-- contadora lo llama "número de constancia"). Hasta hoy "constancia" solo
-- existía en cobros (retención). Columna opcional: una NC sin número
-- queda en blanco; se captura al emitir o se completa después en la NC.
-- ============================================================

alter table notas_credito add column if not exists numero_autorizacion_fel text;
