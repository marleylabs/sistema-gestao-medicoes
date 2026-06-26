from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import unicodedata
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import pandas as pd
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from openpyxl import load_workbook
from openpyxl.utils.cell import range_boundaries
from sqlalchemy import MetaData, create_engine, text
from sqlalchemy.dialects.postgresql import insert


DEFAULT_SHEET = "Geral"
DEFAULT_BASE_SHEET = "BASE"
DEFAULT_PAYMENT_MAP_SHEET = "MAPA PAGTO"
DEFAULT_BM_AUX_SHEET = "BM AUX"
DEFAULT_EXCEL_PATH = r"C:\Users\anderson.marley\Desktop\2605 - ELABORAÇÃO DE BMS - ( PROJETISTAS ).xlsm"
ENCRYPTED_PREFIX = "enc:v1"
SENSITIVE_RAW_COLUMNS = {
    "cpf",
    "cnpj",
    "cpf/cnpj",
    "cpf / cnpj",
    "e-mail",
    "email",
}

PROJECT_COLUMNS = {
    "codigo_projeto": ["Projeto Referente"],
    "titulo_primario": ["Título Primário"],
    "centro_custo": ["Centro de Custo"],
    "localizacao": ["Localização", "Localização.1", "Localização .1"],
    "contrato": ["CONTRATO"],
}

PROFESSIONAL_COLUMNS = {
    "nome": ["PROJETISTA", "Evidência", "Número do Documento"],
    "funcao": ["FUNÇÃO", "FUNÇÃO2", "Função"],
}

COORDINATOR_COLUMNS = {
    "nome": ["Coordenador", "Mesclado"],
}

BASE_PROFESSIONAL_COLUMNS = {
    "codigo": ["Codigo", "Código"],
    "nome_completo": ["Nome Completo"],
    "cpf": ["CPF"],
    "razao_social": ["Razão Social"],
    "cnpj": ["CNPJ"],
    "email": ["E-mail", "Email"],
    "funcao": ["Função", "FUNÇÃO"],
}

PAYMENT_MAP_COLUMNS = {
    "status_source": ["ATO"],
    "codigo": ["PROJETISTA"],
    "valor": ["VALOR"],
}

PAYMENT_MAP_ITEM_COLUMNS = {
    "ato": ["ATO"],
    "projetista_codigo": ["PROJETISTA"],
    "responsavel": ["RESPONSÁVEL", "RESPONSAVEL"],
    "cpf_cnpj": ["CPF / CNPJ", "CPF/CNPJ"],
    "razao_social": ["CNPJ", "Razão Social", "RAZÃO SOCIAL"],
    "intr_sossego": ["Intr. Sossego", "Intr. Sossego."],
    "salobo": ["Salobo"],
    "acg": ["ACG"],
    "escadas_alumar": ["Escadas Alumar"],
    "valor": ["VALOR"],
    "rev": ["REV"],
    "status": ["STATUS", "CONDIÇÃO"],
}

BM_AUX_COLUMNS = {
    "responsavel_codigo": ["Responsavel", "Responsável"],
    "ciclo": ["Ciclo", "CICLO"],
    "equivalente_revisado": ["Equivalente_Revisado"],
    "valor_medicao": ["VALOR DE MEDIÇÃO", "VALOR DA MEDIÇÃO", "Valor da Medição"],
}

MEASUREMENT_COLUMNS = {
    "numero_medicao": ["Número da Medição"],
    "mesclado": ["Mesclado"],
    "numero_documento": ["Número do Documento"],
    "evidencia": ["Evidência"],
    "data_cadastro": ["Data de Cadastro"],
    "formato": ["Formato", "Coluna1"],
    "quantidade": ["Quantidade"],
    "multiplicador": ["Multiplicador"],
    "equivalente_a1_horas": ["Equivalente (A1 ou Horas)"],
    "porcentagem_revisao": ["Porcentagem de Revisão"],
    "emissao_inicial": ["Emissão Inicial"],
    "retorno_vale": ["Retorno Vale"],
    "encerramento": ["Encerramento"],
    "arquivamento": ["Arquivamento"],
    "medido_horas": ["Medido (Horas)"],
    "item_qqp": ["Item da QQP"],
    "valor_unitario": ["Valor Unitário"],
    "valor_bruto": ["Valor Bruto"],
    "valor_total": ["Valor Total"],
    "obs": ["OBS"],
    "valor_reajuste": ["Valor do Reajuste"],
    "ciclo": ["CICLO"],
    "referencia": ["REFERÊNCIA"],
    "percentual_emissao": ["% EMISSÃO"],
    "tipo2": ["TIPO2"],
    "condicao": ["CONDIÇÃO"],
    "valor_medicao": ["VALOR DE MEDIÇÃO"],
}


def is_valid_measurement_key(numero_medicao: str | None, codigo_projeto: str | None) -> bool:
    if not numero_medicao or not codigo_projeto:
        return False

    invalid_values = {
        "número da medição",
        "numero da medição",
        "projeto referente",
        "coordenador",
        "projetista",
    }
    if numero_medicao.casefold() in invalid_values or codigo_projeto.casefold() in invalid_values:
        return False

    return numero_medicao.upper().startswith("BM")


def first_value(row: pd.Series, candidates: list[str]) -> Any:
    for column in candidates:
        if column in row.index and not pd.isna(row[column]):
            value = row[column]
            if isinstance(value, str) and not value.strip():
                continue
            return value
    return None


def clean_text(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    value = str(value).replace("\xa0", " ").strip()
    value = " ".join(value.split())
    return value or None


def encryption_key() -> bytes:
    encoded = os.getenv("DATA_ENCRYPTION_KEY")
    if not encoded:
        raise RuntimeError("DATA_ENCRYPTION_KEY não configurada.")
    key = base64.b64decode(encoded)
    if len(key) != 32:
        raise RuntimeError("DATA_ENCRYPTION_KEY deve conter exatamente 32 bytes em Base64.")
    return key


def encrypt_sensitive(value: Any) -> str | None:
    cleaned = clean_text(value)
    if not cleaned:
        return None
    nonce = os.urandom(12)
    encrypted = AESGCM(encryption_key()).encrypt(nonce, cleaned.encode("utf-8"), None)
    ciphertext, tag = encrypted[:-16], encrypted[-16:]
    return ":".join(
        [
            ENCRYPTED_PREFIX,
            base64.b64encode(nonce).decode("ascii"),
            base64.b64encode(tag).decode("ascii"),
            base64.b64encode(ciphertext).decode("ascii"),
        ]
    )


def safe_raw_payload(row: pd.Series, unnamed_prefix: str) -> dict[str, Any]:
    return {
        str(key): json_safe(value)
        for key, value in row.to_dict().items()
        if not str(key).startswith(unnamed_prefix)
        and normalize_for_compare(str(key)) not in SENSITIVE_RAW_COLUMNS
    }


def normalize_for_compare(value: str | None) -> str:
    if value is None:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return normalized.casefold().strip()


def normalize_collaborator_status(value: Any) -> str:
    source = clean_text(value)
    if normalize_for_compare(source) == "producao":
        return "PRODUÇÃO"
    return "ATO"


def is_expense_professional_name(value: str | None) -> bool:
    return normalize_for_compare(value).startswith("despesa alimentacao")


def has_positive_payment_value(valor: Decimal | None) -> bool:
    return bool(valor is not None and valor > 0)


def is_payment_map_ato(value: Any, valor: Decimal | None, codigo: str | None, positive_payment_codes: set[str]) -> bool:
    normalized = normalize_for_compare(clean_text(value))
    return bool(normalized and normalized != "producao" and has_positive_payment_value(valor))


def is_payment_map_production(value: Any, valor: Decimal | None, codigo: str | None, positive_payment_codes: set[str]) -> bool:
    normalized = normalize_for_compare(clean_text(value))
    has_positive_source_value = normalize_for_compare(codigo) in positive_payment_codes
    return bool(normalized in {"", "producao"} and (has_positive_payment_value(valor) or has_positive_source_value))


def clean_decimal(value: Any, default: Decimal | None = Decimal("0")) -> Decimal | None:
    if value is None or pd.isna(value):
        return default
    if isinstance(value, (int, float, Decimal)):
        if pd.isna(value):
            return default
        return Decimal(str(value))

    raw = str(value).strip()
    if not raw:
        return default

    normalized = raw.replace("R$", "").replace("\xa0", "").replace(" ", "")
    if normalized.endswith("%"):
        normalized = normalized[:-1]

    if "," in normalized and "." in normalized:
        normalized = normalized.replace(".", "").replace(",", ".")
    elif "," in normalized:
        normalized = normalized.replace(",", ".")

    try:
        return Decimal(normalized)
    except InvalidOperation:
        return default


def clean_percent(value: Any) -> Decimal | None:
    number = clean_decimal(value, default=None)
    if number is None:
        return None
    if isinstance(value, str) and "%" in value:
        return number / Decimal("100")
    return number


def clean_date(value: Any) -> date | None:
    if value is None or pd.isna(value):
        return None
    parsed = pd.to_datetime(value, dayfirst=True, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.date()


def json_safe(value: Any) -> Any:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, (date, Decimal)):
        return str(value)
    return value


def source_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def extract(row: pd.Series, mapping: dict[str, list[str]]) -> dict[str, Any]:
    return {target: first_value(row, candidates) for target, candidates in mapping.items()}


def load_schema(engine, schema_path: Path) -> None:
    sql = schema_path.read_text(encoding="utf-8")
    with engine.begin() as conn:
        conn.execute(text(sql))


def reflect_tables(engine):
    metadata = MetaData()
    metadata.reflect(
        engine,
        only=[
            "projetos",
            "profissionais",
            "medicoes",
            "mapa_pagamento_contexto",
            "mapa_pagamento_itens",
            "bm_aux_medicoes",
        ],
    )
    return (
        metadata.tables["projetos"],
        metadata.tables["profissionais"],
        metadata.tables["medicoes"],
        metadata.tables["mapa_pagamento_contexto"],
        metadata.tables["mapa_pagamento_itens"],
        metadata.tables["bm_aux_medicoes"],
    )


def clear_imported_database(conn, ciclo: str) -> None:
    # Delete seletivo por ciclo — preserva dados de outros ciclos.
    # projetos e profissionais são master data compartilhado entre ciclos: nunca deletar.
    conn.execute(text("DELETE FROM medicoes WHERE ciclo = :ciclo"), {"ciclo": ciclo})
    conn.execute(text("DELETE FROM bm_aux_medicoes WHERE ciclo = :ciclo"), {"ciclo": ciclo})
    conn.execute(text("DELETE FROM mapa_pagamento_itens WHERE ciclo = :ciclo"), {"ciclo": ciclo})


def upsert_project(conn, projetos, data: dict[str, Any]) -> int:
    stmt = insert(projetos).values(**data)
    stmt = (
        stmt
        .on_conflict_do_update(
            index_elements=[projetos.c.codigo_projeto],
            set_={
                "titulo_primario": stmt.excluded.titulo_primario,
                "centro_custo": stmt.excluded.centro_custo,
                "localizacao": stmt.excluded.localizacao,
                "contrato": stmt.excluded.contrato,
                "updated_at": text("now()"),
            },
        )
        .returning(projetos.c.id)
    )
    return conn.execute(stmt).scalar_one()


def upsert_professional(conn, profissionais, data: dict[str, Any]) -> int | None:
    nome = clean_text(data.get("nome"))
    if not nome or is_expense_professional_name(nome):
        return None

    payload = {
        "nome": nome,
        "codigo": clean_text(data.get("codigo")),
        "nome_completo": clean_text(data.get("nome_completo")),
        "cpf": encrypt_sensitive(data.get("cpf")),
        "razao_social": clean_text(data.get("razao_social")),
        "cnpj": encrypt_sensitive(data.get("cnpj")),
        "email": encrypt_sensitive(data.get("email")),
        "status_colaborador": clean_text(data.get("status_colaborador")),
        "funcao": clean_text(data.get("funcao")),
    }
    stmt = insert(profissionais).values(**payload)
    stmt = (
        stmt
        .on_conflict_do_update(
            index_elements=[profissionais.c.nome],
            set_={
                "codigo": text("coalesce(excluded.codigo, profissionais.codigo)"),
                "nome_completo": text("coalesce(excluded.nome_completo, profissionais.nome_completo)"),
                "cpf": text("coalesce(excluded.cpf, profissionais.cpf)"),
                "razao_social": text("coalesce(excluded.razao_social, profissionais.razao_social)"),
                "cnpj": text("coalesce(excluded.cnpj, profissionais.cnpj)"),
                "email": text("coalesce(excluded.email, profissionais.email)"),
                "status_colaborador": text("coalesce(excluded.status_colaborador, profissionais.status_colaborador)"),
                "funcao": text("coalesce(profissionais.funcao, excluded.funcao)"),
                "updated_at": text("now()"),
            },
        )
        .returning(profissionais.c.id)
    )
    return conn.execute(stmt).scalar_one()


def upsert_base_professional(conn, profissionais, data: dict[str, Any]) -> int:
    stmt = insert(profissionais).values(**data)
    stmt = (
        stmt
        .on_conflict_do_update(
            index_elements=[profissionais.c.nome],
            set_={
                "codigo": stmt.excluded.codigo,
                "nome_completo": stmt.excluded.nome_completo,
                "cpf": stmt.excluded.cpf,
                "razao_social": stmt.excluded.razao_social,
                "cnpj": stmt.excluded.cnpj,
                "email": stmt.excluded.email,
                "status_colaborador": text("coalesce(profissionais.status_colaborador, excluded.status_colaborador)"),
                "funcao": stmt.excluded.funcao,
                "updated_at": text("now()"),
            },
        )
        .returning(profissionais.c.id)
    )
    return conn.execute(stmt).scalar_one()


def upsert_payment_map_status(conn, profissionais, data: dict[str, Any]) -> int:
    stmt = insert(profissionais).values(**data)
    stmt = (
        stmt
        .on_conflict_do_update(
            index_elements=[profissionais.c.nome],
            set_={
                "codigo": text("coalesce(profissionais.codigo, excluded.codigo)"),
                "status_colaborador": stmt.excluded.status_colaborador,
                "updated_at": text("now()"),
            },
        )
        .returning(profissionais.c.id)
    )
    return conn.execute(stmt).scalar_one()


def build_base_professional(row: pd.Series) -> dict[str, Any] | None:
    raw = extract(row, BASE_PROFESSIONAL_COLUMNS)
    codigo = clean_text(raw["codigo"])
    if not codigo or codigo.casefold() in {"codigo", "código"}:
        return None

    return {
        "nome": codigo,
        "codigo": codigo,
        "nome_completo": clean_text(raw["nome_completo"]),
        "cpf": encrypt_sensitive(raw["cpf"]),
        "razao_social": clean_text(raw["razao_social"]),
        "cnpj": encrypt_sensitive(raw["cnpj"]),
        "email": encrypt_sensitive(raw["email"]),
        "status_colaborador": None,
        "funcao": clean_text(raw["funcao"]),
    }


def build_positive_payment_codes(df: pd.DataFrame, bm_aux_df: pd.DataFrame) -> set[str]:
    positive_payment_codes: set[str] = set()

    for _, row in df.iterrows():
        codigo = clean_text(first_value(row, ["PROJETISTA"]))
        valor_medicao = clean_decimal(first_value(row, MEASUREMENT_COLUMNS["valor_medicao"]))
        if codigo and has_positive_payment_value(valor_medicao):
            positive_payment_codes.add(normalize_for_compare(codigo))

    for _, row in bm_aux_df.iterrows():
        raw = extract(row, BM_AUX_COLUMNS)
        codigo = clean_text(raw["responsavel_codigo"])
        valor_medicao = clean_decimal(raw["valor_medicao"])
        if codigo and has_positive_payment_value(valor_medicao):
            positive_payment_codes.add(normalize_for_compare(codigo))

    return positive_payment_codes


def build_canonical_professional_codes(base_df: pd.DataFrame) -> dict[str, str]:
    canonical_codes: dict[str, str] = {}
    for _, row in base_df.iterrows():
        raw = extract(row, BASE_PROFESSIONAL_COLUMNS)
        codigo = clean_text(raw["codigo"])
        if not codigo:
            continue
        canonical_codes[normalize_for_compare(codigo)] = codigo
    return canonical_codes


def build_payment_map_status(
    row: pd.Series,
    positive_payment_codes: set[str],
    canonical_codes: dict[str, str],
) -> dict[str, Any] | None:
    raw = extract(row, PAYMENT_MAP_COLUMNS)
    codigo = clean_text(raw["codigo"])
    status_source = clean_text(raw["status_source"])
    valor = clean_decimal(raw["valor"])
    if not codigo:
        return None

    invalid_codes = {"projetista", "total", "valor"}
    if normalize_for_compare(codigo) in invalid_codes:
        return None

    codigo = canonical_codes.get(normalize_for_compare(codigo), codigo)

    if is_payment_map_ato(status_source, valor, codigo, positive_payment_codes):
        status_colaborador = "ATO"
    elif is_payment_map_production(status_source, valor, codigo, positive_payment_codes):
        status_colaborador = "PRODUÇÃO"
    else:
        return None

    return {
        "nome": codigo,
        "codigo": codigo,
        "status_colaborador": status_colaborador,
    }


def derive_ciclo_from_mes_referencia(mes_referencia: str | None) -> str | None:
    """Deriva o ciclo YYMM a partir de strings como 'Maio de 2026' ou 'Maio/2026'.
    Retorna None se não conseguir derivar com certeza — nunca usa fallback silencioso."""
    import re
    if not mes_referencia:
        return None
    meses = {
        "janeiro": "01", "fevereiro": "02", "março": "03", "marco": "03",
        "abril": "04", "maio": "05", "junho": "06",
        "julho": "07", "agosto": "08", "setembro": "09",
        "outubro": "10", "novembro": "11", "dezembro": "12",
    }
    texto = mes_referencia.lower().strip()
    mes_num = next((v for k, v in meses.items() if k in texto), None)
    # Busca o último grupo de 4 dígitos que representa um ano razoável (2020-2099)
    anos = re.findall(r"\b(20[2-9]\d)\b", texto)
    if not mes_num or not anos:
        return None
    ano = anos[-1][-2:]  # últimos 2 dígitos do ano mais recente encontrado
    ciclo = f"{ano}{mes_num}"
    # Validação básica: YYMM onde MM entre 01-12
    if not re.fullmatch(r"\d{2}(0[1-9]|1[0-2])", ciclo):
        return None
    return ciclo


def build_payment_map_context(excel_path: Path, sheet_name: str, ciclo: str | None = None) -> dict[str, Any]:
    workbook = load_workbook(excel_path, read_only=True, data_only=True, keep_vba=True)
    sheet = workbook[sheet_name]
    contract_columns = range(7, 12)

    contratos = []
    rateio = []
    for column in contract_columns:
        nome = clean_text(sheet.cell(4, column).value)
        if not nome:
            continue
        contratos.append(
            {
                "contrato": nome,
                "valor": float(clean_decimal(sheet.cell(5, column).value) or 0),
            }
        )
        rateio.append(
            {
                "contrato": nome,
                "percentual": float(clean_decimal(sheet.cell(6, column).value) or 0),
            }
        )

    mes_referencia = clean_text(sheet["H1"].value)
    if not ciclo:
        ciclo = derive_ciclo_from_mes_referencia(mes_referencia)
    if not ciclo:
        raise ValueError(
            f"Não foi possível derivar o ciclo a partir de '{mes_referencia}'. "
            "Informe o ciclo explicitamente (ex: 2606) no campo da interface."
        )

    return {
        "ciclo": ciclo,
        "mes_referencia": mes_referencia,
        "producao_label": clean_text(sheet["G2"].value),
        "producao_inicio": clean_date(sheet["H2"].value),
        "producao_fim": clean_date(sheet["K2"].value),
        "ato_label": clean_text(sheet["H3"].value),
        "ato_ciclo": clean_text(sheet["K3"].value),
        "contratos": contratos,
        "rateio": rateio,
    }


def read_excel_table(excel_path: Path, sheet_name: str, table_name: str) -> pd.DataFrame:
    workbook = load_workbook(excel_path, read_only=False, data_only=True, keep_vba=True)
    try:
        sheet = workbook[sheet_name]
        if table_name not in sheet.tables:
            return pd.DataFrame()

        table = sheet.tables[table_name]
        min_col, min_row, max_col, max_row = range_boundaries(table.ref)
        rows = [
            list(row)
            for row in sheet.iter_rows(
                min_row=min_row,
                max_row=max_row,
                min_col=min_col,
                max_col=max_col,
                values_only=True,
            )
        ]
        return dataframe_from_excel_rows(rows)
    finally:
        workbook.close()


def dataframe_from_excel_rows(rows: list[list[Any]]) -> pd.DataFrame:
    if len(rows) < 2:
        return pd.DataFrame()

    headers = [clean_text(value) or f"unnamed_{index + 1}" for index, value in enumerate(rows[0])]
    df = pd.DataFrame(rows[1:], columns=headers)
    return df.dropna(how="all").reset_index(drop=True)


def read_excel_header_region(
    excel_path: Path,
    sheet_name: str,
    required_headers: set[str],
    key_header: str,
    max_header_row: int = 100,
) -> pd.DataFrame:
    workbook = load_workbook(excel_path, read_only=False, data_only=True, keep_vba=True)
    try:
        sheet = workbook[sheet_name]
        header_row = None
        min_col = None
        max_col = None

        for row_number in range(1, min(sheet.max_row, max_header_row) + 1):
            values = [clean_text(sheet.cell(row_number, column).value) for column in range(1, sheet.max_column + 1)]
            normalized = {normalize_for_compare(value) for value in values if value}
            if {normalize_for_compare(value) for value in required_headers}.issubset(normalized):
                populated_columns = [index + 1 for index, value in enumerate(values) if value]
                header_row = row_number
                min_col = min(populated_columns)
                max_col = max(populated_columns)
                break

        if header_row is None or min_col is None or max_col is None:
            return pd.DataFrame()

        headers = [clean_text(sheet.cell(header_row, column).value) for column in range(min_col, max_col + 1)]
        key_index = next(
            (
                index
                for index, header in enumerate(headers)
                if normalize_for_compare(header) == normalize_for_compare(key_header)
            ),
            None,
        )
        if key_index is None:
            return pd.DataFrame()

        last_row = header_row
        for row_number in range(header_row + 1, sheet.max_row + 1):
            if clean_text(sheet.cell(row_number, min_col + key_index).value):
                last_row = row_number

        rows = [
            [sheet.cell(row_number, column).value for column in range(min_col, max_col + 1)]
            for row_number in range(header_row, last_row + 1)
        ]
        return dataframe_from_excel_rows(rows)
    finally:
        workbook.close()


def read_payment_map_items(excel_path: Path, sheet_name: str) -> pd.DataFrame:
    table = read_excel_table(excel_path, sheet_name, "Tabela5")
    if not table.empty:
        return table

    return read_excel_header_region(
        excel_path,
        sheet_name,
        required_headers={"ATO", "PROJETISTA", "VALOR"},
        key_header="PROJETISTA",
    )


def build_payment_map_item(row: pd.Series, ordem: int, canonical_codes: dict[str, str], ciclo: str = "2605") -> dict[str, Any] | None:
    raw = extract(row, PAYMENT_MAP_ITEM_COLUMNS)
    projetista_codigo = clean_text(raw["projetista_codigo"])
    if not projetista_codigo:
        return None

    normalized_code = normalize_for_compare(projetista_codigo)
    invalid_codes = {"projetista", "total", "valor"}
    if normalized_code in invalid_codes or not any(char.isalpha() for char in projetista_codigo):
        return None

    projetista_codigo = canonical_codes.get(normalized_code, projetista_codigo)
    valor = clean_decimal(raw["valor"])
    ato = clean_text(raw["ato"])
    if has_positive_payment_value(valor) and not ato:
        ato = "PRODUÇÃO"

    payload = {
        "ciclo": ciclo,
        "ordem": ordem,
        "ato": ato,
        "projetista_codigo": projetista_codigo,
        "responsavel": clean_text(raw["responsavel"]),
        "cpf_cnpj": encrypt_sensitive(raw["cpf_cnpj"]),
        "razao_social": clean_text(raw["razao_social"]),
        "intr_sossego": clean_decimal(raw["intr_sossego"]),
        "salobo": clean_decimal(raw["salobo"]),
        "acg": clean_decimal(raw["acg"]),
        "escadas_alumar": clean_decimal(raw["escadas_alumar"]),
        "valor": valor,
        "rev": clean_decimal(raw["rev"]),
        "status": clean_text(raw["status"]),
    }
    raw_payload = safe_raw_payload(row, "unnamed_")
    payload["raw_payload"] = raw_payload
    payload["source_row_hash"] = source_hash({"ciclo": ciclo, "ordem": ordem, **raw_payload})
    return payload


def upsert_payment_map_item(conn, mapa_pagamento_itens, data: dict[str, Any]) -> None:
    stmt = insert(mapa_pagamento_itens).values(**data)
    stmt = stmt.on_conflict_do_update(
        index_elements=[mapa_pagamento_itens.c.source_row_hash],
        set_={
            "ordem": stmt.excluded.ordem,
            "ato": stmt.excluded.ato,
            "projetista_codigo": stmt.excluded.projetista_codigo,
            "responsavel": stmt.excluded.responsavel,
            "cpf_cnpj": stmt.excluded.cpf_cnpj,
            "razao_social": stmt.excluded.razao_social,
            "intr_sossego": stmt.excluded.intr_sossego,
            "salobo": stmt.excluded.salobo,
            "acg": stmt.excluded.acg,
            "escadas_alumar": stmt.excluded.escadas_alumar,
            "valor": stmt.excluded.valor,
            "rev": stmt.excluded.rev,
            "status": stmt.excluded.status,
            "raw_payload": stmt.excluded.raw_payload,
            "updated_at": text("now()"),
        },
    )
    conn.execute(stmt)


def read_bm_aux_sheet(excel_path: Path, sheet_name: str) -> pd.DataFrame:
    raw = pd.read_excel(excel_path, sheet_name=sheet_name, dtype=object)
    raw = raw.dropna(how="all").reset_index(drop=True)
    if raw.empty:
        return raw

    headers = [clean_text(value) or f"unnamed_{index + 1}" for index, value in enumerate(raw.iloc[0].tolist())]
    df = raw.iloc[1:].copy()
    df.columns = headers
    return df.dropna(how="all").reset_index(drop=True)


def build_bm_aux_measurement(row: pd.Series) -> dict[str, Any] | None:
    raw = extract(row, BM_AUX_COLUMNS)
    responsavel_codigo = clean_text(raw["responsavel_codigo"])
    if not responsavel_codigo or not any(char.isalpha() for char in responsavel_codigo):
        return None

    ciclo = clean_text(raw["ciclo"])
    valor_medicao = clean_decimal(raw["valor_medicao"])
    if not has_positive_payment_value(valor_medicao):
        return None

    raw_payload = safe_raw_payload(row, "unnamed_")

    return {
        "responsavel_codigo": responsavel_codigo,
        "ciclo": ciclo,
        "equivalente_revisado": clean_decimal(raw["equivalente_revisado"]),
        "valor_medicao": valor_medicao,
        "source_row_hash": source_hash(raw_payload),
        "raw_payload": raw_payload,
    }


def upsert_bm_aux_measurement(conn, bm_aux_medicoes, data: dict[str, Any]) -> None:
    stmt = insert(bm_aux_medicoes).values(**data)
    stmt = stmt.on_conflict_do_update(
        index_elements=[bm_aux_medicoes.c.source_row_hash],
        set_={
            "responsavel_codigo": stmt.excluded.responsavel_codigo,
            "ciclo": stmt.excluded.ciclo,
            "equivalente_revisado": stmt.excluded.equivalente_revisado,
            "valor_medicao": stmt.excluded.valor_medicao,
            "raw_payload": stmt.excluded.raw_payload,
            "updated_at": text("now()"),
        },
    )
    conn.execute(stmt)


def upsert_payment_map_context(conn, mapa_pagamento_contexto, data: dict[str, Any]) -> None:
    stmt = insert(mapa_pagamento_contexto).values(**data)
    stmt = stmt.on_conflict_do_update(
        index_elements=[mapa_pagamento_contexto.c.ciclo],
        set_={
            "mes_referencia": stmt.excluded.mes_referencia,
            "producao_label": stmt.excluded.producao_label,
            "producao_inicio": stmt.excluded.producao_inicio,
            "producao_fim": stmt.excluded.producao_fim,
            "ato_label": stmt.excluded.ato_label,
            "ato_ciclo": stmt.excluded.ato_ciclo,
            "contratos": stmt.excluded.contratos,
            "rateio": stmt.excluded.rateio,
            "updated_at": text("now()"),
        },
    )
    conn.execute(stmt)


def build_measurement(row: pd.Series) -> dict[str, Any]:
    raw_measurement = extract(row, MEASUREMENT_COLUMNS)
    payload = {
        "numero_medicao": clean_text(raw_measurement["numero_medicao"]),
        "mesclado": clean_text(raw_measurement["mesclado"]),
        "numero_documento": clean_text(raw_measurement["numero_documento"]),
        "evidencia": clean_text(raw_measurement["evidencia"]),
        "data_cadastro": clean_date(raw_measurement["data_cadastro"]),
        "formato": clean_text(raw_measurement["formato"]),
        "quantidade": clean_decimal(raw_measurement["quantidade"]),
        "multiplicador": clean_decimal(raw_measurement["multiplicador"]),
        "equivalente_a1_horas": clean_decimal(raw_measurement["equivalente_a1_horas"]),
        "porcentagem_revisao": clean_percent(raw_measurement["porcentagem_revisao"]),
        "emissao_inicial": clean_percent(raw_measurement["emissao_inicial"]),
        "retorno_vale": clean_percent(raw_measurement["retorno_vale"]),
        "encerramento": clean_percent(raw_measurement["encerramento"]),
        "arquivamento": clean_percent(raw_measurement["arquivamento"]),
        "medido_horas": clean_decimal(raw_measurement["medido_horas"]),
        "item_qqp": clean_text(raw_measurement["item_qqp"]),
        "valor_unitario": clean_decimal(raw_measurement["valor_unitario"]),
        "valor_bruto": clean_decimal(raw_measurement["valor_bruto"]),
        "valor_total": clean_decimal(raw_measurement["valor_total"]),
        "obs": clean_text(raw_measurement["obs"]),
        "valor_reajuste": clean_decimal(raw_measurement["valor_reajuste"]),
        "ciclo": clean_text(raw_measurement["ciclo"]),
        "referencia": clean_text(raw_measurement["referencia"]),
        "percentual_emissao": clean_percent(raw_measurement["percentual_emissao"]),
        "tipo2": clean_text(raw_measurement["tipo2"]),
        "condicao": clean_text(raw_measurement["condicao"]),
        "valor_medicao": clean_decimal(raw_measurement["valor_medicao"]),
    }
    raw_payload = safe_raw_payload(row, "Unnamed")
    payload["raw_payload"] = raw_payload
    payload["source_row_hash"] = source_hash(raw_payload)
    return payload


def ingest(
    excel_path: Path,
    sheet_name: str,
    base_sheet_name: str,
    payment_map_sheet_name: str,
    bm_aux_sheet_name: str,
    database_url: str,
    create_schema: bool,
    full_refresh: bool,
    ciclo: str | None = None,
) -> dict[str, int]:
    engine = create_engine(database_url, future=True)
    if create_schema:
        load_schema(engine, Path(__file__).resolve().parents[1] / "database" / "schema.sql")

    df = pd.read_excel(excel_path, sheet_name=sheet_name, dtype=object)
    df = df.dropna(how="all").reset_index(drop=True)
    base_df = pd.read_excel(excel_path, sheet_name=base_sheet_name, dtype=object)
    base_df = base_df.dropna(how="all").reset_index(drop=True)
    payment_map_df = pd.read_excel(excel_path, sheet_name=payment_map_sheet_name, header=7, dtype=object)
    payment_map_df = payment_map_df.dropna(how="all").reset_index(drop=True)
    payment_map_items_df = read_payment_map_items(excel_path, payment_map_sheet_name)
    bm_aux_df = read_bm_aux_sheet(excel_path, bm_aux_sheet_name)
    positive_payment_codes = build_positive_payment_codes(df, bm_aux_df)
    canonical_codes = build_canonical_professional_codes(base_df)

    projetos, profissionais, medicoes, mapa_pagamento_contexto, mapa_pagamento_itens, bm_aux_medicoes = reflect_tables(engine)
    payment_context = build_payment_map_context(excel_path, payment_map_sheet_name, ciclo=ciclo)
    ciclo_efetivo = payment_context["ciclo"]
    base_loaded = 0
    payment_status_loaded = 0
    payment_items_loaded = 0
    bm_aux_loaded = 0
    inserted_or_updated = 0
    source_hashes: set[str] = set()
    duplicate_source_rows = 0
    skipped = 0

    with engine.begin() as conn:
        if full_refresh:
            clear_imported_database(conn, ciclo_efetivo)

        upsert_payment_map_context(conn, mapa_pagamento_contexto, payment_context)

        for _, row in base_df.iterrows():
            base_professional = build_base_professional(row)
            if not base_professional:
                continue
            upsert_base_professional(conn, profissionais, base_professional)
            base_loaded += 1

        conn.execute(text("update profissionais set status_colaborador = null"))
        for _, row in payment_map_df.iterrows():
            payment_status = build_payment_map_status(row, positive_payment_codes, canonical_codes)
            if not payment_status:
                continue
            upsert_payment_map_status(conn, profissionais, payment_status)
            payment_status_loaded += 1

        for index, row in payment_map_items_df.iterrows():
            payment_item = build_payment_map_item(row, index + 1, canonical_codes, ciclo=ciclo_efetivo)
            if not payment_item:
                continue
            upsert_payment_map_item(conn, mapa_pagamento_itens, payment_item)
            payment_items_loaded += 1

        for _, row in bm_aux_df.iterrows():
            bm_aux_measurement = build_bm_aux_measurement(row)
            if not bm_aux_measurement:
                continue
            upsert_bm_aux_measurement(conn, bm_aux_medicoes, bm_aux_measurement)
            bm_aux_loaded += 1

        for _, row in df.iterrows():
            project_raw = extract(row, PROJECT_COLUMNS)
            codigo_projeto = clean_text(project_raw["codigo_projeto"])
            numero_medicao = clean_text(first_value(row, MEASUREMENT_COLUMNS["numero_medicao"]))
            if not is_valid_measurement_key(numero_medicao, codigo_projeto):
                skipped += 1
                continue

            id_projeto = upsert_project(
                conn,
                projetos,
                {
                    "codigo_projeto": codigo_projeto,
                    "titulo_primario": clean_text(project_raw["titulo_primario"]),
                    "centro_custo": clean_text(project_raw["centro_custo"]),
                    "localizacao": clean_text(project_raw["localizacao"]),
                    "contrato": clean_text(project_raw["contrato"]),
                },
            )

            id_profissional = upsert_professional(conn, profissionais, extract(row, PROFESSIONAL_COLUMNS))
            id_coordenador = upsert_professional(conn, profissionais, extract(row, COORDINATOR_COLUMNS))
            measurement = build_measurement(row)
            # Usa o ciclo efetivo como fallback quando a coluna CICLO está vazia na planilha
            if not measurement.get("ciclo"):
                measurement["ciclo"] = ciclo_efetivo
            measurement.update(
                {
                    "id_projeto": id_projeto,
                    "id_coordenador": id_coordenador,
                    "id_profissional": id_profissional,
                }
            )
            if measurement["source_row_hash"] in source_hashes:
                duplicate_source_rows += 1
            source_hashes.add(measurement["source_row_hash"])

            stmt = insert(medicoes).values(**measurement)
            stmt = (
                stmt
                .on_conflict_do_update(
                    index_elements=[medicoes.c.source_row_hash],
                    set_={
                        column: stmt.excluded[column]
                        for column in measurement
                        if column not in {"source_row_hash"}
                    }
                    | {"updated_at": text("now()")},
                )
            )
            conn.execute(stmt)
            inserted_or_updated += 1

    return {
        "rows_read": len(df),
        "base_rows_read": len(base_df),
        "base_professionals_loaded": base_loaded,
        "payment_map_rows_read": len(payment_map_df),
        "payment_status_loaded": payment_status_loaded,
        "payment_map_items_rows_read": len(payment_map_items_df),
        "payment_map_items_loaded": payment_items_loaded,
        "bm_aux_rows_read": len(bm_aux_df),
        "bm_aux_rows_loaded": bm_aux_loaded,
        "rows_processed": inserted_or_updated,
        "rows_unique_by_source_hash": len(source_hashes),
        "rows_duplicate_by_source_hash": duplicate_source_rows,
        "rows_skipped": skipped,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ETL relacional de medições da planilha Geral.")
    parser.add_argument("--excel", default=DEFAULT_EXCEL_PATH, help="Caminho do arquivo .xlsm/.xlsx.")
    parser.add_argument("--sheet", default=DEFAULT_SHEET, help="Nome da aba de origem.")
    parser.add_argument("--base-sheet", default=DEFAULT_BASE_SHEET, help="Nome da aba de cadastro de profissionais.")
    parser.add_argument("--payment-map-sheet", default=DEFAULT_PAYMENT_MAP_SHEET, help="Nome da aba do mapa de pagamento.")
    parser.add_argument("--bm-aux-sheet", default=DEFAULT_BM_AUX_SHEET, help="Nome da aba auxiliar de BM.")
    parser.add_argument(
        "--append",
        action="store_true",
        help="Não limpa o banco antes da carga. Use apenas para cargas incrementais controladas.",
    )
    parser.add_argument(
        "--ciclo",
        default=None,
        help="Ciclo no formato YYMM (ex: 2606). Se omitido, deriva automaticamente do campo 'Mês referência' da planilha.",
    )
    parser.add_argument(
        "--database-url",
        default=os.getenv("ETL_DATABASE_URL") or os.getenv("DATABASE_URL"),
        help="URL PostgreSQL. Ex: postgresql+psycopg2://usuario:senha@localhost:5432/medicoes",
    )
    parser.add_argument("--create-schema", action="store_true", help="Executa database/schema.sql antes da carga.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.database_url:
        raise SystemExit("Informe --database-url ou defina a variável ETL_DATABASE_URL.")

    result = ingest(
        Path(args.excel),
        args.sheet,
        args.base_sheet,
        args.payment_map_sheet,
        args.bm_aux_sheet,
        args.database_url,
        args.create_schema,
        not args.append,
        ciclo=args.ciclo,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
