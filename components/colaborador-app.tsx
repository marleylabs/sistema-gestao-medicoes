"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, CheckCircle2, ChevronDown, FileText, LogOut, RefreshCw, UserRound } from "lucide-react";
import { Button, IconButton, Textarea } from "@/components/ui";
import type { AuthUser } from "@/lib/session";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

type ColaboradorData = {
  usuario: {
    codigo: string;
    nome: string;
    cpf: string | null;
    cnpj: string | null;
    razaoSocial: string | null;
    email: string | null;
    funcao: string | null;
    statusColaborador: string | null;
  };
  alocacao: {
    ato: string | null;
    intrSossego: number;
    salobo: number;
    acg: number;
    escadasAlumar: number;
  } | null;
  pagamento: {
    valor: number;
    rev: number;
    responsavel: string | null;
    razaoSocial: string | null;
  } | null;
  documentos: Array<{
    id: string;
    projetoReferente: string;
    tituloPrimario: string | null;
    dataCadastro: string | null;
    formato: string | null;
    quantidade: number;
    equivalenteA1Horas: number;
    valorMedicao: number;
  }>;
  sgc: {
    status: string;
    revisaoNumero: number;
    revisaoLabel: string | null;
    pontosDiscordancia: string | null;
    aprovadoAt: string | null;
    revisaoSolicitadaAt: string | null;
    reenviadoAt: string | null;
  };
};

function dateLabel(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T00:00:00`));
}

function ratio(value: number) {
  return value ? percent.format(value) : "-";
}

function statusText(status: string) {
  if (status === "APROVADO") return "Medição aprovada";
  if (status === "REVISAO_SOLICITADA") return "Revisão solicitada";
  return "Pendente de validação";
}

function InfoCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[#d8dee8] bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[#F5F5F5] text-[#AF1B1B]">{icon}</span>
        <h2 className="text-base font-bold text-[#1A1A1A]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase text-[#1A1A1A]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[#1A1A1A]">{value || "-"}</div>
    </div>
  );
}

export function ColaboradorApp({ user }: { user: AuthUser }) {
  const [data, setData] = useState<ColaboradorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [pontosDiscordancia, setPontosDiscordancia] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const canValidate = data?.sgc.status === "PENDENTE";

  const contratos = useMemo(() => {
    if (!data?.alocacao) return [];
    return [
      ["Intr. Sossego", data.alocacao.intrSossego],
      ["Salobo", data.alocacao.salobo],
      ["ACG", data.alocacao.acg],
      ["Escadas Alumar", data.alocacao.escadasAlumar],
    ].filter(([, value]) => Number(value) > 0);
  }, [data]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/colaborador/me");
    setData(await response.json());
    setLoading(false);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  async function sendSgc(action: "APROVAR" | "SOLICITAR_REVISAO") {
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/colaborador/sgc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, pontosDiscordancia }),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setMessage(payload.error ?? "Não foi possível atualizar a validação.");
      return;
    }
    setRevisionOpen(false);
    setPontosDiscordancia("");
    setMessage(action === "APROVAR" ? "Medição aprovada com sucesso." : "Solicitação de revisão enviada para a equipe de Medição.");
    await loadData();
  }

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading || !data) {
    return <main className="min-h-screen bg-[#F5F5F5] p-6 text-sm text-[#1A1A1A]">Carregando ambiente do colaborador...</main>;
  }

  return (
    <main className="min-h-screen bg-[#F5F5F5]">
      <header className="sticky top-0 z-40 border-b border-[#d8dee8] bg-white/95 shadow-sm backdrop-blur">
        <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-[#1A1A1A]">Portal do Colaborador</h1>
            <p className="text-xs text-[#1A1A1A]">Validação SGC da medição do ciclo</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={loadData} className="hidden sm:inline-flex">
              <RefreshCw size={16} />
              Atualizar
            </Button>
            <div className="hidden text-right md:block">
              <div className="text-sm font-semibold text-[#1A1A1A]">{user.nome}</div>
              <div className="text-xs text-[#1A1A1A]">{user.usuario}</div>
            </div>
            <IconButton onClick={logout} title="Sair da plataforma">
              <LogOut size={17} />
            </IconButton>
          </div>
        </div>
      </header>

      <div className="grid gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-[#d8dee8] bg-white p-5">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <div className="text-sm font-semibold text-[#AF1B1B]">Sistema SGC</div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-[#1A1A1A]">{statusText(data.sgc.status)}</h2>
                {data.sgc.revisaoLabel ? (
                  <span className="rounded-md bg-[#F5F5F5] px-2 py-1 text-xs font-bold text-[#AF1B1B]">{data.sgc.revisaoLabel}</span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-[#1A1A1A]">Confira os dados apresentados e registre sua conformidade ou pontos de discordância.</p>
            </div>
            <span className="inline-flex w-fit rounded-md bg-[#F5F5F5] px-3 py-1 text-sm font-bold text-[#AF1B1B]">{data.sgc.status}</span>
          </div>

          {message ? <div className="mt-4 rounded-md bg-[#F5F5F5] px-3 py-2 text-sm font-semibold text-[#AF1B1B]">{message}</div> : null}
          {data.sgc.pontosDiscordancia ? (
            <div className="mt-4 rounded-md border border-[#AF1B1B] bg-[#F5F5F5] p-3">
              <div className="text-sm font-bold text-[#AF1B1B]">Pontos de discordância enviados</div>
              <p className="mt-1 text-sm text-[#1A1A1A]">{data.sgc.pontosDiscordancia}</p>
            </div>
          ) : null}

          {canValidate ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(180px,240px)_minmax(220px,280px)]">
              <Button className="h-11 bg-[#16A34A] text-base shadow-sm hover:bg-[#15803D] focus:ring-[#16A34A]/40" onClick={() => sendSgc("APROVAR")} disabled={saving}>
                <CheckCircle2 size={16} />
                Aprovar
              </Button>
              <Button
                className="h-11 border-[#F2C94C] bg-[#F2C94C] text-[#1A1A1A] shadow-sm hover:bg-[#E0B83F] focus:ring-[#F2C94C]/40"
                onClick={() => setRevisionOpen((value) => !value)}
                disabled={saving}
              >
                <AlertTriangle size={17} />
                Solicitar revisão
              </Button>
            </div>
          ) : (
            <div className="mt-5 rounded-md border border-[#d8dee8] bg-[#F5F5F5] px-3 py-2 text-sm font-semibold text-[#1A1A1A]">
              {data.sgc.status === "REVISAO_SOLICITADA"
                ? "A solicitação foi enviada. Aguarde a equipe de Medição reenviar a medição revisada."
                : "A medição já foi aprovada para este ciclo."}
            </div>
          )}

          {canValidate && revisionOpen ? (
            <div className="mt-5 grid gap-3 rounded-lg border border-[#AF1B1B] bg-[#F5F5F5] p-4">
              <div>
                <h3 className="text-base font-bold text-[#1A1A1A]">Solicitação de revisão</h3>
                <p className="mt-1 text-sm text-[#1A1A1A]">Descreva os pontos de discordância para que a equipe de Medição possa analisar.</p>
              </div>
              <label className="grid gap-1 text-sm font-semibold text-[#1A1A1A]">
                <span>Pontos de Discordância</span>
                <Textarea
                  className="min-h-28 bg-white"
                  value={pontosDiscordancia}
                  onChange={(event) => setPontosDiscordancia(event.target.value)}
                  placeholder="Descreva onde e por que os dados estão incorretos."
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button className="bg-[#16A34A] hover:bg-[#15803D] focus:ring-[#16A34A]/40" onClick={() => sendSgc("SOLICITAR_REVISAO")} disabled={saving}>
                  Enviar revisão
                </Button>
                <Button className="border-[#cfd7e3] bg-white text-[#1A1A1A] hover:bg-[#eef1f5]" onClick={() => setRevisionOpen(false)} disabled={saving}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <div className="grid gap-4 xl:grid-cols-3">
          <InfoCard title="Dados pessoais" icon={<UserRound size={18} />}>
            <div className="grid gap-3">
              <Field label="Código" value={data.usuario.codigo} />
              <Field label="Nome" value={data.usuario.nome} />
              <Field label="CPF / CNPJ" value={data.usuario.cpf || data.usuario.cnpj} />
              <Field label="Razão social" value={data.usuario.razaoSocial} />
              <Field label="E-mail" value={data.usuario.email} />
              <Field label="Função" value={data.usuario.funcao} />
            </div>
          </InfoCard>

          <InfoCard title="Alocação" icon={<FileText size={18} />}>
            <div className="grid gap-3">
              <Field label="Alocação principal" value={data.alocacao?.ato} />
              <Field label="Contratos" value={contratos.length ? contratos.map(([label, value]) => `${label}: ${ratio(Number(value))}`).join(" | ") : "-"} />
              <Field label="Atuação" value={data.usuario.statusColaborador} />
            </div>
          </InfoCard>

          <InfoCard title="Informações de pagamento" icon={<Banknote size={18} />}>
            <div className="grid gap-3">
              <Field label="Valor previsto" value={currency.format(data.pagamento?.valor ?? 0)} />
              <Field label="Revisão" value={data.pagamento?.rev ? currency.format(data.pagamento.rev) : "-"} />
              <Field label="Responsável" value={data.pagamento?.responsavel} />
              <Field label="Empresa" value={data.pagamento?.razaoSocial} />
            </div>
          </InfoCard>
        </div>

        <section className="overflow-hidden rounded-lg border border-[#d8dee8] bg-white">
          <button
            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
            onClick={() => setDocumentsOpen((value) => !value)}
          >
            <div>
              <h2 className="text-lg font-bold text-[#1A1A1A]">Documentos da Medição do Ciclo</h2>
              <p className="text-sm text-[#1A1A1A]">{data.documentos.length} documentos vinculados ao código {data.usuario.codigo}.</p>
            </div>
            <ChevronDown className={documentsOpen ? "rotate-180 transition" : "transition"} size={19} />
          </button>

          {documentsOpen ? (
            <div className="overflow-auto border-t border-[#d8dee8]">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead className="bg-[#F5F5F5]">
                  <tr>
                    <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Projeto referente</th>
                    <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Título primário</th>
                    <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Data de cadastro</th>
                    <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Formato</th>
                  </tr>
                </thead>
                <tbody>
                  {data.documentos.map((documento) => (
                    <tr key={documento.id} className="border-b border-[#edf1f6] last:border-0">
                      <td className="px-3 py-3 font-semibold text-[#1A1A1A]">{documento.projetoReferente}</td>
                      <td className="px-3 py-3 text-[#1A1A1A]">{documento.tituloPrimario ?? "-"}</td>
                      <td className="px-3 py-3 text-[#1A1A1A]">{dateLabel(documento.dataCadastro)}</td>
                      <td className="px-3 py-3 text-[#1A1A1A]">{documento.formato ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
