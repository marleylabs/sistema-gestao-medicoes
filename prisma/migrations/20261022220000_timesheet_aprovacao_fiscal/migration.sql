-- Aprovação das horas do timesheet pelo fiscal do contrato (spec timesheet-aprovacao-fiscal).

-- Perfil FISCAL.
ALTER TABLE "usuarios" DROP CONSTRAINT "usuarios_perfil_check";
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_perfil_check" CHECK ("perfil" IN ('ADMIN', 'MEDICAO', 'COLABORADOR', 'FINANCEIRO', 'ADMINISTRATIVO', 'FISCAL'));

-- Fiscal do contrato.
ALTER TABLE "contratos" ADD COLUMN "fiscal_id" UUID;
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_fiscal_id_fkey" FOREIGN KEY ("fiscal_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "idx_contratos_fiscal_id" ON "contratos"("fiscal_id");

-- Decisão por dia.
ALTER TABLE "timesheet_dias" ADD COLUMN "aprovacao" TEXT,
ADD COLUMN "aprovacao_motivo" TEXT,
ADD COLUMN "aprovacao_por_id" UUID,
ADD COLUMN "aprovacao_por_nome" TEXT,
ADD COLUMN "aprovacao_em" TIMESTAMPTZ;
ALTER TABLE "timesheet_dias" ADD CONSTRAINT "timesheet_dias_aprovacao_check" CHECK ("aprovacao" IS NULL OR "aprovacao" IN ('APROVADO', 'REPROVADO'));
