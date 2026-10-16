import "server-only";

import { prisma } from "@/lib/prisma";
import { toColaboradorCodigo } from "@/lib/usuario-format";
import { selectCadastroForAuthenticatedUser } from "@/lib/cadastro-identity";
import { aliasesDaIdentidade, resolverIdentidadeOperacional } from "@/lib/profissional-identidade";
import { filtrarAliasesDaIdentidade } from "@/lib/colaborador-alias-filtro";

/**
 * Valores (códigos, nomes, aliases) que delimitam os dados do fornecedor logado. Regra da spec
 * docs/brain/specs/p1-escopo-fornecedor-por-identidade.md: a identidade vem do cadastro do usuário
 * (login ou nome exato, falhando fechado) e só entra na lista o valor que o resolver oficial liga ao
 * MESMO Profissional — nunca CNPJ, nunca nome parecido, nunca a linha inteira do mapa.
 */
export async function getColaboradorCodigoAliases(usuario: string | null | undefined, ciclo?: string | null) {
  return (await getColaboradorEscopo(usuario, ciclo)).aliases;
}

/** Mesma regra, devolvendo também o Profissional da sessão (null sem identidade única). */
export async function getColaboradorEscopo(
  usuario: string | null | undefined,
  ciclo?: string | null,
): Promise<{ aliases: string[]; profissionalId: string | null }> {
  const login = toColaboradorCodigo(usuario);
  if (!usuario || !login) return { aliases: [], profissionalId: null };
  const usuarioUpper = usuario.trim().toUpperCase();

  const usuarioDb = await prisma.usuario.findUnique({ where: { usuario: usuarioUpper }, select: { nome: true } });
  const cadastroCandidates = await prisma.cadastroFornecedor.findMany({
    where: {
      OR: [
        { colaboradorCodigo: usuarioUpper },
        ...(usuarioDb?.nome ? [{ responsavel: { equals: usuarioDb.nome, mode: "insensitive" as const } }] : []),
      ],
    },
    select: { id: true, colaboradorCodigo: true, responsavel: true, cnpjNormalizado: true },
    orderBy: { updatedAt: "desc" },
  });
  const cadastro = selectCadastroForAuthenticatedUser(cadastroCandidates, usuario, usuarioDb?.nome).cadastro;

  const identidade = await resolverIdentidadeOperacional(cadastro?.colaboradorCodigo ?? login);
  // Sem identidade única, o escopo é só o login da sessão (falha fechado).
  if (identidade.status !== "RESOLVIDO") return { aliases: [login], profissionalId: null };
  const { profissionalId } = identidade;

  const profissional = await prisma.profissional.findUnique({
    where: { id: profissionalId },
    select: { codigo: true, nome: true, nomeCompleto: true },
  });
  const proprios = [
    login,
    cadastro?.colaboradorCodigo,
    cadastro?.responsavel,
    profissional?.codigo,
    profissional?.nome,
    profissional?.nomeCompleto,
    ...(await aliasesDaIdentidade(profissionalId)),
  ].filter((v): v is string => !!v);

  // Grafias do mapa ligadas a um valor próprio; cada uma ainda passa pelo filtro.
  const mapa = await prisma.mapaPagamentoItem.findMany({
    where: {
      ...(ciclo ? { ciclo } : {}),
      OR: [
        { projetistaCodigo: { in: proprios, mode: "insensitive" } },
        { responsavel: { in: proprios, mode: "insensitive" } },
      ],
    },
    select: { projetistaCodigo: true, responsavel: true },
  });

  const aliases = await filtrarAliasesDaIdentidade(
    [...proprios, ...mapa.flatMap((item) => [item.projetistaCodigo, item.responsavel])],
    (valor) => resolverIdentidadeOperacional(valor),
    profissionalId,
  );
  // O login é a identidade da sessão: entra, a menos que seja o código de OUTRO Profissional.
  const doLogin = await resolverIdentidadeOperacional(login);
  if (doLogin.status !== "RESOLVIDO" || doLogin.profissionalId === profissionalId) aliases.unshift(login);
  return { aliases: Array.from(new Set(aliases)), profissionalId };
}
