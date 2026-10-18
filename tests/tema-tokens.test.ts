import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { assinarPreferencia, lerPreferenciaSalva, lerPreferenciaTema, resolverTema, salvarPreferencia, SCRIPT_TEMA_INICIAL, TEMA_STORAGE_KEY } from "../lib/tema";

function read(file: string) {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8");
}

/** Guarda do tema claro/escuro (spec docs/brain/specs/layout-tema-motion.md). */

test("resolverTema: preferência salva vence o sistema", () => {
  assert.equal(resolverTema("claro", true), "claro");
  assert.equal(resolverTema("escuro", false), "escuro");
});

test("resolverTema: sem preferência segue o sistema", () => {
  assert.equal(resolverTema(null, true), "escuro");
  assert.equal(resolverTema(null, false), "claro");
});

test("lerPreferenciaTema: só aceita claro/escuro; o resto é seguir o sistema", () => {
  assert.equal(lerPreferenciaTema("claro"), "claro");
  assert.equal(lerPreferenciaTema("escuro"), "escuro");
  assert.equal(lerPreferenciaTema(null), null);
  assert.equal(lerPreferenciaTema("dark"), null);
});

test("layout aplica o tema antes da pintura (script anti-flash)", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /SCRIPT_TEMA_INICIAL/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(SCRIPT_TEMA_INICIAL, new RegExp(`localStorage\\.getItem\\("${TEMA_STORAGE_KEY}"\\)`));
  assert.match(SCRIPT_TEMA_INICIAL, /prefers-color-scheme: dark/);
});

test("script anti-flash decide igual a resolverTema nas 6 combinações", () => {
  for (const salvo of ["claro", "escuro", null] as const) {
    for (const sistemaEscuro of [true, false]) {
      let escuro: boolean | undefined;
      const document = { documentElement: { classList: { toggle: (_: string, valor: boolean) => { escuro = valor; } } } };
      const localStorage = { getItem: (chave: string) => (chave === TEMA_STORAGE_KEY ? salvo : null) };
      const matchMedia = () => ({ matches: sistemaEscuro });
      new Function("document", "localStorage", "matchMedia", SCRIPT_TEMA_INICIAL)(document, localStorage, matchMedia);
      assert.equal(escuro, resolverTema(salvo, sistemaEscuro) === "escuro", `salvo=${salvo} sistemaEscuro=${sistemaEscuro}`);
    }
  }
});

test("menu da conta oferece Claro, Escuro e Sistema", () => {
  const menu = read("components/account-menu.tsx");
  for (const rotulo of ["Claro", "Escuro", "Sistema"]) assert.match(menu, new RegExp(`"${rotulo}"`));
  assert.match(menu, /useTema\(\)/);
  // botões de alternância: role="radio" exigiria navegação por setas
  assert.doesNotMatch(menu, /role="radio/);
  assert.match(menu, /aria-pressed=\{preferencia === valor\}/);
});

function fontes(dir: string): string[] {
  return fs.readdirSync(path.join(__dirname, "..", dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === "api" ? [] : fontes(rel);
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

// Exceções com motivo: o boletim replica a planilha impressa (papel branco nos dois temas); o ícone da sidebar fica sobre fundo sempre escuro.
const EXCECOES_COR: Record<string, RegExp> = {
  "components/boletim-medicao.tsx": /.*/,
  "components/app-shell.tsx": /text-\[#ef8d8d\]/,
};

test("componentes usam tokens de tema, não hex fixo nem bg-white", () => {
  for (const arquivo of [...fontes("components"), ...fontes("app")]) {
    const excecao = EXCECOES_COR[arquivo];
    if (excecao?.source === ".*") continue;
    const fonte = excecao ? read(arquivo).replace(new RegExp(excecao, "g"), "") : read(arquivo);
    assert.doesNotMatch(fonte, /-\[#[0-9a-fA-F]{3,8}\]/, `${arquivo} tem classe com hex fixo`);
    assert.doesNotMatch(fonte, /-\[(?:rgba?|hsla?)\(/, `${arquivo} tem classe com rgb/hsl fixo`);
    assert.doesNotMatch(fonte, /(?<![\w/[-])(?:[a-z0-9-]+:)*bg-white(?![\w/-])/, `${arquivo} usa bg-white`);
  }
});

const SOLIDO = "primary|primary-hover|error|success|warning";

test("texto sobre fundo colorido sólido usa --on-solid, nunca text-white", () => {
  for (const arquivo of [...fontes("components"), ...fontes("app")]) {
    for (const [str] of read(arquivo).matchAll(/"[^"\n]*"|`[^`]*`/g)) {
      for (const variante of ["", "hover:", "group-hover:"]) {
        const fundo = new RegExp(`(?<![\\w:-])${variante}bg-\\[var\\(--(?:${SOLIDO})\\)\\](?!/)`);
        const branco = new RegExp(`(?<![\\w:/-])${variante}text-white(?![\\w/-])`);
        // fundo sólido só no hover com texto branco na base: o hover precisa trocar o texto para --on-solid
        const brancoNaBase = variante !== "" && /(?<![\w:/-])text-white(?![\w/-])/.test(str) && !str.includes(`${variante}text-[var(--on-solid)]`);
        assert.ok(!(fundo.test(str) && (branco.test(str) || brancoNaBase)), `${arquivo}: text-white sobre fundo sólido em ${str.slice(0, 80)}`);
      }
    }
  }
});

test("hover muda o visual (nenhum hover igual ao estado normal)", () => {
  const igual = /(?<![\w:-])(bg|text|border)-\[var\(--([a-z-]+)\)\](\/\d+|)(?=[\s"`])[^"`\n]*?\shover:\1-\[var\(--\2\)\]\3(?=[\s"`])/;
  for (const arquivo of fontes("components")) {
    read(arquivo).split("\n").forEach((linha, i) => assert.doesNotMatch(linha, igual, `${arquivo}:${i + 1}`));
  }
});

function tokens(bloco: string) {
  return new Set([...bloco.matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1]));
}

test("globals.css redefine em .dark todos os tokens de cor do :root", () => {
  const css = read("app/globals.css");
  const root = css.match(/:root\s*\{([^}]*)\}/);
  const dark = css.match(/\.dark\s*\{([^}]*)\}/);
  assert.ok(root && dark, "esperava blocos :root e .dark");
  const noDark = tokens(dark[1]);
  // aliases (var(--x)) herdam do token base e não precisam ser repetidos
  const base = [...tokens(root[1])].filter((t) => !new RegExp(`${t}\\s*:\\s*var\\(`).test(root[1]));
  for (const t of base) assert.ok(noDark.has(t), `.dark não define ${t}`);
  assert.ok(tokens(root[1]).has("--surface-muted"), "token --surface-muted ausente");
  assert.match(css, /@custom-variant dark/);
});

test("globals.css sem cor fixa fora dos blocos de token", () => {
  const css = read("app/globals.css").replace(/:root\s*\{[^}]*\}/, "").replace(/\.dark\s*\{[^}]*\}/, "");
  // \# é nome de classe escapado num seletor, não cor
  assert.doesNotMatch(css, /(?<!\\)#[0-9a-fA-F]{3,8}\b|rgba?\(/);
});

/** Motion (T4): toda animação respeita prefers-reduced-motion e não esconde texto de leitor de tela. */

test("motion.tsx exporta as primitivas e respeita useReducedMotion", () => {
  const motion = read("components/motion.tsx");
  for (const nome of ["FadeIn", "AnimatedText"]) assert.match(motion, new RegExp(`export function ${nome}\\b`));
  assert.match(motion, /useReducedMotion\(\)/);
  // no SSR useReducedMotion() é null: um initial que dependa dele diverge na hidratação e esconde o HTML do servidor
  assert.doesNotMatch(motion, /initial=\{reduzir/);
  // título só com CSS (@starting-style): anima na carga do servidor e na troca de tela, sem depender de hidratação
  const inicio = motion.indexOf("export function AnimatedText");
  const fim = motion.indexOf("export function", inicio + 1);
  const animatedText = motion.slice(inicio, fim === -1 ? undefined : fim);
  assert.match(animatedText, /starting:opacity-0/);
  assert.match(animatedText, /motion-reduce:transition-none/);
  assert.doesNotMatch(animatedText, /motion\.|useReducedMotion/);
  assert.match(motion, /aria-label=\{/, "AnimatedText precisa expor o texto inteiro");
  assert.match(motion, /aria-hidden/);
});

test("botões têm feedback de press que some com motion reduzido", () => {
  const ui = read("components/ui.tsx");
  const botoes = ui.slice(ui.indexOf("export function Button"), ui.indexOf("export function Input"));
  assert.equal((botoes.match(/active:scale-\[0\.97\]/g) ?? []).length, 2, "Button e IconButton");
  // active:scale-* usa a propriedade `scale`; transform-none não a anula
  assert.equal((botoes.match(/motion-reduce:active:scale-100/g) ?? []).length, 2);
});

test("PageHeader anima o título com AnimatedText", () => {
  const ui = read("components/ui.tsx");
  const header = ui.slice(ui.indexOf("export function PageHeader"), ui.indexOf("export function PageContainer"));
  assert.match(header, /<AnimatedText/);
});

/** Shell e diálogos (T5). */

test("framer-motion segue prefers-reduced-motion em todo o app", () => {
  assert.match(read("components/providers.tsx"), /<MotionConfig reducedMotion="user">/);
});

test("shell anima a troca de seção sem remontar o conteúdo e desliza o item ativo", () => {
  const shell = read("components/app-shell.tsx");
  assert.match(shell, /<FadeIn chave=\{activeSection\}/);
  assert.match(shell, /layoutId=/);
});

test("todo ds-dialog tem animação de entrada só com classes (starting:)", () => {
  for (const arquivo of fontes("components")) {
    for (const m of read(arquivo).matchAll(/["`][^"`\n]*\bds-dialog\b[^"`\n]*["`]/g)) {
      assert.match(m[0], /starting:opacity-0/, `${arquivo}: ds-dialog sem animação de entrada`);
      assert.match(m[0], /motion-reduce:transition-none/, `${arquivo}: ds-dialog sem motion-reduce`);
    }
  }
});

/** M2 — login (T2). */

test("login: seletor de tema, entrada só em CSS, painel decorativo e erro com tokens de erro", () => {
  const login = read("components/login-form.tsx");
  assert.match(login, /useTema\(\)/);
  assert.match(login, /aria-label=\{descricao\}/);
  assert.match(login, /starting:opacity-0/);
  assert.match(login, /<AnimatedText as="h2"/);
  assert.match(login, /useReducedMotion\(\)/, "o brilho em loop para com motion reduzido");
  assert.match(login, /aria-hidden/);
  assert.match(login, /role="alert"[^>]*bg-\[var\(--error-soft\)\][^>]*text-\[var\(--error\)\]/);
});

test("preferência de tema não diverge na hidratação (useSyncExternalStore com snapshot de servidor)", () => {
  const providers = read("components/providers.tsx");
  assert.match(providers, /useSyncExternalStore\(assinarPreferencia, lerPreferenciaSalva, \(\) => null\)/);
  // o efeito lê a preferência real: na hidratação o estado ainda é null e aplicaria o tema do sistema
  assert.match(providers, /resolverTema\(lerPreferenciaSalva\(\)/);
  assert.doesNotMatch(providers, /typeof window === "undefined"/);
});

function comLocalStorage(storage: unknown, fn: () => void) {
  const g = globalThis as { localStorage?: unknown };
  const anterior = g.localStorage;
  g.localStorage = storage;
  try {
    fn();
  } finally {
    g.localStorage = anterior;
  }
}

test("store do tema: salva, apaga no Sistema e avisa quem assina", () => {
  const dados = new Map<string, string>();
  comLocalStorage({ getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => dados.set(k, v), removeItem: (k: string) => dados.delete(k) }, () => {
    let avisos = 0;
    const g = globalThis as { window?: unknown };
    const janelaAnterior = g.window;
    g.window = { addEventListener: () => {}, removeEventListener: () => {} };
    try {
      const cancelar = assinarPreferencia(() => { avisos++; });
      salvarPreferencia("escuro");
      assert.equal(dados.get(TEMA_STORAGE_KEY), "escuro");
      assert.equal(lerPreferenciaSalva(), "escuro");
      salvarPreferencia(null);
      assert.equal(dados.has(TEMA_STORAGE_KEY), false, "Sistema apaga a chave");
      assert.equal(lerPreferenciaSalva(), null);
      assert.equal(avisos, 2);
      cancelar();
      salvarPreferencia("claro");
      assert.equal(avisos, 2, "depois de cancelar não avisa mais");
    } finally {
      g.window = janelaAnterior;
    }
  });
});

test("store do tema: com localStorage bloqueado, a escolha vale em memória", () => {
  const bloqueado = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); }, removeItem: () => { throw new Error("bloqueado"); } };
  comLocalStorage(bloqueado, () => {
    salvarPreferencia("escuro");
    assert.equal(lerPreferenciaSalva(), "escuro");
    salvarPreferencia(null);
    assert.equal(lerPreferenciaSalva(), null);
  });
});

/** M2 — gráficos no tema (T3). */

test("dashboard: gráficos sem cor fixa nem estilo inline, linha animada só sem motion reduzido", () => {
  for (const arquivo of fontes("components/dashboard-pilot")) {
    const fonte = read(arquivo);
    assert.doesNotMatch(fonte, /["'`]#[0-9a-fA-F]{3,8}["'`]/, `${arquivo}: cor fixa em string`);
    assert.doesNotMatch(fonte, /contentStyle|style=\{/, `${arquivo}: estilo inline`);
  }
  assert.match(read("components/dashboard-pilot/dashboard-evolution-chart.tsx"), /isAnimationActive=\{!reduzir\}/);
});

/** M2 — KPIs, cascata e hover (T4). */

test("motion.tsx: CountUp sem re-render por frame e Stagger só depois da hidratação", () => {
  const motion = read("components/motion.tsx");
  for (const nome of ["Stagger", "StaggerItem", "CountUp"]) assert.match(motion, new RegExp(`export function ${nome}\\b`));
  const countUp = motion.slice(motion.indexOf("export function CountUp"));
  assert.match(countUp, /useMotionValue\(/);
  assert.match(countUp, /useTransform\(/);
  assert.doesNotMatch(countUp, /useState\(/, "setState por frame re-renderiza o card inteiro");
  assert.match(countUp, /className="sr-only"/);
  const stagger = motion.slice(motion.indexOf("export function Stagger("), motion.indexOf("export function StaggerGrupo"));
  assert.match(stagger, /useMontadoAposHidratacao\(\)/);
  assert.match(stagger, /initial=\{animar \? "oculto" : false\}/);
  // grupo aninhado herda do pai: com initial/animate próprios ficaria fora da cascata
  const grupo = motion.slice(motion.indexOf("export function StaggerGrupo"), motion.indexOf("export function StaggerItem"));
  assert.match(grupo, /variants=\{staggerPai\}/);
  assert.doesNotMatch(grupo, /initial=|animate=/);
});

test("dashboard: KPIs com CountUp e cascata; card de KPI com hover que respeita motion reduzido", () => {
  const pilot = read("components/dashboard-pilot/index.tsx");
  assert.equal((pilot.match(/<CountUp /g) ?? []).length, 4);
  assert.equal((pilot.match(/<Stagger /g) ?? []).length, 1, "um único Stagger: os KPIs entram como grupo dentro da cascata");
  assert.match(pilot, /<StaggerGrupo /);
  assert.equal((pilot.match(/\brealce\b/g) ?? []).length, 4, "só o dashboard liga o realce");
  const card = read("components/dashboard-pilot/dashboard-kpi-card.tsx");
  assert.match(card, /realce && "[^"]*hover:-translate-y-0\.5[^"]*motion-reduce:hover:translate-y-0/);
});

test("login: brilho só anima visível; botão de tema diz para qual tema vai e tem alvo de 40px", () => {
  const login = read("components/login-form.tsx");
  assert.match(login, /useInView\(/);
  assert.match(login, /`Tema: \$\{rotulo\}\. Mudar para \$\{rotuloProximo\}`/);
  assert.match(login, /aria-label=\{descricao\}/);
  assert.match(login, /h-10 w-10/);
});
