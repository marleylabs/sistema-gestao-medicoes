-- CreateTable
CREATE TABLE "feriados" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "data" DATE NOT NULL,
    "nome" TEXT NOT NULL,
    "abrangencia" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_by_nome" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feriados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profissional_id" UUID NOT NULL,
    "habilitado" BOOLEAN,
    "contrato_id" UUID,
    "funcao" TEXT,
    "item_pq" TEXT,
    "local" TEXT,
    "area" TEXT,
    "numero_se" TEXT,
    "doc_numero" TEXT,
    "updated_by_id" UUID,
    "updated_by_nome" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_ciclos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ciclo" TEXT NOT NULL,
    "liberacao" TEXT NOT NULL DEFAULT 'DIA_A_DIA',
    "updated_by_id" UUID,
    "updated_by_nome" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_ciclos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_folhas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profissional_id" UUID NOT NULL,
    "ciclo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "enviada_at" TIMESTAMPTZ,
    "enviada_por_id" UUID,
    "reaberta_at" TIMESTAMPTZ,
    "reaberta_por_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_folhas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_dias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "folha_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "entrada_1" INTEGER,
    "saida_1" INTEGER,
    "entrada_2" INTEGER,
    "saida_2" INTEGER,
    "projeto_pep" TEXT,
    "descricao" TEXT,
    "solicitante" TEXT,
    "updated_by_id" UUID,
    "updated_by_nome" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_dias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feriados_data_key" ON "feriados"("data");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_configs_profissional_id_key" ON "timesheet_configs"("profissional_id");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_ciclos_ciclo_key" ON "timesheet_ciclos"("ciclo");

-- CreateIndex
CREATE INDEX "idx_timesheet_folhas_ciclo" ON "timesheet_folhas"("ciclo");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_folhas_profissional_id_ciclo_key" ON "timesheet_folhas"("profissional_id", "ciclo");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_dias_folha_id_data_key" ON "timesheet_dias"("folha_id", "data");

-- AddForeignKey
ALTER TABLE "timesheet_configs" ADD CONSTRAINT "timesheet_configs_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_configs" ADD CONSTRAINT "timesheet_configs_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_folhas" ADD CONSTRAINT "timesheet_folhas_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_dias" ADD CONSTRAINT "timesheet_dias_folha_id_fkey" FOREIGN KEY ("folha_id") REFERENCES "timesheet_folhas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domínios fechados (o Prisma não modela CHECK; a validação também fica em lib/).
ALTER TABLE "feriados" ADD CONSTRAINT "feriados_abrangencia_check" CHECK ("abrangencia" IN ('ESTADUAL', 'MUNICIPAL'));
ALTER TABLE "timesheet_ciclos" ADD CONSTRAINT "timesheet_ciclos_liberacao_check" CHECK ("liberacao" IN ('DIA_A_DIA', 'CICLO'));
ALTER TABLE "timesheet_folhas" ADD CONSTRAINT "timesheet_folhas_status_check" CHECK ("status" IN ('ABERTA', 'ENVIADA'));
ALTER TABLE "timesheet_dias" ADD CONSTRAINT "timesheet_dias_minutos_check" CHECK (
  ("entrada_1" IS NULL OR "entrada_1" BETWEEN 0 AND 1439) AND
  ("saida_1" IS NULL OR "saida_1" BETWEEN 0 AND 1439) AND
  ("entrada_2" IS NULL OR "entrada_2" BETWEEN 0 AND 1439) AND
  ("saida_2" IS NULL OR "saida_2" BETWEEN 0 AND 1439)
);
