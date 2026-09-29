ALTER TABLE "cadastros_fornecedores"
    ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "inativado_at" TIMESTAMPTZ;
