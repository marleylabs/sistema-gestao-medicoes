import "server-only";

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { senhaDoUsuarioConfere } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { detectAllowedImageMime } from "@/lib/file-security";
import { TimesheetError, auditoria, carregarFolha, exigirEnvioPermitido, type Ator, type FolhaTimesheet } from "@/lib/timesheet";
import { ACEITE_VERSAO, LIMITES_PNG, MAX_ASSINATURA_BYTES, type MetodoAssinatura } from "@/lib/timesheet-assinatura-texto";

/**
 * Assinatura eletrônica da folha (spec docs/brain/specs/timesheet-assinatura.md): validação da entrada do modal
 * (PNG e senha), gravação com hash do conteúdo e código de verificação, envio assinado do colaborador e a
 * verificação de um código. O lado do fiscal (escopo do contrato) fica em `lib/timesheet-fiscal.ts`.
 */

export type PapelAssinatura = "FISCAL" | "COLABORADOR";
export type AssinaturaValidada = { imagem: Buffer; metodo: MetodoAssinatura };

const PREFIXO_PNG = "data:image/png;base64,";
// Sem I, O, 0 e 1, que se confundem ao digitar o código.
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FORMATO_CODIGO = /^TS-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
// Conta toda tentativa (certa ou errada): um fiscal assina várias folhas seguidas, então o limite é folgado.
const TENTATIVAS = { limite: 20, janelaMs: 15 * 60 * 1000 };

/** PNG do quadro: assinatura de PNG, até 100 KB e dimensões do cabeçalho IHDR dentro dos limites. */
export function validarImagemAssinatura(imagem: unknown): Buffer {
  if (typeof imagem !== "string" || !imagem.startsWith(PREFIXO_PNG)) throw new TimesheetError("Desenhe ou digite a assinatura.", 400);
  // 4/3 do base64: recusa antes de decodificar um texto enorme.
  if (imagem.length - PREFIXO_PNG.length > Math.ceil((MAX_ASSINATURA_BYTES * 4) / 3) + 4) throw new TimesheetError("A assinatura passou de 100 KB.", 400);
  const bytes = Buffer.from(imagem.slice(PREFIXO_PNG.length), "base64");
  if (bytes.length > MAX_ASSINATURA_BYTES) throw new TimesheetError("A assinatura passou de 100 KB.", 400);
  if (bytes.length < 24 || detectAllowedImageMime(bytes) !== "image/png" || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new TimesheetError("Imagem da assinatura inválida.", 400);
  }
  const largura = bytes.readUInt32BE(16);
  const altura = bytes.readUInt32BE(20);
  if (largura < LIMITES_PNG.minLargura || largura > LIMITES_PNG.maxLargura || altura < LIMITES_PNG.minAltura || altura > LIMITES_PNG.maxAltura) {
    throw new TimesheetError("Imagem da assinatura com tamanho inválido.", 400);
  }
  return bytes;
}

async function confirmarSenha(usuarioId: string, senha: unknown) {
  if (typeof senha !== "string" || !senha) throw new TimesheetError("Informe sua senha para assinar.", 400);
  const limite = checkRateLimit(`assinatura:${usuarioId}`, TENTATIVAS.limite, TENTATIVAS.janelaMs);
  if (!limite.ok) throw new TimesheetError(`Muitas tentativas. Tente de novo em ${Math.ceil(limite.retryAfterSeconds / 60)} min.`, 429);
  if (!(await senhaDoUsuarioConfere(usuarioId, senha))) throw new TimesheetError("Senha incorreta.", 400);
}

/** Entrada do modal (`{ imagem, metodo, senha }`) → imagem validada. A senha é a do usuário da sessão. */
export async function validarAssinatura(entrada: unknown, usuarioId: string): Promise<AssinaturaValidada> {
  const e = (entrada && typeof entrada === "object" ? entrada : {}) as { imagem?: unknown; metodo?: unknown; senha?: unknown };
  if (e.metodo !== "DESENHO" && e.metodo !== "DIGITADO") throw new TimesheetError("Modo de assinatura inválido.", 400);
  const imagem = validarImagemAssinatura(e.imagem);
  await confirmarSenha(usuarioId, e.senha);
  return { imagem, metodo: e.metodo };
}

/** IP de quem assina, como a rota de login lê (primeiro do x-forwarded-for do proxy). */
export function ipDaRequisicao(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

export function gerarCodigo() {
  const letras = [...randomBytes(8)].map((b) => ALFABETO[b % ALFABETO.length]).join("");
  return `TS-${letras.slice(0, 4)}-${letras.slice(4)}`;
}

/** O que foi assinado, gravado junto (o fiscal assina com dias pendentes; o resumo mostra em que estado). */
function resumoDaFolha(folha: FolhaTimesheet) {
  const lancados = folha.dias.filter((d) => d.lancado);
  return {
    totais: folha.totais,
    diasLancados: lancados.length,
    aprovados: lancados.filter((d) => d.aprovacao === "APROVADO").length,
    reprovados: lancados.filter((d) => d.aprovacao === "REPROVADO").length,
    pendentes: lancados.filter((d) => !d.aprovacao).length,
    aceite: ACEITE_VERSAO,
  };
}

/** Grava a assinatura dentro da transação de quem chama (envio ou assinatura do fiscal), que registra a auditoria. */
export async function gravarAssinatura(tx: Prisma.TransactionClient, dados: {
  folhaId: string; papel: PapelAssinatura; ator: Ator; ip: string | null; assinatura: AssinaturaValidada; conteudo: FolhaTimesheet;
}) {
  const codigo = gerarCodigo();
  await tx.timesheetAssinatura.create({
    data: {
      folhaId: dados.folhaId, papel: dados.papel, usuarioId: dados.ator.id, nome: dados.ator.nome, ip: dados.ip,
      metodo: dados.assinatura.metodo, imagem: new Uint8Array(dados.assinatura.imagem),
      hashConteudo: dados.conteudo.conteudoHash, resumo: resumoDaFolha(dados.conteudo), codigo,
    },
  });
  return { codigo, hash: dados.conteudo.conteudoHash };
}

/** P2002 no índice parcial = já existe uma assinatura ativa daquele papel na folha. */
export function assinaturaDuplicada(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Fornecedor envia e assina a folha do ciclo num só ato (spec, regra 6): fica só leitura até a medição reabrir.
 * Status, assinatura e auditoria na mesma transação; sem assinatura não há envio.
 */
export async function enviarFolha(input: {
  profissionalId: string | null; ciclo: unknown; ator: Ator; assinatura: AssinaturaValidada; ip?: string | null; cicloAtivo?: string;
}) {
  const { ciclo, profissional } = await exigirEnvioPermitido(input.profissionalId, input.ciclo, input.cicloAtivo);
  // shortcut: o hash é lido antes da transação; um dia gravado nesse intervalo só faria a folha aparecer como alterada.
  const conteudo = await carregarFolha(profissional.id, ciclo, undefined, { paraMedicao: true });
  try {
    return await prisma.$transaction(async (tx) => {
      const folha = await tx.timesheetFolha.findUnique({
        where: { profissionalId_ciclo: { profissionalId: profissional.id, ciclo } },
        // Dia salvo em branco não conta: precisa de ao menos um período lançado.
        select: { id: true, _count: { select: { dias: { where: { OR: [{ entrada1: { not: null } }, { entrada2: { not: null } }] } } } } },
      });
      if (!folha || folha._count.dias === 0) throw new TimesheetError("Preencha ao menos um dia antes de enviar.", 400);
      const enviada = await tx.timesheetFolha.updateMany({
        where: { id: folha.id, status: "ABERTA" },
        data: { status: "ENVIADA", enviadaAt: new Date(), enviadaPorId: input.ator.id },
      });
      if (enviada.count === 0) throw new TimesheetError("A folha já foi enviada.", 409);
      const { codigo, hash } = await gravarAssinatura(tx, { folhaId: folha.id, papel: "COLABORADOR", ator: input.ator, ip: input.ip ?? null, assinatura: input.assinatura, conteudo });
      await tx.adminAuditLog.create({
        data: auditoria(input.ator, "TIMESHEET_ENVIADA", folha.id, profissional.codigo, { ciclo, assinatura: { codigo, metodo: input.assinatura.metodo, hash } }),
      });
      return { codigo };
    });
  } catch (e) {
    if (assinaturaDuplicada(e)) throw new TimesheetError("A folha já tem uma assinatura ativa do colaborador.", 409);
    throw e;
  }
}

/**
 * Confere um código (spec, regra 8). Devolve o `profissionalId` para quem chama filtrar o escopo (o fiscal) e o
 * `ip`, que só a rota interna repassa.
 */
export async function verificarAssinatura(codigoParam: unknown) {
  const codigo = typeof codigoParam === "string" ? codigoParam.trim().toUpperCase() : "";
  if (!FORMATO_CODIGO.test(codigo)) throw new TimesheetError("Código inválido. Use o formato TS-XXXX-XXXX.", 400);
  const a = await prisma.timesheetAssinatura.findUnique({
    where: { codigo },
    select: {
      papel: true, nome: true, assinadoEm: true, metodo: true, ip: true, hashConteudo: true, resumo: true,
      encerradaEm: true, encerramento: true, folha: { select: { ciclo: true, profissionalId: true } },
    },
  });
  if (!a) throw new TimesheetError("Código não encontrado.", 404);
  const atual = await carregarFolha(a.folha.profissionalId, a.folha.ciclo, undefined, { paraMedicao: true });
  return {
    codigo, papel: a.papel, nome: a.nome, assinadoEm: a.assinadoEm.toISOString(), metodo: a.metodo, ip: a.ip,
    ativa: !a.encerradaEm, encerramento: a.encerramento, encerradaEm: a.encerradaEm?.toISOString() ?? null,
    ciclo: a.folha.ciclo, profissionalId: a.folha.profissionalId, fornecedor: atual.fornecedor,
    alterada: a.hashConteudo !== atual.conteudoHash, resumo: a.resumo,
  };
}
export type VerificacaoAssinatura = Omit<Awaited<ReturnType<typeof verificarAssinatura>>, "profissionalId" | "ip"> & { ip?: string | null };
