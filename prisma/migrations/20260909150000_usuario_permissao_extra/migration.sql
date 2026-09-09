-- Permissões extras concedidas individualmente por usuário, além do Usuario.perfil — aditiva, não
-- altera nem substitui a coluna perfil. Ver database/schema.sql para o comentário completo.
CREATE TABLE IF NOT EXISTS "usuarios_permissoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "permissao" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "usuarios_permissoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_permissoes_usuario_id_permissao_key" ON "usuarios_permissoes"("usuario_id", "permissao");
CREATE INDEX IF NOT EXISTS "usuarios_permissoes_usuario_id_idx" ON "usuarios_permissoes"("usuario_id");
