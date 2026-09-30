-- Aliases operacionais de Profissional: como uma identidade aparece em fontes externas (máscara de
-- medição, BM AUX, mapa). Só por decisão explícita; sem unique global (ambiguidade real bloqueia).
-- Ver prisma/schema.prisma:ProfissionalAlias e database/schema.sql.
CREATE TABLE IF NOT EXISTS "profissional_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profissional_id" UUID NOT NULL REFERENCES "profissionais"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "alias" TEXT NOT NULL,
    "alias_normalizado" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_by_nome" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "profissional_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "profissional_aliases_profissional_alias_key" ON "profissional_aliases"("profissional_id", "alias_normalizado");
CREATE INDEX IF NOT EXISTS "profissional_aliases_alias_normalizado_idx" ON "profissional_aliases"("alias_normalizado");
