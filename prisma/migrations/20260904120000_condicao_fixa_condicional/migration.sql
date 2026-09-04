-- Condição fixa condicional: modelagem genérica e configurável por fornecedor, substituindo a
-- exceção hardcoded do Cristiano Jeferson. Estritamente aditiva.
-- tipo_condicao_fixa NULL/'FIXA' => comportamento pré-existente (valor_condicao_fixa), sem migração
-- manual necessária para fornecedores já cadastrados.
-- 'CONDICIONAL_PRODUCAO' => exige AMBOS valor_condicao_fixa_com_producao e valor_condicao_fixa_sem_producao.
ALTER TABLE "cadastros_fornecedores" ADD COLUMN IF NOT EXISTS "tipo_condicao_fixa" TEXT;
ALTER TABLE "cadastros_fornecedores" ADD COLUMN IF NOT EXISTS "valor_condicao_fixa_com_producao" NUMERIC(16,4);
ALTER TABLE "cadastros_fornecedores" ADD COLUMN IF NOT EXISTS "valor_condicao_fixa_sem_producao" NUMERIC(16,4);
