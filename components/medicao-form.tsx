"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button, Field, IconButton, Input, Select, Textarea } from "@/components/ui";
import type { Medicao, Profissional, Projeto } from "@/components/types";

type FormState = {
  numeroMedicao: string;
  idProjeto: string;
  idCoordenador: string;
  idProfissional: string;
  dataCadastro: string;
  formato: string;
  quantidade: string;
  multiplicador: string;
  equivalenteA1Horas: string;
  medidoHoras: string;
  valorUnitario: string;
  valorBruto: string;
  valorTotal: string;
  valorMedicao: string;
  itemQqp: string;
  referencia: string;
  tipo2: string;
  condicao: string;
  obs: string;
};

const emptyForm: FormState = {
  numeroMedicao: "",
  idProjeto: "",
  idCoordenador: "",
  idProfissional: "",
  dataCadastro: new Date().toISOString().slice(0, 10),
  formato: "HH",
  quantidade: "0",
  multiplicador: "1",
  equivalenteA1Horas: "0",
  medidoHoras: "0",
  valorUnitario: "0",
  valorBruto: "0",
  valorTotal: "0",
  valorMedicao: "0",
  itemQqp: "",
  referencia: "",
  tipo2: "HH",
  condicao: "",
  obs: "",
};

function fromMedicao(medicao: Medicao | null): FormState {
  if (!medicao) return emptyForm;
  return {
    numeroMedicao: medicao.numeroMedicao ?? "",
    idProjeto: medicao.idProjeto ?? "",
    idCoordenador: medicao.idCoordenador ?? "",
    idProfissional: medicao.idProfissional ?? "",
    dataCadastro: medicao.dataCadastro ? medicao.dataCadastro.slice(0, 10) : "",
    formato: medicao.formato ?? "HH",
    quantidade: String(medicao.quantidade ?? 0),
    multiplicador: String(medicao.multiplicador ?? 1),
    equivalenteA1Horas: String(medicao.equivalenteA1Horas ?? 0),
    medidoHoras: String(medicao.medidoHoras ?? 0),
    valorUnitario: String(medicao.valorUnitario ?? 0),
    valorBruto: String(medicao.valorBruto ?? 0),
    valorTotal: String(medicao.valorTotal ?? 0),
    valorMedicao: String(medicao.valorMedicao ?? 0),
    itemQqp: medicao.itemQqp ?? "",
    referencia: medicao.referencia ?? "",
    tipo2: medicao.tipo2 ?? "HH",
    condicao: medicao.condicao ?? "",
    obs: medicao.obs ?? "",
  };
}

function professionalLabel(profissional: Profissional) {
  if (profissional.nomeCompleto && profissional.nomeCompleto !== profissional.nome) {
    return `${profissional.nome} - ${profissional.nomeCompleto}`;
  }
  return profissional.nome;
}

export function MedicaoForm({
  open,
  medicao,
  projetos,
  profissionais,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  medicao: Medicao | null;
  projetos: Projeto[];
  profissionais: Profissional[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (data: FormState) => void;
}) {
  const [form, setForm] = useFormState(open, medicao);

  if (!open) return null;

  const update = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1A1A1A]/35 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#d8dee8] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-[#1A1A1A]">{medicao ? "Editar medição" : "Nova medição"}</h2>
            <p className="text-sm text-[#1A1A1A]">Campos relacionais usam os cadastros carregados do PostgreSQL.</p>
          </div>
          <IconButton onClick={onClose} title="Fechar">
            <X size={17} />
          </IconButton>
        </div>

        <form
          className="grid max-h-[calc(92vh-74px)] gap-5 overflow-y-auto p-5"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(form);
          }}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Número da medição">
              <Input value={form.numeroMedicao} onChange={(event) => update("numeroMedicao", event.target.value)} required />
            </Field>
            <Field label="Projeto">
              <Select value={form.idProjeto} onChange={(event) => update("idProjeto", event.target.value)} required>
                <option value="">Selecione</option>
                {projetos.map((projeto) => (
                  <option key={projeto.id} value={projeto.id}>
                    {projeto.codigoProjeto}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Data de cadastro">
              <Input type="date" value={form.dataCadastro} onChange={(event) => update("dataCadastro", event.target.value)} />
            </Field>
            <Field label="Coordenador">
              <Select value={form.idCoordenador} onChange={(event) => update("idCoordenador", event.target.value)}>
                <option value="">Sem coordenador</option>
                {profissionais.map((profissional) => (
                  <option key={profissional.id} value={profissional.id}>
                    {professionalLabel(profissional)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Profissional">
              <Select value={form.idProfissional} onChange={(event) => update("idProfissional", event.target.value)}>
                <option value="">Sem profissional</option>
                {profissionais.map((profissional) => (
                  <option key={profissional.id} value={profissional.id}>
                    {professionalLabel(profissional)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Formato">
              <Select value={form.formato} onChange={(event) => update("formato", event.target.value)}>
                <option value="HH">HH</option>
                <option value="A1">A1</option>
                <option value="UN">UN</option>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Quantidade">
              <Input type="number" step="0.01" value={form.quantidade} onChange={(event) => update("quantidade", event.target.value)} />
            </Field>
            <Field label="Multiplicador">
              <Input type="number" step="0.01" value={form.multiplicador} onChange={(event) => update("multiplicador", event.target.value)} />
            </Field>
            <Field label="Equivalente">
              <Input type="number" step="0.01" value={form.equivalenteA1Horas} onChange={(event) => update("equivalenteA1Horas", event.target.value)} />
            </Field>
            <Field label="Medido (Horas)">
              <Input type="number" step="0.01" value={form.medidoHoras} onChange={(event) => update("medidoHoras", event.target.value)} />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Valor unitário">
              <Input type="number" step="0.01" value={form.valorUnitario} onChange={(event) => update("valorUnitario", event.target.value)} />
            </Field>
            <Field label="Valor bruto">
              <Input type="number" step="0.01" value={form.valorBruto} onChange={(event) => update("valorBruto", event.target.value)} />
            </Field>
            <Field label="Valor total">
              <Input type="number" step="0.01" value={form.valorTotal} onChange={(event) => update("valorTotal", event.target.value)} />
            </Field>
            <Field label="Valor de medição">
              <Input type="number" step="0.01" value={form.valorMedicao} onChange={(event) => update("valorMedicao", event.target.value)} />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Item QQP">
              <Input value={form.itemQqp} onChange={(event) => update("itemQqp", event.target.value)} />
            </Field>
            <Field label="Referência">
              <Input value={form.referencia} onChange={(event) => update("referencia", event.target.value)} />
            </Field>
            <Field label="Tipo">
              <Input value={form.tipo2} onChange={(event) => update("tipo2", event.target.value)} />
            </Field>
            <Field label="Condição">
              <Input value={form.condicao} onChange={(event) => update("condicao", event.target.value)} />
            </Field>
          </div>

          <Field label="Observações">
            <Textarea value={form.obs} onChange={(event) => update("obs", event.target.value)} />
          </Field>

          <div className="flex justify-end gap-2 border-t border-[#d8dee8] pt-4">
            <Button type="button" className="border-[#cfd7e3] bg-white text-[#1A1A1A] hover:bg-[#f2f4f7]" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function useFormState(open: boolean, medicao: Medicao | null) {
  const [form, setForm] = useState<FormState>(() => fromMedicao(medicao));

  useEffect(() => {
    if (open) setForm(fromMedicao(medicao));
  }, [open, medicao]);

  return [form, setForm] as const;
}
