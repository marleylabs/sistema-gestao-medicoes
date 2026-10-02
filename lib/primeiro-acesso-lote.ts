import type { RotateAndSendFirstAccessResult } from "@/lib/first-access";
import { avaliarElegibilidadePrimeiroAcesso } from "@/lib/primeiro-acesso-elegibilidade";

/**
 * Envio de primeiro acesso EM LOTE — só orquestração. A regra continua sendo a do fluxo individual:
 * elegibilidade em lib/primeiro-acesso-elegibilidade.ts e rotação+e-mail em `rotateAndSendFirstAccess`
 * (lib/first-access.ts), injetada como `enviar` pela rota (e por fakes nos testes).
 *
 * - IDs deduplicados; cada cadastro é RECONSULTADO (`carregar`) e reavaliado no servidor — o
 *   checkbox da tela nunca é a fonte de verdade.
 * - Sequencial (nunca Promise.all): cada envio abre suas próprias transações curtas (rotação e
 *   idempotência do e-mail) e o provedor tem limite de taxa; ver INTERVALO_MINIMO_ENVIO_MS.
 * - Parcial por natureza: falha de um item não desfaz os anteriores; cada item tem seu resultado.
 * - Um mesmo `Usuario` (dois cadastros com o mesmo responsável) é processado uma única vez.
 * - O resultado nunca carrega senha, token, e-mail ou erro bruto do provedor.
 */

/**
 * Limite por requisição: o processamento é sequencial e espaçado (~0,6 s por envio), então 50
 * cabem com folga no tempo de resposta do proxy público (Cloudflare encerra em 100 s) e cobrem a
 * base atual inteira (48 cadastros na pré-produção auditada). Acima disso, o ADMIN envia em partes.
 */
export const LIMITE_PRIMEIRO_ACESSO_LOTE = 50;

/** Resend limita a 2 requisições/s por padrão — 600 ms entre envios reais mantém o lote abaixo disso. */
export const INTERVALO_MINIMO_ENVIO_MS = 600;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StatusPrimeiroAcessoLote = "ENVIADO" | "IGNORADO" | "FALHA";

export type ResultadoPrimeiroAcessoLote = {
  id: string;
  nome: string | null;
  status: StatusPrimeiroAcessoLote;
  motivo: string;
};

export type ResumoPrimeiroAcessoLote = {
  totalSelecionados: number;
  enviados: number;
  ignorados: number;
  falhas: number;
  resultados: ResultadoPrimeiroAcessoLote[];
};

export type CadastroPrimeiroAcesso = {
  id: string;
  nome: string;
  emailCadastral: string | null;
  acesso: { id: string; nome: string; usuario: string; perfil: string; primeiroLogin: boolean; email: string | null } | null;
};

export type EnvioPrimeiroAcesso = { usuarioId: string; usuarioNome: string; usuarioLogin: string; email: string };

export function normalizarIdsPrimeiroAcessoLote(raw: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Informe um array de IDs." };
  const ids = [...new Set(raw.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter((id) => UUID_PATTERN.test(id)))];
  if (ids.length === 0) return { ok: false, error: "Nenhum fornecedor válido informado." };
  if (ids.length > LIMITE_PRIMEIRO_ACESSO_LOTE) {
    return { ok: false, error: `No máximo ${LIMITE_PRIMEIRO_ACESSO_LOTE} fornecedores por envio. Envie em partes.` };
  }
  return { ok: true, ids };
}

const MOTIVO_FALHA_ENVIO = "Não foi possível enviar o e-mail. Envie novamente.";

function resultadoDoEnvio(envio: RotateAndSendFirstAccessResult): Pick<ResultadoPrimeiroAcessoLote, "status" | "motivo"> {
  if (envio.ok) return { status: "ENVIADO", motivo: envio.alreadyProcessed ? "Acesso já enviado nesta operação" : "Acesso enviado" };
  // Relido DENTRO da trava do service: a pessoa concluiu o primeiro login entre a leitura e o envio.
  if (envio.status === 409 && envio.motivo === "ACESSO_JA_DEFINIDO") return { status: "IGNORADO", motivo: "Acesso já ativado (senha definida pelo usuário)" };
  if (envio.status === 409) return { status: "IGNORADO", motivo: "Envio já em andamento. Verifique novamente em instantes." };
  return { status: "FALHA", motivo: MOTIVO_FALHA_ENVIO };
}

export async function processarPrimeiroAcessoEmLote(input: {
  ids: string[];
  carregar: (ids: string[]) => Promise<Map<string, CadastroPrimeiroAcesso>>;
  enviar: (envio: EnvioPrimeiroAcesso) => Promise<RotateAndSendFirstAccessResult>;
  aguardar?: (ms: number) => Promise<void>;
  intervaloMs?: number;
}): Promise<ResumoPrimeiroAcessoLote> {
  const ids = [...new Set(input.ids)];
  const aguardar = input.aguardar ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const intervaloMs = input.intervaloMs ?? INTERVALO_MINIMO_ENVIO_MS;
  const cadastros = await input.carregar(ids);
  const usuariosProcessados = new Set<string>();
  const resultados: ResultadoPrimeiroAcessoLote[] = [];
  let enviosAoProvedor = 0;

  for (const id of ids) {
    const cadastro = cadastros.get(id);
    if (!cadastro) {
      resultados.push({ id, nome: null, status: "IGNORADO", motivo: "Fornecedor não encontrado" });
      continue;
    }
    const elegibilidade = avaliarElegibilidadePrimeiroAcesso(cadastro.acesso, cadastro.emailCadastral);
    if (!elegibilidade.elegivel || !cadastro.acesso?.email) {
      resultados.push({ id, nome: cadastro.nome, status: "IGNORADO", motivo: elegibilidade.elegivel ? "Sem e-mail cadastrado" : elegibilidade.mensagem });
      continue;
    }
    if (usuariosProcessados.has(cadastro.acesso.id)) {
      resultados.push({ id, nome: cadastro.nome, status: "IGNORADO", motivo: "Mesmo acesso de outro fornecedor selecionado" });
      continue;
    }
    usuariosProcessados.add(cadastro.acesso.id);

    if (enviosAoProvedor > 0 && intervaloMs > 0) await aguardar(intervaloMs);
    enviosAoProvedor += 1;
    try {
      const envio = await input.enviar({
        usuarioId: cadastro.acesso.id,
        usuarioNome: cadastro.acesso.nome,
        usuarioLogin: cadastro.acesso.usuario,
        email: cadastro.acesso.email,
      });
      resultados.push({ id, nome: cadastro.nome, ...resultadoDoEnvio(envio) });
    } catch (error) {
      // Erro inesperado (banco/provedor): o detalhe técnico fica nos logs do servidor, nunca na resposta.
      console.error("[primeiro-acesso-lote] envio falhou", { cadastroId: id, error: error instanceof Error ? error.message : String(error) });
      resultados.push({ id, nome: cadastro.nome, status: "FALHA", motivo: MOTIVO_FALHA_ENVIO });
    }
  }

  return {
    totalSelecionados: ids.length,
    enviados: resultados.filter((r) => r.status === "ENVIADO").length,
    ignorados: resultados.filter((r) => r.status === "IGNORADO").length,
    falhas: resultados.filter((r) => r.status === "FALHA").length,
    resultados,
  };
}
