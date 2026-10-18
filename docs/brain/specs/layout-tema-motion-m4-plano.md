---
atualizado: 2026-10-18
status: concluído em 2026-10-18
tags: [spec, plano]
---
# Plano: M4 Portal do fornecedor

Spec: [layout-tema-motion](layout-tema-motion.md), seção M4. Base: M3 em 7fb1499.

## Componentes e ordem
1. **Minhas Medições, NF e comprovante**: o painel lateral (`AdminSidePanel`) já tem entrada e saída; falta o `AnimatePresence` no ponto que abre, o `Modal` no visualizador do BM, o `Carregando` e o realce da linha. Vem primeiro porque só reaproveita peças do M3.
2. **Diálogos do portal**: `AnimatePresence` nos três pontos que abrem o `PortalDialog` (aprovar, solicitar revisão e responder). É independente, mas fica em `colaborador-app.tsx`, o mesmo arquivo das tarefas 3 e 4.
3. **Ação principal em destaque**: reorganiza o card `portal-acao` e realça o passo atual. Fica antes do motion da tarefa 4, para a cascata já nascer na ordem nova.
4. **Motion expressivo na aprovação do BM**: `AnimatedText` no título da etapa, `CountUp` nos valores do resumo, `Stagger` nos blocos, skeleton no carregamento inicial e fade no `PortalFeedback`.
5. **Chat**: abertura e fechamento do `RevisionChatWidget` e do `GeneralChatWidget`, fade nas mensagens novas e `Modal` no `ChatImageViewer`. Vai por último, porque o `GeneralChatWidget` também aparece no painel interno.

Tudo fica em sequência nesta sessão: as tarefas 2 a 4 tocam o mesmo `colaborador-app.tsx`, e a 1 e a 5 são pequenas.

## Inventário
- **`colaborador-app.tsx`** (1.341 linhas):
  - carregamento inicial com spinner (linha ~586);
  - títulos de etapa em `<h2>` ("Aguardando o envio do BM", "Conferência da Medição", "Análise em andamento");
  - `BoletimResumoPortal`, card `portal-acao`, `ComposicaoPortal` e `DocumentosMedicaoPortal`;
  - `AprovarBoletimDialog`, `SolicitarRevisaoDialog` e `ResponderMedicaoDialog` (linhas ~985 a 1011);
  - `RevisionChatWidget` (botão flutuante e janela, linhas ~1161 e ~1220);
  - `GeneralChatWidget` (linha ~1097).
- **`portal-fornecedor.tsx`**: `PortalDialog` (já no `Modal`), `PortalFeedback`, `BoletimResumoPortal` e `EstadoConcluido`.
- **`minhas-medicoes.tsx`**:
  - skeleton próprio (linhas ~73 a 75);
  - linhas clicáveis (~148) e lista no celular (~171);
  - `DetalheMedicao` no `AdminSidePanel` (~207);
  - overlay cru do BM (~285);
  - `EnvioNotaFiscal` (~303).
- **`general-chat-widget.tsx`**: `ChatImageViewer` com overlay cru (~261) e janela de conversas. Também usado em `medicoes-app.tsx` (ADMIN).

## Riscos
- **Guardas do portal** (`tests/portal-fornecedor.test.ts`): eles procuram trechos exatos de `colaborador-app.tsx`, por exemplo `onConfirm={() => void sendSgc("ENVIAR")}`, `disabled={saving || !salvoAt}` e o recorte entre "Conteúdo visível após envio do BM" e `{/* ── Minhas Medições ── */}`. Ao mover o card `portal-acao`, esses trechos e marcadores ficam iguais; se um guarda quebrar, ajusta-se o guarda só quando a regra continua a mesma.
- **E2E do portal** (`portal-fornecedor-redesign`, `minhas-medicoes`, `bm-total-aprovacao`, `workflow-*`, `e2e/pages/portal-page.ts`): eles localizam por papel e texto. A nova ordem dos blocos não pode mudar textos nem papéis. O teste de 375 px de Minhas Medições mede o painel, e o motion reduzido da config resolve isso.
- **`CountUp` em valor de dinheiro:** o valor final em `sr-only` precisa ser o texto que o E2E lê. Hoje o E2E procura o valor formatado no resumo; o `CountUp` já guarda o valor final em `sr-only`, mas o número visível anima. Com motion reduzido ele aparece final na hora. Conferir os specs que leem o resumo.
- **Chat compartilhado:** a animação do `GeneralChatWidget` aparece também para o ADMIN interno; o E2E `realtime-multiuser` usa o chat.
- **Fornecedor externo em celular:** motion expressivo, mas sem atrasar a ação (a cascata inteira em até ~400 ms) e nada de animação em loop.

## Tarefas

- [x] **T1: Minhas Medições, NF e comprovante** — feita em 2026-10-18. Painel com `AnimatePresence` e `Fragment` de key fixa; BM no `Modal variante="tela"`; `Carregando`; `classeLinha` na linha aberta. O próximo passo em AGUARDANDO_NF ganha destaque, e a NF recebida, o arquivo escolhido e o erro de envio entram com fade (`starting:`). O botão já mostrava "Enviando..." e o progresso. O caso com motion ligado ficou em `e2e/minhas-medicoes.spec.ts`, porque o seed não tem medição aprovada para os fornecedores fixos. O `fecharEMedir` foi para `e2e/fixtures/saida-animada.ts`. Verificado: `tsc`; `test:targeted` 539/539; E2E completo 205/207 (um localizador ambíguo do happy path, corrigido, e uma falha intermitente nos filtros); os dois specs passaram depois (13/13).
  - Aceite:
    - `AnimatePresence` com `Fragment` de key fixa no ponto do `DetalheMedicao`; trocar de medição é instantâneo e fechar anima;
    - o visualizador do BM no `Modal variante="tela"` com `rotulo="Boletim de Medição"`;
    - `Carregando` no lugar do skeleton próprio, com o texto "Carregando medições…" mantido;
    - `classeLinha` e `data-aberta` na linha aberta (desktop);
    - `EnvioNotaFiscal`: o botão mostra "Enviando…" durante o envio, a confirmação entra com fade e o passo "Enviar NF" ganha destaque em AGUARDANDO_NF.
  - Verificar: guarda (nenhum `fixed inset-0` cru em `minhas-medicoes.tsx`; `AnimatePresence` no ponto); `tsc`; E2E `minhas-medicoes`; caso do portal em `e2e/motion-saida.spec.ts`.
  - Arquivos: `components/minhas-medicoes.tsx`, `tests/tema-tokens.test.ts` e `e2e/motion-saida.spec.ts`.

- [x] **T2: diálogos do portal com saída** — feita em 2026-10-18. Um `AnimatePresence` envolve os três pontos (`dialogo-aprovar`, `dialogo-revisao` e `dialogo-resposta`); o `PortalDialog` já usava o `Modal`, que fica inerte na saída. Verificado: `tsc`; `test:targeted` 539/539; E2E do portal e dos fluxos 37/37.
  - Aceite: `AnimatePresence` nos pontos de `AprovarBoletimDialog`, `SolicitarRevisaoDialog` e `ResponderMedicaoDialog`; proteção contra duplo envio e textos iguais.
  - Verificar: guarda; `tsc`; `test:targeted` (guardas do portal); E2E `portal-fornecedor-redesign` e `bm-total-aprovacao`.
  - Arquivos: `components/colaborador-app.tsx`, `tests/tema-tokens.test.ts`.

### Checkpoint A (depois da T2)
- `tsc`, `test:targeted` e E2E do portal passando. Você confere Minhas Medições e os diálogos com um fornecedor de teste.

- [x] **T3: ação principal em destaque** — feita em 2026-10-18. O card `portal-acao` já ficava logo abaixo do resumo; não precisou mover. Com ação pendente (aprovar o BM ou enviar a NF), ele ganha borda primária e fundo `--primary-soft` (`data-acao-pendente`). O passo atual (Salvar, depois Aprovar) tem borda primária, número em fundo sólido e `aria-current="step"`. Junto: `bg-white/65` e `bg-white/70` das áreas de upload viraram `bg-[var(--surface)]/…` (no tema escuro ficavam claras; o guarda do M1 não pegava `bg-white/`), com guarda para as telas do portal. Contraste ≥ 4,5:1 nos dois temas (menor: 4,71). Verificado: `tsc`; `test:targeted` 540/540; E2E do portal 47/47; capturas nos dois temas.
  - Aceite:
    - o card `portal-acao` fica logo abaixo do resumo do BM, com borda `--primary` e fundo `--primary-soft`;
    - o passo atual fica realçado e o passo concluído mostra o check em verde;
    - mesmos textos, `data-testid` e regras (Aprovar só depois de Salvar).
  - Verificar: guardas de `portal-fornecedor.test.ts`; `tsc`; E2E do portal; contraste do texto sobre `--primary-soft` nos dois temas.
  - Arquivos: `components/colaborador-app.tsx`.

- [x] **T4: motion expressivo na aprovação do BM** — feita em 2026-10-18. `AnimatedText` nos títulos de etapa, em "O que você precisa fazer" e no título do `EstadoConcluido`; `Stagger` com cinco `StaggerItem` (resumo, ação, composição, descartados e documentos); skeleton no carregamento inicial ("Carregando ambiente do fornecedor…" em `sr-only`); `PortalFeedback` com fade. Os valores do resumo usam `CountUp` com `textoUnico` (opção nova): um só texto, que termina no valor final, porque o E2E lê esses elementos com `toHaveText` e `innerText` e a cópia oculta duplicaria o valor. Verificado: `tsc`; `test:targeted` 541/541; E2E do portal 55/55; headless com motion ligado (o valor conta até R$ 7.425,00 em cerca de 0,8 s).
  - Aceite:
    - `AnimatedText` nos títulos de etapa;
    - `CountUp` nos valores do `BoletimResumoPortal`;
    - `Stagger` nos blocos (resumo, ação, composição e documentos);
    - skeleton no carregamento inicial, com "Carregando ambiente do fornecedor…" em `sr-only`;
    - `PortalFeedback` com fade.
  - Verificar: guarda; `tsc`; E2E do portal (motion reduzido); headless com motion ligado.
  - Arquivos: `components/colaborador-app.tsx`, `components/portal-fornecedor.tsx`, `tests/tema-tokens.test.ts`.

- [x] **T5: chat** — feita em 2026-10-18, com um desvio do aceite. Os dois widgets trocam o botão pela janela com `if (!open) return botão`, e a janela desmonta na hora; animar a saída exigiria reestruturar dois componentes grandes, que guardam o estado da gravação de áudio. Então a entrada é só CSS (`ENTRADA_JANELA` em `components/motion.tsx`): a janela abre com escala e fade a partir do canto, e ao fechar o botão volta com o mesmo efeito. Sem saída animada, também não há o que deixar inerte. As mensagens usam `ENTRADA_MENSAGEM`: as que chegam sobem e aparecem; ao abrir, o histórico aparece junto com a janela. O `ChatImageViewer` ficou com overlay próprio e fade, sem passar para o `Modal`: ele fecha ao clicar no fundo, e o `Modal` não tem esse comportamento. Guarda em `tema-tokens`. Verificado: `tsc`; `test:targeted` 542/542; E2E completo 211/211.
  - Aceite:
    - a janela do `RevisionChatWidget` e a do `GeneralChatWidget` abrem e fecham com escala e fade, ficando inertes na saída;
    - mensagens novas entram com fade curto (sem animar o histórico ao abrir);
    - `ChatImageViewer` no `Modal`.
  - Verificar: guarda; `tsc`; E2E `realtime-multiuser` e os que usam o chat.
  - Arquivos: `components/colaborador-app.tsx`, `components/general-chat-widget.tsx`, `tests/tema-tokens.test.ts`.

### Checkpoint B (fim do M4)
- `tsc`, `test:targeted` e E2E completo (3 rodadas).
- Você confere o portal com um fornecedor de teste, nos dois temas e a 375 px.
- `/review` e `/ponytail-review`; cérebro; commit só com o seu pedido.
- Revisão em 2026-10-18. O `/review` aprovou com ressalvas, sem nada crítico. Importantes: (1) com `textoUnico`, o leitor de tela pode ler um valor intermediário do BM nos primeiros ~0,8 s; a correção é tirar o `CountUp` desses três valores ou manter a cópia `sr-only` e fazer o E2E ler outro atributo. (2) O Esc do `PortalDialog` continua ativo durante a saída; a correção é `useIsPresent` no efeito. Sugestões: piscada dupla da mensagem otimista no chat; BM de Minhas Medições sem foco inicial nem Esc (já existia antes); a condição de ação pendente repetida; o skeleton inicial montado à mão em vez do `Carregando`; a string de fade repetida em três lugares; a região `role="status"` do `PortalFeedback` nasce com o texto (já existia antes); falta um E2E da saída inerte dos diálogos do portal. O `/ponytail-review` só apontou a condição de ação pendente repetida. Correções aguardam o seu pedido.
- E2E em 3 rodadas seguidas (2026-10-18): 211/211, 203/204 e 203/204. As duas falhas foram intermitentes e em specs diferentes: `portal-fornecedor-redesign:162` (Esc no diálogo de revisão) e `importacao-identidades:128` (ETL real, área fora do M4). Repetidos isolados, passaram: 44/44 (portal, 4 repetições) e 16/16 (importação, 2 repetições). Na suíte, o 3º número soma 204 porque os testes do mesmo describe serial que vêm depois de uma falha não rodam.
- Correções da revisão em 2026-10-18 (itens 1, 2, 3, 5 e 7; os itens 4, 6, 8 e 9 ficaram como estavam, por decisão sua). (1) Os valores em dinheiro do resumo do BM voltaram a ser texto fixo: sem `CountUp`, a opção `textoUnico` foi removida, e a entrada fica com a cascata. Assim, o leitor de tela e quem copia leem sempre o valor final. (2) O Esc do `PortalDialog` fica desligado durante a saída (`useIsPresent`). (3) Só a mensagem do outro lado entra com fade; a do próprio usuário aparece na hora, e a troca da otimista pela real não pisca. (5) `acaoPendente` calculado uma vez. (7) `ENTRADA_FADE` em `components/motion.tsx`, usado em Minhas Medições (3 lugares), no `PortalFeedback` e no `ChatImageViewer`. Guardas atualizados em `tema-tokens`. Verificado: `tsc`; `test:targeted` 542/542; E2E completo 211/211.
