# Fonte de verdade do banco

## Estado confirmado

- `prisma/schema.prisma` é consumido por `prisma generate` e pelo build da aplicação.
- `database/schema.sql` é o script idempotente que representa a criação/evolução manual do PostgreSQL existente.
- O PostgreSQL em execução é a referência final para validar uma alteração em ambiente com dados.
- `database/schema.prisma` é um artefato legado e não deve ser usado para gerar o cliente.

## Estratégia segura

1. Não executar `prisma migrate reset` em bancos existentes.
2. Manter `prisma/schema.prisma` alinhado ao PostgreSQL efetivo.
3. Criar um baseline versionado a partir do estado já implantado antes de introduzir migrations incrementais.
4. Validar cada migration em clone do banco, revisar o SQL e só então aplicar no ambiente operacional.
5. CNPJ não é identidade do colaborador e não deve receber `UNIQUE`; cadastros distintos podem compartilhar `cnpj_normalizado`.
6. Uma futura regra contra duplicação do mesmo colaborador deve usar a identidade operacional (`colaborador_codigo`) e antes exigir saneamento/decisão explícita sobre registros históricos.

## Divergência mantida deliberadamente

`database/schema.prisma` permanece sem alterações para não mascarar sua condição legada. Sua remoção ou arquivamento deve ocorrer em mudança separada depois que o baseline estiver formalizado.
