# Índice do cérebro

Leia esta lista e abra só o que a tarefa precisa.

## Essenciais
- [Status](status.md): onde paramos, dúvidas abertas e próximos passos
- [Pendências](pendencias.md): riscos e dívidas técnicas por prioridade (P1 a P3)
- [Arquitetura](arquitetura.md): stack, pastas, fluxo principal e infra
- [Glossário](glossario.md): termos do negócio (BM, ciclo, conferência, alias...)

## Módulos
- [Autenticação](modulos/autenticacao.md): login, sessão JWT, perfis, permissões extras, primeiro acesso
- [Ciclos](modulos/ciclos.md): ciclos YYMM, ciclo ativo, exclusão
- [Envio do BM](modulos/envio-bm.md): ciclo de vida do BM e status de envio a pagamento
- [Conferência e divergências](modulos/conferencia-divergencias.md): planilha do fornecedor × equipe, Incluir/Descartar
- [Boletim](modulos/boletim-calculo.md): cálculo do total, condição fixa, fonte da medição
- [Financeiro](modulos/financeiro.md): validação de NF, pagamento, comprovante
- [Mapa de pagamento](modulos/mapa-pagamento.md): linhas de pagamento, REV, rateio
- [Portal do fornecedor](modulos/portal-fornecedor.md): telas do COLABORADOR e isolamento por alias
- [Cadastro de fornecedores](modulos/cadastro-fornecedores.md): Consulta PJ, inativação, exclusão definitiva
- [Identidades e aliases](modulos/identidades-importacao.md): resolver de identidade, pendências
- [ETL](modulos/etl.md): importação de planilhas em Python
- [Contratos](modulos/contratos.md): contratos e participação por fornecedor
- [Histórico e dashboard](modulos/historico-dashboard.md): histórico, evidências, dashboard
- [Chat](modulos/chat.md): conversas, anexos, presença (polling)
- [E-mail](modulos/email.md): notificações via Resend, modo teste, EmailLog

## Decisões
- [001 Migrations Prisma](decisoes/001-migrations-prisma-fonte-de-verdade.md): baseline legado e banco só por migrations
- [002 Estado por fornecedor e ciclo](decisoes/002-estado-do-fluxo-por-fornecedor-e-ciclo.md): status no BM, não na medição
- [003 Identidade por código e alias](decisoes/003-identidade-por-codigo-e-alias.md): nunca CNPJ, sem fuzzy
- [004 Sessão JWT própria](decisoes/004-sessao-jwt-propria.md): cookie + revalidação no banco
- [005 Polling](decisoes/005-polling-para-tempo-real.md): sem WebSocket/SSE
- [006 E-mail Resend](decisoes/006-email-resend-com-guardas.md): fail-safe, fora da transação
- [007 Arquivos no banco](decisoes/007-arquivos-no-banco.md): NF e anexos em bytea
- [008 Exclusão preserva histórico](decisoes/008-exclusao-definitiva-preserva-historico.md): tombstone e anonimização
- [009 ETL como serviço HTTP](decisoes/009-etl-como-servico-http.md): container Python atrás de proxy
- [010 Reimportação preserva BM](decisoes/010-reimportacao-preserva-bm.md): BM aprovado/pago imutável na importação; divergência reportada

## Specs
- [P1 escopo do fornecedor por identidade](specs/p1-escopo-fornecedor-por-identidade.md): lista de aliases do portal só com valores que resolvem para o próprio Profissional (aprovada)
- [Plano da P1 escopo do fornecedor](specs/p1-escopo-fornecedor-por-identidade-plano.md): T1 diagnóstico só leitura → filtro → aliases → Documentos Medidos → E2E (aprovado)
