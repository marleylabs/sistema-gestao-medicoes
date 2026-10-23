"use client";

import { Dancing_Script } from "next/font/google";
import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from "react";
import { AlertTriangle, Eraser, PenLine, Search, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { Aba, Badge, Button, Card, Field, Input } from "@/components/ui";
import { ErroDialogo, PortalDialog } from "@/components/portal-fornecedor";
import { erroDaApi } from "@/components/timesheet/folha-timesheet";
import { QUADRO, TEXTO_ACEITE, dataHoraAssinatura, type EntradaAssinatura, type MetodoAssinatura } from "@/lib/timesheet-assinatura-texto";
import type { FolhaTimesheet } from "@/lib/timesheet";
import type { VerificacaoAssinatura } from "@/lib/timesheet-assinatura";

/**
 * Assinatura eletrônica da folha (spec docs/brain/specs/timesheet-assinatura.md): quadro de desenho (mouse, toque
 * ou caneta) ou nome digitado em letra cursiva, os dois viram PNG; diálogo com senha e aceite; bloco que mostra
 * as assinaturas da folha; verificação de um código.
 */

const cursiva = Dancing_Script({ subsets: ["latin"], weight: "600" });
// O quadro é sempre branco com traço escuro, em qualquer tema, para sair igual no PDF.
const TINTA = "#0f172a";
const PAPEL = "#ffffff";

type Assinaturas = FolhaTimesheet["assinaturas"];
type Assinatura = NonNullable<Assinaturas["fiscal"]>;

function limpar(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = PAPEL;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return ctx;
}

/** Quadro de desenho + aba "Digitar nome" (acessível pelo teclado). `onChange(null)` enquanto está vazio. */
function QuadroAssinatura({ nomePadrao, onChange }: { nomePadrao: string; onChange: (valor: { imagem: string; metodo: MetodoAssinatura } | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const [modo, setModo] = useState<MetodoAssinatura>("DESENHO");
  const [temTraco, setTemTraco] = useState(false);
  const [nome, setNome] = useState(nomePadrao);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = limpar(c);
    if (modo === "DESENHO") { setTemTraco(false); onChange(null); return; }
    const texto = nome.trim();
    if (!texto || !ctx) { onChange(null); return; }
    let ativo = true;
    const fonte = `76px ${cursiva.style.fontFamily}`;
    // A fonte web pode não ter chegado: sem esperar, o canvas desenharia na fonte de reserva.
    void document.fonts.load(fonte).then(() => {
      if (!ativo) return;
      limpar(c);
      ctx.font = fonte;
      ctx.fillStyle = TINTA;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(texto, c.width / 2, c.height / 2, c.width - 40);
      onChange({ imagem: c.toDataURL("image/png"), metodo: "DIGITADO" });
    });
    return () => { ativo = false; };
    // onChange vem do pai a cada render; o quadro só redesenha quando o modo ou o nome mudam (de propósito fora das dependências).
  }, [modo, nome]);

  function ponto(e: PointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  }
  function iniciar(e: PointerEvent<HTMLCanvasElement>) {
    if (modo !== "DESENHO") return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    desenhando.current = true;
    const { x, y } = ponto(e);
    ctx.strokeStyle = TINTA;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function mover(e: PointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current) return;
    const ctx = e.currentTarget.getContext("2d");
    const { x, y } = ponto(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
  }
  function terminar(e: PointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current) return;
    desenhando.current = false;
    setTemTraco(true);
    onChange({ imagem: e.currentTarget.toDataURL("image/png"), metodo: "DESENHO" });
  }
  function apagar() {
    if (canvas.current) limpar(canvas.current);
    setTemTraco(false);
    onChange(null);
  }

  return (
    <div className="grid gap-2">
      <div role="tablist" aria-label="Forma de assinar" className="flex gap-5 border-b border-[var(--border)]">
        <Aba grupo="assinatura-modo" ativa={modo === "DESENHO"} onClick={() => setModo("DESENHO")} className="xl:mb-0">Desenhar</Aba>
        <Aba grupo="assinatura-modo" ativa={modo === "DIGITADO"} onClick={() => setModo("DIGITADO")} className="xl:mb-0">Digitar nome</Aba>
      </div>
      {modo === "DIGITADO" && (
        <Field label="Nome para a assinatura">
          <Input value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
        </Field>
      )}
      <div className="relative">
        <canvas
          ref={canvas}
          width={QUADRO.largura}
          height={QUADRO.altura}
          role="img"
          aria-label={modo === "DESENHO" ? "Quadro para desenhar a assinatura com o mouse, o dedo ou a caneta" : "Prévia da assinatura com o nome digitado"}
          data-testid="assinatura-quadro"
          className={clsx("aspect-[3/1] w-full touch-none rounded-lg border border-[var(--border-strong)] bg-white", modo === "DESENHO" ? "cursor-crosshair" : "cursor-default")}
          onPointerDown={iniciar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerCancel={terminar}
        />
        {modo === "DESENHO" && !temTraco && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-[12px] text-slate-400">Assine aqui</span>
        )}
      </div>
      {modo === "DESENHO" && (
        <Button variant="ghost" className="h-9 justify-self-start px-2" onClick={apagar} disabled={!temTraco}>
          <Eraser size={15} aria-hidden />
          Limpar
        </Button>
      )}
    </div>
  );
}

/** Diálogo de assinatura: resumo do que se assina, quadro, senha e aceite. */
export function DialogoAssinatura({ titulo, descricao, nomePadrao, resumo, rotuloConfirmar, ocupado, erro, onCancelar, onConfirmar }: {
  titulo: string; descricao: string; nomePadrao: string; resumo: ReactNode; rotuloConfirmar: string;
  ocupado: boolean; erro: string | null; onCancelar: () => void; onConfirmar: (entrada: EntradaAssinatura) => void;
}) {
  const [assinatura, setAssinatura] = useState<{ imagem: string; metodo: MetodoAssinatura } | null>(null);
  const [senha, setSenha] = useState("");
  const pronto = !!assinatura && !!senha;

  function confirmar(e?: FormEvent) {
    e?.preventDefault();
    if (assinatura && senha) onConfirmar({ ...assinatura, senha });
  }

  return (
    <PortalDialog
      titulo={titulo}
      descricao={descricao}
      busy={ocupado}
      onClose={onCancelar}
      footer={
        <>
          <Button variant="secondary" className="h-10 w-full sm:w-auto" onClick={onCancelar} disabled={ocupado}>Cancelar</Button>
          <Button className="h-10 w-full sm:w-auto" onClick={() => confirmar()} disabled={ocupado || !pronto} aria-busy={ocupado}>
            <PenLine size={15} aria-hidden />
            {ocupado ? "Assinando..." : rotuloConfirmar}
          </Button>
        </>
      }
    >
      <ErroDialogo erro={erro} />
      {resumo}
      <QuadroAssinatura nomePadrao={nomePadrao} onChange={setAssinatura} />
      <form onSubmit={confirmar} className="grid gap-3">
        <Field label="Sua senha">
          <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
        </Field>
        <p className="text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">{TEXTO_ACEITE}</p>
      </form>
    </PortalDialog>
  );
}

/** Uma linha de resumo no padrão do diálogo de aprovação do BM. */
export function LinhaResumo({ rotulo, valor, forte }: { rotulo: string; valor: ReactNode; forte?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={forte ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>{rotulo}</dt>
      <dd className={clsx("min-w-0 break-words text-right tabular-nums text-[var(--foreground)]", forte ? "font-bold" : "font-medium")}>{valor}</dd>
    </div>
  );
}

export function Resumo({ children }: { children: ReactNode }) {
  return <dl className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-[13px]">{children}</dl>;
}

function CartaoAssinatura({ papel, assinatura, acao, testId }: { papel: string; assinatura: Assinatura | null; acao?: ReactNode; testId: string }) {
  return (
    <div className="grid content-start gap-2 rounded-lg border border-[var(--border)] p-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">{papel}</p>
        {assinatura ? <Badge variant="success">Assinada</Badge> : <Badge variant="neutral">Aguardando</Badge>}
      </div>
      {assinatura ? (
        <>
          {/* PNG gerado pelo próprio quadro, servido junto da folha (data URL): sem otimização de imagem a fazer. */}
          <img src={assinatura.imagem} alt={`Assinatura de ${assinatura.nome}`} className="h-16 w-auto max-w-full justify-self-start rounded border border-[var(--border)] bg-white" />
          <p className="text-[13px] font-semibold text-[var(--foreground)]">{assinatura.nome}</p>
          <p className="text-[12px] text-[var(--muted-foreground)]">
            Assinado eletronicamente em {dataHoraAssinatura(assinatura.assinadoEm)} · código <span className="font-technical font-semibold text-[var(--foreground)]">{assinatura.codigo}</span>
          </p>
          {assinatura.alterada && (
            <p role="status" className="flex items-start gap-1.5 text-[12px] font-medium text-[var(--warning)]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
              Folha alterada após a assinatura.
            </p>
          )}
        </>
      ) : (
        <p className="text-[12px] text-[var(--muted-foreground)]">Ainda não assinada.</p>
      )}
      {acao}
    </div>
  );
}

/** As duas assinaturas da folha. `acaoFiscal`: botões do fiscal (assinar/revogar), só na tela dele. */
export function AssinaturasTimesheet({ assinaturas, acaoFiscal }: { assinaturas: Assinaturas; acaoFiscal?: ReactNode }) {
  return (
    <Card className="grid gap-3 p-4">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--foreground)]">
        <ShieldCheck size={15} aria-hidden />
        Assinaturas
      </h3>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="timesheet-assinaturas">
        <CartaoAssinatura papel="Colaborador" assinatura={assinaturas.colaborador} testId="timesheet-assinatura-colaborador" />
        <CartaoAssinatura papel="Fiscalização da VALE" assinatura={assinaturas.fiscal} acao={acaoFiscal} testId="timesheet-assinatura-fiscal" />
      </div>
    </Card>
  );
}

const ENCERRAMENTO: Record<string, string> = { REVOGADA: "Revogada pelo fiscal", REABERTURA: "Encerrada pela reabertura da folha" };

/** Confere um código de assinatura (medição: `/api/admin/...`; fiscal: `/api/fiscal/...`). */
export function VerificarAssinatura({ endpoint }: { endpoint: string }) {
  const [codigo, setCodigo] = useState("");
  const [resultado, setResultado] = useState<VerificacaoAssinatura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function verificar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true); setErro(null); setResultado(null);
    const res = await fetch(`${endpoint}?codigo=${encodeURIComponent(codigo.trim())}`, { cache: "no-store" });
    setOcupado(false);
    if (!res.ok) { setErro(await erroDaApi(res, "Não foi possível verificar o código.")); return; }
    setResultado((await res.json()) as VerificacaoAssinatura);
  }

  return (
    <Card className="p-4">
      {/* O Card não repassa atributos: o data-testid fica no conteúdo. */}
      <div className="grid gap-3" data-testid="verificar-assinatura">
        <form onSubmit={(e) => void verificar(e)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Verificar código de assinatura">
              <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="TS-XXXX-XXXX" maxLength={20} className="font-technical uppercase" />
            </Field>
          </div>
          <Button type="submit" variant="secondary" className="h-10" disabled={ocupado || !codigo.trim()} aria-busy={ocupado}>
            <Search size={15} aria-hidden />
            {ocupado ? "Verificando..." : "Verificar"}
          </Button>
        </form>
        <div aria-live="polite">
          {erro && <p role="alert" className="text-[13px] font-medium text-[var(--error)]">{erro}</p>}
          {resultado && (
            <Resumo>
              <LinhaResumo rotulo="Situação" valor={resultado.ativa ? <Badge variant="success">Válida</Badge> : <Badge variant="danger">{ENCERRAMENTO[resultado.encerramento ?? ""] ?? "Encerrada"}</Badge>} />
              <LinhaResumo rotulo="Assinada por" valor={`${resultado.nome} (${resultado.papel === "FISCAL" ? "fiscal" : "colaborador"})`} />
              <LinhaResumo rotulo="Em" valor={dataHoraAssinatura(resultado.assinadoEm)} />
              <LinhaResumo rotulo="Folha" valor={`${resultado.fornecedor.nome} · ciclo ${resultado.ciclo}`} />
              {resultado.ip && <LinhaResumo rotulo="Endereço de acesso" valor={resultado.ip} />}
              <LinhaResumo rotulo="Conteúdo" valor={resultado.alterada ? "Alterado após a assinatura" : "Igual ao assinado"} />
            </Resumo>
          )}
        </div>
      </div>
    </Card>
  );
}
