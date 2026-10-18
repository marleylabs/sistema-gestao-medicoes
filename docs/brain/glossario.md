---
atualizado: 2026-10-17
tags: [glossario]
---
# Glossário

- **Medição:** um documento medido (linha da planilha) em `Medicao`. Não tem status próprio.
- **BM (Boletim de Medição):** o consolidado de um fornecedor num ciclo. O estado do fluxo fica em `SgcAprovacaoMedicao`; o cálculo, em `lib/boletim-calculo.ts`.
- **SGC:** nome legado das tabelas e rotas do fluxo de aprovação do BM (`sgc_aprovacoes_medicao`, `sgc_logs`, `app/api/sgc`).
- **Ciclo:** período de medição no formato YYMM (ex.: 2605). "GERAL" não é ciclo válido (`lib/ciclo.ts`).
- **Período ATO / Produção:** ATO vai do dia 21 do mês anterior ao dia 20; Produção é um mês antes.
- **Ciclo ativo:** o ciclo marcado com `ativoMedicao` em `MapaPagamentoContexto` (`lib/ciclo-ativo.ts`).
- **Fornecedor / Colaborador / Projetista / Profissional:** a mesma pessoa jurídica prestadora. O perfil de login é COLABORADOR; o cadastro operacional é `Profissional`; o administrativo é `CadastroFornecedor`.
- **Colaborador código:** a identidade operacional do fornecedor (`Profissional.codigo`, ou o nome quando não há código). Com o P0, é igual ao login.
- **P0:** o login do fornecedor (`P0` + 6 dígitos) e, pela [decisão 012](decisoes/012-p0-como-id-do-fornecedor.md), o único ID dele na plataforma: login = `Profissional.codigo` = código do cadastro = código gravado em BM, mapa, divergência, BM auxiliar e logs. O código antigo (nome) vira alias.
- **Alias:** um nome alternativo de planilha ligado a um `Profissional` (`ProfissionalAlias`).
- **Identidade pendente:** um nome da planilha que ainda não tem vínculo (`ImportacaoIdentidade`). Pode ser vinculada ou descartada.
- **Coordenador:** o profissional coordenador da medição (`Medicao.idCoordenador`).
- **Consulta PJ:** a planilha administrativa de cadastro de fornecedores (aba `CONTRATOS_ATIVOS`).
- **Conferência:** o fornecedor sobe a própria planilha e o sistema a compara com a da equipe. Status: AGUARDANDO_UPLOAD, DIVERGENCIA, CONCLUIDA.
- **Divergência:** uma diferença por **NR VALE** entre fornecedor e equipe (formato, A1EQ, % emissão, tipo). A equipe resolve com Incluir ou Descartar.
- **NR VALE:** o número do documento usado como chave de comparação.
- **A1 equivalente (A1EQ HH):** horas equivalentes ao formato A1, base do valor medido.
- **% Emissão / revisão:** frações de 0 a 1 por etapa do documento (emissão inicial, retorno de vale, encerramento, arquivamento).
- **Condição fixa:** valor fixo mensal do fornecedor, FIXA ou CONDICIONAL_PRODUCAO (só vale se houve produção no ciclo).
- **Fonte da medição:** DOCUMENTOS ou DOCUMENTOS_AUXILIARES.
- **BM AUX / Documentos Auxiliares:** a aba auxiliar da planilha (`BmAuxMedicao`).
- **Mapa de pagamento:** as linhas de pagamento por fornecedor e ciclo (`MapaPagamentoItem`), com contexto e rateio por contrato.
- **REV:** o ajuste no mapa de pagamento somado ao total do BM.
- **NF:** a nota fiscal (PDF) enviada pelo fornecedor e validada por CNPJ do prestador e do tomador.
- **Comprovante:** o comprovante de pagamento anexado pelo Financeiro.
- **Contrato / rateio:** a participação de cada fornecedor por contrato, calculada pelos documentos medidos.
- **Inativação:** desativa o `CadastroFornecedor` (e o usuário, se não houver outro cadastro ativo). É reversível.
- **Exclusão definitiva:** remove o cadastro e anonimiza o profissional (tombstone), preservando o histórico.
- **Primeiro acesso:** o envio de senha temporária ao fornecedor. A troca é obrigatória no login.
- **Permissão extra:** uma permissão aditiva por usuário (ADMINISTRATIVO, HISTORICO_MEDICOES).
