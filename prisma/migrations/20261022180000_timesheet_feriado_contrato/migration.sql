-- Feriado por contrato (spec timesheet-feriados-por-contrato). Os feriados existentes ficam sem
-- contrato e continuam valendo para todos.

-- DropIndex
DROP INDEX "feriados_data_key";

-- AlterTable
ALTER TABLE "feriados" ADD COLUMN "contrato_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "feriados_data_contrato_id_key" ON "feriados"("data", "contrato_id");

-- Os sem contrato também são únicos por data (no índice acima, NULL não colide com NULL).
CREATE UNIQUE INDEX "feriados_data_sem_contrato_key" ON "feriados"("data") WHERE "contrato_id" IS NULL;

-- AddForeignKey
ALTER TABLE "feriados" ADD CONSTRAINT "feriados_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
