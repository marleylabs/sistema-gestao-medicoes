-- Estado explícito de exclusão operacional de profissionais.
ALTER TABLE "profissionais" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "profissionais" ADD COLUMN IF NOT EXISTS "deleted_by_id" UUID;
ALTER TABLE "profissionais" ADD COLUMN IF NOT EXISTS "deleted_by_nome" TEXT;
ALTER TABLE "profissionais" ADD COLUMN IF NOT EXISTS "deleted_reason" TEXT;

CREATE INDEX IF NOT EXISTS "idx_profissionais_deleted_at"
  ON "profissionais"("deleted_at");

-- Snapshots mínimos usados quando o cadastro vivo é anonimizado.
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "coordenador_nome_snapshot" TEXT;
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "profissional_nome_snapshot" TEXT;

-- Auditoria persistente, sem cópia de CPF/CNPJ/e-mail.
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "action" TEXT NOT NULL,
  "admin_id" UUID NOT NULL,
  "admin_usuario" TEXT NOT NULL,
  "admin_nome" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" UUID,
  "target_codigo" TEXT,
  "reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_action"
  ON "admin_audit_logs"("action");
CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_target_codigo"
  ON "admin_audit_logs"("target_codigo");
CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_created_at"
  ON "admin_audit_logs"("created_at" DESC);
