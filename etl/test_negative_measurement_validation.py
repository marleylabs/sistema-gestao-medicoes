from __future__ import annotations

import contextlib
import io
from decimal import Decimal
from pathlib import Path

import pandas as pd

import ingest_medicoes as ingest_module
import server
from ingest_medicoes import (
    InvalidMeasurementRowError,
    build_discount_measurement,
    build_measurement,
    prevalidate_normal_measurements,
    source_hash,
)


def normal_row(**overrides) -> pd.Series:
    values = {
        "Número da Medição": "BM05",
        "Projeto Referente": "PROJETO-TESTE",
        "Número do Documento": "MC-1140KN-C-70193",
        "Evidência": "GRD-SE-KN-2025-7164-0026",
        "Formato": "A4",
        "Quantidade": 3,
        "Multiplicador": 1,
        "Equivalente (A1 ou Horas)": 0.375,
        "Medido (Horas)": 3,
        "Item da QQP": "26",
        "Valor Unitário": 190.47,
        "Valor Bruto": 571.41,
        "Valor Total": 611.3219,
        "Valor do Reajuste": 10.8568,
        "CICLO": "2608",
        "PROJETISTA": "RESPONSAVEL TESTE",
        "REFERÊNCIA": "A",
        "% EMISSÃO": 1,
        "TIPO": "DG",
        "VALOR DE MEDIÇÃO": 0,
    }
    values.update(overrides)
    return pd.Series(values)


def validate(rows: list[pd.Series]) -> None:
    df = pd.DataFrame(rows)
    df.attrs["excel_row_numbers"] = list(range(2, len(rows) + 2))
    prevalidate_normal_measurements(df, "Documentos", "2608", {}, {})


def test_positive_and_zero_measurements_are_valid() -> None:
    validate([normal_row(), normal_row(**{"Quantidade": 0, "Valor Total": 0, "VALOR DE MEDIÇÃO": 0})])
    zero = build_measurement(normal_row(**{"Quantidade": 0, "Valor Total": 0, "VALOR DE MEDIÇÃO": 0}))
    assert zero["quantidade"] == Decimal("0")
    assert zero["valor_total"] == Decimal("0")
    assert zero["valor_medicao"] == Decimal("0")


def test_bm05_is_blocked_with_structured_business_error() -> None:
    row = normal_row(**{
        "Quantidade": -3,
        "Equivalente (A1 ou Horas)": -0.375,
        "Medido (Horas)": -3,
        "Valor Bruto": -571.41,
        "Valor Total": -611.3219,
        "Valor do Reajuste": -10.8568,
        "VALOR DE MEDIÇÃO": 0,
    })
    try:
        validate([row])
    except InvalidMeasurementRowError as error:
        detail = error.invalid_rows[0]
        assert error.code == "INVALID_MEASUREMENT_ROWS"
        assert detail["excelRow"] == 2
        assert detail["numeroDocumento"] == "MC-1140KN-C-70193"
        assert detail["blockingFields"] == {"quantidade": "-3", "valor_total": "-611.3219"}
        assert detail["negativeFields"]["valor_reajuste"] == "-10.8568"
        assert "Nenhum dado foi alterado" in str(error)
    else:
        raise AssertionError("BM05 negativa deveria ter sido bloqueada antes da persistência.")


def test_discount_flow_is_not_blocked_and_keeps_semantics() -> None:
    discount_only = normal_row(**{
        "Número da Medição": None,
        "Projeto Referente": None,
        "Motivo Desconto": "DESCONTO: TREINAMENTOS",
        "Valor Desconto": -80,
    })
    validate([discount_only])
    base = build_measurement(discount_only)
    discount = build_discount_measurement(discount_only, base, "2608")
    assert discount is not None
    assert discount["tipo2"] == "DESCONTO"
    assert discount["valor_total"] == Decimal("80")
    assert discount["valor_medicao"] == Decimal("80")

    regular_with_discount = normal_row(**{
        "Motivo Desconto": "DESCONTO: TREINAMENTOS",
        "Valor Desconto": -80,
    })
    validate([regular_with_discount])
    regular_discount = build_discount_measurement(
        regular_with_discount,
        build_measurement(regular_with_discount),
        "2608",
    )
    assert regular_discount is not None
    assert regular_discount["tipo2"] == "DESCONTO"


def test_all_invalid_rows_are_returned_and_hash_is_unchanged() -> None:
    first = normal_row(**{"Quantidade": -3})
    second = normal_row(**{"Número do Documento": "DOC-2", "Valor Total": -100, "VALOR DE MEDIÇÃO": -50})
    original = build_measurement(first)
    expected_hash = source_hash(original["raw_payload"])
    try:
        validate([first, second])
    except InvalidMeasurementRowError as error:
        assert len(error.invalid_rows) == 2
        assert error.invalid_rows[0]["excelRow"] == 2
        assert error.invalid_rows[1]["excelRow"] == 3
    else:
        raise AssertionError("Todas as linhas inválidas deveriam ser retornadas.")
    assert build_measurement(first)["source_row_hash"] == expected_hash


def test_server_exposes_validation_without_traceback() -> None:
    original_ingest = server.ingest

    def reject(**_kwargs):
        raise InvalidMeasurementRowError([
            {
                "origin": "Documentos",
                "excelRow": 33,
                "numeroMedicao": "BM05",
                "ciclo": "2608",
                "numeroDocumento": "MC-1140KN-C-70193",
                "evidencia": "GRD-SE-KN-2025-7164-0026",
                "responsavel": "RESPONSAVEL TESTE",
                "quantidade": "-3",
                "valorTotal": "-611.3219",
                "valorMedicao": "0",
                "blockingFields": {"quantidade": "-3", "valor_total": "-611.3219"},
                "negativeFields": {"quantidade": "-3", "valor_total": "-611.3219"},
            }
        ])

    try:
        server.ingest = reject
        server.run_etl(b"fixture", "2608")
        assert server._last_error_type == "validation"
        assert server._last_error_details[0]["numeroDocumento"] == "MC-1140KN-C-70193"
        assert "Traceback" not in (server._last_error or "")
        assert "Nenhum dado foi alterado" in (server._last_error or "")
    finally:
        server.ingest = original_ingest


def test_invalid_rows_stop_before_transaction_begin() -> None:
    invalid_df = pd.DataFrame([normal_row(**{"Quantidade": -3})])
    invalid_df.attrs["excel_row_numbers"] = [33]

    class ReadOnlyConnection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class EngineWithoutWrites:
        begin_called = False

        def connect(self):
            return ReadOnlyConnection()

        def begin(self):
            self.begin_called = True
            raise AssertionError("engine.begin() não pode ser alcançado por uma planilha inválida")

    engine = EngineWithoutWrites()
    replacements = {
        "create_engine": lambda *_args, **_kwargs: engine,
        "resolve_sheet_name": lambda _path, requested, _aliases=None: requested,
        "resolve_optional_sheet_name": lambda *_args, **_kwargs: None,
        "read_measurements_sheet": lambda *_args, **_kwargs: invalid_df,
        "read_bm_aux_sheet": lambda *_args, **_kwargs: pd.DataFrame(),
        "latest_fonte_medicao_by_collaborator": lambda _conn: {},
        "load_operational_identity_resolver": lambda _conn: ingest_module.OperationalIdentityResolver([], []),
        "latest_cadastros_by_collaborator": lambda _conn: {},
        "load_import_decisions": lambda *_a, **_k: {"nomes_descartados": {}, "linhas_descartadas": set(), "existentes": {}},
        "reflect_tables": lambda _engine: (None, None, None, None, None, None),
        "build_generated_payment_context": lambda *_args, **_kwargs: {
            "ciclo": "2608",
            "mes_referencia": None,
            "producao_label": "PRODUÇÃO",
            "producao_inicio": None,
            "producao_fim": None,
            "ato_label": "ATO",
            "ato_ciclo": "2608",
            "contratos": [],
            "rateio": [],
        },
        "collect_import_collaborator_codes": lambda *_args, **_kwargs: set(),
    }
    originals = {name: getattr(ingest_module, name) for name in replacements}
    try:
        for name, replacement in replacements.items():
            setattr(ingest_module, name, replacement)
        try:
            ingest_module.ingest(
                Path("fixture.xlsx"),
                "Documentos",
                "Base",
                "MAPA PAGTO",
                "Documentos Auxiliares",
                "postgresql://fixture",
                False,
                True,
                "2608",
            )
        except InvalidMeasurementRowError:
            pass
        else:
            raise AssertionError("A planilha negativa deveria ter sido rejeitada.")
        assert engine.begin_called is False
    finally:
        for name, original in originals.items():
            setattr(ingest_module, name, original)


def test_internal_error_keeps_traceback_only_in_logs() -> None:
    original_ingest = server.ingest

    def fail(**_kwargs):
        raise RuntimeError("diagnostico-interno-controlado")

    try:
        server.ingest = fail
        logs = io.StringIO()
        with contextlib.redirect_stdout(logs):
            server.run_etl(b"fixture", "2608")
        assert server._last_error_type == "internal"
        assert server._last_error == "Falha interna inesperada durante a importação. Nenhum dado foi alterado."
        assert "Traceback" not in (server._last_error or "")
        assert "Traceback" in logs.getvalue()
        assert "diagnostico-interno-controlado" in logs.getvalue()
    finally:
        server.ingest = original_ingest


if __name__ == "__main__":
    test_positive_and_zero_measurements_are_valid()
    test_bm05_is_blocked_with_structured_business_error()
    test_discount_flow_is_not_blocked_and_keeps_semantics()
    test_all_invalid_rows_are_returned_and_hash_is_unchanged()
    test_server_exposes_validation_without_traceback()
    test_invalid_rows_stop_before_transaction_begin()
    test_internal_error_keeps_traceback_only_in_logs()
    print("OK: pré-validação de medições negativas validada.")
