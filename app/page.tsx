import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ColaboradorApp } from "@/components/colaborador-app";
import { FiscalApp } from "@/components/timesheet/fiscal-app";
import { MedicoesApp } from "@/components/medicoes-app";
import { getCurrentUser } from "@/lib/auth";
import { getPermissoesExtras } from "@/lib/permissoes-acesso";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.perfil === "COLABORADOR") return <ColaboradorApp user={user} />;
  // O fiscal do contrato só aprova horas do timesheet: tela própria, nunca o app da equipe interna.
  if (user.perfil === "FISCAL") return <FiscalApp user={user} />;
  // Lida junto com o próprio usuário (uma vez por carregamento de página, nunca por render do
  // cliente) — getCurrentUser() já relê o banco a cada request, então uma permissão concedida ou
  // revogada por um ADMIN passa a valer no próximo carregamento, sem exigir logout/login.
  const permissoesExtras = await getPermissoesExtras(user.id);
  return (
    <Suspense>
      <MedicoesApp user={user} permissoesExtras={permissoesExtras} />
    </Suspense>
  );
}
