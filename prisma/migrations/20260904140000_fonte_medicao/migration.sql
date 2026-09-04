-- Fonte da medição: substitui a whitelist hardcoded por nome (BM_AUX_ALLOWED_COLLABORATORS) do ETL
-- por configuração cadastral explícita e genérica. Estritamente aditiva.
-- NULL/'DOCUMENTOS' (padrão) => produção da aba "Documentos" do Excel.
-- 'DOCUMENTOS_AUXILIARES' => produção da aba "Documentos Auxiliares" (BM AUX).
ALTER TABLE "cadastros_fornecedores" ADD COLUMN IF NOT EXISTS "fonte_medicao" TEXT;
