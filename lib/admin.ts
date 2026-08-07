import "server-only";

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

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
  if (!["ADMIN", "ADMINISTRATIVO"].includes(user.perfil)) {
    return { user, response: NextResponse.json({ error: "Acesso restrito ao Administrativo." }, { status: 403 }) };
  }
  return { user, response: null };
}
