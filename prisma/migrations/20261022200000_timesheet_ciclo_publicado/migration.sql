-- Ciclo publicado próprio do timesheet (spec timesheet-ciclo-publicado). Nenhum marcado = o timesheet
-- segue o ciclo publicado do portal (ativo_medicao), como antes.

-- AlterTable
ALTER TABLE "mapa_pagamento_contexto" ADD COLUMN "ativo_timesheet" BOOLEAN NOT NULL DEFAULT false;

-- No máximo um ciclo publicado no timesheet (mesma trava de ativo_medicao).
CREATE UNIQUE INDEX "mapa_pagamento_contexto_ativo_timesheet_key" ON "mapa_pagamento_contexto"("ativo_timesheet") WHERE "ativo_timesheet" = true;
