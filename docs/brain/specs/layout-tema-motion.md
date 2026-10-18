---
criado: 2026-10-17
status: aprovada em 2026-10-17
---
# Layout: tema claro/escuro e motion

## Objetivo
Modernizar a interface do En Passant para os três setores e para os fornecedores, com modo claro e modo escuro e com animações expressivas, sem perder a densidade de informação que o trabalho com medições exige.

Pronto quando:
- toda tela funciona nos dois temas com contraste de texto de pelo menos 4.5:1;
- botões, títulos, páginas, painéis e modais têm motion consistente;
- `prefers-reduced-motion` desliga toda animação que não for essencial.

Decisões do usuário em 2026-10-17:
- Entrega em fundação + telas: um módulo por vez, cada um com o próprio commit.
- O tema padrão segue o sistema operacional. O usuário troca no menu da conta, e a escolha fica salva no navegador.
- Motion expressivo: inclui animação de texto nos títulos, stagger em listas de cards e transições de página. Tabelas ficam sem animação de entrada.
- Exceção ao "sem CSS novo" do CLAUDE.md, limitada ao `app/globals.css`: o bloco de tokens do tema escuro e o `@custom-variant dark`. Os componentes continuam só com classes Tailwind.

Identidade mantida: primária #AF1B1B e fonte Manrope. A paleta azul-marinho com Fira que a UI/UX Pro Max sugeriu foi descartada. Dela ficam só as regras: interface densa, hover entre 150 e 300 ms, nada de overshoot (efeito "back"/elástico) em tabela ou dado financeiro, e no máximo 1 ou 2 elementos chamativos por tela.

## Mapa de capacidades
Dependência só para baixo: M2, M3 e M4 dependem de M1 e não dependem entre si.

| Id | Módulo | Entrega | Depende de |
|----|--------|---------|------------|
| M1 | Fundação | Tokens semânticos claro/escuro, migração das cores fixas para tokens, alternador de tema, primitivas de motion, shell | — |
| M2 | Login e dashboard | Login com entrada animada; KPIs com contador, cards em stagger, gráficos no tema | M1 |
| M3 | Painéis dos setores | Planejamento, Administrativo e Financeiro: cabeçalhos animados, drawers e modais com transição, ajustes de hierarquia | M1 |
| M4 | Portal do fornecedor | Telas do COLABORADOR com o mesmo padrão | M1 |

Esta spec detalha o M1, o M2 e o M3. O M4 ganha uma seção própria quando começar.

## M1: Fundação

### 1. Tokens e tema
- `app/globals.css`:
  - Os tokens atuais do `:root` (`--background`, `--surface`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, os pares `--success`/`--success-soft` etc.) ganham valores escuros em `.dark`.
  - Entra `@custom-variant dark (&:where(.dark, .dark *))`.
  - Os componentes já usam tokens pelo formato `text-[var(--foreground)]` (mais de 1.000 usos), e esse formato continua. Não entra `@theme inline`: trocar o valor da variável em `.dark` já basta para essas classes.
  - Os valores fixos do próprio `globals.css` passam para tokens: scrollbar, `::selection`, hover de `tbody tr` e a sombra de `.ds-dialog`/`.ds-popover`.
  - O bloco "Compatibilidade visual durante a migração" (overrides dos azuis antigos) sai depois que o codemod trocar essas classes.
- Escuro: superfície neutra, sem preto puro. Fundo próximo de #0F0F10, superfície #18181B, borda #2A2A2E, texto #EDEDED e texto secundário #A1A1AA. A primária clareia para manter o contraste sobre o fundo escuro (algo como #E04848; o valor final é medido). A `--sidebar` já é escura e continua.
- Classe `dark` no `<html>`:
  - Um script inline e bloqueante em `app/layout.tsx` lê `localStorage` (`tema`: `claro`, `escuro` ou ausente, que significa sistema) e `matchMedia` antes da pintura, para a página não piscar no tema errado. É o único script inline. O `<html>` leva `suppressHydrationWarning`.
  - O alternador (Claro / Escuro / Sistema) fica no `components/account-menu.tsx` e usa o estado do `components/providers.tsx`, ao lado do `BlurContext`. Nenhuma biblioteca nova (`next-themes` não entra).
  - Na tela de login, que não tem menu da conta, o tema segue o sistema ou a escolha salva.
- Gráficos (recharts) e HeroUI: as cores saem dos tokens. O HeroUI só aparece num arquivo hoje. Se o tema dele não acompanhar a classe `dark`, os dois componentes (Card e Chip) são estilizados pelas classes.

### 2. Migração das cores fixas (codemod)
- Um script em `scripts/` (descartável, roda uma vez e não fica no build) troca as classes com hex por classes de token em `components/` e `app/`. Mapa inicial pela frequência (o script lista as que sobrarem para decisão manual):

| Hex atual | Token (`[var(--x)]`) |
|-----------|-------|
| #1A1A1A, #111827, #111111, #1F2937 | `foreground` |
| #555555, #6B7280, #4B5563, #374151, #9CA3AF | `muted-foreground` (o #9CA3AF em texto auxiliar vira `muted-foreground/70` se o contraste deixar) |
| #E5E7EB, #EFEFED, #D8DEE8 | `border` |
| #D1D5DB | `border-strong` |
| #FAFAF8, #F9FAFB, #F3F4F6, #F7F7F5, #FAFAFA, #F5F5F5 | `surface-muted` (token novo) ou `background` |
| `bg-white` | `bg-[var(--surface)]` |
| #2563EB, #1D4ED8, #AF1B1B | `primary` / `primary-hover` |
| #EFF6FF | `primary-soft` |
| #DC2626, #B91C1C / #FEF2F2, #FEE2E2 | `error` / `error-soft` |
| #16A34A, #15803D / #DCFCE7 | `success` / `success-soft` |
| #92400E, #D97706, #F59E0B / #FFFBEB | `warning` / `warning-soft` |

- `text-white` em botão primário e sobreposições `bg-black/40` continuam: são corretos nos dois temas.
- O `style={{}}` que já existe em 8 arquivos não muda neste módulo, exceto quando tiver cor fixa: aí a cor vai para token.

### 3. Primitivas de motion
Arquivo novo: `components/motion.tsx`. Usa o `framer-motion`, que já é dependência. Conteúdo, só o que já tem uso (`Stagger` e `CountUp` entram no M2, ver correções da revisão):
- `FadeIn`: entrada de página e de painel (opacity + y de 8px, 250 ms, ease-out).
- `Stagger` e `StaggerItem`: listas de cards (60 ms entre os itens, no máximo cerca de 12 itens animados).
- `AnimatedText`: título que entra por palavra (no `PageHeader`). Os leitores de tela recebem o texto inteiro (`aria-label` no container e `aria-hidden` nas partes).
- `CountUp`: valor de KPI. O valor final vem formatado em BRL desde o primeiro render, para não aparecer número parcial errado, e a animação só interpola a exibição. Para não arrastar float para cálculo, os valores em `Decimal` chegam já convertidos para exibição.
- Botões (`Button`/`IconButton` de `components/ui.tsx`): hover e press só com classes Tailwind (`transition`, `active:scale-[0.97]`, `motion-reduce:transform-none`). O `framer-motion` não entra em cada botão.
- Modais e drawers: `AnimatePresence`, com saída mais rápida que a entrada (cerca de 150 ms contra 250 ms).
- Tudo respeita `useReducedMotion()`: com motion reduzido, o componente renderiza o estado final na hora.
- Nada de overshoot em tabela, valor monetário ou status de BM.

### 4. Shell
`components/app-shell.tsx`:
- O conteúdo entra com `FadeIn` na troca de aba/tela.
- O item ativo do menu ganha um indicador que desliza (`layoutId`).
- As superfícies passam para tokens.

O mesmo vale para o `components/ui.tsx` (Card, PageHeader com `AnimatedText`, Badge, Input, Select).

## M2: Login e dashboard (aprovada em 2026-10-18)

Decisões do usuário em 2026-10-18:
- Login com o texto entrando e um fundo vivo no painel escuro.
- Seletor de tema discreto no login.
- No dashboard: contadores nos KPIs, cards em cascata, gráfico que se desenha, hover nos cards.

Pronto quando:
- as duas telas têm o motion abaixo nos dois temas;
- o HTML do servidor nunca fica escondido esperando o JS (entradas da carga inicial só com `starting:` em CSS), e com motion reduzido nada anima;
- o gráfico segue o tema (eixos, grade, rótulos e tooltip), sem cor fixa;
- `tsc`, `test:targeted` e E2E completo passam.

### 1. Login (`components/login-form.tsx`)
- **Painel escuro da direita:**
  - a frase "Decisões financeiras…" entra palavra por palavra com `AnimatedText as="h2"`, que já aceita `h2`;
  - fundo vivo com uma grade sutil (gradiente em classes `bg-[linear-gradient(...)]` + `bg-[size:...]`) e um brilho radial na cor primária, que deriva devagar (loop de cerca de 20 s via `motion.div`, só `x`/`y`/`opacity`);
  - o painel é decorativo: fica com `aria-hidden` no brilho e na grade, e o texto continua legível.
- **Formulário:** o cartão entra só com CSS, pela variante `starting:` (`starting:opacity-0 starting:translate-y-2`, cerca de 400 ms, `motion-reduce:transition-none`). O `@starting-style` roda na primeira pintura sem depender do JS, então o HTML do servidor nunca fica escondido além da própria transição. Com o JS desligado, a página aparece igual.
- **`AnimatedText` passa a ser só CSS** (mudança em `components/motion.tsx`):
  - cada palavra com `starting:opacity-0 starting:translate-y-[0.35em] starting:blur-sm`, `transition-[opacity,translate,filter]` e atraso por índice, vindo de uma lista fixa de classes `delay-*` (o Tailwind precisa de classes estáticas);
  - o `@starting-style` vale na primeira pintura e em todo elemento inserido depois, então os títulos animam tanto na carga do servidor quanto na troca de tela, sem divergência de hidratação;
  - sai o framer e o `useSyncExternalStore` do `AnimatedText`; o `FadeIn` continua no framer, porque precisa repetir a entrada sem remontar.
- **Tema:** botão pequeno no canto superior direito que alterna Claro → Escuro → Sistema, com ícone sol/lua/monitor e `aria-label` com o tema atual. Usa o `useTema()` do `components/providers.tsx`.
- **Erro de login:** a mensagem passa a usar os tokens de erro (`--error`/`--error-soft`), em vez da primária sobre `surface-muted`.
- O fluxo não muda: mesmos campos, mesma chamada `/api/auth/login`, mesmo modal de troca de senha.

### 2. Dashboard (`components/dashboard-pilot/`)
- **KPIs:**
  - `CountUp` nos 4 valores (Valor medido em BRL e as contagens), criado agora em `components/motion.tsx`;
  - anima ao abrir a tela e quando o valor muda (troca de ciclo/filtro);
  - o primeiro valor exibido parte de 0 só em montagem pós-hidratação;
  - o leitor de tela recebe sempre o valor final (`sr-only`);
  - continua dentro do `BlurValue`, que esconde valores no modo de privacidade;
  - implementação com `useMotionValue` + `useTransform` num `motion.span`, sem re-render por frame;
  - só exibição: o número chega pronto de `data.cards`.
- **Cascata:** `Stagger`/`StaggerItem` (criados agora) na grade dos 4 KPIs e nos blocos abaixo (gráfico, distribuição por contrato, status, BMs recentes). Passo de 60 ms; tabelas internas sem animação.
- **Hover nos cards:**
  - `DashboardKpiCard` ganha `transition`, `hover:-translate-y-0.5`, `hover:shadow-md` e `hover:border-[var(--border-strong)]`, com `motion-reduce:hover:translate-y-0`;
  - o card é compartilhado, então o hover vale também para os KPIs de Administrativo, Evidências, Financeiro e Fornecedores (consistência de propósito).
- **Gráfico de evolução (`dashboard-evolution-chart.tsx`):**
  - cores por tokens: `var(--primary)`, `var(--border)`, `var(--muted-foreground)`, `var(--surface)`, `var(--foreground)`, que funcionam em atributos SVG do recharts;
  - tooltip com `content` próprio só com classes Tailwind (sai o `contentStyle`, que era estilo inline);
  - a linha se desenha com `isAnimationActive` (cerca de 800 ms, ease-out), desligada com motion reduzido;
  - o guarda de cor passa a cobrir hex em props/strings dos gráficos (`"#xxxxxx"` em `components/dashboard-pilot/`).
- Tooltip padrão branca do recharts nos outros gráficos: `dashboard-contract-distribution.tsx` passa pelo mesmo tratamento, se usar recharts.

### Correções da revisão do M2 (2026-10-18)
`/review` e `/ponytail-review` não acharam nada crítico. Corrigidos os itens 1 a 7:
- O store da preferência de tema (`lerPreferenciaSalva`, `assinarPreferencia`, `salvarPreferencia`) foi para `lib/tema.ts`, com testes de comportamento: salvar, apagar no Sistema, avisar e cancelar a assinatura, e a cópia em memória com o `localStorage` bloqueado.
- Cascata única: a grade de KPIs é um `StaggerGrupo` (só `variants`, herda do pai) dentro do `Stagger` do dashboard. Antes, o `Stagger` aninhado controlava a própria animação e os KPIs começavam junto com o gráfico.
- O hover que levanta o card virou a prop `realce` do `DashboardKpiCard`, ligada só no dashboard. Nos painéis o card não é clicável, e o efeito sugeriria um clique.
- O brilho do login só anima visível (`useInView`). Medido no Chromium headless: no desktop ele se move; abaixo de `lg`, com o painel `display:none`, fica parado.
- O botão de tema diz para onde vai (`Tema: Sistema. Mudar para Claro`) e tem alvo de 40 px.
- As guardas recortam a função certa (`Stagger`, `StaggerGrupo`) e conferem a chamada completa do `useSyncExternalStore` e a leitura real no efeito.

### Fora do escopo do M2
- Mudar dados, cálculos ou a ordem dos blocos do dashboard.
- Redesenhar o layout do login além do painel e do seletor de tema.
- Animar a saída de diálogos (M3/M4).

### Testes do M2
- Guardas em `tests/tema-tokens.test.ts`:
  - `motion.tsx` exporta `Stagger`, `StaggerItem` e `CountUp` sem `initial` dependente de `useReducedMotion`;
  - nenhum hex em `components/dashboard-pilot/` (classes, props e strings);
  - o tooltip do gráfico não usa `contentStyle`;
  - o login usa `useTema()` e o botão tem `aria-label`;
  - o `DashboardKpiCard` tem `motion-reduce` no hover.
- O E2E existente cobre o login e o dashboard (`data-testid="evolution-data-label"` precisa continuar existindo).
- Conferência no navegador: login e dashboard nos dois temas; contador e cascata ao trocar para o dashboard e ao trocar o ciclo.

## M3: Painéis dos setores (aprovada em 2026-10-18)

Decisões do usuário em 2026-10-18:
- Escopo: Fornecedores (Planejamento), Administrativo, Financeiro, Evidências e Histórico.
- Painéis laterais e modais com animação de entrada e de saída.
- Extras: abas com indicador deslizante, toasts animados, skeletons padronizados e realce da linha aberta.

Pronto quando:
- todo painel lateral e todo modal desses painéis entra e sai com animação nos dois temas;
- com motion reduzido, abre e fecha na hora;
- durante a saída, o overlay não bloqueia cliques;
- `tsc`, `test:targeted` e E2E completo passam.

### 1. Painel lateral (`components/administrativo/admin-side-panel.tsx`, 12 usos)
- **Entrada e saída:**
  - o painel desliza da direita (`x: 100%` → `0`, cerca de 280 ms, ease-out) e o overlay faz fade, com `motion.div` dentro do próprio `AdminSidePanel`;
  - a saída é mais rápida (cerca de 180 ms) e exige `AnimatePresence` em volta de cada ponto que abre o painel (`{aberto && <X />}`), pois o React remove o componente na hora;
  - os pontos de uso são `administrativo/detalhes.tsx`, `fornecedor-editor.tsx`, `importar-panel.tsx`, `evidencia-drawer.tsx`, `financeiro-drawer.tsx`, `gerenciar-ciclos.tsx`, `historico/drawers.tsx` e `minhas-medicoes.tsx` (este último é do M4 e entra junto por ser o mesmo componente).
- `components/fornecedores/fornecedor-drawer.tsx` tem implementação própria e recebe o mesmo tratamento (ou passa a usar o `AdminSidePanel`, se o layout permitir sem mudar o conteúdo).
- **Durante a saída:** o overlay e o painel ficam com `pointer-events-none`, para um clique logo após fechar não ser interceptado (isso protege o E2E, que clica na sequência).
- O foco, o Esc e o `aria-modal` continuam como hoje.

### 2. Modais (`ds-dialog`, cerca de 15 pontos em 10 arquivos)
- Um componente novo, `Modal` em `components/ui.tsx`, junta o que cada arquivo repete: overlay `fixed inset-0` com `bg-black/40`, contêiner `ds-dialog`, `role`/`aria-modal`/`aria-labelledby` e as animações (`motion`; escala 0.97 → 1 e fade na entrada, cerca de 200 ms; saída de cerca de 140 ms).
- Os pontos atuais passam a usar o `Modal`, com `AnimatePresence` onde abrem. A classe `starting:` do M1 sai desses pontos.
- O conteúdo, os botões, os textos, os `data-testid` e o comportamento ficam iguais; muda só o invólucro.

### 3. Abas com indicador (`role="tablist"`)
- Financeiro (status), Administrativo (tipo de cadastro) e Histórico (perspectiva): a aba ativa ganha um sublinhado que desliza entre as abas (`motion.span` com `layoutId` próprio de cada lista).
- O `aria-selected` e o teclado continuam como hoje.

### 4. Toasts
- Um componente, `Toast` em `components/ui.tsx` (`role="status"`, `aria-live="polite"`, tom sucesso/erro com os tokens), com entrada por slide de baixo + fade e saída por fade, via `AnimatePresence`.
- Substitui os toasts fixos de `administrativo-panel.tsx`, `financeiro-panel.tsx` e `fornecedores/index.tsx`.
- O aviso em linha de `importacao/identidades-pendentes.tsx` continua em linha, mas entra com fade.
- O texto das mensagens e o tempo de exibição não mudam.

### 5. Skeletons
- Um componente, `Skeleton` em `components/ui.tsx` (bloco `animate-pulse` em `--surface-hover`, `aria-hidden`), e um contêiner de carregamento com `role="status"` e o texto atual em `sr-only`.
- Troca os "Carregando…" com spinner por linhas de skeleton nas listas dos cinco painéis e nos painéis laterais (BM, divergências).
- **Os textos atuais continuam no DOM** (`sr-only`), porque o E2E espera `getByText("Carregando cadastros...")` sumir antes de agir. Sem o texto, a espera passaria na hora e criaria instabilidade.
- O ícone de recarregar (`RefreshCw` com `animate-spin`) fica como está.

### 6. Realce da linha aberta
- Nas tabelas de Fornecedores, Administrativo, Financeiro, Evidências e Histórico, a linha cujo detalhe está aberto fica com `bg-[var(--primary-soft)]` e uma borda à esquerda na cor primária (`shadow-[inset_3px_0_0_var(--primary)]`), com `transition-colors`.
- Marcar com `aria-selected` quando a tabela já for interativa; senão, `data-aberta` só para o estilo.
- Ao fechar o painel, o realce sai com a mesma transição.

### Fora do escopo do M3
- O portal do fornecedor (M4), exceto o `AdminSidePanel` e o `Modal`, que são compartilhados.
- Mudar textos, ordem de colunas, filtros ou regras.
- Animar linhas de tabela na entrada (regra da spec: tabelas sem animação de entrada).

### Testes do M3
- Guardas em `tests/tema-tokens.test.ts`:
  - o `AdminSidePanel`, o `FornecedorDrawer` e o `Modal` têm `exit` e ficam `inert` na saída (sem clique, teclado nem leitor de tela; correção da revisão do M3, que antes usava só `pointer-events-none`);
  - nenhum `ds-dialog` fora do `Modal`, e todo `<Modal>` tem nome acessível (`rotuloId` ou `rotulo`);
  - todo ponto que renderiza `AdminSidePanel`/`Modal`/`FornecedorDrawer` condicionalmente está dentro de `AnimatePresence`;
  - os toasts usam o `Toast`;
  - as 3 listas de abas usam `layoutId`;
  - os textos "Carregando…" atuais continuam presentes.
- O E2E existente cobre abrir e fechar painéis e modais, os toasts e as abas, com motion reduzido. `e2e/motion-saida.spec.ts` liga o motion e confere que o modal e o painel ficam inertes durante a saída.
- Conferência no navegador: abrir e fechar cada painel e cada modal nos dois temas; clicar logo após fechar; trocar abas; ver um toast; carregar uma lista.

## Comandos
- Tipos: `npx tsc --noEmit`
- Testes: `npm run test:targeted` (com `DATABASE_URL`, `DATABASE_URL_TEST` e `E2E_DATABASE_NAME` do banco de teste)
- E2E (no fim de cada módulo, porque os seletores podem depender de texto e estrutura): `npm run test:e2e:seed` e depois `npm run test:e2e`
- Ver o resultado: `npm run dev`, conferindo os dois temas e o motion reduzido (DevTools → Rendering → `prefers-reduced-motion`)

## Estrutura
- `app/globals.css`: tokens claro/escuro e variante `dark`
- `app/layout.tsx`: script anti-flash e `suppressHydrationWarning`
- `components/providers.tsx`: contexto do tema
- `components/account-menu.tsx`: alternador de tema
- `components/motion.tsx` (novo): primitivas de motion
- `components/ui.tsx` e `components/app-shell.tsx`: primitivas e shell no novo padrão
- `scripts/codemod-cores-tokens.ts` (novo, uso único): troca de hex por token
- `tests/tema-tokens.test.ts` (novo): guarda de regressão por leitura de código-fonte, no padrão de `tests/financeiro-panel-responsivo.test.ts`

## Estilo de código
- Só classes Tailwind nos componentes. Cores sempre por token, nunca hex novo em `components/` ou `app/`.
- `"use client"` só onde o motion ou o tema exigem. `components/motion.tsx` é client; as páginas continuam Server Components.
- TypeScript estrito, sem `any`.

## Testes
- `tests/tema-tokens.test.ts`:
  - nenhuma classe `-[#hex]` nem `bg-white` em `components/`/`app/` fora de uma lista de exceções justificadas;
  - `globals.css` define os tokens em `:root` e em `.dark`;
  - o layout tem o script anti-flash;
  - `components/motion.tsx` usa `useReducedMotion`.
- Lógica de tema (ler a preferência, resolver o "sistema"): função pura com teste unitário.
- `test:targeted` e E2E completos passando ao fim do M1. As cores mudam de classe, mas as regras de negócio não podem mudar.
- Conferência visual manual: login, dashboard, um painel de cada setor e o portal, nos dois temas.

## Limites
- Sempre: tokens para cor; reduced motion respeitado; foco visível; contraste de 4.5:1 conferido nos dois temas; `tsc` e `test:targeted` passando antes de concluir.
- Perguntar antes: qualquer dependência nova (não deve ser necessária); mudar texto, ordem ou fluxo de tela; mexer em permissão, API ou regra de negócio (fora do escopo).
- Nunca: CSS novo além dos tokens no `globals.css`; `style` inline novo; animação que atrase a ação do usuário (navegar, salvar, aprovar); overshoot em dado financeiro; commit ou push sem pedido explícito.

## Fora do escopo
- Trocar os componentes caseiros do `ui.tsx` pelos do HeroUI (vale avaliar depois, em tarefa própria).
- Reescrever o layout de telas além do tema e do motion. Ajustes de hierarquia ficam em M2 a M4, tela por tela.
- Tema por usuário salvo no banco. A preferência fica só no navegador.

## Paleta escura (T1, medida em 2026-10-17)
Valores em `app/globals.css` (`.dark`). O contraste foi medido sobre o fundo (#0f0f10) e sobre a superfície (#18181b): texto 15:1, secundário 6.9:1, primária #f06a6a 5.9:1, erro 6.4:1, sucesso 10:1, aviso 10.6:1. Os pares texto/fundo suave ficam entre 5:1 e 8.8:1.
- No escuro, a primária clara não dá 4.5:1 com texto branco. Por isso, texto sobre fundo colorido sólido usa `--on-solid` (branco no claro, #0f0f10 no escuro). Os botões sólidos trocam `text-white` por `text-[var(--on-solid)]` na T3/T4.
- Tokens auxiliares: `--surface-muted`, `--scrollbar`, `--row-hover`, `--selection`, `--shadow-dialog`, `--shadow-popover`.

## Codemod de cores (T3, 2026-10-17)
45 arquivos migrados de hex fixo para `[var(--token)]`. O script foi apagado depois de rodar, e `tests/tema-tokens.test.ts` impede a volta de hex e `bg-white` em `components/`/`app/`. Decisões além do mapa inicial:
- Token novo `--surface-hover`: tons cinza mais escuros (#F3F4F6, #F1F1EF...) que serviam de hover ou faixa. Os tons mais claros viraram `--surface-muted`.
- Bordas suaves de estado (#FCA5A5, #F2DBB7, #CDE9D5, #BFDBFE...) usam o token da cor com opacidade (`border-[var(--error)]/30`), sem token novo.
- `bg-[#1A1A1A]` (sobreposição de modal) virou `bg-black`.
- Texto branco sobre fundo sólido virou `text-[var(--on-solid)]`, inclusive quando o fundo vem em outra string (bolha do chat, botão de arquivo do Financeiro).
- Os hovers que ficaram iguais ao estado normal depois do mapeamento ganharam `/90` (fundo sólido) ou `foreground` (texto secundário).
- No claro, `--warning` escureceu de #b86608 (4.2:1) para #9a5306 (5.8:1). O badge da sidebar, que era âmbar #F59E0B, fica mais escuro.
- Placeholders: `muted-foreground/70`.
- Exceções: `components/boletim-medicao.tsx` é a réplica da planilha impressa e fica como papel branco nos dois temas (`bg-white text-black` no contêiner); `text-[#ef8d8d]` está num ícone da sidebar, que é sempre escura.
- Ficam para o M2: as cores do gráfico de evolução (props do recharts com hex) e a tooltip padrão do recharts, que é branca no escuro.
- Verificado no navegador, no tema escuro: em todas as seções do admin, no login e no portal do fornecedor, nenhum fundo branco e nenhum texto abaixo de 4.5:1 (script de contraste no DOM). O tema claro foi conferido por amostragem.

## Shell e diálogos (T5, 2026-10-18)
- A troca de seção anima o conteúdo com `FadeIn chave={activeSection}`. A animação se repete sem remontar os painéis, que guardam filtros e estado.
- O item ativo do menu tem fundo com `layoutId`, um por sidebar (desktop e mobile), porque as duas existem ao mesmo tempo no DOM.
- `MotionConfig reducedMotion="user"` no `components/providers.tsx`: todo o framer-motion, inclusive o `layoutId`, respeita `prefers-reduced-motion`.
- Diálogos: não há componente compartilhado (cada um dos 15 `ds-dialog` monta o próprio overlay). A entrada usa só classes, com a variante `starting:` do Tailwind 4 (`@starting-style`): `starting:opacity-0 starting:scale-[0.97]`, 200 ms, e `motion-reduce:transition-none`. O menu da conta segue o mesmo padrão. A saída precisaria de `AnimatePresence` em cada chamada, então fica para M3/M4, tela por tela, ou para um componente de diálogo único, se ele for criado.

## Correções da revisão do M1 (2026-10-18)
`/review` e `/ponytail-review` não acharam nada de segurança. Corrigidos os itens 1 a 7:
- **Nada de animação na carga inicial.** `FadeIn` e `AnimatedText` dependiam de `useReducedMotion()`, que é `null` no SSR. O HTML do servidor saía com `opacity:0`, e a página ficava invisível até a hidratação, com divergência para quem usa motion reduzido. Agora o SSR sai no estado final e só o que monta depois da hidratação anima (`useSyncExternalStore`, servidor `false` e cliente `true`), ou seja, a troca de tela. O `FadeIn` repete a entrada em `useLayoutEffect`, só quando a `chave` muda.
- O press dos botões usa `motion-reduce:active:scale-100`. No Tailwind 4, `scale-*` é a propriedade `scale`, que `transform-none` não anula.
- Na sidebar, o hover sólido de "Importar Planilha" troca o texto para `--on-solid`, e os `rgba(175,27,27,…)` fixos (sidebar e chat) viraram `[var(--primary)]/N`.
- Os hovers que o codemod deixou iguais ao estado normal usam `hover:bg-[var(--x)]/15`.
- O seletor de tema usa botões com `aria-pressed` em vez de `role="radio"`, que exigiria navegação por setas.
- Sem código para depois: `Stagger`, `StaggerItem` e `CountUp` saíram e serão criados no M2, junto com o primeiro uso. O `AnimatedText` só aceita `h1`/`h2`, porque o `aria-label` não vale em `p`/`span`.
- Testes-guarda novos: o script anti-flash executado nas 6 combinações contra `resolverTema`, classes com `rgb`/`hsl` fixo, `text-white` sobre fundo sólido (inclusive quando o fundo vem só no hover), hover igual ao estado normal e `ds-dialog` dentro de `clsx`.
- Ficou de fora (opcional na revisão): animar só a opacidade na troca de seção (o `transform` prende modais `fixed` por cerca de 250 ms), diferenciar `--primary-soft` de `--error-soft` no escuro, ternários com ramos iguais em `colaborador-app.tsx:1283` e `equipe-panel.tsx:112`, e `useSyncExternalStore` no provider do tema.

## Em aberto
- Nada, por enquanto.
