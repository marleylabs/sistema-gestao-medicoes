---
atualizado: 2026-10-17
status: aprovado em 2026-10-17, em execução
tags: [spec, plano]
---
# Plano: M1 Fundação (tema claro/escuro e motion)

Spec: [layout-tema-motion](layout-tema-motion.md).

## Componentes e ordem
1. **Tokens escuros**: os valores em `.dark` no `globals.css` e a regra pura de resolver o tema. Ninguém vê nada ainda; é a base de tudo.
2. **Alternador de tema**: script anti-flash, contexto e menu da conta. Já dá para trocar o tema. As telas que usam `var(--...)` ficam certas, e as com hex fixo ficam claras (esperado até a T3).
3. **Codemod de cores**: troca hex e `bg-white` por tokens. O modo escuro passa a cobrir tudo.
4. **Primitivas de motion e botões**: `components/motion.tsx`, press/hover no `Button`/`IconButton` e `AnimatedText` no `PageHeader`.
5. **Shell e modais**: troca de tela com `FadeIn`, indicador do menu e `AnimatePresence` nos diálogos compartilhados.

A ordem é sequencial: T2 precisa dos tokens da T1, e o checkpoint visual da T3 precisa do alternador da T2. T4 e T5 só dependem de T1 e poderiam correr em paralelo com a T3, mas a T3 mexe em quase todo `components/`, e duas sessões editando os mesmos arquivos geram conflito. Por isso não há paralelismo.

## Riscos
- **O codemod muda a aparência no tema claro.** Alguns hex (#9CA3AF, #F3F4F6) não batem exatamente com o token. Mitigação: o mapa da spec junta só tons visualmente equivalentes, o script lista o que não mapeou, e há conferência visual antes/depois em 5 telas.
- **O E2E depende de classe ou estilo.** Pela busca de hoje, nenhum spec do `e2e/` nem teste usa hex ou `bg-white`, mas o E2E completo roda no checkpoint de qualquer forma.
- **Flash de tema e erro de hidratação.** O script inline roda antes da pintura e o `<html>` leva `suppressHydrationWarning`. O provider lê o `localStorage` no primeiro render do cliente (`useState` preguiçoso); nada renderizado na hidratação depende disso.
- **Motion atrasando a ação.** Entradas de no máximo 300 ms, nunca bloqueiam clique; com `useReducedMotion` o estado final aparece na hora.
- **Contraste da primária no escuro.** O #AF1B1B sobre fundo escuro fica abaixo de 4.5:1. A primária escura é medida na T1 (texto e borda), e o botão primário mantém texto branco com contraste conferido.

## Tarefas

- [x] **T1: tokens escuros e regra de tema** — feita em 2026-10-17. `tests/tema-tokens.test.ts` 4/4, `test:targeted` 510/510, `tsc` ok. Novo token `--on-solid` (texto sobre fundo colorido sólido: branco no claro, escuro no escuro), porque nenhum tom passa de 4.5:1 ao mesmo tempo como texto no fundo escuro e como fundo de texto branco.
  - Aceite:
    - `.dark` no `globals.css` redefine todos os tokens do `:root` e cria `--surface-muted` (nos dois temas);
    - `@custom-variant dark` declarado;
    - scrollbar, `::selection`, hover de `tbody tr` e sombras de `.ds-dialog`/`.ds-popover` passam a usar tokens;
    - função pura `resolverTema(preferencia, sistemaEscuro)` em `lib/tema.ts`, com `preferencia` ∈ `claro|escuro|null`.
  - Verificar: teste unitário de `resolverTema` e o teste-guarda "globals define os tokens em `:root` e `.dark`"; contraste dos pares texto/fundo do escuro medido e anotado na spec.
  - Arquivos: `app/globals.css`, `lib/tema.ts` (novo), `tests/tema-tokens.test.ts` (novo).

- [x] **T2: alternador de tema** — feita em 2026-10-17. `tema-tokens` 7/7, `test:targeted` 513/513, `tsc` ok. Conferido no navegador (dev contra o banco de teste): troca imediata, a escolha persiste ao recarregar e vence o tema do sistema, sem erro de hidratação. O provider lê o `localStorage` no primeiro render do cliente (`useState` preguiçoso); com um efeito, o tema do sistema apareceria por um instante.
  - Aceite:
    - script inline no `app/layout.tsx` aplica `dark` antes da pintura, a partir do `localStorage.tema` ou do `matchMedia`;
    - o contexto em `components/providers.tsx` expõe `tema` e `setTema`, salva no `localStorage` com try/catch e escuta a mudança do sistema quando a preferência é "sistema";
    - o menu da conta tem Claro / Escuro / Sistema, com ícones do lucide e o selecionado marcado;
    - recarregar a página não pisca o tema errado.
  - Verificar: `tsc`; manual em `npm run dev` (trocar, recarregar, mudar o tema do SO); o teste-guarda confere o script anti-flash.
  - Arquivos: `app/layout.tsx`, `components/providers.tsx`, `components/account-menu.tsx`.

- [x] **T3: codemod de cores para tokens** — feita em 2026-10-17. 45 arquivos migrados, script apagado (decisões na spec). `tsc` ok, `test:targeted` 514/514, E2E 207/207. Conferido no navegador nos dois temas.
  - Aceite:
    - `scripts/codemod-cores-tokens.ts` troca, sem diferenciar maiúsculas, `(bg|text|border|ring|fill|stroke|divide|outline|from|to|placeholder)-[#hex]` pelo token do mapa da spec, e também `bg-white` exato (não `bg-white/..`);
    - imprime o que sobrou por arquivo, e cada sobra é decidida à mão e registrada na spec;
    - a sidebar (sempre escura) não muda;
    - sai o bloco "Compatibilidade visual" do `globals.css`;
    - o teste-guarda impede hex novo e `bg-white` em `components/`/`app/`, fora de uma lista de exceções com motivo.
  - Verificar: `tsc`; `test:targeted`; teste-guarda; conferência visual antes/depois, nos dois temas, de login, dashboard, um painel de cada setor e portal.
  - Arquivos: `scripts/codemod-cores-tokens.ts` (novo, uso único; apagar depois?, ver pergunta), cerca de 60 arquivos em `components/` e `app/`.

### Checkpoint A (depois da T3) — ok em 2026-10-17 (testes e conferência visual do usuário)
- `npx tsc --noEmit`, `npm run test:targeted`, `npm run test:e2e:seed` e `npm run test:e2e` passando.
- Você confere os dois temas no `npm run dev` e aprova antes do motion.

- [x] **T4: primitivas de motion e botões** — feita em 2026-10-18. `components/motion.tsx` (FadeIn, Stagger/StaggerItem, AnimatedText com blur por palavra, CountUp), press em `Button`/`IconButton`, título do `PageHeader` animado. `tema-tokens` 11/11, `test:targeted` 517/517, E2E 207/207; conferido no navegador (a animação termina, sem aviso de hidratação). O motion reduzido não foi emulado no navegador; está coberto pelo `initial={false}` e pelo teste-guarda.
  - Aceite:
    - `components/motion.tsx` (client) exporta `FadeIn`, `Stagger`/`StaggerItem`, `AnimatedText` e `CountUp`, todos respeitando `useReducedMotion`;
    - `AnimatedText` mantém o texto inteiro acessível (`aria-label` + `aria-hidden` nas partes);
    - `CountUp` recebe o valor final e um formatador, e o primeiro render já mostra o valor final quando o motion está reduzido;
    - `Button`/`IconButton` ganham `active:scale-[0.97]`, `transition` e `motion-reduce:transform-none`, e os hovers com hex fixo passam a usar tokens;
    - `PageHeader` usa `AnimatedText` no título.
  - Verificar: `tsc`; teste-guarda ("motion.tsx usa `useReducedMotion`", "AnimatedText tem `aria-label`"); manual com o motion reduzido ligado no DevTools.
  - Arquivos: `components/motion.tsx` (novo), `components/ui.tsx`.

- [x] **T5: shell e diálogos** — feita em 2026-10-18. `FadeIn chave` na troca de seção, indicador com `layoutId`, `MotionConfig reducedMotion="user"`, entrada dos 15 `ds-dialog` com `starting:` (saída fica para M3/M4, decisão na spec). `tema-tokens` 14/14, `test:targeted` 520/520 (duas rodadas), E2E 207/207.
  - Aceite:
    - o conteúdo do `<main>` do `app-shell` entra com `FadeIn` (chave = seção ativa);
    - o item ativo do menu tem fundo animado com `layoutId`;
    - os diálogos (`.ds-dialog`) abrem e fecham com `AnimatePresence`: entrada em cerca de 250 ms, saída em cerca de 150 ms. Se cada um dos 12 arquivos montar o próprio diálogo, entram só os que já passam por uma peça compartilhada, e o resto fica para M3/M4 (registrado);
    - nenhuma animação em tabela.
  - Verificar: `tsc`; `test:targeted`; E2E completo (troca de seção e modais são caminhos dos specs); manual.
  - Arquivos: `components/app-shell.tsx` e o componente compartilhado de diálogo, se existir.

### Checkpoint B (fim do M1) — revisões feitas e corrigidas em 2026-10-18 (`test:targeted` 523/523, E2E 207/207); falta o commit
- `tsc`, `test:targeted` e E2E completo passando; `/review` e `/ponytail-review`.
- Cérebro: status, spec (decisões do codemod e paleta escura), `modulos/` se algum comportamento mudar, e o índice.
- Commit (Conventional Commits, em português) e push só com o seu pedido.

## Perguntas
- O script do codemod fica no repositório (registro do que foi feito) ou é apagado depois da T3? Sugestão: apagar, porque a spec já registra o mapa e o teste-guarda impede a volta dos hex.
