"""Planilha SINTÉTICA de medição para e2e/importacao-identidades.spec.ts (nenhum nome/documento real).

Uso: python e2e/fixtures/planilha_identidades.py <saida.xlsx> <SUFIXO>

Conteúdo (aba Documentos):
  - FORNECEDOR E2E <S> RESOLVIDO  — cadastro existente (100)
  - MARIA <S> COSTA                — AUTO_MATCH com "MARIA <S> FERNANDA LIMA COSTA" (10)
  - ROMERO <S> PINTO (2 linhas)    — sem cadastro → pendente; será vinculado (30 + 20)
  - CARLOS <S> NUNES               — sem cadastro → pendente; será descartado (30)
  - linha totalmente vazia e linha só com espaços (ignoradas)
  - 1 linha com dados e sem PROJETISTA (7) — erro estrutural até ser descartada
"""
from __future__ import annotations

import sys
from pathlib import Path

from openpyxl import Workbook

HEADERS = [
    "Número da Medição", "Projeto Referente", "Número do Documento", "Evidência", "Formato", "Quantidade",
    "Multiplicador", "Equivalente (A1 ou Horas)", "Medido (Horas)", "Item da QQP", "Valor Unitário", "Valor Bruto",
    "Valor Total", "Valor do Reajuste", "CICLO", "PROJETISTA", "REFERÊNCIA", "% EMISSÃO", "TIPO", "VALOR DE MEDIÇÃO",
]


def linha(projetista: str | None, documento: str, valor: float) -> list:
    valores = {
        "Número da Medição": "BM01", "Projeto Referente": "PRJ-E2E-IDENT", "Número do Documento": documento,
        "Evidência": "GRD-T-SINT-0001", "Formato": "A4", "Quantidade": 1, "Multiplicador": 1,
        "Equivalente (A1 ou Horas)": 0.125, "Medido (Horas)": 1, "Item da QQP": "1", "Valor Unitário": valor,
        "Valor Bruto": valor, "Valor Total": valor, "Valor do Reajuste": 0, "CICLO": "2806",
        "PROJETISTA": projetista, "REFERÊNCIA": "A", "% EMISSÃO": 1, "TIPO": "DG", "VALOR DE MEDIÇÃO": valor,
    }
    return [valores[h] for h in HEADERS]


def main() -> None:
    saida, s = Path(sys.argv[1]), sys.argv[2]
    wb = Workbook()
    ws = wb.active
    ws.title = "Documentos"
    ws.append(HEADERS)
    ws.append(linha(f"FORNECEDOR E2E {s} RESOLVIDO", f"DOC-{s}-A", 100))
    ws.append(linha(f"MARIA {s} COSTA", f"DOC-{s}-M", 10))
    ws.append(linha(f"ROMERO {s} PINTO", f"DOC-{s}-R1", 30))
    ws.append([None] * len(HEADERS))
    ws.append(linha(f"ROMERO {s} PINTO", f"DOC-{s}-R2", 20))
    ws.append(["   "] * len(HEADERS))
    ws.append(linha(f"CARLOS {s} NUNES", f"DOC-{s}-C", 30))
    ws.append(linha(None, f"DOC-{s}-SEM", 7))
    wb.create_sheet("Documentos Auxiliares").append(["Responsavel", "Auxiliar", "Ciclo"])
    wb.save(saida)


if __name__ == "__main__":
    main()
