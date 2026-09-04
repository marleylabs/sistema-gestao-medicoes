import "server-only";

import { isDeletedFornecedorIdentityName } from "@/lib/cadastro-fornecedor";
import { generateTempPassword, generateUniqueInternalAccessCode, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptSensitive, encryptSensitive } from "@/lib/encryption";
import { isValidEmail, requiresEmail, EMAIL_REQUIRED_MESSAGE } from "@/lib/usuario-email-policy";
import { isValidPerfil } from "@/lib/perfis";

export type UsuarioSerializado = {
  id: string;
  usuario: string;
  nome: string;
  perfil: string;
  ativo: boolean;
  primeiroLogin: boolean;
  senhaTemporaria: string | null;
  email: string | null;
  ultimoLoginAt: string | null;
  createdAt: string;
};

function serialize(u: {
  id: string; usuario: string; nome: string; perfil: string; ativo: boolean; primeiroLogin: boolean;
  senhaTemporaria: string | null; email: string | null; ultimoLoginAt: Date | null; createdAt: Date;
}): UsuarioSerializado {
  return {
    id: u.id,
    usuario: u.usuario,
    nome: u.nome,
    perfil: u.perfil,
    ativo: u.ativo,
    primeiroLogin: u.primeiroLogin,
    senhaTemporaria: u.primeiroLogin ? u.senhaTemporaria : null,
    email: decryptSensitive(u.email),
    ultimoLoginAt: u.ultimoLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export type CriarUsuarioInternoResult =
  | { ok: true; status: 200 | 201; usuario: UsuarioSerializado }
  | { ok: false; status: number; error: string };

/**
 * Criação de usuário interno com senha inicial automática — mecanismo único usado hoje pela
 * antiga Gestão de Usuários (`/api/admin/usuarios`) e, a partir da unificação, também pelo
 * "Novo funcionário" do Painel Administrativo (`/api/admin/administrativo/funcionarios`).
 *
 * NUNCA aceita perfil COLABORADOR: fornecedor só nasce via máscara/"Novo fornecedor"
 * (`upsertCadastroFornecedor`, que já cria o próprio Usuario) — nunca por este caminho genérico,
 * para não duplicar a pessoa em dois fluxos diferentes.
 */
export async function criarUsuarioInterno(input: { nome: unknown; perfil: unknown; email: unknown }): Promise<CriarUsuarioInternoResult> {
  const nome = typeof input.nome === "string" ? input.nome.trim() : "";
  const perfil = typeof input.perfil === "string" ? input.perfil : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";

  if (nome.length < 3) {
    return { ok: false, status: 400, error: "Informe um nome com pelo menos 3 caracteres." };
  }
  if (!isValidPerfil(perfil)) {
    return { ok: false, status: 400, error: "Perfil inválido." };
  }
  if (perfil === "COLABORADOR") {
    return { ok: false, status: 400, error: "Fornecedor deve ser cadastrado pela importação da máscara ou por \"Novo fornecedor\", nunca por este formulário." };
  }
  if (email && !isValidEmail(email)) {
    return { ok: false, status: 400, error: "E-mail inválido." };
  }
  // Novos usuários sempre nascem ativos — a regra de e-mail obrigatório (MEDICAO/FINANCEIRO) já
  // vale desde a criação.
  if (requiresEmail(perfil, true) && !email) {
    return { ok: false, status: 400, error: EMAIL_REQUIRED_MESSAGE };
  }

  const senha = generateTempPassword();
  const usuarioLogin = await generateUniqueInternalAccessCode();

  const exists = await prisma.usuario.findUnique({ where: { usuario: usuarioLogin } });
  if (await isDeletedFornecedorIdentityName(nome) || (exists?.excluidoAt && await prisma.adminAuditLog.findFirst({
    where: { action: "FORNECEDOR_EXCLUSAO_DEFINITIVA", metadata: { path: ["usuarioId"], equals: exists.id } }, select: { id: true },
  }))) {
    return { ok: false, status: 409, error: "Identidade excluída definitivamente não pode ser reativada." };
  }
  if (exists) {
    if (exists.excluidoAt) {
      const restored = await prisma.usuario.update({
        where: { id: exists.id },
        data: {
          nome,
          perfil,
          ativo: true,
          primeiroLogin: true,
          senhaTemporaria: senha,
          senhaHash: await hashPassword(senha),
          email: email ? encryptSensitive(email) : null,
          excluidoAt: null,
          updatedAt: new Date(),
        },
      });
      return { ok: true, status: 201, usuario: { ...serialize(restored), senhaTemporaria: senha } };
    }
    return { ok: false, status: 409, error: "Já existe um usuário com esse login." };
  }

  const created = await prisma.usuario.create({
    data: {
      usuario: usuarioLogin,
      nome,
      perfil,
      ativo: true,
      primeiroLogin: true,
      senhaTemporaria: senha,
      senhaHash: await hashPassword(senha),
      email: email ? encryptSensitive(email) : null,
    },
  });

  return { ok: true, status: 201, usuario: { ...serialize(created), senhaTemporaria: senha } };
}
