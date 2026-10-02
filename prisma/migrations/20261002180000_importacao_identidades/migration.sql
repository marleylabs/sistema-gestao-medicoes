-- Identidades da importação de medição por ciclo: nome da planilha ainda sem vínculo cadastral
-- (PENDENTE), vinculado depois por um humano (VINCULADO), reconhecido por correspondência
-- determinística (AUTO_VINCULADO) ou descartado do ciclo (DESCARTADO). Também guarda a decisão de
-- descartar uma linha estrutural sem PROJETISTA (tipo LINHA_SEM_PROJETISTA, chave = hash da linha).
-- Nunca cria Profissional/código: a medição pendente fica com id_profissional NULL e aponta para
-- esta tabela. Ver prisma/schema.prisma:ImportacaoIdentidade e database/schema.sql.
CREATE TABLE IF NOT EXISTS "importacao_identidades" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ciclo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor_bruto" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "profissional_id" UUID REFERENCES "profissionais"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "ocorrencias" INTEGER NOT NULL DEFAULT 0,
    "linhas" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "resolvido_por_id" UUID,
    "resolvido_por_nome" TEXT,
    "resolvido_at" TIMESTAMPTZ,
    "descartado_por_id" UUID,
    "descartado_por_nome" TEXT,
    "descartado_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "importacao_identidades_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "importacao_identidades_ciclo_tipo_chave_key" ON "importacao_identidades"("ciclo", "tipo", "chave");
CREATE INDEX IF NOT EXISTS "importacao_identidades_ciclo_status_idx" ON "importacao_identidades"("ciclo", "status");

ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "identidade_importacao_id" UUID REFERENCES "importacao_identidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_medicoes_identidade_importacao" ON "medicoes"("identidade_importacao_id");

ALTER TABLE "mapa_pagamento_itens" ADD COLUMN IF NOT EXISTS "identidade_importacao_id" UUID REFERENCES "importacao_identidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_mapa_pagamento_itens_identidade_importacao" ON "mapa_pagamento_itens"("identidade_importacao_id");
