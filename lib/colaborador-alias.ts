import "server-only";

import { normalizeCnpjDigits, onlyDigits } from "@/lib/cadastro-fornecedor";
import { decryptSensitive } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { toColaboradorCodigo } from "@/lib/usuario-format";

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)));
}

export async function getColaboradorCodigoAliases(usuario: string | null | undefined, ciclo?: string | null) {
  const usuarioCnpj = normalizeCnpjDigits(usuario);
  const cadastroPorLogin = usuarioCnpj.length === 14
    ? await prisma.cadastroFornecedor.findFirst({
        where: { cnpjNormalizado: usuarioCnpj },
        select: { colaboradorCodigo: true, responsavel: true, cnpjNormalizado: true },
      })
    : null;
  const usuarioDb = !cadastroPorLogin && usuario
    ? await prisma.usuario.findUnique({
        where: { usuario: usuario.trim().toUpperCase() },
        select: { nome: true },
      })
    : null;
  const cadastroPorUsuario = !cadastroPorLogin && usuarioDb?.nome
    ? await prisma.cadastroFornecedor.findFirst({
        where: { responsavel: { equals: usuarioDb.nome, mode: "insensitive" } },
        select: { colaboradorCodigo: true, responsavel: true, cnpjNormalizado: true },
      })
    : null;
  const codigo = cadastroPorLogin?.colaboradorCodigo ?? cadastroPorUsuario?.colaboradorCodigo ?? toColaboradorCodigo(usuario);
  const codigos = new Set<string>(codigo ? [codigo] : []);

  const profissional = codigo
    ? await prisma.profissional.findUnique({
        where: { codigo },
        select: { codigo: true, nome: true, nomeCompleto: true, cnpj: true },
      })
    : null;
  const profissionalCnpj = onlyDigits(decryptSensitive(profissional?.cnpj));

  const cadastroDireto = cadastroPorLogin ?? cadastroPorUsuario ?? (codigo
    ? await prisma.cadastroFornecedor.findFirst({
        where: { OR: [{ colaboradorCodigo: codigo }, { responsavel: codigo }] },
        select: { colaboradorCodigo: true, responsavel: true, cnpjNormalizado: true },
      })
    : null);
  const cadastroPorCnpj = !cadastroDireto && profissionalCnpj.length === 14
    ? await prisma.cadastroFornecedor.findFirst({
        where: {
          cnpjNormalizado: profissionalCnpj,
          OR: [
            ...(profissional?.nome ? [{ responsavel: { contains: profissional.nome, mode: "insensitive" as const } }] : []),
            ...(profissional?.nomeCompleto ? [{ responsavel: { equals: profissional.nomeCompleto, mode: "insensitive" as const } }] : []),
          ],
        },
        select: { colaboradorCodigo: true, responsavel: true, cnpjNormalizado: true },
      })
    : null;
  const cadastro = cadastroDireto ?? cadastroPorCnpj;

  unique([cadastro?.colaboradorCodigo, cadastro?.responsavel, profissional?.codigo, profissional?.nome, profissional?.nomeCompleto]).forEach((value) => codigos.add(value));

  const normalizedCadastroName = normalizeText(cadastro?.responsavel ?? profissional?.nomeCompleto ?? codigo);
  if (normalizedCadastroName) {
    const pagamentos = await prisma.mapaPagamentoItem.findMany({
      where: ciclo ? { ciclo } : undefined,
      select: { projetistaCodigo: true, responsavel: true },
    });
    pagamentos
      .filter((item) => normalizeText(item.responsavel) === normalizedCadastroName || normalizeText(item.projetistaCodigo) === normalizedCadastroName)
      .flatMap((item) => [item.projetistaCodigo, item.responsavel])
      .forEach((value) => value && codigos.add(value));
  }

  return Array.from(codigos);
}
