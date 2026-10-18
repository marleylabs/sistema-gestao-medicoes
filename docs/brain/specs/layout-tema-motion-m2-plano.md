---
atualizado: 2026-10-18
status: aprovado em 2026-10-18, em execução
tags: [spec, plano]
---
# Plano: M2 Login e dashboard

Spec: [layout-tema-motion](layout-tema-motion.md), seção M2. Base: M1 em a516126.

## Componentes e ordem
1. **`AnimatedText` só em CSS**: a base que o login precisa (título animado na carga do servidor). Também muda os títulos das telas do M1.
2. **Login**: cartão com `starting:`, painel vivo e seletor de tema. Depende de 1.
3. **Gráficos no tema**: tokens no gráfico de evolução e na pizza de contratos, tooltip com classes e linha que se desenha. Independente de 1 e 2.
4. **KPIs e cascata**: `CountUp`, `Stagger`/`StaggerItem` e hover no `DashboardKpiCard`. Independente de 1 a 3.

As tarefas 2, 3 e 4 tocam arquivos diferentes, mas cada uma é pequena e precisa da conferência no navegador. Por isso ficam em sequência nesta sessão: rodar em paralelo custaria mais em montagem do que economiza.

## Riscos
- **E2E do dashboard depende do recharts:**
  - `.recharts-tooltip-wrapper` com "Dezembro de 2026" e o valor;
  - `evolution-data-label` e `.recharts-area-dot`;
  - o tooltip próprio precisa continuar dentro do wrapper e com o mesmo texto;
  - com `isAnimationActive`, os rótulos só aparecem depois da animação; o Playwright espera, mas a animação tem de ficar curta (800 ms ou menos).
- **`var(--x)` em atributo SVG:** funciona no Chrome e no Firefox (o recharts repassa a string). Confiro no navegador. O `color-mix()` em `fill` também.
- **`CountUp` e E2E:** os specs só leem os rótulos dos KPIs, não os valores. O `sr-only` com o valor final duplica o texto e pode criar ambiguidade num `getByText` futuro, então vai com `aria-hidden` na parte animada.
- **`AnimatedText` em CSS:** o atraso por palavra vem de uma lista fixa de classes. Títulos com mais palavras que a lista usam o último atraso.
- **Hover no card compartilhado:** muda também os KPIs de Administrativo, Evidências, Financeiro e Fornecedores (decisão da spec).
- **Fundo vivo:** fica em loop infinito. Com o painel oculto (abaixo de `lg`) não deve rodar: o `motion.div` fica dentro do `section` com `hidden lg:flex`, e o framer não anima elemento com `display:none`? Confiro; se animar, o custo é desprezível (um elemento, só `transform`).

## Tarefas

- [x] **T1: `AnimatedText` só em CSS** — feita em 2026-10-18. Sem framer nem `useSyncExternalStore`; atrasos de 50 ms numa lista fixa. Conferido no navegador: a transição de opacity/translate/filter roda na troca de seção e termina em `opacity:1`/`filter:none`, sem aviso de hidratação. `tema-tokens` 17/17, `test:targeted` 523/523, `tsc` ok.
  - Aceite:
    - palavras com `starting:opacity-0 starting:translate-y-[0.35em] starting:blur-sm` e `transition-[opacity,translate,filter] duration-500 ease-out`;
    - atraso por índice numa lista fixa de classes (`delay-0` … `delay-300`);
    - `motion-reduce:transition-none`;
    - sem framer e sem `useSyncExternalStore` no componente; o `aria-label` no heading continua;
    - o `useSyncExternalStore` sai do `motion.tsx` se nada mais usar.
  - Verificar: guarda atualizada (`AnimatedText` usa `starting:` e não usa `motion.`); `tsc`; no navegador, o título anima na carga e na troca de seção, sem aviso de hidratação.
  - Arquivos: `components/motion.tsx`, `tests/tema-tokens.test.ts`.

- [x] **T2: login** — feita em 2026-10-18. Cartão com `starting:`, grade e brilho em loop no painel (o brilho para com motion reduzido), frase com `AnimatedText as="h2"`, botão de tema (Claro → Escuro → Sistema) e erro com `role="alert"` nos tokens de erro. Para o ícone do tema não divergir na hidratação, a preferência foi para um store externo (`useSyncExternalStore` em `components/providers.tsx`, com cópia em memória se o `localStorage` estiver bloqueado e sincronia entre abas); o efeito que aplica a classe lê a preferência real, para não piscar o tema do sistema. `tema-tokens` 19/19, `test:targeted` 525/525, E2E de login + dashboard 10/10; conferido no navegador nos dois temas, com erro e recarga.
  - Aceite:
    - cartão do formulário com `starting:opacity-0 starting:translate-y-2`, cerca de 400 ms, e `motion-reduce`;
    - frase do painel com `AnimatedText as="h2"`;
    - grade de fundo por classes (`bg-[linear-gradient(...)]` + `bg-[size:32px_32px]`, tons de `white/5`) e um brilho radial `bg-[radial-gradient(...var(--primary)...)]` que deriva com `motion.div` (loop de 20 s, `x`/`y`, `repeatType: "mirror"`), desligado com motion reduzido; os dois com `aria-hidden`;
    - botão de tema no canto superior direito que alterna Claro → Escuro → Sistema, com ícone e `aria-label="Tema: <atual>. Alterar"`, usando `useTema()`;
    - mensagem de erro com `--error`/`--error-soft` e `role="alert"`;
    - campos, a chamada a `/api/auth/login` e o modal de troca de senha sem mudança.
  - Verificar: guardas (o login usa `useTema()`, o botão tem `aria-label`, o erro usa os tokens de erro); `tsc`; E2E de login; navegador nos dois temas, com o erro de login forçado por senha errada.
  - Arquivos: `components/login-form.tsx`, `tests/tema-tokens.test.ts`.

- [x] **T3: gráficos no tema** — feita em 2026-10-18. Tokens em todas as cores do gráfico de evolução e da pizza (`var(--x)` e `color-mix` resolvem no SVG: grade #2e2e33 e fatia #f06a6a no escuro), tooltip próprio em `components/dashboard-pilot/grafico-tooltip.tsx` só com classes, legenda da pizza por classe (sai o `style`), linha animada em 800 ms com `isAnimationActive={!reduzir}`. `tema-tokens` 20/20, `test:targeted` 526/526, E2E `dashboard-pilot` 2/2. No painel do app (aba em segundo plano) a animação do recharts não termina e o rótulo do ponto não aparece; no Chromium do Playwright aparece.
  - Aceite:
    - evolução: cores por `var(--primary)`, `var(--border)`, `var(--muted-foreground)`, `var(--surface)` e `var(--foreground)`;
    - tooltip com `content` próprio só com classes (borda, superfície, sombra, texto 11px) e o mesmo texto de hoje (mês por extenso e BRL);
    - `isAnimationActive={!reduzir}`, cerca de 800 ms, ease-out;
    - pizza de contratos: paleta por tokens (`var(--primary)`, `color-mix` da primária, `var(--warning)`, `var(--success)`, `var(--muted-foreground)`, `var(--border-strong)`);
    - bolinhas da legenda por classe em vez de `style`, com uma lista paralela de classes `bg-[...]`;
    - tooltip da pizza com o mesmo `content`, reaproveitado num componente local do `dashboard-pilot`, sem arquivo novo se couber.
  - Verificar: guarda "nenhum hex em `components/dashboard-pilot/`, nem em string" e "sem `contentStyle`/`style=`" ali; `tsc`; E2E `dashboard-pilot.spec.ts`; navegador nos dois temas, com hover no ponto e na fatia.
  - Arquivos: `components/dashboard-pilot/dashboard-evolution-chart.tsx`, `components/dashboard-pilot/dashboard-contract-distribution.tsx`, `tests/tema-tokens.test.ts`.

- [x] **T4: KPIs, cascata e hover** — feita em 2026-10-18. `CountUp` com `useMotionValue` + `useTransform` (sem re-render por frame; parte de 0 só em montagem pós-hidratação), `Stagger`/`StaggerItem` nos KPIs e nos blocos do `DashboardPilot` e hover no `DashboardKpiCard` (vale para os KPIs de todos os painéis). Conferido no navegador: o valor sobe de R$ 0,00 a R$ 5.000,00 em cerca de 0,8 s e a cascata termina em `opacity:1`. O framer anima a opacidade via WAAPI, então o `style` inline não muda durante a animação. `tema-tokens` 22/22.
  - Aceite:
    - `CountUp` em `motion.tsx`: `useMotionValue` + `animate`, valor renderizado por `useTransform` num `motion.span` (sem re-render por frame);
    - na primeira montagem pós-hidratação parte de 0, na mudança de valor parte do valor anterior; com motion reduzido ou no SSR mostra o final;
    - `sr-only` com o valor final e parte animada `aria-hidden`;
    - `Stagger`/`StaggerItem` (variants, passo de 60 ms, `initial` só pós-hidratação) na grade de KPIs e nos 4 blocos do `DashboardPilot`;
    - `DashboardKpiCard` com `transition`, `hover:-translate-y-0.5`, `hover:shadow-md`, `hover:border-[var(--border-strong)]` e `motion-reduce:hover:translate-y-0`;
    - o `CountUp` só no `DashboardPilot` (Valor medido em BRL e as 3 contagens), dentro do `BlurValue`.
  - Verificar: guardas (exports, sem `initial={reduzir`, `motion-reduce` no hover do card); `tsc`; `test:targeted`; E2E completo; navegador: contador e cascata ao abrir o dashboard e ao trocar o ciclo, e o modo blur continua escondendo valores.
  - Arquivos: `components/motion.tsx`, `components/dashboard-pilot/index.tsx`, `components/dashboard-pilot/dashboard-kpi-card.tsx`, `tests/tema-tokens.test.ts`.

### Checkpoint (fim do M2) — testes ok em 2026-10-18 (`tsc`, `test:targeted` 528/528, E2E 207/207); visual aprovado, revisões feitas e corrigidas (`test:targeted` 531/531; E2E com uma falha intermitente diferente por rodada, ver status); falta o commit
- `tsc`, `test:targeted`, `test:e2e:seed` + `test:e2e` passando.
- Você confere login e dashboard nos dois temas.
- `/review` e `/ponytail-review`; cérebro (status, spec, índice); commit só com o seu pedido.
