import { Suspense } from "react";
import { redirect } from "next/navigation";
import { MedicoesApp } from "@/components/medicoes-app";
import { getCurrentUser } from "@/lib/auth";
import { getPermissoesExtras } from "@/lib/permissoes-acesso";

/**
 * Tela operacional "Fornecedores" — a antiga "Operação por fornecedor" do Dashboard. Mesma regra de
 * acesso de sempre: só MEDICAO/ADMIN operam o Mapa de Pagamento (as APIs continuam com
 * requireAdmin); os demais perfis voltam para a própria tela inicial, nunca veem esta rota.
 */
export default async function FornecedoresRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["MEDICAO", "ADMIN"].includes(user.perfil)) redirect("/");
  const permissoesExtras = await getPermissoesExtras(user.id);
  return (
    <Suspense>
      <MedicoesApp user={user} permissoesExtras={permissoesExtras} />
    </Suspense>
  );
}
