---
atualizado: 2026-10-18
status: concluído em 2026-10-18 (7fb1499)
tags: [spec, plano]
---
# Plano: M3 Painéis dos setores

Spec: [layout-tema-motion](layout-tema-motion.md), seção M3. Base: M2 em ee6d375.

## Componentes e ordem
1. **Painel lateral com entrada e saída**: o `AdminSidePanel` é compartilhado por 12 usos. Primeiro, porque é o maior ganho visual e o que mais mexe nos fluxos do E2E.
2. **`Modal` único**: junta os overlays repetidos e dá saída aos modais. Depois do 1, porque usa o mesmo padrão (`AnimatePresence` + `pointer-events-none` na saída).
3. **Abas com indicador**: independente.
4. **`Toast`**: independente.
5. **`Skeleton`**: independente.
6. **Realce da linha aberta**: depende do 1, porque o estado "aberto" é o do painel lateral.

As tarefas 3 a 5 não dependem entre si, mas tocam os mesmos arquivos grandes (`administrativo-panel.tsx`, `financeiro-panel.tsx`, `fornecedores/index.tsx`). Por isso ficam em sequência nesta sessão, sem paralelismo.

## Inventário
- **`AdminSidePanel` (8 componentes, 12 usos)**:
  - `FornecedorDetalhe`, `FuncionarioDetalhe` (`administrativo/detalhes.tsx`);
  - `FornecedorEditor`, `FuncionarioCreatePanel` (`administrativo/fornecedor-editor.tsx`, abertos em `administrativo-panel.tsx`);
  - `ImportarConsultaPanel`;
  - `EvidenciaDrawer` (`evidencias-workspace.tsx`);
  - `FinanceiroDrawer` (`financeiro-panel.tsx`);
  - `GerenciarCiclosPanel`;
  - `MedicaoDrawer`, `FornecedorHistoricoDrawer`, `ContratoHistoricoDrawer` (`historico/drawers.tsx`);
  - o painel de `minhas-medicoes.tsx`.
  - Com implementação própria: `FornecedorDrawer` (`fornecedores/index.tsx`).
- **Modais `ds-dialog` (16)**:
  - `administrativo-panel.tsx` (8);
  - `gerenciar-ciclos.tsx` (2);
  - `primeiro-acesso-lote-dialog.tsx`, `divergencias-medicao.tsx`, `ciclo-publicado.tsx`, `envio-bm-lote-dialog.tsx`, `identidades-pendentes.tsx`, `portal-fornecedor.tsx` (1 cada).
  - Com overlay próprio sem `ds-dialog`, mas nos painéis do escopo: o modal de credencial (`administrativo-panel.tsx`), o `alertdialog` de `divergencias-medicao.tsx` e o modal do `historico-workspace.tsx`. Entram junto.
  - Fora: `alterar-senha-modal.tsx` (login e conta) e `medicao-form.tsx` (verificar se ainda é usado; se for, entra no M4).

## Riscos
- **Saída mantém o elemento no DOM por cerca de 150 ms:**
  - o E2E que espera `toHaveCount(0)` continua funcionando (repete a checagem);
  - um clique logo depois do fechamento seria interceptado pelo overlay, por isso `pointer-events-none` na saída é obrigatório e tem guarda;
  - um `getByRole("dialog")` logo após fechar pode achar dois diálogos (o que sai e o que entra); saída curta e, se aparecer no E2E, o `exit` também tira o `role`.
- **`AnimatePresence` precisa de `key` estável** quando o mesmo ponto troca o item aberto (outro fornecedor). Com `key` = id do item, o painel antigo sai e o novo entra. Sem `key`, o conteúdo trocaria sem animar, o que também é aceitável; decido por ponto, sem remontar o editor no meio de uma edição.
- **Foco ao fechar:** hoje cada painel controla o foco. A saída animada não pode devolver o foco tarde demais. O retorno continua no `onClose`, sem esperar o fim da animação.
- **`administrativo-panel.tsx` é grande (mais de 1.600 linhas):** as trocas são mecânicas (só o invólucro dos modais) e o diff deve mostrar só isso.
- **Skeleton e E2E:** os textos "Carregando…" atuais ficam em `sr-only` (o E2E espera que sumam).

## Tarefas

- [x] **T1: painel lateral com entrada e saída** — feita em 2026-10-18. Hook `usePainelSobreposto` em `components/motion.tsx`, usado pelo `AdminSidePanel` e pelo `FornecedorDrawer`. Ele conta os painéis montados: a entrada só ocorre quando não havia painel aberto. Detalhe ↔ edição do mesmo item usa a mesma `key` no `AnimatePresence` e troca sem saída. Durante a saída, o `useIsPresent` desliga cliques (`pointer-events-none`) e o Esc. Medido no Chromium headless: o painel desliza na entrada e na saída, detalhe → edição fica com um só diálogo e o clique logo após fechar reabre normalmente. `tema-tokens` 27/27. `minhas-medicoes.tsx` (M4) anima a entrada, mas ainda fecha sem saída até ganhar `AnimatePresence` no M4.
  - O E2E pegou duas regressões na primeira versão, ambas corrigidas:
    - Trocar de item com uma `key` por item deixava dois diálogos ao mesmo tempo (o que saía e o que entrava), o que quebrava o seletor de Evidências. Agora o filho do `AnimatePresence` é um `Fragment` com `key` fixa por local: trocar item ou modo é instantâneo e só fechar anima a saída.
    - A medição de posição do painel a 375 px pegava o meio da entrada. Agora o `playwright.config.ts` roda com `reducedMotion: "reduce"`: o E2E mede o estado final, sem corrida com animação, e a animação fica coberta pelas guardas e pela medição headless.
  - Depois das correções: `tsc` ok, `test:targeted` 533/533 e E2E 208/208 em 9,0 min (antes eram cerca de 11 min com as animações).
  - Aceite:
    - o `AdminSidePanel` anima o overlay (fade) e o painel (`x: "100%"` → `0`, 280 ms; saída de 180 ms) com `motion`;
    - `pointer-events-none` na saída;
    - motion reduzido abre e fecha na hora (o `MotionConfig` já cobre o `x`; a opacidade também zera a duração);
    - os 12 usos e o `FornecedorDrawer` ficam dentro de `AnimatePresence` no ponto onde abrem, com `key` do item quando o mesmo ponto troca de item;
    - Esc, foco e `aria-modal` sem mudança.
  - Verificar: guarda (o painel tem `exit` e `pointer-events-none`; os pontos condicionais estão em `AnimatePresence`); `tsc`; E2E de Administrativo, Financeiro, Fornecedores, Evidências e Histórico; navegador: abrir, fechar e clicar logo depois, nos dois temas.
  - Arquivos: `administrativo/admin-side-panel.tsx`, `fornecedores/fornecedor-drawer.tsx` e os pontos de abertura listados no inventário.

- [x] **T2: `Modal` único** — feita em 2026-10-18.
  - `Modal` em `components/ui.tsx`: overlay, contêiner, `role`/`aria-*`, entrada com escala e fade, saída rápida com `pointer-events-none` via `useIsPresent`; variante `tela` para os visualizadores de BM.
  - 19 modais migrados (16 `ds-dialog`, o de credencial e os visualizadores de BM de Evidências e de Histórico, que passaram a ter `role="dialog"` com o nome "Boletim de Medição"). A conversão foi mecânica (só o invólucro), com `AnimatePresence` e `key` própria nos pontos que abrem dentro do escopo.
  - Os modais do Administrativo que não tinham `role` passaram a ter `role="dialog"`; todos os seletores de diálogo do E2E usam nome, então nada ficou ambíguo.
  - O `PortalDialog` (M4) já usa o `Modal`; o `AnimatePresence` dos pontos dele fica para o M4.
  - Medido no Chromium headless: o modal entra (opacidade de 0,13 a 1 e escala de 0,97 a 1), sai com `pointer-events: none` e reabre logo depois de cancelar. A guarda antiga do M1 (`starting:` em cada `ds-dialog`) foi trocada pela do `Modal`, e `tests/portal-fornecedor.test.ts` passou a conferir os atributos do diálogo no `Modal` (o portal passa `role` e título).
  - Aceite:
    - `Modal` em `components/ui.tsx` com overlay, `ds-dialog`, `role` (`dialog`/`alertdialog`), `aria-modal`, `aria-labelledby`/`aria-describedby` e `className` do contêiner (largura);
    - entrada com escala 0.97 e fade (200 ms), saída de 140 ms e `pointer-events-none` na saída;
    - os 16 `ds-dialog`, o modal de credencial, o `alertdialog` de divergências e o modal do Histórico passam a usar o `Modal`, dentro de `AnimatePresence`;
    - `data-testid`, textos e botões iguais.
  - Verificar: guarda (nenhum `ds-dialog` fora do `Modal`; `Modal` com `exit` e `pointer-events-none`); `tsc`; E2E completo; navegador em 3 modais diferentes.
  - Arquivos: `components/ui.tsx` e os arquivos do inventário de modais.

### Checkpoint A (depois da T2) — testes ok em 2026-10-18 (`test:targeted` 533/533; E2E 208/208 em duas rodadas seguidas, 8,8 min cada); conferido e aprovado por você no Docker (porta 3200, banco de teste)
- `tsc`, `test:targeted` e E2E completo passando. Você confere painéis e modais no navegador.

- [x] **T3: abas com indicador** — feita em 2026-10-18. Componente `Aba` em `components/ui.tsx` (botão `role="tab"` com sublinhado `motion.span` e `layoutId` vindo de `grupo`), usado nas 3 listas com grupos `aba-cadastro`, `aba-status-financeiro` e `aba-perspectiva-historico`. Guarda em `tema-tokens`.
  - Aceite: as 3 listas (`financeiro-panel.tsx`, `administrativo-panel.tsx` e `historico-workspace.tsx`) com sublinhado `motion.span` e `layoutId` próprio; `aria-selected` e teclado iguais.
  - Verificar: guarda (`layoutId` nas 3 listas); `tsc`; navegador.

- [x] **T4: `Toast`** — feita em 2026-10-18. `Toast` em `components/ui.tsx` recebe `mensagem` (null esconde), `tom` e `camada`; o `AnimatePresence` fica dentro dele e o tempo de 4 s continua com quem chama. Os avisos de `identidades-pendentes.tsx` entram com fade em CSS (`starting:opacity-0`). Guarda em `tema-tokens`.
  - Aceite:
    - `Toast` em `components/ui.tsx` (`role="status"`, `aria-live="polite"`, tons sucesso/erro), com entrada por slide + fade e saída por fade, dentro de `AnimatePresence`;
    - substitui os toasts fixos de `administrativo-panel.tsx`, `financeiro-panel.tsx` e `fornecedores/index.tsx`;
    - o aviso de `identidades-pendentes.tsx` entra com fade;
    - mensagens e tempos iguais.
  - Verificar: guarda (nenhum `fixed bottom-5 right-5` fora do `Toast`); `tsc`; E2E que verificam toast; navegador.

- [x] **T5: `Skeleton`** — feita em 2026-10-18. `Skeleton` (bloco pulsante, parado com motion reduzido) e `Carregando` (`role="status"`, texto em `sr-only`, linhas de skeleton) em `components/ui.tsx`. Usados nas listas de Administrativo, Financeiro, Histórico e Evidências, nos visualizadores de BM, nos painéis laterais (composição do BM, divergências, documentos, NF) e nos KPIs do dashboard. Os textos "Carregando…" continuam no código (o E2E espera "Carregando cadastros..." sumir). O ícone de atualizar segue girando. Fornecedores não tinha carregamento de lista. Guarda em `tema-tokens`.
  - Aceite:
    - `Skeleton` e contêiner de carregamento (`role="status"` + texto atual em `sr-only`) em `components/ui.tsx`;
    - os carregamentos das listas dos 5 painéis e dos painéis laterais (BM, divergências) usam o skeleton;
    - o skeleton de Evidências e o do dashboard passam a usar o componente.
  - Verificar: guarda (os textos "Carregando…" que o E2E usa continuam no código); `tsc`; E2E completo.

- [x] **T6: realce da linha aberta** — feita em 2026-10-18. `classeLinha(aberta)` em `components/ui.tsx` dá as classes da linha clicável; a do item aberto ganha `--primary-soft` e a barra primária à esquerda (sem hover cinza por cima) e `data-aberta`. Usada nas tabelas de Administrativo (fornecedores e funcionários), Financeiro, Histórico (3 perspectivas), Evidências e Fornecedores; os pais passam o item aberto (`abertoId`, `abertaKey` ou `aberto`). Só no desktop: no celular o painel cobre a lista. Contraste do texto sobre `--primary-soft` ≥ 4,5:1 nos dois temas (menor: texto secundário 4,83 no claro). Guarda em `tema-tokens`.
  - Aceite: nas 5 tabelas, a linha do item aberto ganha `bg-[var(--primary-soft)]` + `shadow-[inset_3px_0_0_var(--primary)]`, com `transition-colors` e `aria-selected` ou `data-aberta`; o realce sai ao fechar.
  - Verificar: `tsc`; navegador nos dois temas (contraste do texto sobre `--primary-soft`).

### Checkpoint B (fim do M3)
- `tsc`, `test:targeted` e E2E completo (3 rodadas, pela instabilidade conhecida do servidor de dev).
- Você confere os cinco painéis nos dois temas.
- `/review` e `/ponytail-review`; cérebro; commit só com o seu pedido.
- Resultado em 2026-10-18: E2E 208/208 em 3 rodadas seguidas (9,5 min cada); `test:targeted` 537/537. O `/review` pediu mudanças. Item importante: durante a saída animada, `pointer-events-none` bloqueia só o mouse. O teclado e o leitor de tela ainda alcançam o modal ou painel que está saindo, e um Enter repetido no `DeleteConfirmModal` pode mandar um segundo POST de exclusão. Correção proposta: `inert={!presente}` no `Modal`, no `AdminSidePanel` e no `FornecedorDrawer`. Sugestões: nome acessível nos 6 modais do Administrativo sem `rotuloId`; anel de foco na linha aberta; live region fixa no `Toast`; um só `role="status"` por painel; BM do Financeiro no `Modal variante="tela"`; saída do drawer de Fornecedores sobreposta ao editor. O `/ponytail-review` só apontou o `ease` literal repetido no `Modal` (usar `EASE_SAIDA`). Correções aguardam o seu pedido.
- Correções da revisão em 2026-10-18 (itens 1 a 7 e o do `/ponytail-review`): (1) `inert={!presente}` no `AdminSidePanel`, no `FornecedorDrawer` e no `Modal`. No `Modal`, o atributo fica num invólucro `div.contents`, porque o `motion.div` não repassa `inert` ao DOM. Teste que reproduz: `e2e/motion-saida.spec.ts`, com motion ligado; falhava antes (foco dentro, sem `inert`). (2) `rotuloId` nos 6 modais do Administrativo e guarda "todo `<Modal>` tem nome". (3) Anel de foco na linha aberta. (4) Região viva fixa no `Toast`. (5) Prop `anunciar={false}` no `Carregando` dos carregamentos secundários dos painéis. (6) BM do Financeiro no `Modal variante="tela"`. (7) Detalhe e editor de Fornecedores no mesmo `Fragment key`. Ponytail: `EASE_SAIDA` no `Modal`. Achado à parte, já existia antes do M3 e foi corrigido no mesmo dia: fechar o BM enquanto ele carregava deixava o fetch reabrir o visualizador. Histórico, Evidências e Financeiro passaram a usar `useVisualizadorBm` (`components/boletim-medicao.tsx`), que descarta a resposta de um BM fechado ou trocado e trata a falha de rede. Teste que reproduz: `e2e/bm-fechar-carregando.spec.ts` (Histórico, que tem medições no seed), mais uma guarda em `tema-tokens` para os três painéis.
