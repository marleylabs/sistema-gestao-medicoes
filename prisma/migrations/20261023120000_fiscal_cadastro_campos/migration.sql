-- Cadastro do fiscal: telefone (cifrado), empresa, cargo e matrícula. Só acrescenta colunas nulas.
ALTER TABLE "usuarios" ADD COLUMN "telefone" TEXT,
ADD COLUMN "empresa" TEXT,
ADD COLUMN "cargo" TEXT,
ADD COLUMN "matricula" TEXT;
