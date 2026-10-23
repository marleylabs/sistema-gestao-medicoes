---
atualizado: 2026-10-23
tags: [spec]
---
# Timesheet: assinatura eletrônica da folha (fiscal e colaborador)

Continuação da [aprovação pelo fiscal](timesheet-aprovacao-fiscal.md). Spec e plano juntos. Status: **implementada e na produção desde 2026-10-23** (c04b28b). Decisão: [014](../decisoes/014-assinatura-eletronica-propria.md).

## Objetivo
O fiscal e o colaborador assinam a folha de timesheet dentro da própria plataforma, com rastreabilidade (quem, quando, de onde e sobre qual conteúdo). A assinatura aparece no espaço acima do nome, no fim da folha (tela e PDF), e no texto do XLSX.

## Por que dentro da plataforma (decisão do usuário em 2026-10-23)
- A API de assinatura do gov.br é oferecida a órgãos públicos. Para uma empresa privada sobra o caminho manual (assinar o PDF em `assinador.iti.br`), que assina um arquivo fixo e se perde a cada nova exportação.
- Provedores (Clicksign, ZapSign, D4Sign, DocuSign) e o certificado ICP-Brasil também assinam um arquivo fixo e trazem custo ou dependência.
- A assinatura própria fica presa à folha, não a um arquivo, e vale o ciclo todo. É uma assinatura eletrônica avançada, válida entre as partes que a aceitam (MP 2.200-2/2001, art. 10, §2º). Ficou combinado deixar o caminho aberto para uma camada ICP-Brasil ou um provedor no futuro, se a VALE exigir.

## Regras (aprovadas pelo usuário em 2026-10-23)
1. **Como se assina.** O modal de assinatura mostra:
   - o resumo do que está sendo assinado: ciclo, fornecedor, total de horas e dias aprovados, reprovados e pendentes;
   - o quadro de desenho, que aceita mouse, toque e caneta, com o botão "Limpar";
   - a aba "Digitar nome" (fonte cursiva), para quem usa só o teclado;
   - a confirmação da senha;
   - o texto de aceite.
   Os dois modos geram um PNG no navegador. O servidor grava numa única transação: o PNG, o modo (`DESENHO` ou `DIGITADO`), o usuário, o nome congelado, a data e hora, o IP, o hash do conteúdo da folha, o resumo, um código de verificação e o registro de auditoria.
2. **A validade vem da trilha, não do desenho.** O desenho sempre aparece junto da linha "Assinado eletronicamente por … em … · código …". O desenho é gravado em cada assinatura (não há rubrica salva no perfil), para não ser reaproveitado em outra folha.
3. **Fiscal.**
   - Assina a qualquer momento, com a folha aberta ou enviada e com dias pendentes, sem restrição. Precisa haver ao menos um dia lançado: sem dias lançados, a folha não existe.
   - A assinatura vale o ciclo todo para aquele fornecedor. Continua depois de reaberturas, correções, novas decisões e feriados novos.
4. **Folha alterada depois da assinatura.**
   - A assinatura continua, mas aparece o aviso "Folha alterada após a assinatura". Ele surge quando o hash atual do conteúdo (dias, horários, textos, decisões e horas calculadas) difere do hash gravado.
   - Vale para as duas assinaturas.
5. **Revogar.**
   - O fiscal pode revogar a própria assinatura e assinar de novo dentro do ciclo.
   - A revogada fica no banco e na auditoria, e a folha mostra só a assinatura ativa.
   - Só pode haver uma assinatura ativa por folha e por papel.
6. **Colaborador.**
   - Assina ao enviar a folha. Envio e assinatura são um só ato, na mesma transação, e não há envio sem assinatura.
   - Quando a medição reabre a folha, a assinatura do colaborador é marcada como encerrada pela reabertura, e o próximo envio pede uma assinatura nova.
   - A assinatura do fiscal não é afetada pela reabertura (regra 3).
7. **Revisão antes do envio (colaborador).** O botão "Enviar folha" abre primeiro a etapa de revisão, no mesmo diálogo do envio atual, com o mesmo formato de resumo da aprovação do BM:
   - Mostra o resumo: dias preenchidos, total de horas e HN, HE 50% e HE 100%.
   - Se houver **dias úteis sem lançamento**, mostra a lista das datas com um aviso. Sábado, domingo e feriado vazios não contam.
   - O colaborador marca a caixa "Revisei a folha e confirmo os lançamentos". Só então o botão "Continuar para a assinatura" fica disponível. A caixa é obrigatória mesmo sem dias vazios.
   - Em seguida vem a etapa de assinatura (regra 1) com o aviso "Depois de enviada, a folha fica só para leitura. Se precisar corrigir, entre em contato com a equipe de medição."
   - Depois do envio, a mensagem de sucesso repete o contato com a medição.
8. **Verificação.**
   - Quem está logado como equipe interna (MEDICAO, ADMIN) ou como FISCAL confere um código e vê se é válido, de qual folha e ciclo, quem assinou, quando, se foi revogado e se a folha mudou depois.
   - O fiscal só consegue conferir códigos de folhas que estão no escopo dele.
   - O fornecedor não tem acesso à verificação.
   - Não há página pública.
9. **Privacidade.**
   - O IP só aparece na verificação interna e na auditoria; o fornecedor nunca o vê.
   - O PNG da assinatura só é servido para quem pode ver aquela folha.
10. **Permissões.**
    - Só o FISCAL do contrato assina como fiscal, e fornecedor fora do escopo dele dá 404.
    - Só o próprio colaborador (`getColaboradorEscopo`) assina como colaborador.
    - Medição e ADMIN não assinam.
    - Senha errada dá 400. Há limite de tentativas por usuário, igual ao do login.

## Onde aparece
- **Tela:** um bloco "Assinaturas" com as duas assinaturas: imagem, nome, data, código e o aviso da regra 4.
  - Fornecedor: aba do portal.
  - Medição: gaveta do Timesheet.
  - Fiscal: painel da folha, com os botões "Assinar folha" e "Revogar".
- **PDF** (`app/timesheet/imprimir/[profissionalId]/page.tsx`, componente `Assinatura`):
  - a imagem fica no espaço acima da linha e do nome;
  - abaixo vai "Assinado eletronicamente em dd/mm/aaaa hh:mm · código TS-XXXX-XXXX", e a data passa a ser a da assinatura;
  - sem assinatura, continua a linha em branco com a data da exportação;
  - a folha continua cabendo em uma página A4.
- **XLSX** (`lib/timesheet-export.ts`, células B46 e K46): só texto ("Assinado eletronicamente por … em … · código …"), sem imagem. Embutir imagem exigiria ensinar o gerador próprio a escrever *drawings*.

## Pontos de atenção (aprovados para implementar)
- **Validação do PNG no servidor:**
  - bytes iniciais de PNG, checados com `detectAllowedImageMime` (`lib/file-security.ts`);
  - até 100 KB;
  - dimensões lidas do cabeçalho do PNG, dentro de um limite.
  - O servidor não detecta um desenho vazio: quem garante é o navegador, que exige traço ou nome antes de assinar.
- **Modo escuro:** traço escuro sobre fundo branco no quadro, em qualquer tema, para sair igual no PDF.
- **Fonte cursiva** para o modo digitado: uma nova fonte via `next/font/google` (por exemplo, Dancing Script). Não é dependência npm.

## Confirmado com o usuário (2026-10-23)
- O botão "Enviar folha" abre a revisão (regra 7); não existe um "Salvar" da folha inteira, porque os dias são gravados um a um.
- O texto de aceite é um texto padrão (`TEXTO_ACEITE` em `lib/timesheet-assinatura-texto.ts`, versão em `ACEITE_VERSAO`). **Pendente:** o usuário vai validar com a VALE o texto e se o contrato precisa de uma cláusula aceitando a assinatura eletrônica.

## Como ficou (implementação)
- **`lib/timesheet-assinatura.ts`:**
  - validação do PNG (assinatura de PNG, até 100 KB, dimensões lidas do IHDR);
  - confirmação da senha (`senhaDoUsuarioConfere` em `lib/auth.ts`, o único lugar além do login que lê o hash);
  - limite de 20 tentativas a cada 15 minutos por usuário. Conta toda tentativa, porque um fiscal assina várias folhas seguidas;
  - `gravarAssinatura`, usada dentro da transação de quem chama;
  - `enviarFolha`, transferida de `lib/timesheet.ts` porque o envio agora sempre leva a assinatura;
  - `verificarAssinatura`.
- **`lib/timesheet-fiscal.ts`:** `assinarComoFiscal`, `revogarAssinaturaFiscal` (só quem assinou revoga) e `verificarAssinaturaDoFiscal` (escopo do fiscal, sem IP).
- **`lib/timesheet-medicao.ts`:** `reabrirFolha` encerra a assinatura do colaborador com `REABERTURA`.
- **`carregarFolha`** devolve `conteudoHash` e `assinaturas.{fiscal,colaborador}`, com a imagem em data URL e a flag `alterada`, sem o IP. A imagem vai junto da folha, então não há rota própria para ela: quem lê a folha vê a imagem.
- **Rotas:**
  - `POST /api/colaborador/timesheet/enviar` (agora exige `assinatura`);
  - `POST` e `DELETE /api/fiscal/timesheet/[profissionalId]/assinatura`;
  - `GET /api/fiscal/timesheet/verificar-assinatura`;
  - `GET /api/admin/timesheet/verificar-assinatura` (com o IP).
- **UI** em `components/timesheet/assinatura.tsx`: quadro de desenho e aba "Digitar nome" (fonte Dancing Script via `next/font/google`), `DialogoAssinatura`, `AssinaturasTimesheet` e `VerificarAssinatura`. A revisão em duas etapas fica em `folha-timesheet.tsx`.
- **Atalho conhecido:** o hash do envio é lido antes da transação. Um dia gravado nesse intervalo só faria a folha aparecer como alterada.

## Modelo de dados (rascunho)
Nova tabela `timesheet_assinaturas`, criada por uma nova migration que só cria tabela e índices:
- `id`, `folha_id` (FK), `papel` (`FISCAL` ou `COLABORADOR`), `usuario_id`, `nome`, `assinado_em`, `ip`, `metodo`, `imagem` (Bytes), `hash_conteudo`, `resumo` (Json) e `codigo` (único);
- `encerrada_em`, `encerrada_por_id` e `encerramento` (`REVOGADA` ou `REABERTURA`);
- índice único parcial em (`folha_id`, `papel`) onde `encerrada_em` é nulo.

## Plano
1. **Migration e schema** da tabela; `lib/timesheet-assinatura.ts`, com:
   - o hash canônico da folha;
   - a validação do PNG;
   - a conferência da senha (`verifyPassword` e `checkRateLimit`);
   - assinar, revogar e verificar, com auditoria (`TIMESHEET_ASSINADA`, `TIMESHEET_ASSINATURA_REVOGADA`);
   - o encerramento na reabertura.
2. **Envio do colaborador:** `enviarFolha` recebe a assinatura e grava status, assinatura e auditoria na mesma transação. A rota `enviar` passa a exigir a assinatura.
3. **Fiscal:** rotas `app/api/fiscal/timesheet/[profissionalId]/assinatura` (POST assina, DELETE revoga) com `requireFiscal` e escopo.
4. **Leitura:**
   - `carregarFolha` devolve as assinaturas ativas, sem a imagem e sem o IP, com a flag de alterada;
   - uma rota serve o PNG conforme quem pode ver a folha;
   - uma rota de verificação para equipe interna e fiscal.
5. **UI:**
   - componente de assinatura (canvas com ponteiro, aba digitada, senha, aceite);
   - revisão em duas etapas no envio;
   - botões do fiscal;
   - bloco "Assinaturas" nas três telas;
   - campo de verificação no painel da medição e na tela do fiscal.
6. **Exportação:** imagem e linha no PDF; texto no XLSX.
7. **Testes:**
   - unitários: hash, validação do PNG, senha e limite, escopo, uma ativa por papel, revogar, reabertura encerra a do colaborador e mantém a do fiscal, aviso de alterada, envio sem assinatura recusado;
   - E2E: o colaborador vê os dias úteis vazios, confirma, assina e envia; o fiscal assina e a assinatura aparece no PDF; uma correção depois da reabertura mostra o aviso; a medição verifica o código.

## Fora do escopo
Página pública de verificação, imagem no XLSX, certificado ICP-Brasil ou provedor externo, assinatura da medição.
