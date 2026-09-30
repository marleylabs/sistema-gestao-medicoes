"""Resolução de identidade operacional no ETL: paridade de normalização com o TS, resolver
(código → alias → legado), preflight que bloqueia ANTES de qualquer escrita, cadastro do mapa
gerado só por igualdade (aproximado vira sugestão) e carga real do resolver no Postgres E2E
(transação com rollback)."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

import server
from ingest_medicoes import (
    OperationalIdentityResolver,
    UnresolvedIdentityError,
    assert_operational_identities_resolved,
    find_cadastro_for_generated_payment,
    normalize_person_name,
)
from test_negative_measurement_validation import normal_row

ROOT = Path(__file__).resolve().parent.parent

CANONICO = {"id": "p-ronald", "codigo": "RONALD RAFAEL SILVA LEAL", "nome": "RONALD RAFAEL SILVA LEAL"}
OUTRO = {"id": "p-ramos", "codigo": "RONALDO RAMOS", "nome": "RONALDO RAMOS"}
LEGADO = {"id": "p-legado", "codigo": None, "nome": "ALAN FARIAS"}
ALIASES = [
    {"profissional_id": "p-ronald", "alias": "RONALD LEAL", "alias_normalizado": "RONALD LEAL"},
    {"profissional_id": "p-ronald", "alias": "AMBIGUO", "alias_normalizado": "AMBIGUO"},
    {"profissional_id": "p-ramos", "alias": "AMBIGUO", "alias_normalizado": "AMBIGUO"},
]


def resolver() -> OperationalIdentityResolver:
    return OperationalIdentityResolver([CANONICO, OUTRO, LEGADO], ALIASES)


def test_normalization_parity_with_typescript() -> None:
    fixture = json.loads((ROOT / "tests" / "fixtures" / "normalizacao-alias.json").read_text(encoding="utf-8"))
    for case in fixture:
        assert normalize_person_name(case["entrada"]) == case["esperado"], case


def test_resolver_order_and_outcomes() -> None:
    r = resolver()
    assert r.resolve("ronald rafael silva leal ") == {"status": "RESOLVIDO", "via": "CODIGO", "id": "p-ronald", "codigo": "RONALD RAFAEL SILVA LEAL"}
    assert r.resolve("Rónald. Leal") == {"status": "RESOLVIDO", "via": "ALIAS", "id": "p-ronald", "codigo": "RONALD RAFAEL SILVA LEAL"}
    ambiguo = r.resolve("AMBIGUO")
    assert ambiguo["status"] == "AMBIGUO" and sorted(ambiguo["candidatos"]) == ["RONALD RAFAEL SILVA LEAL", "RONALDO RAMOS"]
    assert r.resolve("alan farias") == {"status": "RESOLVIDO", "via": "NOME_LEGADO", "id": "p-legado", "codigo": "ALAN FARIAS"}
    assert r.resolve("PAULO SOUZA")["status"] == "NAO_RESOLVIDO"
    assert r.resolve("RONALD R LEAL")["status"] == "NAO_RESOLVIDO"  # parecido nunca resolve
    r.declare("NOVO DA BASE")
    assert r.resolve("NOVO DA BASE")["via"] == "DECLARADO_PLANILHA"
    r.register("p-novo", "NOVO DA BASE", "NOVO DA BASE")
    assert r.require_id("novo da base") == "p-novo"


def test_aliases_merge_into_canonical_codes() -> None:
    merged = resolver().apply_to_canonical_codes({"ronaldleal": "RONALD LEAL", "outro": "RONALDO RAMOS"})
    assert merged["ronaldleal"] == "RONALD RAFAEL SILVA LEAL"  # valor que era alias vira o código canônico
    assert merged["outro"] == "RONALDO RAMOS"
    assert "ambiguo" not in merged  # alias ambíguo nunca entra no mapa


def preflight(rows: list[pd.Series], r: OperationalIdentityResolver, cadastros=None, base_df=None):
    df = pd.DataFrame(rows)
    return assert_operational_identities_resolved(
        df, base_df if base_df is not None else pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), set(), {}, {},
        "2608", r, cadastros or {}, "Documentos", "Base", None, None,
    )


def test_preflight_resolves_alias_and_legacy() -> None:
    summary = preflight([normal_row(PROJETISTA="RONALD LEAL"), normal_row(PROJETISTA="ALAN FARIAS"), normal_row(PROJETISTA="RONALD LEAL")], resolver())
    assert summary["identidades_resolvidas"] == 2
    assert summary["identidades_por_via"] == {"ALIAS": 1, "NOME_LEGADO": 1}
    assert summary["aliases_utilizados"] == ["RONALD LEAL -> RONALD RAFAEL SILVA LEAL"]


def test_bm_aux_alias_reports_alias_via_and_uses_canonical_cadastro() -> None:
    """Fornecedor de Documentos Auxiliares escrito com o nome curto (ex.: CRISTIANO JEFERSON): o alias
    leva ao código canônico, a fonte DOCUMENTOS_AUXILIARES é achada por igualdade (sem fuzzy), a via
    reportada é ALIAS e o mapa gerado aplica a condição condicional do cadastro canônico."""
    from decimal import Decimal
    from ingest_medicoes import bm_aux_people, resolve_condicao_fixa, uses_documentos_auxiliares

    canonico = {"id": "p-cris", "codigo": "CRISTIANO JEFERSON DA COSTA SILVA", "nome": "CRISTIANO JEFERSON DA COSTA SILVA"}
    r = OperationalIdentityResolver([canonico], [{"profissional_id": "p-cris", "alias": "CRISTIANO JEFERSON", "alias_normalizado": "CRISTIANO JEFERSON"}])
    codes = r.apply_to_canonical_codes({})
    fonte = {"cristiano jeferson da costa silva": "DOCUMENTOS_AUXILIARES"}
    assert codes["cristiano jeferson"] == "CRISTIANO JEFERSON DA COSTA SILVA"
    assert uses_documentos_auxiliares("CRISTIANO JEFERSON", codes, fonte) is True
    assert bm_aux_people({"responsavel": "CRISTIANO JEFERSON", "auxiliar": None}, codes, fonte) == [("RESPONSAVEL", "CRISTIANO JEFERSON DA COSTA SILVA")]

    bm = pd.DataFrame([{"Responsavel": "CRISTIANO JEFERSON", "Ciclo": "2608"}])
    summary = assert_operational_identities_resolved(pd.DataFrame(), pd.DataFrame(), bm, pd.DataFrame(), set(), codes, fonte, "2608", r, {},
                                                     "Documentos", None, "Documentos Auxiliares", None)
    assert summary["identidades_por_via"] == {"ALIAS": 1}
    assert summary["aliases_utilizados"] == ["CRISTIANO JEFERSON -> CRISTIANO JEFERSON DA COSTA SILVA"]

    cadastros = {"cristiano jeferson da costa silva": {"colaborador_codigo": "CRISTIANO JEFERSON DA COSTA SILVA", "tipo_condicao_fixa": "CONDICIONAL_PRODUCAO",
                                                       "valor_condicao_fixa_com_producao": "8340", "valor_condicao_fixa_sem_producao": "12000"}}
    cad = find_cadastro_for_generated_payment(cadastros, {"codigo": "CRISTIANO JEFERSON DA COSTA SILVA", "nome": "CRISTIANO JEFERSON DA COSTA SILVA"}, [])
    assert cad is cadastros["cristiano jeferson da costa silva"]
    assert resolve_condicao_fixa(cad, True) == Decimal("8340") and resolve_condicao_fixa(cad, False) == Decimal("12000")
    # Sem o alias, o nome curto nunca recebe o cadastro (só sugestão).
    sug: list = []
    assert find_cadastro_for_generated_payment(cadastros, {"codigo": "CRISTIANO JEFERSON", "nome": "CRISTIANO JEFERSON"}, sug) is None


def test_preflight_blocks_unresolved_and_ambiguous_with_details() -> None:
    cadastros = {"x": {"colaborador_codigo": "PAULO ROBERTO SOUZA", "responsavel": "PAULO ROBERTO SOUZA"}}
    rows = [normal_row(PROJETISTA="PAULO SOUZA"), normal_row(PROJETISTA="PAULO SOUZA"), normal_row(PROJETISTA="AMBIGUO"), normal_row(PROJETISTA="RONALD LEAL")]
    try:
        preflight(rows, resolver(), cadastros)
    except UnresolvedIdentityError as error:
        by_name = {d["valor"]: d for d in error.details}
        assert set(by_name) == {"PAULO SOUZA", "AMBIGUO"}
        assert by_name["PAULO SOUZA"]["status"] == "NAO_RESOLVIDO"
        assert by_name["PAULO SOUZA"]["ocorrencias"] == 2 and by_name["PAULO SOUZA"]["linhas"] == [2, 3]
        assert by_name["PAULO SOUZA"]["origem"] == "Documentos" and by_name["PAULO SOUZA"]["ciclo"] == "2608"
        assert by_name["PAULO SOUZA"]["sugestoesCadastro"] == ["PAULO ROBERTO SOUZA"]  # só informativa
        assert by_name["AMBIGUO"]["status"] == "AMBIGUO"
        assert error.to_dict()["code"] == "UNRESOLVED_OPERATIONAL_IDENTITIES"
        assert "Nenhum dado foi alterado" in str(error)
    else:
        raise AssertionError("Preflight deveria bloquear PAULO SOUZA e o alias ambíguo.")


def test_preflight_blocks_base_code_that_is_alias_of_other_identity() -> None:
    base_df = pd.DataFrame([{"Código": "RONALD LEAL", "Nome Completo": "RONALD LEAL"}])
    try:
        preflight([normal_row(PROJETISTA="RONALD RAFAEL SILVA LEAL")], resolver(), base_df=base_df)
    except UnresolvedIdentityError as error:
        assert [d["status"] for d in error.details] == ["CONFLITO_ALIAS"]
    else:
        raise AssertionError("Código da Base que é alias de outra identidade deveria bloquear.")


def test_generated_map_never_applies_approximate_cadastro() -> None:
    cadastros = {"diogo aguiar diniz": {"colaborador_codigo": "DIOGO AGUIAR DINIZ", "responsavel": "DIOGO AGUIAR DINIZ", "razao_social": "DAD LTDA"}}
    sugestoes: list[dict] = []
    item = {"codigo": "DIOGO DINIZ", "nome": "DIOGO DINIZ", "nome_completo": None}
    assert find_cadastro_for_generated_payment(cadastros, item, sugestoes) is None
    assert sugestoes == [{"codigo": "DIOGO DINIZ", "cadastroSugerido": "DIOGO AGUIAR DINIZ", "colaboradorCodigoSugerido": "DIOGO AGUIAR DINIZ"}]
    direto = {"codigo": "DIOGO AGUIAR DINIZ", "nome": "DIOGO AGUIAR DINIZ", "nome_completo": None}
    assert find_cadastro_for_generated_payment(cadastros, direto, []) is cadastros["diogo aguiar diniz"]


def test_server_exposes_identity_details() -> None:
    original = server.ingest

    def reject(**_kwargs):
        raise UnresolvedIdentityError([{"valor": "PAULO SOUZA", "origem": "Documentos", "status": "NAO_RESOLVIDO", "ocorrencias": 1, "linhas": [5]}])

    try:
        server.ingest = reject
        server.run_etl(b"fixture", "2608")
        assert server._last_error_type == "validation"
        assert server._last_error_details[0]["valor"] == "PAULO SOUZA"
        assert "PAULO SOUZA" in server._last_error
    finally:
        server.ingest = original


def test_unresolved_identity_stops_before_transaction_begin() -> None:
    """Nome inédito bloqueia ANTES de engine.begin(): nada de full_refresh/limpeza parcial do ciclo."""
    import ingest_medicoes as ingest_module

    df = pd.DataFrame([normal_row(PROJETISTA="NOME INEDITO SEM ALIAS")])
    df.attrs["excel_row_numbers"] = [7]

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
            raise AssertionError("engine.begin() não pode ser alcançado com identidade não resolvida")

    engine = EngineWithoutWrites()
    replacements = {
        "create_engine": lambda *_a, **_k: engine,
        "resolve_sheet_name": lambda _path, requested, _aliases=None: requested,
        "resolve_optional_sheet_name": lambda *_a, **_k: None,
        "read_measurements_sheet": lambda *_a, **_k: df,
        "read_bm_aux_sheet": lambda *_a, **_k: pd.DataFrame(),
        "latest_fonte_medicao_by_collaborator": lambda _conn: {},
        "load_operational_identity_resolver": lambda _conn: resolver(),
        "latest_cadastros_by_collaborator": lambda _conn: {},
        "reflect_tables": lambda _engine: (None, None, None, None, None, None),
        "build_generated_payment_context": lambda *_a, **_k: {"ciclo": "2608", "mes_referencia": None, "producao_label": "PRODUÇÃO", "producao_inicio": None,
                                                               "producao_fim": None, "ato_label": "ATO", "ato_ciclo": "2608", "contratos": [], "rateio": []},
        "collect_import_collaborator_codes": lambda *_a, **_k: set(),
    }
    originals = {name: getattr(ingest_module, name) for name in replacements}
    try:
        for name, replacement in replacements.items():
            setattr(ingest_module, name, replacement)
        try:
            ingest_module.ingest(Path("fixture.xlsx"), "Documentos", "Base", "MAPA PAGTO", "Documentos Auxiliares", "postgresql://fixture", False, True, "2608")
        except UnresolvedIdentityError as error:
            assert error.details[0]["valor"] == "NOME INEDITO SEM ALIAS" and error.details[0]["linhas"] == [7]
        else:
            raise AssertionError("Identidade inédita deveria bloquear a importação.")
        assert engine.begin_called is False
    finally:
        for name, original in originals.items():
            setattr(ingest_module, name, original)


def test_resolver_loads_from_e2e_database() -> None:
    url_text = os.environ.get("ETL_DATABASE_URL") or os.environ.get("DATABASE_URL_TEST")
    if not url_text:
        print("SKIP: sem ETL_DATABASE_URL/DATABASE_URL_TEST")
        return
    url = make_url(url_text).difference_update_query(["schema"])
    assert url.host in ("localhost", "127.0.0.1") and "e2e" in (url.database or "")
    engine = create_engine(url)
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            s = uuid.uuid4().hex[:6].upper()
            pid = str(uuid.uuid4())
            conn.execute(text("insert into profissionais (id, nome, codigo) values (:id, :c, :c)"), {"id": pid, "c": f"CANONICO ETL {s}"})
            conn.execute(text("insert into profissional_aliases (profissional_id, alias, alias_normalizado, origem) values (:id, :a, :n, 'MANUAL')"),
                         {"id": pid, "a": f"Alias Etl {s}", "n": normalize_person_name(f"Alias Etl {s}")})
            r = OperationalIdentityResolver.load(conn)
            assert r.resolve(f"alias etl {s}") == {"status": "RESOLVIDO", "via": "ALIAS", "id": pid, "codigo": f"CANONICO ETL {s}"}
        finally:
            tx.rollback()


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("OK: identidade operacional no ETL (paridade, resolver, preflight, mapa gerado sem cadastro aproximado, servidor, E2E).")
