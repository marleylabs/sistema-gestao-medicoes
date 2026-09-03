import assert from "node:assert/strict";
import test from "node:test";

/**
 * AUDITORIA — importação de "Consulta PJ" criava fornecedores duplicados. Causa raiz real
 * (confirmada lendo o código): `upsertCadastroFornecedor` (lib/cadastro-fornecedor.ts) exigia
 * `cnpjNormalizado: row.cnpjNormalizado` como filtro OBRIGATÓRIO para achar o cadastro existente —
 * sempre que uma reimportação trazia um CNPJ diferente do já cadastrado (ex.: correção real de
 * CNPJ do fornecedor "Alexandre Augusto Gilli" entre duas planilhas), a busca não encontrava o
 * registro e criava um segundo cadastro para a MESMA pessoa.
 *
 * `lib/cadastro-fornecedor.ts` tem "server-only" (sem dependência real de ambiente server nas
 * funções puras testadas aqui — nenhuma delas toca banco, criptografia ou variável de ambiente) —
 * reimplementado aqui VERBATIM (mesma lógica do arquivo real, não uma reimplementação divergente)
 * para testar o algoritmo de identidade sem o bloqueio de import de "server-only" fora do runtime
 * do Next.js (mesmo padrão já usado em tests/mapa-pagamento-cadastro.test.ts).
 */

// ─── Reimplementação verbatim de lib/cadastro-fornecedor.ts ─────────────────────────────────────

const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function stripAccents(value: string) {
  return value.normalize("NFD").replace(COMBINING_DIACRITICS, "");
}

function normalizePersonName(value: string | null | undefined) {
  return stripAccents(String(value ?? ""))
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function onlyDigits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

type CadastroRow = {
  responsavel: string;
  email: string | null;
  telefone: string | null;
  razaoSocial: string;
  cnpjNormalizado: string;
};

type IdentityCandidate = {
  cadastroId: string;
  colaboradorCodigo: string | null;
  responsavel: string;
  email: string | null;
  telefone: string | null;
  razaoSocial: string;
  cnpjNormalizado: string;
};

type IdentityIndex = {
  profissionalCodigosByName: Map<string, Set<string>>;
  cadastrosByName: Map<string, IdentityCandidate[]>;
  cadastroIdByColaboradorCodigo: Map<string, string>;
  cadastroByColaboradorCodigo: Map<string, IdentityCandidate>;
};

function buildIndex(profissionais: { codigo: string | null; nome: string; nomeCompleto: string | null }[], cadastros: IdentityCandidate[]): IdentityIndex {
  const profissionalCodigosByName = new Map<string, Set<string>>();
  for (const p of profissionais) {
    if (!p.codigo) continue;
    for (const raw of [p.codigo, p.nome, p.nomeCompleto]) {
      const key = normalizePersonName(raw);
      if (!key) continue;
      const set = profissionalCodigosByName.get(key) ?? new Set<string>();
      set.add(p.codigo);
      profissionalCodigosByName.set(key, set);
    }
  }
  const cadastrosByName = new Map<string, IdentityCandidate[]>();
  const cadastroIdByColaboradorCodigo = new Map<string, string>();
  const cadastroByColaboradorCodigo = new Map<string, IdentityCandidate>();
  for (const c of cadastros) {
    const nameKey = normalizePersonName(c.responsavel);
    if (nameKey) {
      const list = cadastrosByName.get(nameKey) ?? [];
      list.push(c);
      cadastrosByName.set(nameKey, list);
    }
    if (c.colaboradorCodigo) {
      const codigoKey = normalizePersonName(c.colaboradorCodigo);
      cadastroIdByColaboradorCodigo.set(codigoKey, c.cadastroId);
      cadastroByColaboradorCodigo.set(codigoKey, c);
    }
  }
  return { profissionalCodigosByName, cadastrosByName, cadastroIdByColaboradorCodigo, cadastroByColaboradorCodigo };
}

function countContradictingSignals(candidate: Pick<IdentityCandidate, "email" | "telefone" | "razaoSocial">, row: CadastroRow) {
  let count = 0;
  const emailA = candidate.email?.trim().toLowerCase() || "";
  const emailB = row.email?.trim().toLowerCase() || "";
  if (emailA && emailB && emailA !== emailB) count += 1;
  const telA = onlyDigits(candidate.telefone);
  const telB = onlyDigits(row.telefone);
  if (telA && telB && telA !== telB) count += 1;
  const razA = normalizePersonName(candidate.razaoSocial);
  const razB = normalizePersonName(row.razaoSocial);
  if (razA && razB && razA !== razB) count += 1;
  return count;
}

function signalsContradict(candidate: Pick<IdentityCandidate, "email" | "telefone" | "razaoSocial">, row: CadastroRow) {
  return countContradictingSignals(candidate, row) >= 1;
}

type Resolution =
  | { kind: "PROFISSIONAL_MATCH"; colaboradorCodigo: string }
  | { kind: "CADASTRO_MATCH"; colaboradorCodigo: string; cadastroId: string }
  | { kind: "CREATE"; colaboradorCodigo: string }
  | { kind: "CONFLICT"; candidates: IdentityCandidate[] };

function resolveFornecedorIdentity(row: CadastroRow, index: IdentityIndex): Resolution {
  const target = normalizePersonName(row.responsavel);
  const codigoFallback = target;

  const profissionalCodigos = index.profissionalCodigosByName.get(target);
  if (profissionalCodigos && profissionalCodigos.size === 1) {
    const codigo = [...profissionalCodigos][0];
    const cadastroVinculado = index.cadastroByColaboradorCodigo.get(normalizePersonName(codigo));
    if (cadastroVinculado && countContradictingSignals(cadastroVinculado, row) >= 2) {
      return { kind: "CONFLICT", candidates: [cadastroVinculado] };
    }
    return { kind: "PROFISSIONAL_MATCH", colaboradorCodigo: codigo };
  }
  if (profissionalCodigos && profissionalCodigos.size > 1) {
    const candidatos = (index.cadastrosByName.get(target) ?? []).filter((c) => c.colaboradorCodigo && profissionalCodigos.has(c.colaboradorCodigo));
    return { kind: "CONFLICT", candidates: candidatos };
  }

  const candidatosNome = index.cadastrosByName.get(target) ?? [];
  const plausiveis = candidatosNome.filter((c) => !signalsContradict(c, row));

  if (plausiveis.length === 1) {
    const c = plausiveis[0];
    return { kind: "CADASTRO_MATCH", colaboradorCodigo: c.colaboradorCodigo ?? codigoFallback, cadastroId: c.cadastroId };
  }
  if (plausiveis.length >= 2) {
    return { kind: "CONFLICT", candidates: plausiveis };
  }
  return { kind: "CREATE", colaboradorCodigo: codigoFallback };
}

// ─── Testes ───────────────────────────────────────────────────────────────────────────────────

function row(over: Partial<CadastroRow>): CadastroRow {
  return { responsavel: "Fulano de Tal", email: null, telefone: null, razaoSocial: "Fulano LTDA", cnpjNormalizado: "11111111000111", ...over };
}

test("1. Fornecedor novo (nenhum candidato) -> CREATE", () => {
  const index = buildIndex([], []);
  const r = resolveFornecedorIdentity(row({ responsavel: "Novo Fornecedor" }), index);
  assert.equal(r.kind, "CREATE");
});

test("2/3. EXEMPLO ALEXANDRE — fornecedor existente com CNPJ ALTERADO, mesmo e-mail/telefone/empresa -> atualiza o MESMO cadastro (nunca cria um segundo)", () => {
  const existente: IdentityCandidate = {
    cadastroId: "cad-alexandre",
    colaboradorCodigo: null, // ainda sem Profissional vinculado — cenário real do bug
    responsavel: "Alexandre Augusto Gilli",
    email: "alexandregilli@yahoo.com.br",
    telefone: "(94) 99134-6773",
    razaoSocial: "A&J - Projetos de Engenharia LTDA",
    cnpjNormalizado: "35094673000132",
  };
  const index = buildIndex([], [existente]);
  const linhaComCnpjNovo = row({
    responsavel: "Alexandre Augusto Gilli",
    email: "alexandregilli@yahoo.com.br",
    telefone: "(94) 99134-6773",
    razaoSocial: "A&J - Projetos de Engenharia LTDA",
    cnpjNormalizado: "35094700000000", // CNPJ diferente do cadastro existente
  });
  const r = resolveFornecedorIdentity(linhaComCnpjNovo, index);
  assert.equal(r.kind, "CADASTRO_MATCH");
  if (r.kind === "CADASTRO_MATCH") assert.equal(r.cadastroId, "cad-alexandre");
});

test("5 (validação adicional) — IDENTIDADE CANÔNICA: colaboradorCodigo já existente (FORNECEDOR001) prevalece quando o CNPJ muda (nunca conta) e SÓ UM outro sinal (e-mail) também muda -> UPDATE, nunca CREATE nem CONFLICT", () => {
  const profissionais = [{ codigo: "FORNECEDOR001", nome: "FORNECEDOR001", nomeCompleto: "Pessoa A" }];
  const cadastroExistente: IdentityCandidate = {
    cadastroId: "cad-fornecedor001",
    colaboradorCodigo: "FORNECEDOR001",
    responsavel: "Pessoa A",
    email: "a@example.com",
    telefone: "11900000001",
    razaoSocial: "Empresa A LTDA",
    cnpjNormalizado: "11111111000101",
  };
  const index = buildIndex(profissionais, [cadastroExistente]);

  // CNPJ muda (nunca conta como sinal) + a pessoa trocou de e-mail (atualização legítima e
  // rotineira) — telefone e razão social continuam batendo. Só 1 sinal diverge -> ainda confia na
  // identidade canônica.
  const linhaComEmailAtualizado = row({
    responsavel: "Pessoa A",
    email: "novo.email@example.com",
    telefone: "11900000001",
    razaoSocial: "Empresa A LTDA",
    cnpjNormalizado: "22222222000202",
  });

  const r = resolveFornecedorIdentity(linhaComEmailAtualizado, index);
  assert.equal(r.kind, "PROFISSIONAL_MATCH", "a chave canônica (colaboradorCodigo) prevalece quando só 1 sinal secundário diverge — atualização legítima, não homônimo");
  if (r.kind === "PROFISSIONAL_MATCH") assert.equal(r.colaboradorCodigo, "FORNECEDOR001");
});

test("5b — TRADE-OFF DOCUMENTADO: mesma identidade canônica (FORNECEDOR001), mas e-mail E telefone E razão social TODOS divergem ao mesmo tempo -> CONFLICT (2+ sinais contraditórios pesam mais que a confiança na identidade canônica sozinha)", () => {
  // Este teste documenta explicitamente o limite: NÃO é possível, ao mesmo tempo, (a) confiar
  // cegamente na identidade canônica mesmo com todos os sinais trocados E (b) proteger contra
  // homônimos reais colidindo no mesmo colaboradorCodigo — são o mesmo padrão de entrada. A
  // escolha desta correção prioriza nunca sobrescrever silenciosamente quando há evidência forte
  // (2+ sinais) de que pode ser uma pessoa diferente; um único sinal divergente (teste anterior)
  // continua resolvendo automaticamente, cobrindo o caso realista de atualização de contato.
  const profissionais = [{ codigo: "FORNECEDOR001", nome: "FORNECEDOR001", nomeCompleto: "Pessoa A" }];
  const cadastroExistente: IdentityCandidate = {
    cadastroId: "cad-fornecedor001",
    colaboradorCodigo: "FORNECEDOR001",
    responsavel: "Pessoa A",
    email: "a@example.com",
    telefone: "11900000001",
    razaoSocial: "Empresa A LTDA",
    cnpjNormalizado: "11111111000101",
  };
  const index = buildIndex(profissionais, [cadastroExistente]);
  const linhaTudoAlterado = row({
    responsavel: "Pessoa A",
    email: "b@example.com",
    telefone: "11900000002",
    razaoSocial: "Empresa B LTDA",
    cnpjNormalizado: "22222222000202",
  });

  const r = resolveFornecedorIdentity(linhaTudoAlterado, index);
  assert.equal(r.kind, "CONFLICT", "3 sinais divergindo ao mesmo tempo é tratado como possível homônimo, nunca sobrescrito silenciosamente");
});

test("4. Reimportar a MESMA planilha (mesma linha) duas vezes -> a segunda vez também resolve para CADASTRO_MATCH do mesmo id, nunca CREATE", () => {
  const existente: IdentityCandidate = {
    cadastroId: "cad-thalita",
    colaboradorCodigo: "THALITA CRYSTINA PEREIRA COSTA",
    responsavel: "Thalita Crystina Pereira Costa",
    email: "thalita@example.com",
    telefone: "11999990000",
    razaoSocial: "Thalita ME",
    cnpjNormalizado: "22222222000122",
  };
  const profissionais = [{ codigo: "THALITA CRYSTINA PEREIRA COSTA", nome: "THALITA CRYSTINA PEREIRA COSTA", nomeCompleto: "Thalita Crystina Pereira Costa" }];
  const index = buildIndex(profissionais, [existente]);
  const linha = row({ responsavel: "Thalita Crystina Pereira Costa", email: "thalita@example.com", telefone: "11999990000", razaoSocial: "Thalita ME" });

  const r1 = resolveFornecedorIdentity(linha, index);
  assert.equal(r1.kind, "PROFISSIONAL_MATCH");
  const r2 = resolveFornecedorIdentity(linha, index);
  assert.equal(r2.kind, "PROFISSIONAL_MATCH");
  if (r1.kind === "PROFISSIONAL_MATCH" && r2.kind === "PROFISSIONAL_MATCH") {
    assert.equal(r1.colaboradorCodigo, r2.colaboradorCodigo);
  }
});

test("5. CNPJ COMPARTILHADO — dois fornecedores com nomes distintos e o MESMO CNPJ permanecem distintos (CNPJ nunca é usado na resolução)", () => {
  const fornecedorA: IdentityCandidate = {
    cadastroId: "cad-a",
    colaboradorCodigo: null,
    responsavel: "Fornecedor A",
    email: "a@example.com",
    telefone: "11111111111",
    razaoSocial: "Empresa A",
    cnpjNormalizado: "11111111000111",
  };
  const fornecedorB: IdentityCandidate = {
    cadastroId: "cad-b",
    colaboradorCodigo: null,
    responsavel: "Fornecedor B",
    email: "b@example.com",
    telefone: "22222222222",
    razaoSocial: "Empresa B",
    cnpjNormalizado: "11111111000111", // MESMO CNPJ de A, de propósito
  };
  const index = buildIndex([], [fornecedorA, fornecedorB]);

  // Reimportar a linha de A com o CNPJ compartilhado nunca deve resolver para B (nomes diferentes).
  const linhaA = row({ responsavel: "Fornecedor A", email: "a@example.com", telefone: "11111111111", razaoSocial: "Empresa A", cnpjNormalizado: "11111111000111" });
  const rA = resolveFornecedorIdentity(linhaA, index);
  assert.equal(rA.kind, "CADASTRO_MATCH");
  if (rA.kind === "CADASTRO_MATCH") assert.equal(rA.cadastroId, "cad-a");

  const linhaB = row({ responsavel: "Fornecedor B", email: "b@example.com", telefone: "22222222222", razaoSocial: "Empresa B", cnpjNormalizado: "11111111000111" });
  const rB = resolveFornecedorIdentity(linhaB, index);
  assert.equal(rB.kind, "CADASTRO_MATCH");
  if (rB.kind === "CADASTRO_MATCH") assert.equal(rB.cadastroId, "cad-b");
});

test("6. HOMÔNIMOS — dois 'João Silva' distintos (e-mail/telefone/empresa diferentes) permanecem distintos, nunca escolhe o primeiro encontrado", () => {
  const joaoA: IdentityCandidate = {
    cadastroId: "cad-joao-a",
    colaboradorCodigo: null,
    responsavel: "João Silva",
    email: "joao.a@example.com",
    telefone: "11111111111",
    razaoSocial: "Empresa A",
    cnpjNormalizado: "11111111000111",
  };
  const index = buildIndex([], [joaoA]);

  // Nova linha "João Silva" com e-mail/telefone/empresa TOTALMENTE diferentes -> homônimo real.
  const linhaJoaoB = row({ responsavel: "João Silva", email: "joao.b@example.com", telefone: "22222222222", razaoSocial: "Empresa B" });
  const r = resolveFornecedorIdentity(linhaJoaoB, index);
  assert.equal(r.kind, "CREATE", "sinais contraditórios com o único candidato -> trata como pessoa diferente, nunca reaproveita o cadastro de A");
});

test("7. Nome com diferença apenas de maiúsculas/minúsculas resolve para o MESMO cadastro", () => {
  const existente: IdentityCandidate = {
    cadastroId: "cad-x",
    colaboradorCodigo: "MARIA DA SILVA",
    responsavel: "Maria da Silva",
    email: "maria@example.com",
    telefone: null,
    razaoSocial: "Maria ME",
    cnpjNormalizado: "33333333000133",
  };
  const profissionais = [{ codigo: "MARIA DA SILVA", nome: "MARIA DA SILVA", nomeCompleto: "Maria da Silva" }];
  const index = buildIndex(profissionais, [existente]);

  const r = resolveFornecedorIdentity(row({ responsavel: "MARIA DA SILVA", email: "maria@example.com", razaoSocial: "Maria ME" }), index);
  assert.equal(r.kind, "PROFISSIONAL_MATCH");
  if (r.kind === "PROFISSIONAL_MATCH") assert.equal(r.colaboradorCodigo, "MARIA DA SILVA");
});

test("8. Nome com espaços extras/múltiplos resolve para o MESMO cadastro", () => {
  const existente: IdentityCandidate = {
    cadastroId: "cad-y",
    colaboradorCodigo: null,
    responsavel: "Pedro   Alves",
    email: "pedro@example.com",
    telefone: "11987654321",
    razaoSocial: "Pedro ME",
    cnpjNormalizado: "44444444000144",
  };
  const index = buildIndex([], [existente]);

  const r = resolveFornecedorIdentity(row({ responsavel: "  Pedro Alves  ", email: "pedro@example.com", telefone: "11987654321", razaoSocial: "Pedro ME" }), index);
  assert.equal(r.kind, "CADASTRO_MATCH");
  if (r.kind === "CADASTRO_MATCH") assert.equal(r.cadastroId, "cad-y");
});

test("9. Caso ambíguo com 2 candidatos plausíveis -> CONFLICT, nunca escolhe arbitrariamente (nunca 'o primeiro')", () => {
  const candidato1: IdentityCandidate = {
    cadastroId: "cad-1",
    colaboradorCodigo: null,
    responsavel: "Ana Souza",
    email: null,
    telefone: null,
    razaoSocial: "Ana Souza ME",
    cnpjNormalizado: "55555555000155",
  };
  const candidato2: IdentityCandidate = {
    cadastroId: "cad-2",
    colaboradorCodigo: null,
    responsavel: "Ana Souza",
    email: null,
    telefone: null,
    razaoSocial: "Ana Souza EIRELI",
    cnpjNormalizado: "66666666000166",
  };
  const index = buildIndex([], [candidato1, candidato2]);

  // Linha sem e-mail/telefone/razaoSocial (nenhum sinal disponível para contradizer NENHUM dos
  // dois candidatos) — ambos continuam "plausíveis" (ausência nunca é tratada como contradição)
  // -> 2 candidatos plausíveis -> CONFLICT, nunca escolhido arbitrariamente.
  const r = resolveFornecedorIdentity(row({ responsavel: "Ana Souza", email: null, telefone: null, razaoSocial: "" }), index);
  assert.equal(r.kind, "CONFLICT");
  if (r.kind === "CONFLICT") assert.equal(r.candidates.length, 2);
});

test("9b. Ambiguidade na identidade CANÔNICA (2 Profissional distintos compatíveis) também vira CONFLICT, nunca findFirst arbitrário", () => {
  const profissionais = [
    { codigo: "HOMONIMO-X", nome: "HOMONIMO-X", nomeCompleto: "Fornecedor Homônimo Real" },
    { codigo: "HOMONIMO-Y", nome: "HOMONIMO-Y", nomeCompleto: "Fornecedor Homônimo Real" },
  ];
  const index = buildIndex(profissionais, []);
  const r = resolveFornecedorIdentity(row({ responsavel: "Fornecedor Homônimo Real" }), index);
  assert.equal(r.kind, "CONFLICT");
});

test("Ausência de dado nunca é tratada como contradição (planilha antiga sem e-mail/telefone continua batendo pelo nome)", () => {
  const existente: IdentityCandidate = {
    cadastroId: "cad-z",
    colaboradorCodigo: null,
    responsavel: "Carlos Pereira",
    email: null,
    telefone: null,
    razaoSocial: "Carlos ME",
    cnpjNormalizado: "77777777000177",
  };
  const index = buildIndex([], [existente]);
  const r = resolveFornecedorIdentity(row({ responsavel: "Carlos Pereira", email: "carlos@example.com", telefone: "11912345678", razaoSocial: "Carlos ME" }), index);
  assert.equal(r.kind, "CADASTRO_MATCH");
});

test("CNPJ nunca participa da contradição — dois cadastros com nomes iguais, sinais coerentes e CNPJ diferente continuam plausíveis (evidência de apoio apenas)", () => {
  const existente: IdentityCandidate = {
    cadastroId: "cad-w",
    colaboradorCodigo: null,
    responsavel: "Fernanda Lima",
    email: "fernanda@example.com",
    telefone: "11922223333",
    razaoSocial: "Fernanda Lima ME",
    cnpjNormalizado: "88888888000188",
  };
  const index = buildIndex([], [existente]);
  const r = resolveFornecedorIdentity(row({ responsavel: "Fernanda Lima", email: "fernanda@example.com", telefone: "11922223333", razaoSocial: "Fernanda Lima ME", cnpjNormalizado: "99999999000199" }), index);
  assert.equal(r.kind, "CADASTRO_MATCH");
});

// ─── VALIDAÇÃO DIRECIONADA (rodada 3) — HOMÔNIMO NA CAMADA PROFISSIONAL ─────────────────────────
//
// `Profissional.nome` é @unique e o colaboradorCodigo de um fornecedor novo (sem Profissional
// prévio) é derivado deterministicamente do nome (`codigoFromName`) — então, ANTES desta correção,
// a Prioridade 1 (match por Profissional já existente) confiava cegamente no match por nome, sem
// nenhuma checagem de sinal, podendo sobrescrever silenciosamente o cadastro de uma pessoa com os
// dados de OUTRA pessoa real que só por coincidência normaliza para o mesmo texto.

test("HOMÔNIMO NA CAMADA PROFISSIONAL — nome bate com um colaboradorCodigo já existente, mas e-mail/telefone/empresa contradizem quem está cadastrado -> CONFLICT, NUNCA sobrescreve silenciosamente", () => {
  const profissionais = [{ codigo: "MARIA OLIVEIRA", nome: "MARIA OLIVEIRA", nomeCompleto: "Maria Oliveira" }];
  const cadastroExistente: IdentityCandidate = {
    cadastroId: "cad-maria-original",
    colaboradorCodigo: "MARIA OLIVEIRA",
    responsavel: "Maria Oliveira",
    email: "maria.original@example.com",
    telefone: "11911112222",
    razaoSocial: "Maria Original ME",
    cnpjNormalizado: "10101010000110",
  };
  const index = buildIndex(profissionais, [cadastroExistente]);

  // Uma pessoa DIFERENTE, cujo nome escrito normaliza para o mesmo texto "MARIA OLIVEIRA", com
  // e-mail/telefone/empresa totalmente diferentes.
  const linhaHomonimo = row({
    responsavel: "Maria Oliveira",
    email: "maria.outra@example.com",
    telefone: "11933334444",
    razaoSocial: "Empresa Completamente Diferente LTDA",
  });

  const r = resolveFornecedorIdentity(linhaHomonimo, index);
  assert.equal(r.kind, "CONFLICT", "nunca pode reaproveitar/sobrescrever silenciosamente um colaboradorCodigo já em uso por outra identidade com sinais contraditórios");
});

test("Mesmo colaboradorCodigo já existente, SEM contradição (ausência de dado ou dado coerente) -> continua PROFISSIONAL_MATCH normalmente (retrocompatível)", () => {
  const profissionais = [{ codigo: "PEDRO SOUZA", nome: "PEDRO SOUZA", nomeCompleto: "Pedro Souza" }];
  const cadastroExistente: IdentityCandidate = {
    cadastroId: "cad-pedro",
    colaboradorCodigo: "PEDRO SOUZA",
    responsavel: "Pedro Souza",
    email: "pedro@example.com",
    telefone: null,
    razaoSocial: "Pedro ME",
    cnpjNormalizado: "20202020000120",
  };
  const index = buildIndex(profissionais, [cadastroExistente]);
  const r = resolveFornecedorIdentity(row({ responsavel: "Pedro Souza", email: "pedro@example.com", telefone: "11955556666", razaoSocial: "Pedro ME" }), index);
  assert.equal(r.kind, "PROFISSIONAL_MATCH");
});

// ─── VALIDAÇÃO DIRECIONADA (rodada 4) — NOVA POLÍTICA: ADMIN sempre pode excluir o cadastro ─────
// administrativo, mesmo com histórico; Profissional é preservado (nunca apagado) quando há
// histórico de medição, e só reavaliado quando é o ÚLTIMO CadastroFornecedor daquela identidade.
// Reimplementação verbatim de lib/cadastro-fornecedor.ts:planIdentityCleanup.

type IdentityCleanupPlan =
  | { codigoKey: string; action: "SKIP_STILL_ACTIVE" }
  | { codigoKey: string; action: "PRESERVE_PROFISSIONAL_FOR_HISTORY"; profissionalId: string | null }
  | { codigoKey: string; action: "DELETE_PROFISSIONAL"; profissionalId: string }
  | { codigoKey: string; action: "NO_PROFISSIONAL_NO_HISTORY" };

function planIdentityCleanup(params: {
  codigosDosCadastrosSolicitados: string[];
  restamPorCodigo: Map<string, number>;
  codigosComHistorico: Set<string>;
  profissionalPorCodigo: Map<string, { id: string }>;
}): IdentityCleanupPlan[] {
  const { codigosDosCadastrosSolicitados, restamPorCodigo, codigosComHistorico, profissionalPorCodigo } = params;
  const plans: IdentityCleanupPlan[] = [];
  const processados = new Set<string>();

  for (const codigoRaw of codigosDosCadastrosSolicitados) {
    const codigoKey = normalizePersonName(codigoRaw);
    if (!codigoKey || processados.has(codigoKey)) continue;
    processados.add(codigoKey);

    if ((restamPorCodigo.get(codigoKey) ?? 0) > 0) {
      plans.push({ codigoKey, action: "SKIP_STILL_ACTIVE" });
      continue;
    }

    const temHistorico = codigosComHistorico.has(codigoKey);
    const profissional = profissionalPorCodigo.get(codigoKey);

    if (temHistorico) {
      plans.push({
        codigoKey,
        action: "PRESERVE_PROFISSIONAL_FOR_HISTORY",
        profissionalId: profissional?.id ?? null,
      });
    } else if (profissional) {
      plans.push({ codigoKey, action: "DELETE_PROFISSIONAL", profissionalId: profissional.id });
    } else {
      plans.push({ codigoKey, action: "NO_PROFISSIONAL_NO_HISTORY" });
    }
  }

  return plans;
}

test("1. ADMIN exclui fornecedor SEM histórico -> Profissional é removido (nada a preservar)", () => {
  const plans = planIdentityCleanup({
    codigosDosCadastrosSolicitados: ["FORNECEDOR002"],
    restamPorCodigo: new Map([["FORNECEDOR002", 0]]),
    codigosComHistorico: new Set(),
    profissionalPorCodigo: new Map([["FORNECEDOR002", { id: "prof-2" }]]),
  });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].action, "DELETE_PROFISSIONAL");
});

test("2. ADMIN exclui fornecedor COM histórico -> Profissional é PRESERVADO (nunca apagado), marcado para exclusão da estrutura ativa", () => {
  const plans = planIdentityCleanup({
    codigosDosCadastrosSolicitados: ["FORNECEDOR001"],
    restamPorCodigo: new Map([["FORNECEDOR001", 0]]),
    codigosComHistorico: new Set(["FORNECEDOR001"]),
    profissionalPorCodigo: new Map([["FORNECEDOR001", { id: "prof-1" }]]),
  });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].action, "PRESERVE_PROFISSIONAL_FOR_HISTORY", "NUNCA bloqueia — preserva Profissional em vez de bloquear a exclusão administrativa");
  if (plans[0].action === "PRESERVE_PROFISSIONAL_FOR_HISTORY") assert.equal(plans[0].profissionalId, "prof-1");
});

test("3. Excluir TODOS os CadastroFornecedor da mesma identidade com histórico de uma vez -> PERMITIDO (nunca mais DUPLICATE_REQUIRES_SELECTION)", () => {
  // A+B mesma identidade, ambos selecionados de uma vez -> restam = 0 após a operação.
  const plans = planIdentityCleanup({
    codigosDosCadastrosSolicitados: ["FORNECEDOR001", "FORNECEDOR001"],
    restamPorCodigo: new Map([["FORNECEDOR001", 0]]),
    codigosComHistorico: new Set(["FORNECEDOR001"]),
    profissionalPorCodigo: new Map([["FORNECEDOR001", { id: "prof-1" }]]),
  });
  assert.equal(plans.length, 1, "processa a identidade uma única vez, mesmo com 2 cadastros solicitados");
  assert.equal(plans[0].action, "PRESERVE_PROFISSIONAL_FOR_HISTORY");
});

test("Enquanto sobrar outro CadastroFornecedor para a MESMA identidade, Profissional/Usuario ficam completamente intocados", () => {
  const plans = planIdentityCleanup({
    codigosDosCadastrosSolicitados: ["FORNECEDOR001"],
    restamPorCodigo: new Map([["FORNECEDOR001", 1]]), // B ainda sobrevive
    codigosComHistorico: new Set(["FORNECEDOR001"]),
    profissionalPorCodigo: new Map([["FORNECEDOR001", { id: "prof-1" }]]),
  });
  assert.equal(plans[0].action, "SKIP_STILL_ACTIVE");
});

test("Identidade já preservada anteriormente (Profissional já com campos operacionais limpos) -> plano continua PRESERVE (limpar de novo é idempotente, sem flag especial)", () => {
  const plans = planIdentityCleanup({
    codigosDosCadastrosSolicitados: ["FORNECEDOR001"],
    restamPorCodigo: new Map([["FORNECEDOR001", 0]]),
    codigosComHistorico: new Set(["FORNECEDOR001"]),
    profissionalPorCodigo: new Map([["FORNECEDOR001", { id: "prof-1" }]]),
  });
  assert.equal(plans[0].action, "PRESERVE_PROFISSIONAL_FOR_HISTORY");
});

test("Identidade com histórico mas SEM nenhum Profissional vinculado -> nada para preservar/apagar em Profissional (só o CadastroFornecedor é removido)", () => {
  const plans = planIdentityCleanup({
    codigosDosCadastrosSolicitados: ["FORNECEDOR003"],
    restamPorCodigo: new Map([["FORNECEDOR003", 0]]),
    codigosComHistorico: new Set(["FORNECEDOR003"]),
    profissionalPorCodigo: new Map(),
  });
  assert.equal(plans[0].action, "PRESERVE_PROFISSIONAL_FOR_HISTORY");
  if (plans[0].action === "PRESERVE_PROFISSIONAL_FOR_HISTORY") assert.equal(plans[0].profissionalId, null);
});
