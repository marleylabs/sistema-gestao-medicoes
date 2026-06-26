"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  FileUp,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  UserRound,
  History,
  RotateCcw,
  Save,
  Send,
  X,
} from "lucide-react";
import { BoletimMedicao, type BmData } from "@/components/boletim-medicao";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, IconButton, Textarea } from "@/components/ui";
import type { AuthUser } from "@/lib/session";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent  = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

type ColaboradorData = {
  usuario: {
    codigo: string; nome: string; cpf: string | null; cnpj: string | null;
    razaoSocial: string | null; email: string | null; funcao: string | null; statusColaborador: string | null;
  };
  alocacao: { ato: string | null; intrSossego: number; salobo: number; acg: number; escadasAlumar: number; } | null;
  pagamento: { valor: number; rev: number; responsavel: string | null; razaoSocial: string | null; } | null;
  documentos: Array<{
    id: string; projetoReferente: string; tituloPrimario: string | null;
    dataCadastro: string | null; formato: string | null; quantidade: number;
    equivalenteA1Horas: number; valorMedicao: number; percentualEmissao: number;
    numeroDocumento: string | null; contrato: string | null; tipo2: string | null;
    condicao: string | null; precoUnitario: number; valorMedido: number; obs: string | null;
  }>;
  sgc: {
    status: string; revisaoNumero: number; revisaoLabel: string | null;
    pontosDiscordancia: string | null; respostaAdmin: string | null;
    aprovadoAt: string | null; revisaoSolicitadaAt: string | null; reenviadoAt: string | null;
  };
};

function dateLabel(v: string | null) {
  if (!v) return "–";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${v}T00:00:00`));
}

function ratio(v: number) { return v ? percent.format(v) : "–"; }

function statusConfig(status: string) {
  if (status === "APROVADO")           return { label: "Medição aprovada",        badge: "success" as const };
  if (status === "AGUARDANDO_NF")      return { label: "Aguardando envio da NF",  badge: "warning" as const };
  if (status === "REVISAO_SOLICITADA") return { label: "Revisão solicitada",      badge: "warning" as const };
  if (status === "AGUARDANDO_ENVIO")   return { label: "Aguardando envio do BM",  badge: "neutral" as const };
  if (status === "CANCELADO")          return { label: "BM cancelado",            badge: "neutral" as const };
  return                                      { label: "Pendente de validação",   badge: "neutral" as const };
}

// ─── InfoCard ─────────────────────────────────────────────────────────────────

function InfoCard({ title, icon, iconBg, iconColor, children }: {
  title: string; icon: React.ReactNode; iconBg: string; iconColor: string; children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${iconBg} ${iconColor}`}>{icon}</span>
        <h2 className="text-sm font-bold text-[#1A1A1A]">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-[#F3F4F6] last:border-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF] shrink-0">{label}</span>
      <span className="text-sm font-medium text-[#1A1A1A] text-right">{value || "–"}</span>
    </div>
  );
}

// ─── ColaboradorApp ───────────────────────────────────────────────────────────

type MedicaoAprovada = BmData & { id: string; status?: string; nfArquivoNome?: string | null; nfCarregadoAt?: string | null; comprovanteArquivoNome?: string | null; comprovanteCarregadoAt?: string | null; };

type Section = "portal" | "medicoes";

export function ColaboradorApp({ user }: { user: AuthUser }) {
  const [section, setSection]               = useState<Section>("portal");
  const [data, setData]                     = useState<ColaboradorData | null>(null);
  const [loading, setLoading]               = useState(true);
  const [medicoes, setMedicoes]             = useState<MedicaoAprovada[]>([]);
  const [medLoading, setMedLoading]         = useState(false);
  const [documentsOpen, setDocumentsOpen]   = useState(false);
  const [revisionOpen, setRevisionOpen]     = useState(false);
  const [pontos, setPontos]                 = useState("");
  const [message, setMessage]               = useState<{ text: string; type: "success" | "info" } | null>(null);
  const [saving, setSaving]                 = useState(false);
  const [nfFile, setNfFile]                 = useState<File | null>(null);
  const [nfUploading, setNfUploading]       = useState(false);
  const [observacao, setObservacao]         = useState("");
  const [salvoAt, setSalvoAt]               = useState<string | null>(null);

  const canValidate = data?.sgc.status === "PENDENTE";
  const { label: statusLabel, badge: statusBadge } = data ? statusConfig(data.sgc.status) : { label: "", badge: "neutral" as const };

  const contratos = useMemo(() => {
    if (!data?.alocacao) return [];
    return ([
      ["Intr. Sossego", data.alocacao.intrSossego],
      ["Salobo",        data.alocacao.salobo],
      ["ACG",           data.alocacao.acg],
      ["Escadas Alumar",data.alocacao.escadasAlumar],
    ] as [string, number][]).filter(([, v]) => v > 0);
  }, [data]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/colaborador/me");
    setData(await res.json());
    setLoading(false);
  }, []);

  const loadMedicoes = useCallback(async () => {
    setMedLoading(true);
    const res = await fetch("/api/colaborador/medicoes");
    const json = await res.json();
    setMedicoes(json.medicoes ?? []);
    setMedLoading(false);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.assign("/login");
  }

  async function sendSgc(action: "SALVAR" | "ENVIAR" | "VOLTAR" | "CANCELAR" | "SOLICITAR_REVISAO") {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/colaborador/sgc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, observacao, pontosDiscordancia: pontos }),
    });
    const payload = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setMessage({ text: payload.error ?? "Não foi possível atualizar a validação.", type: "info" });
      return;
    }
    if (action === "SALVAR") {
      setSalvoAt(payload.salvoAt ?? new Date().toISOString());
      setMessage({ text: "BM salvo com sucesso. Clique em Enviar quando estiver pronto.", type: "success" });
      return;
    }
    setRevisionOpen(false);
    setPontos("");
    const msgs: Record<string, string> = {
      ENVIAR: "BM enviado com sucesso. Aguardando envio da Nota Fiscal.",
      VOLTAR: "BM retornado para revisão.",
      CANCELAR: "BM cancelado.",
      SOLICITAR_REVISAO: "Solicitação de revisão enviada para a equipe de Medição.",
    };
    setMessage({ text: msgs[action] ?? "Operação realizada.", type: "success" });
    await loadData();
  }

  async function uploadNf() {
    if (!nfFile) return;
    setNfUploading(true);
    setMessage(null);
    const form = new FormData();
    form.append("nf", nfFile);
    const res = await fetch("/api/colaborador/nf", { method: "POST", body: form });
    const payload = await res.json().catch(() => ({}));
    setNfUploading(false);
    if (!res.ok) {
      setMessage({ text: payload.error ?? "Erro ao enviar a NF.", type: "info" });
      return;
    }
    setNfFile(null);
    setMessage({ text: "Nota fiscal enviada com sucesso. Medição marcada como aprovada.", type: "success" });
    await loadData();
  }

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (section === "medicoes") loadMedicoes(); }, [section, loadMedicoes]);

  if (loading || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F5F5]">
        <div className="flex items-center gap-3 text-sm text-[#555555]">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#2563EB]" />
          Carregando ambiente do colaborador…
        </div>
      </div>
    );
  }

  const navItems = [
    { id: "portal",   label: "Portal",           icon: <LayoutDashboard size={17} /> },
    { id: "medicoes", label: "Minhas Medições",  icon: <History size={17} /> },
  ];

  const topBar = (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={loadData} className="hidden sm:inline-flex">
        <RefreshCw size={14} />
        Atualizar
      </Button>
      <div className="hidden text-right md:block">
        <p className="text-sm font-semibold text-[#1A1A1A]">{user.nome}</p>
        <p className="text-xs text-[#555555]">{user.usuario}</p>
      </div>
      <IconButton onClick={logout} title="Sair"><LogOut size={15} /></IconButton>
    </div>
  );

  const aguardando = data.sgc.status === "AGUARDANDO_ENVIO";

  const TITLES: Record<Section, string> = { portal: "Portal do Colaborador", medicoes: "Minhas Medições" };

  return (
    <AppShell activeSection={section} onNavigate={(id) => setSection(id as Section)} navItems={navItems} pageTitle={TITLES[section]} topBarRight={topBar}>
      <div className="grid gap-5">

        {/* ── Portal ── */}
        {/* ── Aguardando envio ── */}
        {section === "portal" && aguardando && (
          <Card className="p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-[#9CA3AF]">
              <Clock size={30} />
            </div>
            <h2 className="text-lg font-bold text-[#1A1A1A]">Aguardando o envio do BM</h2>
            <p className="mt-2 text-sm text-[#555555]">
              Sua medição ainda não foi disponibilizada pela equipe de Medição.
              <br />
              Assim que for enviada, você poderá visualizar e validar os dados aqui.
            </p>
            <p className="mt-4 text-xs text-[#9CA3AF]">
              Caso tenha dúvidas, entre em contato com a equipe responsável.
            </p>
          </Card>
        )}

        {/* ── Conteúdo visível após envio do BM ── */}
        {section === "portal" && !aguardando && <>
        <Card className="p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#AF1B1B]">SISTEMA APROVAÇÃO</p>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-[#1A1A1A]">{statusLabel}</h2>
                {data.sgc.revisaoLabel && <Badge variant="brand">{data.sgc.revisaoLabel}</Badge>}
              </div>
              <p className="mt-1.5 text-sm text-[#555555]">
                Confira os dados apresentados e registre sua conformidade ou pontos de discordância.
              </p>
            </div>
            <Badge variant={statusBadge} className="shrink-0 px-3 py-1 text-xs">
              {data.sgc.status}
            </Badge>
          </div>

          {/* Feedback message */}
          {message && (
            <div className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${message.type === "success" ? "bg-[#F0FDF4] text-[#16A34A]" : "bg-[#EFF6FF] text-[#2563EB]"}`}>
              {message.text}
            </div>
          )}

          {/* Previous discordance */}
          {data.sgc.pontosDiscordancia && (
            <div className="mt-4 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] p-4">
              <p className="text-sm font-bold text-[#DC2626]">Pontos de discordância enviados</p>
              <p className="mt-1 text-sm text-[#1A1A1A]">{data.sgc.pontosDiscordancia}</p>
            </div>
          )}

          {/* Resposta do admin */}
          {data.sgc.respostaAdmin && (
            <div className="mt-3 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#2563EB]">Resposta da equipe de Medição</p>
              <p className="mt-1.5 text-sm leading-relaxed text-[#1A1A1A]">{data.sgc.respostaAdmin}</p>
            </div>
          )}

          {/* Link para Minhas Medições quando aprovado */}
          {data.sgc.status === "APROVADO" && (
            <div className="mt-5 flex items-center justify-between rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3">
              <p className="text-sm text-[#15803D]">Acesse <strong>Minhas Medições</strong> para ver todos os detalhes desta aprovação.</p>
              <Button variant="success" className="shrink-0" onClick={() => setSection("medicoes")}>
                <History size={14} />
                Ver medições
              </Button>
            </div>
          )}

          {/* NF Upload (AGUARDANDO_NF) */}
          {data.sgc.status === "AGUARDANDO_NF" && (
            <div className="mt-5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-5">
              <div className="mb-3 flex items-center gap-2">
                <FileUp size={16} className="text-[#D97706]" />
                <h3 className="text-sm font-bold text-[#1A1A1A]">Envio da Nota Fiscal</h3>
              </div>
              <p className="mb-4 text-sm text-[#555555]">
                Sua medição foi aprovada. Para finalizar o processo, faça o upload da Nota Fiscal referente a esta medição.
                Formatos aceitos: PDF, JPG ou PNG (máx. 10 MB).
              </p>
              <label className="block">
                <span className="sr-only">Nota Fiscal</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="block w-full text-sm text-[#555555] file:mr-4 file:rounded-lg file:border-0 file:bg-[#D97706] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#B45309]"
                  onChange={(e) => setNfFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {nfFile && (
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-xs text-[#555555]">{nfFile.name} ({(nfFile.size / 1024).toFixed(0)} KB)</span>
                  <Button variant="success" className="h-9 px-5" onClick={uploadNf} disabled={nfUploading}>
                    {nfUploading ? "Enviando…" : "Enviar NF"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          {canValidate ? (
            <div className="mt-5 space-y-3">
              {/* Observação */}
              <div>
                <Textarea
                  className="min-h-20 bg-white text-sm"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Observação (opcional) — registrada no histórico ao Salvar."
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" className="h-10 px-5" onClick={() => sendSgc("SALVAR")} disabled={saving}>
                  <Save size={15} />
                  Salvar
                </Button>
                <Button
                  variant="success"
                  className="h-10 px-6"
                  onClick={() => sendSgc("ENVIAR")}
                  disabled={saving || !salvoAt}
                  title={!salvoAt ? "Salve primeiro para habilitar o Envio" : undefined}
                >
                  <Send size={15} />
                  Enviar
                </Button>
                <Button
                  variant="ghost"
                  className="h-10 border border-[#F59E0B] bg-[#FFFBEB] px-5 text-[#D97706] hover:bg-[#FEF3C7]"
                  onClick={() => setRevisionOpen((v) => !v)}
                  disabled={saving}
                >
                  <AlertTriangle size={15} />
                  Solicitar revisão
                </Button>
                <Button
                  variant="ghost"
                  className="h-10 border border-[#E5E7EB] px-5 text-[#6B7280] hover:bg-[#F9FAFB]"
                  onClick={() => sendSgc("CANCELAR")}
                  disabled={saving}
                >
                  <X size={15} />
                  Cancelar BM
                </Button>
              </div>
              {!salvoAt && (
                <p className="text-xs text-[#9CA3AF]">
                  Clique em <strong>Salvar</strong> para registrar e depois em <strong>Enviar</strong> para confirmar.
                </p>
              )}
            </div>
          ) : data.sgc.status === "AGUARDANDO_NF" ? null : data.sgc.status === "REVISAO_SOLICITADA" ? (
            <div className="mt-5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#555555]">
              Solicitação enviada. Aguarde a equipe de Medição reenviar a medição revisada.
            </div>
          ) : data.sgc.status === "CANCELADO" ? (
            <div className="mt-5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#555555]">
              Este BM foi cancelado.
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#555555]">
              A medição já foi aprovada para este ciclo.
            </div>
          )}

          {/* Voltar BM — disponível quando AGUARDANDO_NF */}
          {data.sgc.status === "AGUARDANDO_NF" && (
            <div className="mt-4 flex justify-end">
              <Button
                variant="ghost"
                className="h-9 border border-[#E5E7EB] px-4 text-xs text-[#6B7280] hover:bg-[#F9FAFB]"
                onClick={() => sendSgc("VOLTAR")}
                disabled={saving}
              >
                <RotateCcw size={13} />
                Voltar BM
              </Button>
            </div>
          )}

          {/* Revision form */}
          {canValidate && revisionOpen && (
            <div className="mt-5 rounded-xl border border-[#F59E0B] bg-[#FFFBEB] p-5">
              <h3 className="text-sm font-bold text-[#1A1A1A]">Solicitação de revisão</h3>
              <p className="mt-1 text-sm text-[#555555]">Descreva os pontos de discordância para análise da equipe de Medição.</p>
              <div className="mt-3">
                <Textarea
                  className="min-h-28 bg-white"
                  value={pontos}
                  onChange={(e) => setPontos(e.target.value)}
                  placeholder="Descreva onde e por que os dados estão incorretos."
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="success" onClick={() => sendSgc("SOLICITAR_REVISAO")} disabled={saving}>
                  {saving ? "Enviando…" : "Enviar revisão"}
                </Button>
                <Button variant="ghost" onClick={() => setRevisionOpen(false)} disabled={saving}>Cancelar</Button>
              </div>
            </div>
          )}
        </Card>

        {/* ── Info cards e documentos (ocultos quando aprovado) ── */}

        <div className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${data.sgc.status === "APROVADO" ? "hidden" : ""}`}>
          <InfoCard title="Dados pessoais" icon={<UserRound size={17} />} iconBg="bg-[#EFF6FF]" iconColor="text-[#2563EB]">
            <div>
              <FieldRow label="Código"       value={data.usuario.codigo} />
              <FieldRow label="Nome"         value={data.usuario.nome} />
              <FieldRow label="CPF / CNPJ"   value={data.usuario.cpf || data.usuario.cnpj} />
              <FieldRow label="Razão social" value={data.usuario.razaoSocial} />
              <FieldRow label="E-mail"       value={data.usuario.email} />
              <FieldRow label="Função"       value={data.usuario.funcao} />
            </div>
          </InfoCard>

          <InfoCard title="Alocação" icon={<FileText size={17} />} iconBg="bg-[#FFFBEB]" iconColor="text-[#D97706]">
            <div>
              <FieldRow label="Alocação principal" value={data.alocacao?.ato} />
              <FieldRow
                label="Contratos"
                value={contratos.length ? contratos.map(([l, v]) => `${l}: ${ratio(v)}`).join(" · ") : "–"}
              />
              <FieldRow label="Atuação" value={data.usuario.statusColaborador} />
            </div>
          </InfoCard>

          <InfoCard title="Informações de pagamento" icon={<Banknote size={17} />} iconBg="bg-[#F0FDF4]" iconColor="text-[#16A34A]">
            <div>
              <FieldRow label="Valor previsto" value={currency.format(data.pagamento?.valor ?? 0)} />
              <FieldRow label="Revisão"        value={data.pagamento?.rev ? currency.format(data.pagamento.rev) : "–"} />
              <FieldRow label="Responsável"    value={data.pagamento?.responsavel} />
              <FieldRow label="Empresa"        value={data.pagamento?.razaoSocial} />
            </div>
          </InfoCard>
        </div>

        {/* ── Documents (oculto quando aprovado) ── */}
        <Card className={`overflow-hidden ${data.sgc.status === "APROVADO" ? "hidden" : ""}`}>
          <button
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[#FAFAFA]"
            onClick={() => setDocumentsOpen((v) => !v)}
          >
            <div>
              <h2 className="text-sm font-bold text-[#1A1A1A]">Documentos da Medição do Ciclo</h2>
              <p className="mt-0.5 text-sm text-[#555555]">
                {data.documentos.length} documentos vinculados ao código {data.usuario.codigo}.
              </p>
            </div>
            <ChevronDown className={`shrink-0 text-[#9CA3AF] transition-transform duration-200 ${documentsOpen ? "rotate-180" : ""}`} size={18} />
          </button>

          {documentsOpen && (() => {
            const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
            const fmtN = (v: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(v);
            const fmtP = (v: number) => new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(v);
            const hasObs = data.documentos.some((d) => d.obs);
            const headers = ["SE", "NR VALE / Projeto", "CTO", "Formato", "A1eq / HH", "% Emissão", "Tipo DG/DOC/HH", "Preço Unit.", "Valor Medido", "Total", ...(hasObs ? ["Observação"] : [])];
            return (
              <div className="overflow-auto border-t border-[#E5E7EB]">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F9FAFB]">
                      {headers.map((h) => (
                        <th key={h} className="whitespace-nowrap border-b border-[#E5E7EB] px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-[#555555]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.documentos.map((d, i) => {
                      const valorMedido = d.valorMedido ?? (d.equivalenteA1Horas * (parseFloat(d.condicao ?? "0") || 0) * d.percentualEmissao);
                      return (
                        <tr key={d.id} className={`border-b border-[#F3F4F6] last:border-0 hover:bg-[#FAFAFA] ${i % 2 !== 0 ? "bg-[#FAFAFA]" : ""}`}>
                          <td className="px-4 py-3 font-medium text-[#1A1A1A]">{d.projetoReferente}</td>
                          <td className="px-4 py-3 text-[#555555]">{d.numeroDocumento ?? "–"}</td>
                          <td className="px-4 py-3 text-[#555555]">{d.contrato ?? "–"}</td>
                          <td className="px-4 py-3 text-[#555555]">{d.formato ?? "–"}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{fmtN(d.equivalenteA1Horas)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{d.percentualEmissao ? fmtP(d.percentualEmissao) : "100%"}</td>
                          <td className="px-4 py-3 text-[#555555]">{d.tipo2 ?? "–"}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{d.precoUnitario ? currency.format(d.precoUnitario) : (d.condicao ?? "–")}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{currency.format(valorMedido)}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#1A1A1A]">{currency.format(valorMedido)}</td>
                          {hasObs && <td className="px-4 py-3 text-[#555555]">{d.obs ?? ""}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                  {data.documentos.length > 0 && (() => {
                    const total = data.documentos.reduce((s, d) => s + (d.valorMedido ?? 0), 0);
                    return (
                      <tfoot>
                        <tr className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB]">
                          <td colSpan={8} className="px-4 py-2.5 text-right text-xs font-bold text-[#555555]">Total medido:</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs font-bold text-[#1A1A1A]">{currency.format(total)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs font-bold text-[#1A1A1A]">{currency.format(total)}</td>
                          {hasObs && <td />}
                        </tr>
                      </tfoot>
                    );
                  })()}
                </table>
              </div>
            );
          })()}
        </Card>
        </>}

        {/* ── Minhas Medições ── */}
        {section === "medicoes" && (
          medLoading ? (
            <div className="flex items-center justify-center py-20 text-sm text-[#555555]">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#2563EB]" />
                Carregando medições…
              </div>
            </div>
          ) : medicoes.length === 0 ? (
            <Card className="p-10 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-[#9CA3AF]">
                <History size={30} />
              </div>
              <h2 className="text-lg font-bold text-[#1A1A1A]">Nenhuma medição disponível</h2>
              <p className="mt-2 text-sm text-[#555555]">
                As medições aprovadas ou aguardando NF aparecerão aqui.
              </p>
            </Card>
          ) : (
            <div className="grid gap-5">
              {medicoes.map((med) => (
                <MedicaoAprovadaCard key={med.id} med={med} onReload={loadMedicoes} />
              ))}
            </div>
          )
        )}
      </div>
    </AppShell>
  );
}

// ─── MedicaoAprovadaCard ──────────────────────────────────────────────────────

function MedicaoAprovadaCard({ med, onReload }: { med: MedicaoAprovada; onReload: () => void }) {
  const cur = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const [bmOpen, setBmOpen] = useState(false);
  const [nfFile, setNfFile] = useState<File | null>(null);
  const [nfUploading, setNfUploading] = useState(false);
  const [nfError, setNfError] = useState<string | null>(null);

  const isAguardandoNf = med.status === "AGUARDANDO_NF";

  const aprovadoLabel = med.aprovadoAt
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(med.aprovadoAt))
    : "–";

  const nfEnviadaLabel = med.nfCarregadoAt
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(med.nfCarregadoAt))
    : null;

  const totalValor = (med.pagamento?.valor ?? 0) + (med.pagamento?.rev ?? 0);

  async function uploadNf() {
    if (!nfFile) return;
    setNfUploading(true);
    setNfError(null);
    const form = new FormData();
    form.append("nf", nfFile);
    const res = await fetch("/api/colaborador/nf", { method: "POST", body: form });
    const payload = await res.json().catch(() => ({}));
    setNfUploading(false);
    if (!res.ok) { setNfError(payload.error ?? "Erro ao enviar a NF."); return; }
    setNfFile(null);
    onReload();
  }

  const headerBg = isAguardandoNf ? "border-[#FDE68A] bg-[#FFFBEB]" : "border-[#BBF7D0] bg-[#F0FDF4]";
  const iconBg   = isAguardandoNf ? "bg-[#D97706]/10 text-[#D97706]" : "bg-[#16A34A]/10 text-[#16A34A]";
  const titleColor = isAguardandoNf ? "text-[#92400E]" : "text-[#15803D]";
  const subColor   = isAguardandoNf ? "text-[#D97706]" : "text-[#16A34A]";
  const StatusIcon = isAguardandoNf ? FileUp : CheckCircle2;

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className={`border-b px-5 py-4 ${headerBg}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>
              <StatusIcon size={18} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className={`text-sm font-bold ${titleColor}`}>
                  {isAguardandoNf ? "Aguardando NF" : "Medição Aprovada"} — Ciclo {med.ciclo}
                </p>
                {med.revisaoLabel && <Badge variant={isAguardandoNf ? "warning" : "success"} className="shrink-0">{med.revisaoLabel}</Badge>}
              </div>
              <p className={`text-xs ${subColor}`}>
                {isAguardandoNf ? "Envie a Nota Fiscal para concluir" : `Aprovado em ${aprovadoLabel}`}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">Valor total</p>
            <p className="text-base font-bold text-[#1A1A1A]">{cur.format(totalValor)}</p>
          </div>
        </div>
      </div>

      {/* NF status / upload */}
      {isAguardandoNf && (
        <div className="border-b border-[#FDE68A] bg-[#FFFBEB] px-5 py-4">
          <p className="mb-3 text-sm font-semibold text-[#92400E]">Envio da Nota Fiscal</p>
          <label className="block">
            <span className="sr-only">Nota Fiscal</span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="block w-full text-sm text-[#555555] file:mr-4 file:rounded-lg file:border-0 file:bg-[#D97706] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#B45309]"
              onChange={(e) => { setNfFile(e.target.files?.[0] ?? null); setNfError(null); }}
            />
          </label>
          {nfFile && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-[#555555]">{nfFile.name} ({(nfFile.size / 1024).toFixed(0)} KB)</span>
              <Button variant="success" className="h-9 px-5" onClick={uploadNf} disabled={nfUploading}>
                {nfUploading ? "Enviando…" : "Enviar NF"}
              </Button>
            </div>
          )}
          {nfError && <p className="mt-2 text-xs text-[#B91C1C]">{nfError}</p>}
        </div>
      )}

      {!isAguardandoNf && med.nfArquivoNome && (
        <div className="flex items-center gap-3 border-b border-[#BBF7D0] bg-[#F0FDF4] px-5 py-3">
          <FileText size={14} className="shrink-0 text-[#16A34A]" />
          <span className="flex-1 text-xs text-[#15803D]">
            NF enviada: <strong>{med.nfArquivoNome}</strong>
            {nfEnviadaLabel && <span className="ml-1 text-[#16A34A]/70">· {nfEnviadaLabel}</span>}
          </span>
          <a
            href={`/api/colaborador/nf/${med.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg bg-[#16A34A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#15803D]"
          >
            Visualizar NF
          </a>
        </div>
      )}

      {med.status === "PAGO" && med.comprovanteArquivoNome && (
        <div className="flex items-center gap-3 border-b border-[#BFDBFE] bg-[#EFF6FF] px-5 py-3">
          <FileText size={14} className="shrink-0 text-[#2563EB]" />
          <span className="flex-1 text-xs text-[#1D4ED8]">
            Comprovante de pagamento: <strong>{med.comprovanteArquivoNome}</strong>
            {med.comprovanteCarregadoAt && (
              <span className="ml-1 text-[#2563EB]/70">
                · {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(med.comprovanteCarregadoAt))}
              </span>
            )}
          </span>
          <a
            href={`/api/colaborador/comprovante/${med.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8]"
          >
            Ver comprovante
          </a>
        </div>
      )}

      {/* Dropdown do Boletim */}
      <button
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[#FAFAFA]"
        onClick={() => setBmOpen((v) => !v)}
      >
        <span className="text-sm font-medium text-[#555555]">
          {bmOpen ? "Ocultar" : "Ver"} Boletim de Medição
        </span>
        <ChevronDown className={`shrink-0 text-[#9CA3AF] transition-transform duration-200 ${bmOpen ? "rotate-180" : ""}`} size={16} />
      </button>

      {bmOpen && (
        <div className="border-t border-[#E5E7EB] p-5">
          <BoletimMedicao data={med} />
        </div>
      )}
    </Card>
  );
}
