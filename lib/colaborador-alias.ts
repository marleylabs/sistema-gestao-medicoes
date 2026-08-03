import "server-only";

import { onlyDigits } from "@/lib/cadastro-fornecedor";
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
  const codigo = toColaboradorCodigo(usuario);
  const codigos = new Set<string>(codigo ? [codigo] : []);

  const profissional = codigo
    ? await prisma.profissional.findUnique({
        where: { codigo },
        select: { codigo: true, nome: true, nomeCompleto: true, cnpj: true },
      })
    : null;
  const profissionalCnpj = onlyDigits(decryptSensitive(profissional?.cnpj));

  const cadastro = codigo || profissionalCnpj
    ? await prisma.cadastroFornecedor.findFirst({
        where: {
          OR: [
            ...(codigo ? [{ colaboradorCodigo: codigo }, { responsavel: codigo }] : []),
            ...(profissionalCnpj.length === 14 ? [{ cnpjNormalizado: profissionalCnpj }] : []),
          ],
        },
        select: { colaboradorCodigo: true, responsavel: true, cnpjNormalizado: true },
      })
    : null;

  unique([cadastro?.colaboradorCodigo, cadastro?.responsavel, profissional?.codigo, profissional?.nome, profissional?.nomeCompleto]).forEach((value) => codigos.add(value));
  const cnpjNormalizado = cadastro?.cnpjNormalizado ?? profissionalCnpj;

  if (cnpjNormalizado.length === 14) {
    const profissionais = await prisma.profissional.findMany({
      select: { codigo: true, nome: true, nomeCompleto: true, cnpj: true },
    });
    profissionais
      .filter((item) => onlyDigits(decryptSensitive(item.cnpj)) === cnpjNormalizado)
      .flatMap((item) => [item.codigo, item.nome, item.nomeCompleto])
      .forEach((value) => value && codigos.add(value));

    const pagamentos = await prisma.mapaPagamentoItem.findMany({
      where: ciclo ? { ciclo } : undefined,
      select: { projetistaCodigo: true, responsavel: true, cpfCnpj: true },
    });
    pagamentos
      .filter((item) => onlyDigits(decryptSensitive(item.cpfCnpj)) === cnpjNormalizado)
      .flatMap((item) => [item.projetistaCodigo, item.responsavel])
      .forEach((value) => value && codigos.add(value));
  }

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
