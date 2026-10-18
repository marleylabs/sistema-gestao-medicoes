import "server-only";

import { prisma } from "@/lib/prisma";
import { toColaboradorCodigo } from "@/lib/usuario-format";
import { selectCadastroForAuthenticatedUser } from "@/lib/cadastro-identity";
import { aliasesDaIdentidade, resolverIdentidadeOperacional } from "@/lib/profissional-identidade";
import { filtrarAliasesDaIdentidade } from "@/lib/colaborador-alias-filtro";

/**
 * Valores (códigos, nomes, aliases) que delimitam os dados do fornecedor logado. Regra da spec
 * docs/brain/specs/p1-escopo-fornecedor-por-identidade.md: a identidade vem do cadastro cujo código é
 * o login (P0, decisão 012; falha fechado) e só entra na lista o valor que o resolver oficial liga ao
 * MESMO Profissional — nunca CNPJ, nunca nome parecido, nunca a linha inteira do mapa.
 */
export async function getColaboradorCodigoAliases(usuario: string | null | undefined, ciclo?: string | null) {
  return (await getColaboradorEscopo(usuario, ciclo)).aliases;
}

/**
 * Mesma regra, devolvendo também o Profissional da sessão (null sem identidade única) e o cadastro
 * escolhido para o usuário (falha fechado com homônimos) — fonte única dos dados exibidos no portal.
 */
export async function getColaboradorEscopo(
  usuario: string | null | undefined,
  ciclo?: string | null,
): Promise<{ aliases: string[]; profissionalId: string | null; cadastroId: string | null }> {
  const login = toColaboradorCodigo(usuario);
  if (!usuario || !login) return { aliases: [], profissionalId: null, cadastroId: null };
  const usuarioUpper = usuario.trim().toUpperCase();

  // P0 é o único ID do fornecedor (decisão 012): o cadastro é o do código igual ao login, nunca pelo nome.
  const cadastroCandidates = await prisma.cadastroFornecedor.findMany({
    where: { colaboradorCodigo: { equals: usuarioUpper, mode: "insensitive" } },
    select: { id: true, colaboradorCodigo: true, responsavel: true, cnpjNormalizado: true },
    orderBy: { updatedAt: "desc" },
  });
  const cadastro = selectCadastroForAuthenticatedUser(cadastroCandidates, usuario).cadastro;
  const cadastroId = cadastro?.id ?? null;

  // O login é a identidade da sessão, mas só entra na lista se não for código/alias de nenhum
  // Profissional (AMBIGUO ou de outro ficaria com os dados alheios).
  const doLogin = await resolverIdentidadeOperacional(login);
  const loginLivre = doLogin.status === "NAO_RESOLVIDO";
  const identidade = cadastro?.colaboradorCodigo ? await resolverIdentidadeOperacional(cadastro.colaboradorCodigo) : doLogin;
  // Sem identidade única, o escopo é só o login da sessão (falha fechado).
  if (identidade.status !== "RESOLVIDO") return { aliases: loginLivre ? [login] : [], profissionalId: null, cadastroId };
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
  if (loginLivre) aliases.unshift(login);
  return { aliases: Array.from(new Set(aliases)), profissionalId, cadastroId };
}
