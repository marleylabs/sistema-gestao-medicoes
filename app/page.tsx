import { redirect } from "next/navigation";
import { ColaboradorApp } from "@/components/colaborador-app";
import { MedicoesApp } from "@/components/medicoes-app";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.perfil === "COLABORADOR") return <ColaboradorApp user={user} />;
  return <MedicoesApp user={user} />;
}
