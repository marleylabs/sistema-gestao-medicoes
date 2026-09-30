"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Plus, Trash2, X } from "lucide-react";
import { Badge, BlurValue, Button, IconButton, Input, Textarea } from "@/components/ui";
import type { ContratoResumo, MapaPagamentoItem, Profissional } from "@/components/types";
import { resolveCondicaoFixa, toCondicaoFixaConfig } from "@/lib/condicao-fixa";
import {
  currency,
  currencyInputValue,
  formatCurrencyInput,
  formatParticipacao,
  money,
  normalizeText,
  parseCurrencyNumber,
  percent,
} from "@/components/pagamento-format";

type DivergenciaLinha = {
  id: string;
  nrVale: string;
  idMedicaoExistente: string | null;
  documentoNaoMapeado: boolean;
  comparacaoAmbigua: boolean;
  formatoDivergente: boolean;
  a1eqDivergente: boolean;
  emissaoDivergente: boolean;
  tipoDivergente: boolean;
  equipe: { formato: string | null; a1eqHh: number | null; percentualEmissao: number | null; tipo: string | null };
  fornecedor: { formato: string; a1eqHh: number; percentualEmissao: number; tipo: string };
  status: "PENDENTE" | "INCLUIDA" | "DESCARTADA";
  observacao: string | null;
  resolvidoPorNome: string | null;
  resolvidoEm: string | null;
};

/**
 * Cadastro/edição de pagamento — mesmo PaymentModal e mesma chamada POST /api/mapa-pagamento ou
 * PATCH /api/mapa-pagamento/[id] de sempre (o backend continua rejeitando ciclo "GERAL").
 */
export function MapaPagamentoEditor({
  item,
  ciclo,
  profissionais = [],
  contratos = [],
  onClose,
  onBack,
  contexto,
  onSaved,
  onDivergenciaResolvida,
}: {
  item: MapaPagamentoItem | null;
  ciclo: string;
  profissionais?: Profissional[];
  contratos?: ContratoResumo[];
  /** Fecha o painel (X). */
  onClose: () => void;
  /** Aberto a partir do detalhe do fornecedor: Voltar/Cancelar/Esc retornam ao detalhe. */
  onBack?: () => void;
  contexto?: PagamentoEditorContexto;
  /** `id`: pagamento salvo (no cadastro, o id recém-criado devolvido pelo POST de sempre). */
  onSaved: (mensagem: string, id?: string) => Promise<void> | void;
  onDivergenciaResolvida?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <PaymentModal
      item={item}
      ciclo={ciclo}
      saving={saving}
      profissionais={profissionais}
      contratos={contratos}
      onCancel={onBack ?? onClose}
      onBack={onBack}
      onClose={onClose}
      contexto={contexto}
      onSave={async (payload) => {
        setSaving(true);
        try {
          const url = item ? `/api/mapa-pagamento/${item.id}` : "/api/mapa-pagamento";
          const res = await fetch(url, {
            method: item ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, ciclo }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || "Não foi possível cadastrar o pagamento. Tente novamente.");
          }
          const salvo = (await res.json().catch(() => null)) as { id?: string } | null;
          await onSaved(item ? "Pagamento atualizado com sucesso." : "Pagamento cadastrado com sucesso.", salvo?.id ?? item?.id);
        } finally {
          setSaving(false);
        }
      }}
      onDivergenciaResolvida={onDivergenciaResolvida}
    />
  );
}

// ─── PaymentModal ─────────────────────────────────────────────────────────────

type DocLine = {
  _key: string;
  id?: string;
  se: string;
  contrato: string;
  numeroDocumento: string;
  formato: string;
  equivalenteA1Horas: string;
  percentualEmissao: string;
  tipo2: string;
  condicao: string;
  obs: string;
  _dirty: boolean;
};

function newDocLine(): DocLine {
  return {
    _key: Math.random().toString(36).slice(2),
    se: "", contrato: "", numeroDocumento: "", formato: "",
    equivalenteA1Horas: "0", percentualEmissao: "0", tipo2: "", condicao: "0",
    obs: "", _dirty: true,
  };
}

function docValorMedido(doc: DocLine): number {
  if (isDiscountDoc(doc)) return -Math.abs(parseCurrencyNumber(doc.condicao));
  const a1eq  = parseFloat(doc.equivalenteA1Horas) || 0;
  const pct   = (parseFloat(doc.percentualEmissao) || 0) / 100;
  const preco = parseFloat(doc.condicao) || 0;
  return a1eq * preco * pct;
}

function isDiscountDoc(doc: Pick<DocLine, "tipo2" | "se" | "numeroDocumento">) {
  return normalizeText(doc.tipo2) === "DESCONTO" || normalizeText(doc.se) === "DESCONTO" || normalizeText(doc.numeroDocumento) === "DESCONTO";
}

function newDiscountLine(): DocLine {
  return {
    _key: Math.random().toString(36).slice(2),
    se: "DESCONTO",
    contrato: "",
    numeroDocumento: "DESCONTO",
    formato: "",
    equivalenteA1Horas: "1",
    percentualEmissao: "100",
    tipo2: "DESCONTO",
    condicao: "0",
    obs: "",
    _dirty: true,
  };
}

type PaymentForm = {
  ato: string;
  projetistaCodigo: string;
  responsavel: string;
  cpfCnpj: string;
  razaoSocial: string;
  intrSossego: string;
  salobo: string;
  acg: string;
  escadasAlumar: string;
  horas: string;
  valor: string;
  rev: string;
  status: string;
  valorFixo: string;
  tipoContratacao: string;
  adicionaisFixos: string;
  observacoesContrato: string;
};

function paymentForm(item: MapaPagamentoItem | null): PaymentForm {
  const condicoesFixas = item?.condicoesFixas;
  const razaoSocial = item?.fornecedor?.razaoSocial ?? item?.razaoSocial ?? "";
  const cpfCnpj = item?.fornecedor?.cpfCnpj ?? item?.cpfCnpj ?? "";
  return {
    ato: item?.ato ?? "",
    projetistaCodigo: item?.projetistaCodigo ?? "",
    responsavel: item?.responsavel ?? "",
    cpfCnpj,
    razaoSocial,
    intrSossego: String(item?.intrSossego ?? 0),
    salobo: String(item?.salobo ?? 0),
    acg: String(item?.acg ?? 0),
    escadasAlumar: String(item?.escadasAlumar ?? 0),
    horas: String(item?.horas ?? 0),
    valor: currencyInputValue(item?.valor ?? 0),
    rev: String(item?.rev ?? 0),
    status: item?.status ?? "",
    valorFixo: condicoesFixas?.valorFixo ?? "",
    tipoContratacao: condicoesFixas?.tipoContratacao ?? "",
    adicionaisFixos: condicoesFixas?.adicionaisFixos ?? "",
    observacoesContrato: condicoesFixas?.observacoesContrato ?? "",
  };
}

export type PagamentoEditorContexto = {
  nome?: string | null;
  statusLabel?: string;
  statusBadge?: "brand" | "success" | "warning" | "danger" | "neutral";
  cicloLabel?: string;
};

/**
 * Formulário de pagamento (cadastro/edição) em painel lateral. A lógica (estado, efeitos, cálculos,
 * documentos, descontos, divergências e salvar) é a mesma de sempre — só a apresentação mudou.
 * `onCancel` = Cancelar/Esc (volta ao detalhe quando há `onBack`); `onClose` = X (fecha tudo).
 */
function PaymentModal({
  item,
  ciclo,
  saving,
  profissionais,
  contratos,
  onCancel,
  onBack,
  onClose,
  contexto,
  onSave,
  onDivergenciaResolvida,
}: {
  item: MapaPagamentoItem | null;
  ciclo: string;
  saving: boolean;
  profissionais: Profissional[];
  contratos: ContratoResumo[];
  onCancel: () => void;
  onBack?: () => void;
  onClose?: () => void;
  contexto?: PagamentoEditorContexto;
  onSave: (payload: PaymentForm) => Promise<void>;
  /** Chamado depois que Incluir/Descartar é confirmado com sucesso — deixa a linha de Pagamentos
   * por Fornecedor (fora deste modal) atualizar o badge de status sem esperar o próximo polling. */
  onDivergenciaResolvida?: () => void;
}) {
  const [form, setForm] = useState<PaymentForm>(() => paymentForm(item));
  const [codigoQuery, setCodigoQuery] = useState(item?.projetistaCodigo ?? "");
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Identidade efetivamente escolhida na lista (nunca o texto em digitação) — só para apresentação.
  const [selecionado, setSelecionado] = useState<{ cadastroAdministrativo: boolean } | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Correção da causa raiz de "fornecedor cadastrado não aparece no Nome": a lista de
  // `profissionais` do componente pai só é recarregada quando o ciclo muda ou um pagamento é
  // salvo — nunca ao simplesmente abrir este modal. Um fornecedor cadastrado no Administrativo
  // enquanto o Dashboard já estava aberto ficava invisível aqui até algum refresh não relacionado
  // acontecer. Busca uma cópia fresca assim que o modal monta, sem esperar F5; usa a prop como
  // fallback imediato para não piscar lista vazia enquanto a rede responde.
  const [profissionaisFrescos, setProfissionaisFrescos] = useState<Profissional[]>(profissionais);
  useEffect(() => {
    let cancelado = false;
    fetch("/api/profissionais")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Profissional[] | null) => { if (!cancelado && data) setProfissionaisFrescos(data); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, []);

  // ── Document lines ──
  const [docs, setDocs] = useState<DocLine[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsSaving, setDocsSaving] = useState(false);
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(new Set());

  const codigo = form.projetistaCodigo;

  useEffect(() => {
    if (!item || !codigo || !ciclo) return;
    setDocsLoading(true);
    fetch(`/api/mapa-pagamento/documentos?codigo=${encodeURIComponent(codigo)}&ciclo=${encodeURIComponent(ciclo)}`)
      .then((r) => r.json())
      .then((data: Array<{ id: string; se: string; contrato: string | null; numeroDocumento: string | null; formato: string | null; equivalenteA1Horas: number; percentualEmissao: number; tipo2: string | null; condicao: string | null; obs: string | null; }>) => {
        setDocs(data.map((d) => {
          const line = {
            _key: d.id,
            id: d.id,
            se: d.se ?? "",
            contrato: d.contrato ?? "",
            numeroDocumento: d.numeroDocumento ?? "",
            formato: d.formato ?? "",
            equivalenteA1Horas: String(d.equivalenteA1Horas),
            percentualEmissao: String(Math.round(d.percentualEmissao * 100)),
            tipo2: d.tipo2 ?? "",
            condicao: d.condicao ?? "0",
            obs: d.obs ?? "",
            _dirty: false,
          };
          return isDiscountDoc(line) ? { ...line, condicao: currencyInputValue(Math.abs(parseCurrencyNumber(line.condicao))) } : line;
        }));
      })
      .catch(() => {})
      .finally(() => setDocsLoading(false));
  }, [item, codigo, ciclo]);

  // ── Divergências da conferência do fornecedor ──
  const [divergencias, setDivergencias] = useState<DivergenciaLinha[]>([]);
  const [divergenciasLoading, setDivergenciasLoading] = useState(false);
  const [observacoesDivergencia, setObservacoesDivergencia] = useState<Record<string, string>>({});
  const [resolvendoDivergenciaId, setResolvendoDivergenciaId] = useState<string | null>(null);
  const resolvendoDivergenciaRef = useRef(false);

  const loadDivergencias = useCallback(() => {
    if (!item || !codigo || !ciclo) return;
    setDivergenciasLoading(true);
    fetch(`/api/admin/conferencia?codigo=${encodeURIComponent(codigo)}&ciclo=${encodeURIComponent(ciclo)}`)
      .then((r) => r.json())
      .then((data: DivergenciaLinha[]) => setDivergencias(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setDivergenciasLoading(false));
  }, [item, codigo, ciclo]);

  useEffect(() => { loadDivergencias(); }, [loadDivergencias]);

  async function resolverDivergencia(id: string, acao: "incluir" | "descartar") {
    if (resolvendoDivergenciaRef.current) return;
    resolvendoDivergenciaRef.current = true;
    setResolvendoDivergenciaId(id);
    try {
      const res = await fetch(`/api/admin/conferencia/${id}/${acao}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observacao: observacoesDivergencia[id]?.trim() ?? "" }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(payload.error ?? "Não foi possível concluir a ação. Tente novamente.");
        return;
      }
      loadDivergencias();
      onDivergenciaResolvida?.();
      // Documentos Medidos pode ter sido criado/atualizado — recarrega para refletir imediatamente.
      setDocsLoading(true);
      fetch(`/api/mapa-pagamento/documentos?codigo=${encodeURIComponent(codigo)}&ciclo=${encodeURIComponent(ciclo)}`)
        .then((r) => r.json())
        .then((data: Array<{ id: string; se: string; contrato: string | null; numeroDocumento: string | null; formato: string | null; equivalenteA1Horas: number; percentualEmissao: number; tipo2: string | null; condicao: string | null; obs: string | null; }>) => {
          setDocs(data.map((d) => {
            const line = {
              _key: d.id, id: d.id, se: d.se ?? "", contrato: d.contrato ?? "",
              numeroDocumento: d.numeroDocumento ?? "", formato: d.formato ?? "",
              equivalenteA1Horas: String(d.equivalenteA1Horas),
              percentualEmissao: String(Math.round(d.percentualEmissao * 100)),
              tipo2: d.tipo2 ?? "", condicao: d.condicao ?? "0", obs: d.obs ?? "", _dirty: false,
            };
            return isDiscountDoc(line) ? { ...line, condicao: currencyInputValue(Math.abs(parseCurrencyNumber(line.condicao))) } : line;
          }));
        })
        .catch(() => {})
        .finally(() => setDocsLoading(false));
    } finally {
      resolvendoDivergenciaRef.current = false;
      setResolvendoDivergenciaId(null);
    }
  }

  const documentosMedidos = docs.filter((doc) => !isDiscountDoc(doc));
  const descontos = docs.filter(isDiscountDoc);
  const totalDocsValorBruto = documentosMedidos.reduce((s, d) => s + docValorMedido(d), 0);
  const totalDescontos = descontos.reduce((s, d) => s + Math.abs(docValorMedido(d)), 0);
  const valorFixoBase = parseCurrencyNumber(form.valorFixo);
  const adicionaisFixos = parseCurrencyNumber(form.adicionaisFixos);
  const totalCondicoesFixas = valorFixoBase + adicionaisFixos;
  const valorPrevistoBase = totalCondicoesFixas + totalDocsValorBruto;
  const valorPrevistoLiquido = valorPrevistoBase - totalDescontos;

  // Fornecedor CONDICIONAL_PRODUCAO (ver lib/condicao-fixa.ts) — o valor fixo depende de "existem
  // documentos medidos" NESTE pagamento (linhas de Documentos Medidos já carregadas/adicionadas no
  // formulário, `totalDocsValorBruto`, a mesma definição usada pelo ETL em
  // generate_payment_map_from_measurements). Sempre recalculado ao vivo enquanto esse tipo de
  // condição está ativo — nunca um valor hardcoded por nome (era a exceção do Cristiano Jeferson,
  // hoje dado cadastral configurável por qualquer fornecedor via CadastroFornecedor).
  useEffect(() => {
    const target = normalizeText(form.projetistaCodigo || form.responsavel || codigoQuery);
    const matched = target
      ? profissionaisFrescos.find((p) => normalizeText(p.codigo) === target || normalizeText(p.nome) === target || normalizeText(p.nomeCompleto) === target)
      : undefined;
    if (!matched || matched.tipoCondicaoFixa !== "CONDICIONAL_PRODUCAO") return;
    const valorResolvido = resolveCondicaoFixa(toCondicaoFixaConfig(matched), totalDocsValorBruto > 0);
    if (valorResolvido == null) return;
    const nextValorFixo = currencyInputValue(valorResolvido);
    const nextTipoContratacao = matched.tipoContrato || "FIXO (PJ)";
    setForm((cur) => {
      if (cur.valorFixo === nextValorFixo && cur.tipoContratacao === nextTipoContratacao) return cur;
      return { ...cur, valorFixo: nextValorFixo, tipoContratacao: nextTipoContratacao };
    });
  }, [codigoQuery, form.projetistaCodigo, form.razaoSocial, form.responsavel, profissionaisFrescos, totalDocsValorBruto]);

  useEffect(() => {
    if (valorPrevistoBase <= 0 && totalDescontos <= 0) return;
    setForm((cur) => ({ ...cur, valor: currencyInputValue(valorPrevistoLiquido) }));
  }, [totalDescontos, valorPrevistoBase, valorPrevistoLiquido]);

  function updateDoc(key: string, field: keyof Omit<DocLine, "_key" | "id" | "_dirty">, value: string) {
    setDocs((cur) => cur.map((d) => d._key === key ? { ...d, [field]: value, _dirty: true } : d));
  }

  function updateDiscount(key: string, field: "obs" | "condicao", value: string) {
    setDocs((cur) => cur.map((d) => {
      if (d._key !== key) return d;
      return {
        ...d,
        se: "DESCONTO",
        numeroDocumento: "DESCONTO",
        tipo2: "DESCONTO",
        equivalenteA1Horas: "1",
        percentualEmissao: "100",
        [field]: field === "condicao" ? value.replace(/[^\d,.-]/g, "") : value,
        _dirty: true,
      };
    }));
  }

  async function saveDocLine(doc: DocLine) {
    setDocsSaving(true);
    try {
      const payload = {
        codigo,
        ciclo,
        se: doc.se,
        contrato: doc.contrato,
        numeroDocumento: doc.numeroDocumento,
        formato: doc.formato,
        equivalenteA1Horas: parseFloat(doc.equivalenteA1Horas) || 0,
        percentualEmissao: (parseFloat(doc.percentualEmissao) || 0) / 100,
        tipo2: doc.tipo2,
        condicao: isDiscountDoc(doc) ? String(-Math.abs(parseCurrencyNumber(doc.condicao))) : doc.condicao,
        obs: doc.obs || null,
      };

      if (doc.id) {
        const res = await fetch(`/api/mapa-pagamento/documentos/${doc.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Não foi possível salvar a linha de documento.");
        }
        const updated = await res.json() as { id: string };
        setDocs((cur) => cur.map((d) => d._key === doc._key ? { ...d, id: updated.id, _dirty: false } : d));
      } else {
        const res = await fetch("/api/mapa-pagamento/documentos", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Não foi possível salvar a linha de documento.");
        }
        const created = await res.json() as { id: string };
        setDocs((cur) => cur.map((d) => d._key === doc._key ? { ...d, id: created.id, _dirty: false } : d));
      }
    } finally {
      setDocsSaving(false);
    }
  }

  async function deleteDocLine(doc: DocLine) {
    if (!doc.id) { setDocs((cur) => cur.filter((d) => d._key !== doc._key)); return; }
    setDeletingDocIds((s) => new Set(s).add(doc.id!));
    try {
      await fetch(`/api/mapa-pagamento/documentos/${doc.id}`, { method: "DELETE" });
      setDocs((cur) => cur.filter((d) => d._key !== doc._key));
    } finally {
      setDeletingDocIds((s) => { const n = new Set(s); n.delete(doc.id!); return n; });
    }
  }

  const [savePaymentError, setSavePaymentError] = useState<string | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);

  async function handleSavePayment() {
    // Nunca deixar "Cadastrar"/"Salvar alterações" falhar em silêncio: antes, um erro ao salvar
    // uma linha de Documento/Desconto (ex.: "Fornecedor não encontrado" quando o código digitado
    // não bate com nenhum Profissional) virava uma promise rejeitada sem catch em nenhum lugar —
    // o clique parecia simplesmente não fazer nada (bug real encontrado nesta sessão).
    if (savingPayment) return; // duplo clique não dispara duas vezes
    setSavingPayment(true);
    setSavePaymentError(null);
    try {
      const shouldUseLiquidTotal = valorPrevistoBase > 0 || totalDescontos > 0;
      const finalForm = shouldUseLiquidTotal ? { ...form, valor: currencyInputValue(valorPrevistoLiquido) } : form;
      const dirtyDocs = docs.filter((doc) => doc._dirty);
      for (const doc of dirtyDocs) {
        await saveDocLine(doc);
      }
      await onSave(finalForm);
    } catch (err) {
      setSavePaymentError(err instanceof Error && err.message ? err.message : "Não foi possível cadastrar o pagamento. Tente novamente.");
    } finally {
      setSavingPayment(false);
    }
  }

  const suggestions = useMemo(() => {
    const q = codigoQuery.trim().toLowerCase();
    if (!q) return profissionaisFrescos.slice(0, 8);
    return profissionaisFrescos
      .filter((p) =>
        (p.codigo ?? "").toLowerCase().includes(q) ||
        (p.nome ?? "").toLowerCase().includes(q) ||
        (p.nomeCompleto ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [codigoQuery, profissionaisFrescos]);

  function selectProfissional(p: Profissional) {
    // CORREÇÃO CRÍTICA: fornecedores legados sem `Profissional.codigo` (import antigo nunca
    // preencheu essa coluna) caíam para "" aqui — o campo Nome ficava visualmente vazio após
    // selecionar, e salvar gravava `projetistaCodigo: null` silenciosamente (resolveProjetistaCodigo
    // trata "" como "nenhum código informado", não como erro). O próprio backend já usa `nome` como
    // identidade canônica de fallback nesses casos (ver lib/mapa-pagamento.ts:resolveProjetistaCodigo)
    // — espelha exatamente a mesma regra aqui, nunca grava uma identidade vazia.
    const identidade = p.codigo || p.nome || "";
    // Fonte PRIMÁRIA e ÚNICA: CadastroFornecedor real (join por colaboradorCodigo, vindo de
    // /api/profissionais) via `resolveCondicaoFixa` — nunca tabela hardcoded por nome. Para
    // CONDICIONAL_PRODUCAO o valor depende de `totalDocsValorBruto` (Documentos Medidos já
    // presentes no formulário nesse instante); o efeito dedicado acima mantém isso em sincronia
    // conforme documentos são carregados/adicionados/removidos.
    const valorResolvido = resolveCondicaoFixa(toCondicaoFixaConfig(p), totalDocsValorBruto > 0);
    setCodigoQuery(identidade);
    setSelecionado({ cadastroAdministrativo: !!p.cadastroAdministrativo });
    setForm((cur) => {
      // Troca de identidade nunca herda CNPJ/Razão social da anterior (ex.: legado sem cadastro
      // selecionado depois de uma identidade administrativa parecida). Mesma identidade re-selecionada
      // mantém o que já estava preenchido quando o Profissional não traz o dado.
      const mesmaIdentidade = normalizeText(cur.projetistaCodigo) === normalizeText(identidade);
      return {
      ...cur,
      projetistaCodigo: identidade,
      responsavel: p.nomeCompleto || p.nome || "",
      // Esta tela trabalha só com CNPJ (CPF nunca é a identidade de fornecedor aqui) — nunca usar
      // p.cpf, mesmo que preenchido.
      cpfCnpj: p.cnpj ? maskCpfCnpj(p.cnpj) : mesmaIdentidade ? cur.cpfCnpj : "",
      razaoSocial: p.razaoSocial || (mesmaIdentidade ? cur.razaoSocial : ""),
      // Selecionar um fornecedor é uma troca EXPLÍCITA de identidade — nunca herda o valor do
      // fornecedor anterior (bug real: selecionar Mauricio, 8.640, depois trocar para alguém sem
      // condição fixa mantinha 8.640 na tela). Sempre reflete o fornecedor recém-selecionado:
      // valor real quando existe, "" quando não existe (nunca um resquício de state antigo).
      valorFixo: valorResolvido != null ? currencyInputValue(valorResolvido) : "",
      tipoContratacao: p.tipoContrato || "",
      };
    });
    setShowSuggestions(false);
  }

  function update(field: keyof PaymentForm, value: string) {
    setForm((cur) => ({ ...cur, [field]: value }));
  }

  useEffect(() => {
    // Mesma fonte primária de `selectProfissional` (CadastroFornecedor real, join por
    // colaboradorCodigo) — cobre o caso de o usuário digitar o código diretamente sem clicar numa
    // sugestão (fornecedores legados). CONDICIONAL_PRODUCAO já é tratado (sempre em sincronia) pelo
    // efeito dedicado acima — este aqui só preenche o caso FIXA, e só quando o campo está vazio
    // (nunca sobrescreve edição manual em andamento).
    const target = normalizeText(form.projetistaCodigo || form.responsavel || codigoQuery);
    const matched = target
      ? profissionaisFrescos.find((p) => normalizeText(p.codigo) === target || normalizeText(p.nome) === target || normalizeText(p.nomeCompleto) === target)
      : undefined;
    if (!matched || matched.tipoCondicaoFixa === "CONDICIONAL_PRODUCAO") return;
    const valorFixoReal = matched.valorCondicaoFixa;
    const tipoContratoReal = matched.tipoContrato;
    if (valorFixoReal == null && !tipoContratoReal) return;
    setForm((cur) => {
      if (parseCurrencyNumber(cur.valorFixo) > 0 && cur.tipoContratacao) return cur;
      return {
        ...cur,
        valorFixo: parseCurrencyNumber(cur.valorFixo) > 0
          ? cur.valorFixo
          : valorFixoReal != null
            ? currencyInputValue(valorFixoReal)
            : cur.valorFixo,
        tipoContratacao: cur.tipoContratacao || tipoContratoReal || "",
      };
    });
  }, [codigoQuery, form.projetistaCodigo, form.razaoSocial, form.responsavel, profissionaisFrescos]);

  function maskCpfCnpj(v: string) {
    const d = v.replace(/\D/g, "");
    if (d.length <= 11) {
      return d
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    return d
      .slice(0, 14)
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }

  function maskPercent(v: string) {
    const d = v.replace(/[^\d,\.]/g, "").replace(",", ".");
    const n = parseFloat(d);
    if (isNaN(n)) return "";
    return String(Math.min(Math.max(n, 0), 100));
  }

  // close suggestions on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Foco no painel ao abrir (teclado/leitor de tela começam no editor, não atrás do overlay).
  const painelRef = useRef<HTMLElement>(null);
  useEffect(() => { painelRef.current?.focus(); }, []);
  // Tab/Shift+Tab circulam dentro do painel (nunca vão para a tela por trás do overlay).
  function manterFocoNoPainel(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab" || !painelRef.current) return;
    const focaveis = Array.from(painelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter((el) => el.offsetParent !== null);
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const ativo = document.activeElement;
    if (event.shiftKey && (ativo === primeiro || ativo === painelRef.current)) { event.preventDefault(); ultimo.focus(); }
    else if (!event.shiftKey && ativo === ultimo) { event.preventDefault(); primeiro.focus(); }
  }

  // Mesma busca de fornecedor dos efeitos de condição fixa acima — só para EXIBIR os valores
  // "com/sem produção" do cadastro (a resolução continua no efeito CONDICIONAL_PRODUCAO).
  const condicaoCondicional = useMemo(() => {
    const target = normalizeText(form.projetistaCodigo || form.responsavel || codigoQuery);
    const matched = target
      ? profissionaisFrescos.find((p) => normalizeText(p.codigo) === target || normalizeText(p.nome) === target || normalizeText(p.nomeCompleto) === target)
      : undefined;
    if (!matched || matched.tipoCondicaoFixa !== "CONDICIONAL_PRODUCAO") return null;
    const config = toCondicaoFixaConfig(matched);
    return { comProducao: config.valorCondicaoFixaComProducao, semProducao: config.valorCondicaoFixaSemProducao };
  }, [codigoQuery, form.projetistaCodigo, form.responsavel, profissionaisFrescos]);

  // close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onCancel(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  const tituloPainel = item ? "Editar pagamento" : "Novo pagamento";
  // Edição: fornecedor do contexto. Cadastro: só o fornecedor efetivamente selecionado (nunca o texto em digitação).
  const nomeContexto = item ? (contexto?.nome || form.responsavel || codigoQuery || null) : (selecionado ? form.responsavel || null : null);
  // Resumo só com contexto suficiente — no cadastro, depois de selecionar o fornecedor ou incluir documentos.
  const mostrarResumo = !!item || !!form.responsavel || docs.length > 0;
  const valorFixoExibido = form.valorFixo && !form.valorFixo.includes("R$")
    ? currencyInputValue(parseCurrencyNumber(form.valorFixo))
    : form.valorFixo;
  const resumo: Array<{ label: string; valor: string; tom?: "danger" | "strong" }> = [
    ...(item ? [{ label: "Pagamento atual", valor: currency.format(item.valor || 0) }] : []),
    { label: "Condição fixa", valor: currency.format(totalCondicoesFixas) },
    { label: "Documentos medidos", valor: currency.format(totalDocsValorBruto) },
    { label: "Descontos", valor: `- ${currency.format(totalDescontos)}`, tom: totalDescontos > 0 ? "danger" : undefined },
    { label: "Total medido líquido", valor: currency.format(valorPrevistoLiquido), tom: "strong" },
  ];
  const secaoTitulo = "text-sm font-semibold text-[var(--foreground)]";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="pagamento-editor-titulo">
      {/* Overlay sem ação de fechar: evita perder edição por um clique acidental (Esc/Voltar/X/Cancelar fecham). */}
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" />
      <aside ref={painelRef} tabIndex={-1} onKeyDown={manterFocoNoPainel} className="relative flex h-full w-full max-w-full flex-col bg-[var(--surface)] shadow-2xl outline-none sm:w-[88vw] lg:w-[clamp(820px,65vw,960px)]">

        {/* Header */}
        <header className="border-b border-[var(--border)] px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-semibold text-[var(--muted-foreground)] hover:bg-[#F7F7F5] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30"
              >
                <ArrowLeft size={14} />
                Voltar ao fornecedor
              </button>
            ) : <span />}
            <IconButton onClick={onClose ?? onCancel} title="Fechar"><X size={16} /></IconButton>
          </div>
          <div className="mt-2 min-w-0">
            <h2 id="pagamento-editor-titulo" className="text-eyebrow text-[var(--primary)]">{tituloPainel}</h2>
            <p className="text-section-title mt-1 break-words text-[var(--foreground)]">
              {nomeContexto || (item ? "Fornecedor" : "Novo fornecedor no ciclo")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
              {contexto?.statusLabel && <Badge variant={contexto.statusBadge ?? "neutral"} className="whitespace-nowrap">{contexto.statusLabel}</Badge>}
              <span>{contexto?.cicloLabel ?? ciclo}</span>
              {ciclo !== "GERAL" && <span className="font-technical text-[11px]">{ciclo}</span>}
              {form.projetistaCodigo && <span className="font-technical text-[11px]">· {form.projetistaCodigo}</span>}
              {!item && selecionado && !selecionado.cadastroAdministrativo && (
                <span className="text-[#92400E]">· Legado · sem cadastro administrativo</span>
              )}
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">

          {/* Resumo — mesmos valores de sempre (item.valor salvo e os totais já calculados neste formulário). */}
          {mostrarResumo && <section className={`grid grid-cols-2 gap-2 border-b border-[var(--border)] bg-[#FAFAF8] px-5 py-4 sm:grid-cols-3 sm:px-6 ${item ? "lg:grid-cols-5" : "lg:grid-cols-4"}`} aria-label="Resumo do pagamento">
            {resumo.map((r) => (
              <div key={r.label} className={`min-w-0 rounded-lg border border-[var(--border)] bg-white px-3 py-2 ${r.tom === "strong" ? "col-span-2 sm:col-span-1" : ""}`}>
                <p className="truncate text-[11px] text-[var(--muted-foreground)]">{r.label}</p>
                <p className={`mt-0.5 truncate text-sm tabular-nums ${r.tom === "danger" ? "font-semibold text-[#DC2626]" : r.tom === "strong" ? "font-bold text-[var(--foreground)]" : "font-semibold text-[var(--foreground)]"}`}>
                  <BlurValue>{r.valor}</BlurValue>
                </p>
              </div>
            ))}
          </section>}

          <div className="divide-y divide-[var(--border)]">

            {/* Identificação */}
            <section className="grid gap-4 px-5 py-5 sm:px-6">
              <h3 className={secaoTitulo}>Identificação</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {/* Nome — autocomplete sobre Profissional (fetch fresco anti-cache acima). Ao selecionar,
                    CNPJ/Razão social são preenchidos automaticamente (somente leitura abaixo). */}
                <MField label="Nome" className="md:col-span-2">
                  <div className="relative" ref={suggestionsRef}>
                    <input
                      className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] hover:border-[#D1D5DB] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                      placeholder="Buscar fornecedor..."
                      value={codigoQuery}
                      onChange={(e) => {
                        // codigoQuery (texto visível) e form.projetistaCodigo (valor enviado) sempre
                        // sincronizados — resolveProjetistaCodigo() no backend revalida antes de gravar.
                        setCodigoQuery(e.target.value);
                        update("projetistaCodigo", e.target.value);
                        setSelecionado(null);
                        setShowSuggestions(true);
                      }}
                      onFocus={() => setShowSuggestions(true)}
                      autoComplete="off"
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <div className="absolute left-0 top-10 z-10 w-full overflow-y-auto rounded-lg border border-[#E5E7EB] bg-white shadow-lg" style={{ maxHeight: "240px" }}>
                        {suggestions.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="flex w-full flex-col border-b border-[#F3F4F6] px-3 py-2 text-left last:border-0 hover:bg-[#F5F5F5]"
                            onMouseDown={() => selectProfissional(p)}
                          >
                            {/* Nome em destaque; razão social/CNPJ distinguem homônimos. */}
                            <span className="text-sm font-semibold text-[#1A1A1A]">{p.nomeCompleto || p.nome}</span>
                            {(p.razaoSocial || p.cnpj) && (
                              <span className="text-xs text-[#555555]">{[p.razaoSocial, p.cnpj ? maskCpfCnpj(p.cnpj) : null].filter(Boolean).join(" · ")}</span>
                            )}
                            {/* Origem da identidade (sem afirmar duplicidade): identidades distintas nunca são fundidas aqui. */}
                            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]" data-testid="sugestao-origem">
                              {p.cadastroAdministrativo ? (
                                <span className="rounded border border-[#cde9d5] bg-[var(--success-soft)] px-1.5 py-0.5 font-semibold text-[var(--success)]">Cadastro administrativo</span>
                              ) : (
                                <span className="rounded border border-[#f2dbb7] bg-[var(--warning-soft)] px-1.5 py-0.5 font-semibold text-[#92400E]">Legado · sem cadastro administrativo</span>
                              )}
                              <span className="font-technical text-[#71717A]">{p.codigo || p.nome}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </MField>

                {/* CNPJ e Razão social — somente leitura: fonte única é o cadastro administrativo. */}
                <MField label="CNPJ">
                  <Input value={form.cpfCnpj} readOnly placeholder="Preenchido automaticamente" className="cursor-not-allowed bg-[#F9FAFB] font-technical text-[#555555]" />
                </MField>
                {!item && selecionado && !selecionado.cadastroAdministrativo && (
                  <p className="text-[12px] text-[#92400E] md:col-span-2" data-testid="aviso-sem-cadastro">Sem cadastro administrativo vinculado.</p>
                )}
                <MField label="Razão social">
                  <Input value={form.razaoSocial} readOnly placeholder="Preenchida automaticamente" className="cursor-not-allowed bg-[#F9FAFB] text-[#555555]" />
                </MField>
              </div>
            </section>

            {/* Participação por contrato — somente leitura, calculada a partir dos Documentos Medidos. */}
            <section className="grid gap-3 px-5 py-5 sm:px-6">
              <h3 className={secaoTitulo}>Participação por contrato</h3>
              {item && contratos.length > 0 ? (
                <ul className={`grid gap-x-6 rounded-lg border border-[var(--border)] px-3 ${contratos.length > 1 ? "sm:grid-cols-2" : ""}`}>
                  {contratos.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 border-b border-[#EFEFED] py-2 text-sm last:border-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-0">
                      <span className="min-w-0 truncate text-[var(--foreground)]">{c.nome}</span>
                      <span className="shrink-0 tabular-nums font-semibold text-[var(--foreground)]">{formatParticipacao(item.participacaoContratos[c.id])}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--muted-foreground)]">
                  {item ? "Nenhum contrato identificado no ciclo." : "Calculado automaticamente após salvar e vincular documentos medidos."}
                </p>
              )}
              {item && item.documentosPendentesContrato > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-[#B45309]">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  {item.documentosPendentesContrato} documento(s) medido(s) sem contrato (CTO) válido — {money(item.valorNaoClassificadoContrato)} ({percent.format(item.percentualNaoClassificadoContrato / 100)} do total) ainda não classificado. Os percentuais acima já refletem essa pendência (não somam 100%).
                </p>
              )}
            </section>

            {/* Condição fixa — mesmo campo de sempre (form.valorFixo). Tipo de contratação, adicionais e
                observações continuam no estado e seguem no payload sem alteração. */}
            <section className="grid gap-3 px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className={secaoTitulo}>Condição fixa</h3>
                {totalCondicoesFixas > 0 && (
                  <span className="text-[12px] text-[var(--muted-foreground)]">Base: <span className="font-semibold text-[var(--foreground)]">{currency.format(totalCondicoesFixas)}</span></span>
                )}
              </div>
              <MField label="Valor fixo mensal/contratual" className="max-w-xs">
                <Input
                  inputMode="decimal"
                  value={valorFixoExibido}
                  onFocus={() => { if (valorFixoExibido !== form.valorFixo) update("valorFixo", valorFixoExibido); }}
                  onChange={(e) => update("valorFixo", e.target.value)}
                  onBlur={(e) => update("valorFixo", currencyInputValue(parseCurrencyNumber(e.target.value)))}
                  placeholder="R$ 0,00"
                />
              </MField>
              {condicaoCondicional && (
                <p className="text-[12px] leading-relaxed text-[var(--muted-foreground)]" data-testid="condicao-condicional">
                  Condicional à produção (cadastro do fornecedor): com produção{" "}
                  <span className="font-semibold text-[var(--foreground)]">{condicaoCondicional.comProducao == null ? "–" : currency.format(condicaoCondicional.comProducao)}</span>
                  {" · "}sem produção{" "}
                  <span className="font-semibold text-[var(--foreground)]">{condicaoCondicional.semProducao == null ? "–" : currency.format(condicaoCondicional.semProducao)}</span>
                  {" — aplicado: "}<span className="font-semibold text-[var(--foreground)]">{totalDocsValorBruto > 0 ? "com produção" : "sem produção"}</span>.
                </p>
              )}
            </section>

            {/* Descontos */}
            <section className="grid gap-3 px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className={secaoTitulo}>Descontos</h3>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Deduções que abatem o valor previsto e o total medido.</p>
                </div>
                <Button variant="secondary" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setDocs((cur) => [...cur, newDiscountLine()])}>
                  <Plus size={13} /> Adicionar desconto
                </Button>
              </div>

              {descontos.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)]">Nenhum desconto aplicado.</p>
              ) : (
                <div className="rounded-lg border border-[var(--border)]">
                  {descontos.map((desconto) => {
                    const isDeleting = desconto.id ? deletingDocIds.has(desconto.id) : false;
                    return (
                      <div key={desconto._key} className="grid gap-2 border-b border-[#EFEFED] p-3 last:border-0 sm:grid-cols-[1fr_170px_auto] sm:items-end">
                        <label className="grid gap-1 text-[11px] text-[var(--muted-foreground)]">
                          Descrição do desconto
                          <Input value={desconto.obs} onChange={(e) => updateDiscount(desconto._key, "obs", e.target.value)} placeholder="Ex: retenção, ajuste, abatimento..." />
                        </label>
                        <label className="grid gap-1 text-[11px] text-[var(--muted-foreground)]">
                          Valor do desconto
                          <Input
                            inputMode="decimal"
                            value={desconto.condicao}
                            onChange={(e) => updateDiscount(desconto._key, "condicao", e.target.value)}
                            onBlur={(e) => updateDiscount(desconto._key, "condicao", currencyInputValue(Math.abs(parseCurrencyNumber(e.target.value))))}
                            placeholder="R$ 0,00"
                            className="font-semibold text-[#DC2626]"
                          />
                        </label>
                        <div className="flex gap-1 sm:justify-end">
                          <Button variant="secondary" className="h-9 px-3 text-xs" disabled={docsSaving} onClick={() => saveDocLine(desconto)}>Salvar</Button>
                          <IconButton className="h-9 w-9 hover:border-[#DC2626] hover:text-[#DC2626]" disabled={isDeleting} onClick={() => deleteDocLine(desconto)} title="Excluir desconto">
                            <Trash2 size={14} />
                          </IconButton>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {totalDescontos > 0 && (
                <p className="flex justify-end gap-3 text-xs">
                  <span className="text-[var(--muted-foreground)]">Total de descontos</span>
                  <span className="font-bold text-[#DC2626]">- {currency.format(totalDescontos)}</span>
                </p>
              )}
            </section>

            {/* Divergências da medição (conferência do fornecedor) — mesmas ações Incluir/Descartar. */}
            {!divergenciasLoading && divergencias.length > 0 && (
              <section className="grid gap-3 px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className={secaoTitulo}>Divergências da Medição</h3>
                  {(() => {
                    const pendentes = divergencias.filter((d) => d.status === "PENDENTE").length;
                    const resolvidas = divergencias.length - pendentes;
                    return (
                      <span className="text-xs text-[#7F1D1D]">
                        {divergencias.length} divergência{divergencias.length !== 1 ? "s" : ""} encontrada{divergencias.length !== 1 ? "s" : ""} — {pendentes} pendente{pendentes !== 1 ? "s" : ""}, {resolvidas} resolvida{resolvidas !== 1 ? "s" : ""}
                      </span>
                    );
                  })()}
                </div>

                <div className="grid gap-3">
                  {divergencias.map((d) => {
                    const emResolucao = resolvendoDivergenciaId === d.id;
                    const observacaoAtual = observacoesDivergencia[d.id] ?? "";
                    const podeDescartar = observacaoAtual.trim().length > 0;
                    const campos: Array<{ label: string; equipe: string; fornecedor: string; divergente: boolean }> = [
                      { label: "Formato", equipe: d.equipe.formato ?? "–", fornecedor: d.fornecedor.formato, divergente: d.formatoDivergente },
                      { label: "A1eq/HH", equipe: d.equipe.a1eqHh === null ? "–" : String(d.equipe.a1eqHh), fornecedor: String(d.fornecedor.a1eqHh), divergente: d.a1eqDivergente },
                      { label: "% Emissão", equipe: d.equipe.percentualEmissao === null ? "–" : percent.format(d.equipe.percentualEmissao), fornecedor: percent.format(d.fornecedor.percentualEmissao), divergente: d.emissaoDivergente },
                      { label: "Tipo", equipe: d.equipe.tipo ?? "–", fornecedor: d.fornecedor.tipo, divergente: d.tipoDivergente },
                    ];

                    return (
                      <div key={d.id} className="rounded-lg border border-[#FECACA] bg-[#FFFBFB] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-technical text-sm font-bold text-[#1A1A1A]">{d.nrVale}</span>
                          {d.documentoNaoMapeado && <Badge variant="warning">Não mapeado pela Equipe</Badge>}
                          {d.comparacaoAmbigua && <Badge variant="danger">NR VALE duplicado — ambíguo</Badge>}
                          {d.status === "INCLUIDA" && <Badge variant="success">Incluída</Badge>}
                          {d.status === "DESCARTADA" && <Badge variant="neutral">Descartada</Badge>}
                        </div>

                        {d.status === "PENDENTE" && !d.comparacaoAmbigua && (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {campos.filter((c) => c.divergente || d.documentoNaoMapeado).map((c) => (
                              <div key={c.label} className="rounded-md bg-[#FEF2F2] px-2.5 py-1.5 text-xs">
                                <p className="font-semibold text-[#7F1D1D]">{c.label}</p>
                                <p className="text-[#555555]">Equipe: <span className="font-technical">{c.equipe}</span></p>
                                <p className="text-[#555555]">Fornecedor: <span className="font-technical">{c.fornecedor}</span></p>
                              </div>
                            ))}
                          </div>
                        )}

                        {d.status === "PENDENTE" ? (
                          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                            <Textarea
                              className="min-h-[38px] bg-white text-xs"
                              placeholder="Informe uma observação sobre esta divergência..."
                              value={observacaoAtual}
                              onChange={(e) => setObservacoesDivergencia((prev) => ({ ...prev, [d.id]: e.target.value }))}
                            />
                            <div className="flex items-center gap-2 self-end">
                              <Button variant="secondary" className="h-8 px-3 text-xs" disabled={!podeDescartar || emResolucao} onClick={() => resolverDivergencia(d.id, "descartar")}>
                                {emResolucao ? "Descartando..." : "Descartar"}
                              </Button>
                              <Button variant="success" className="h-8 px-3 text-xs" disabled={emResolucao} onClick={() => resolverDivergencia(d.id, "incluir")}>
                                {emResolucao ? "Incluindo..." : "Incluir"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-[#555555]">
                            <p><span className="font-semibold">{d.status === "INCLUIDA" ? "Incluído" : "Motivo"}:</span> {d.observacao || "—"}</p>
                            <p className="mt-0.5 text-[#9CA3AF]">Resolvido por {d.resolvidoPorNome ?? "—"}{d.resolvidoEm ? ` em ${new Date(d.resolvidoEm).toLocaleString("pt-BR")}` : ""}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Documentos medidos — mesma tabela editável (rolagem horizontal só dentro dela). */}
            <section className="grid gap-3 px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className={secaoTitulo}>Documentos medidos</h3>
                <div className="flex flex-wrap items-center gap-2">
                  {(valorPrevistoBase > 0 || totalDescontos > 0) && (
                    <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => update("valor", formatCurrencyInput(String(valorPrevistoLiquido)))}>
                      Usar total ({currency.format(valorPrevistoLiquido)})
                    </Button>
                  )}
                  <Button variant="secondary" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setDocs((cur) => [...cur, newDocLine()])}>
                    <Plus size={13} /> Adicionar linha
                  </Button>
                </div>
              </div>

              {docsLoading ? (
                <p className="text-center text-xs text-[var(--muted-foreground)]">Carregando documentos…</p>
              ) : docs.length === 0 && totalCondicoesFixas <= 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] bg-[#FAFAF8] px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
                  Nenhum documento medido adicionado. Use &quot;Adicionar linha&quot; para incluir.
                </p>
              ) : (
                <div className="max-w-full overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#E5E7EB] bg-[#FAFAF8]">
                        {["SE", "CTO", "NR VALE", "Formato", "A1eq/HH", "% Emissão", "TIPO DG/DOC/HH", "Preço Unit.", "Valor Medido", "Observação", ""].map((h) => (
                          <th key={h} className="whitespace-nowrap px-2 py-2 text-left font-semibold text-[#555555]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {totalCondicoesFixas > 0 && (
                        <tr className="border-b border-[#EFEFED] bg-[#FAFAF8]">
                          <td className="px-2 py-2">
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--foreground)] ring-1 ring-[var(--border)]">Fixo</span>
                          </td>
                          <td className="px-2 py-2 font-semibold text-[var(--foreground)]">{form.tipoContratacao || "FIXO (PJ)"}</td>
                          <td className="px-2 py-2 text-[var(--muted-foreground)]" colSpan={6}>
                            Provento base contratual{adicionaisFixos > 0 ? " + adicionais fixos" : ""}
                          </td>
                          <td className="px-2 py-2 text-right font-bold text-[var(--foreground)]">{currency.format(totalCondicoesFixas)}</td>
                          <td className="px-2 py-2 text-[var(--muted-foreground)]">Base fixa</td>
                          <td className="px-2 py-2" />
                        </tr>
                      )}
                      {docs.map((doc) => {
                        const valorMedido = docValorMedido(doc);
                        const desconto = isDiscountDoc(doc);
                        const isDeleting = doc.id ? deletingDocIds.has(doc.id) : false;
                        if (desconto) {
                          return (
                            <tr key={doc._key} className="border-b border-[#FEE2E2] bg-white text-[#DC2626] last:border-0">
                              <td className="px-2 py-2">
                                <span className="rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-bold uppercase text-[#DC2626] ring-1 ring-[#FECACA]">Desconto</span>
                              </td>
                              <td className="px-2 py-2" colSpan={7}><span className="font-semibold">{doc.obs || "Desconto aplicado"}</span></td>
                              <td className="px-2 py-2 text-right font-bold">- {currency.format(Math.abs(valorMedido))}</td>
                              <td className="px-2 py-2">Dedução</td>
                              <td className="px-2 py-2" />
                            </tr>
                          );
                        }
                        return (
                          <tr key={doc._key} className="border-b border-[#F3F4F6] last:border-0 hover:bg-[#FAFAFA]">
                            <td className="px-2 py-1.5">
                              <input className="h-7 w-20 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[var(--primary)] focus:outline-none" value={doc.se} onChange={(e) => updateDoc(doc._key, "se", e.target.value)} placeholder="SE-001" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className="h-7 w-24 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[var(--primary)] focus:outline-none" value={doc.contrato} onChange={(e) => updateDoc(doc._key, "contrato", e.target.value)} placeholder="CTO-X" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className="h-7 w-24 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[var(--primary)] focus:outline-none" value={doc.numeroDocumento} onChange={(e) => updateDoc(doc._key, "numeroDocumento", e.target.value)} placeholder="NR-0001" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className="h-7 w-16 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[var(--primary)] focus:outline-none" value={doc.formato} onChange={(e) => updateDoc(doc._key, "formato", e.target.value)} placeholder="A1" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className="h-7 w-16 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[var(--primary)] focus:outline-none" value={doc.equivalenteA1Horas} onChange={(e) => updateDoc(doc._key, "equivalenteA1Horas", e.target.value)} placeholder="0" inputMode="decimal" />
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="relative">
                                <input className="h-7 w-16 rounded border border-[#E5E7EB] px-2 pr-5 text-xs focus:border-[var(--primary)] focus:outline-none" value={doc.percentualEmissao} onChange={(e) => updateDoc(doc._key, "percentualEmissao", e.target.value)} placeholder="100" inputMode="decimal" />
                                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#9CA3AF]">%</span>
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <input className="h-7 w-28 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[var(--primary)] focus:outline-none" value={doc.tipo2} onChange={(e) => updateDoc(doc._key, "tipo2", e.target.value)} placeholder="Tipo" />
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="relative">
                                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[#9CA3AF]">R$</span>
                                <input className="h-7 w-24 rounded border border-[#E5E7EB] pl-7 pr-2 text-xs focus:border-[var(--primary)] focus:outline-none" value={doc.condicao} onChange={(e) => updateDoc(doc._key, "condicao", e.target.value)} placeholder="0" inputMode="decimal" />
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-right font-semibold text-[#1A1A1A]">{currency.format(valorMedido)}</td>
                            <td className="px-2 py-1.5">
                              <input
                                className={`h-7 w-40 rounded border px-2 text-xs focus:outline-none focus:ring-1 ${doc._dirty ? "border-[#F59E0B]/60 bg-[#FFFBEB] placeholder:text-[#D97706]/60 focus:border-[#F59E0B] focus:ring-[#F59E0B]/30" : "border-[#E5E7EB] bg-white placeholder:text-[#D1D5DB] focus:border-[var(--primary)] focus:ring-[var(--primary)]/15"}`}
                                value={doc.obs}
                                onChange={(e) => updateDoc(doc._key, "obs", e.target.value)}
                                placeholder="Observação…"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex gap-1">
                                <button type="button" disabled={docsSaving} className="rounded p-1 text-[var(--foreground)] hover:bg-[#F4F4F2] disabled:opacity-40" onClick={() => saveDocLine(doc)} title="Salvar linha">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                                </button>
                                <button type="button" disabled={isDeleting} className="rounded p-1 text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-40" onClick={() => deleteDocLine(doc)} title="Excluir linha">
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Footer fixo no fim do painel — ações sempre visíveis durante a rolagem. */}
        <footer className="border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3 sm:px-6">
          {savePaymentError && (
            <div role="alert" className="mb-2 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#AF1B1B]">
              {savePaymentError}
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <Button variant="secondary" className="w-full sm:w-auto" onClick={onCancel} disabled={saving || savingPayment}>Cancelar</Button>
            <Button className="w-full sm:w-auto" onClick={handleSavePayment} disabled={saving || savingPayment || docsSaving}>
              {saving || savingPayment || docsSaving
                ? (item ? "Salvando…" : "Cadastrando…")
                : (item ? "Salvar alterações" : "Cadastrar")}
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function MField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`grid gap-1.5 text-label text-[var(--muted-foreground)] ${className ?? ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
