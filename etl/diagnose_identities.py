"""Diagnóstico SOMENTE LEITURA da coluna PROJETISTA de uma planilha de medição.

Uso: python diagnose_identities.py <planilha.xlsx|xlsm> [--sheet Documentos]

Para cada linha de medição (ou só de desconto) mostra a linha do Excel, o valor bruto de
PROJETISTA, se a célula está num intervalo mesclado (e a âncora), e o valor efetivo que o ETL usa.
Lista em destaque as linhas que ficariam SEM_PROJETISTA. Não conecta ao banco e não grava nada.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from openpyxl import load_workbook

from ingest_medicoes import (
    DEFAULT_SHEET,
    IDENTITY_HEADER,
    MEASUREMENT_COLUMNS,
    PROJECT_COLUMNS,
    SHEET_ALIASES,
    clean_text,
    extract,
    first_value,
    has_discount_data,
    is_valid_measurement_key,
    read_measurements_sheet,
    resolve_sheet_name,
    should_keep_vba,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("planilha", type=Path)
    parser.add_argument("--sheet", default=DEFAULT_SHEET)
    args = parser.parse_args()

    sheet_name = resolve_sheet_name(args.planilha, args.sheet, SHEET_ALIASES["Documentos"])
    df = read_measurements_sheet(args.planilha, sheet_name)
    excel_rows = df.attrs.get("excel_row_numbers", [])

    workbook = load_workbook(args.planilha, read_only=False, data_only=True, keep_vba=should_keep_vba(args.planilha))
    try:
        sheet = workbook[sheet_name]
        header_cell = next(
            (cell for row in sheet.iter_rows(max_row=100) for cell in row if clean_text(cell.value) == IDENTITY_HEADER),
            None,
        )
        column = header_cell.column if header_cell else None
        merged = [r for r in sheet.merged_cells.ranges if column and r.min_col <= column <= r.max_col]

        sem_projetista = []
        print(f"Aba: {sheet_name} · coluna {IDENTITY_HEADER}: {header_cell.coordinate if header_cell else 'não encontrada'}")
        print(f"Intervalos mesclados na coluna: {len(merged)}")
        print("linha\tbruto\tmesclado\tefetivo")
        for position, (_index, row) in enumerate(df.iterrows()):
            project = extract(row, PROJECT_COLUMNS)
            numero = clean_text(first_value(row, MEASUREMENT_COLUMNS["numero_medicao"]))
            if not is_valid_measurement_key(numero, clean_text(project["codigo_projeto"])) and not has_discount_data(row):
                continue
            linha = excel_rows[position] if position < len(excel_rows) else None
            bruto = clean_text(sheet.cell(linha, column).value) if linha and column else None
            faixa = next((r for r in merged if linha and r.min_row <= linha <= r.max_row), None)
            efetivo = clean_text(row.get(IDENTITY_HEADER))
            print(f"{linha}\t{bruto or ''}\t{faixa.coord if faixa else ''}\t{efetivo or '(vazio)'}")
            if not efetivo:
                sem_projetista.append((linha, clean_text(first_value(row, MEASUREMENT_COLUMNS["numero_documento"]))))

        print(f"\nLinhas SEM_PROJETISTA (bloqueiam a importação): {len(sem_projetista)}")
        for linha, documento in sem_projetista:
            print(f"  linha {linha} · documento {documento or '—'}")
    finally:
        workbook.close()


if __name__ == "__main__":
    main()
