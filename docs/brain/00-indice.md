# Índice do cérebro

Leia esta lista e abra só o que a tarefa precisa.

## Essenciais
- [Status](status.md): onde paramos, dúvidas abertas e próximos passos
- [Pendências](pendencias.md): riscos e dívidas técnicas por prioridade (P1 a P3)
- [Arquitetura](arquitetura.md): stack, pastas, fluxo principal e infra
- [Glossário](glossario.md): termos do negócio (BM, ciclo, conferência, alias...)
- [Ambiente](ambiente.md): como montar o projeto noutra máquina (arquivos fora do git, Docker, banco de teste, plugins do Claude Code)

## Módulos
- [Autenticação](modulos/autenticacao.md): login, sessão JWT, perfis, permissões extras, primeiro acesso
- [Ciclos](modulos/ciclos.md): ciclos YYMM, ciclo ativo, exclusão
- [Envio do BM](modulos/envio-bm.md): ciclo de vida do BM e status de envio a pagamento
- [Conferência e divergências](modulos/conferencia-divergencias.md): planilha do fornecedor × equipe, Incluir/Descartar
- [Boletim](modulos/boletim-calculo.md): cálculo do total, condição fixa, fonte da medição
- [Financeiro](modulos/financeiro.md): validação de NF, pagamento, comprovante
- [Mapa de pagamento](modulos/mapa-pagamento.md): linhas de pagamento, REV, rateio
- [Portal do fornecedor](modulos/portal-fornecedor.md): telas do COLABORADOR (inclui a aba Timesheet) e isolamento por alias
- [Cadastro de fornecedores](modulos/cadastro-fornecedores.md): Consulta PJ, inativação, exclusão definitiva
- [Identidades e aliases](modulos/identidades-importacao.md): resolver de identidade, pendências
- [ETL](modulos/etl.md): importação de planilhas em Python
- [Contratos](modulos/contratos.md): contratos e participação por fornecedor
- [Histórico e dashboard](modulos/historico-dashboard.md): histórico, evidências, dashboard
- [Chat](modulos/chat.md): conversas, anexos, presença (polling)
- [E-mail](modulos/email.md): notificações via Resend, modo teste, EmailLog
- [Timesheet ATO](modulos/timesheet.md): folha de horas do fornecedor ATO, cálculo HN/HE, feriados, liberação e envio

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
- [011 Nome do fornecedor só pelo Administrativo](decisoes/011-nome-do-fornecedor-so-pelo-administrativo.md): o nome é o elo com o cadastro; o fornecedor não o altera
- [012 P0 como ID do fornecedor](decisoes/012-p0-como-id-do-fornecedor.md): login = código do Profissional = código do cadastro; código antigo vira alias
- [013 Servidor único é a produção](decisoes/013-servidor-unico-e-producao.md): 192.168.15.101:3020 é a produção; "pré-produção" nas notas antigas é ela

## Specs
- [P1 escopo do fornecedor por identidade](specs/p1-escopo-fornecedor-por-identidade.md): lista de aliases do portal só com valores que resolvem para o próprio Profissional (implementada)
- [Plano da P1 escopo do fornecedor](specs/p1-escopo-fornecedor-por-identidade-plano.md): T1 diagnóstico só leitura → filtro → aliases → Documentos Medidos → E2E (concluído)
- [P2 P0 como único ID do fornecedor](specs/p2-vinculo-login-profissional.md): recodificar Profissional, cadastro e dados para o P0 do login; código antigo vira alias (aprovada)
- [Plano da P2 P0 como ID](specs/p2-vinculo-login-profissional-plano.md): dry-run → migração → P0 no cadastro novo → fim da busca por nome → E2E → produção (concluído)
- [Layout: tema claro/escuro e motion](specs/layout-tema-motion.md): mapa M1 fundação → M2 login/dashboard, M3 setores, M4 portal; spec do M1 e do M2 (feitos) e do M3 (aprovada)
- [Plano do M1 tema e motion](specs/layout-tema-motion-plano.md): tokens escuros → alternador → codemod de cores → motion → shell (concluído em 2026-10-18)
- [Plano do M2 login e dashboard](specs/layout-tema-motion-m2-plano.md): AnimatedText em CSS → login → gráficos no tema → KPIs e cascata (concluído em 2026-10-18)
- [Plano do M3 painéis dos setores](specs/layout-tema-motion-m3-plano.md): painel lateral → Modal único → abas → Toast → Skeleton → realce de linha (concluído em 7fb1499)
- [Timesheet ATO](specs/timesheet-ato.md): folha de apropriação de horas no portal, cálculo HN/HE 50%/HE 100%, feriados, acompanhamento da medição e exportação (implementada)
- [Plano do Timesheet ATO](specs/timesheet-ato-plano.md): schema → cálculo → folha no portal → feriados → acompanhamento → configuração → XLSX/PDF → E2E (concluído; na produção desde 2026-10-22)
- [Timesheet: feriados por contrato](specs/timesheet-feriados-por-contrato.md): feriado manual geral ou de um contrato, filtro por contrato na aba Feriados; spec e plano juntos (implementada, não implantada)
- [Timesheet: ciclo publicado próprio](specs/timesheet-ciclo-publicado.md): a medição publica o ciclo do timesheet separado do ciclo do portal, para o preenchimento não começar atrasado (implementada, não implantada)
- [Plano do M4 portal do fornecedor](specs/layout-tema-motion-m4-plano.md): Minhas Medições e NF → diálogos → ação principal em destaque → motion expressivo → chat (concluído)
