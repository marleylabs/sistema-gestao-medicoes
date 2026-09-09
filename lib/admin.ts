import "server-only";

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermissao } from "@/lib/permissoes-acesso";

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  }
  if (!["MEDICAO", "ADMIN"].includes(user.perfil)) {
    return { user, response: NextResponse.json({ error: "Acesso restrito ao perfil Medição." }, { status: 403 }) };
  }
  return { user, response: null };
}

export async function requireFinanceiro() {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  }
  if (!["MEDICAO", "ADMIN", "FINANCEIRO", "ADMINISTRATIVO"].includes(user.perfil)) {
    return { user, response: NextResponse.json({ error: "Acesso restrito." }, { status: 403 }) };
  }
  return { user, response: null };
}

export async function requireAdministrativo() {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  }
  // ADMIN e ADMINISTRATIVO continuam liberados de base; qualquer outro perfil (MEDICAO,
  // FINANCEIRO) só passa se tiver a permissão extra ADMINISTRATIVO concedida individualmente
  // (ver lib/permissoes.ts) — nunca liberado para o perfil inteiro. As ações restritas a ADMIN
  // literal dentro do módulo (redefinir senha, excluir, alterar perfil, resolução de identidade,
  // conceder permissões) fazem sua própria checagem extra depois desta, sem depender daqui.
  if (!["ADMIN", "ADMINISTRATIVO"].includes(user.perfil) && !(await hasPermissao(user, "ADMINISTRATIVO"))) {
    return { user, response: NextResponse.json({ error: "Acesso restrito ao Administrativo." }, { status: 403 }) };
  }
  return { user, response: null };
}
