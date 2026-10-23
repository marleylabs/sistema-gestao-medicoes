-- Assinatura eletrônica da folha de timesheet pelo fiscal e pelo colaborador (spec timesheet-assinatura).
-- Só cria a tabela e os índices.

-- CreateTable
CREATE TABLE "timesheet_assinaturas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "folha_id" UUID NOT NULL,
    "papel" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "assinado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "metodo" TEXT NOT NULL,
    "imagem" BYTEA NOT NULL,
    "hash_conteudo" TEXT NOT NULL,
    "resumo" JSONB NOT NULL,
    "codigo" TEXT NOT NULL,
    "encerrada_em" TIMESTAMPTZ,
    "encerrada_por_id" UUID,
    "encerramento" TEXT,

    CONSTRAINT "timesheet_assinaturas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "timesheet_assinaturas_papel_check" CHECK ("papel" IN ('FISCAL', 'COLABORADOR')),
    CONSTRAINT "timesheet_assinaturas_metodo_check" CHECK ("metodo" IN ('DESENHO', 'DIGITADO')),
    CONSTRAINT "timesheet_assinaturas_encerramento_check" CHECK (
        ("encerrada_em" IS NULL AND "encerramento" IS NULL) OR ("encerrada_em" IS NOT NULL AND "encerramento" IN ('REVOGADA', 'REABERTURA'))
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_assinaturas_codigo_key" ON "timesheet_assinaturas"("codigo");

-- CreateIndex
CREATE INDEX "idx_timesheet_assinaturas_folha_id" ON "timesheet_assinaturas"("folha_id");

-- No máximo uma assinatura ativa por folha e papel; as encerradas ficam como histórico.
CREATE UNIQUE INDEX "timesheet_assinaturas_ativa_key" ON "timesheet_assinaturas"("folha_id", "papel") WHERE "encerrada_em" IS NULL;

-- AddForeignKey
ALTER TABLE "timesheet_assinaturas" ADD CONSTRAINT "timesheet_assinaturas_folha_id_fkey" FOREIGN KEY ("folha_id") REFERENCES "timesheet_folhas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
