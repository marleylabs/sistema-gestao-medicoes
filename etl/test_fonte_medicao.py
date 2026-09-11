"""Regressão do bug real encontrado em produção: CadastroFornecedor.fonteMedicao=DOCUMENTOS_AUXILIARES
configurado com o nome completo (ex.: "CRISTIANO JEFERSON DA COSTA SILVA") era ignorado pelo ETL porque
a planilha usa a forma abreviada (ex.: "CRISTIANO JEFERSON") e não existe Profissional.codigo real
ligando as duas identidades — uses_documentos_auxiliares() comparava só por string normalizada exata.
Primeira parte roda sem banco (funções puras); a segunda valida latest_fonte_medicao_by_collaborator()
contra o Postgres E2E real, reproduzindo o cadastro real do Cristiano."""
import os
import uuid
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from ingest_medicoes import (
    normalize_fonte_medicao,
    uses_documentos_auxiliares,
    latest_fonte_medicao_by_collaborator,
    same_person_name,
)


def test_normalize_fonte_medicao():
    assert normalize_fonte_medicao("DOCUMENTOS_AUXILIARES") == "DOCUMENTOS_AUXILIARES"
    assert normalize_fonte_medicao("documentos_auxiliares") == "DOCUMENTOS_AUXILIARES"
    assert normalize_fonte_medicao("DOCUMENTOS") == "DOCUMENTOS"
    assert normalize_fonte_medicao(None) == "DOCUMENTOS"
    assert normalize_fonte_medicao("") == "DOCUMENTOS"
    assert normalize_fonte_medicao("QUALQUER_OUTRA_COISA") == "DOCUMENTOS"
    print("PASS: normalize_fonte_medicao — default legado DOCUMENTOS preservado.")


def test_uses_documentos_auxiliares_exact_match():
    fonte_map = {"cristiano jeferson": "DOCUMENTOS_AUXILIARES"}
    assert uses_documentos_auxiliares("Cristiano Jeferson", {}, fonte_map) is True
    assert uses_documentos_auxiliares("Outra Pessoa", {}, fonte_map) is False
    print("PASS: uses_documentos_auxiliares — correspondência exata continua funcionando.")


def test_uses_documentos_auxiliares_fuzzy_short_vs_full_name():
    """Reproduz o bug real: cadastro usa o nome completo, planilha usa a forma abreviada."""
    fonte_map = {"cristiano jeferson da costa silva": "DOCUMENTOS_AUXILIARES"}
    # ANTES da correção isto retornava False (bug real de produção) — a planilha usa a forma curta.
    assert uses_documentos_auxiliares("CRISTIANO JEFERSON", {}, fonte_map) is True
    print("PASS: uses_documentos_auxiliares — fallback fuzzy resolve nome curto x nome completo (bug real do Cristiano).")


def test_uses_documentos_auxiliares_fuzzy_does_not_false_positive():
    """Fallback fuzzy não pode inventar correspondência entre pessoas genuinamente diferentes."""
    fonte_map = {"mauricio spindola rodrigues junior": "DOCUMENTOS_AUXILIARES"}
    assert uses_documentos_auxiliares("Cristiano Jeferson", {}, fonte_map) is False
    assert uses_documentos_auxiliares("Mauricio Silva", {}, fonte_map) is False
    print("PASS: uses_documentos_auxiliares — fallback fuzzy não cria falso positivo entre pessoas diferentes.")


def test_uses_documentos_auxiliares_via_canonical_codes():
    """Quando existe Profissional.codigo real ligando a identidade, a resolução direta (sem fuzzy) já basta."""
    canonical_codes = {"cristiano jeferson": "P0999999"}
    fonte_map = {"p0999999": "DOCUMENTOS_AUXILIARES"}
    assert uses_documentos_auxiliares("Cristiano Jeferson", canonical_codes, fonte_map) is True
    print("PASS: uses_documentos_auxiliares — resolução por colaboradorCodigo real (sem depender de fuzzy).")


def test_same_person_name_prefix_rule_matches_real_case():
    assert same_person_name("CRISTIANO JEFERSON", "CRISTIANO JEFERSON DA COSTA SILVA") is True
    assert same_person_name("MAURICIO SPINDOLA", "MAURICIO SPINDOLA RODRIGUES JUNIOR") is True
    assert same_person_name("CRISTIANO JEFERSON", "MAURICIO SPINDOLA RODRIGUES JUNIOR") is False
    print("PASS: same_person_name — casos reais de Cristiano e Mauricio confirmados.")


def test_latest_fonte_medicao_by_collaborator_e2e():
    """Reproduz literalmente o cadastro real do Cristiano contra o Postgres E2E: CadastroFornecedor
    com responsavel/colaboradorCodigo = nome completo, fonte_medicao = DOCUMENTOS_AUXILIARES."""
    for line in (Path(__file__).resolve().parent.parent / ".env.test").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
    assert os.environ.get("ALLOW_E2E_DATABASE") == "true"
    expected = os.environ["E2E_DATABASE_NAME"]
    url = make_url(os.environ["DATABASE_URL_TEST"]).difference_update_query(["schema"])
    assert url.host in ("localhost", "127.0.0.1") and url.database == expected
    engine = create_engine(url)
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            assert conn.execute(text("select current_database()")).scalar_one() == expected
            uid = str(uuid.uuid4())[:8]
            nome_completo = f"CRISTIANO TESTE {uid} DA COSTA SILVA"
            nome_planilha = f"CRISTIANO TESTE {uid}"
            conn.execute(
                text(
                    """
                    insert into cadastros_fornecedores (id, colaborador_codigo, responsavel, cnpj_normalizado, razao_social, fonte_medicao, tipo_condicao_fixa, updated_at)
                    values (gen_random_uuid(), :codigo, :responsavel, :cnpj, :responsavel, 'DOCUMENTOS_AUXILIARES', 'FIXA', now())
                    """
                ),
                {"codigo": nome_completo, "responsavel": nome_completo, "cnpj": f"{uid}00000000000"[:14]},
            )
            fonte_map = latest_fonte_medicao_by_collaborator(conn)
            # ANTES da correção: False (bug real) — planilha nunca usa o nome completo cadastrado.
            assert uses_documentos_auxiliares(nome_planilha, {}, fonte_map) is True
            assert uses_documentos_auxiliares(f"PESSOA SEM RELACAO {uid}", {}, fonte_map) is False
            print("PASS (E2E): latest_fonte_medicao_by_collaborator + uses_documentos_auxiliares resolvem o cadastro real do Cristiano (nome completo x nome abreviado da planilha).")
        finally:
            transaction.rollback()
    engine.dispose()


if __name__ == "__main__":
    test_normalize_fonte_medicao()
    test_uses_documentos_auxiliares_exact_match()
    test_uses_documentos_auxiliares_fuzzy_short_vs_full_name()
    test_uses_documentos_auxiliares_fuzzy_does_not_false_positive()
    test_uses_documentos_auxiliares_via_canonical_codes()
    test_same_person_name_prefix_rule_matches_real_case()
    test_latest_fonte_medicao_by_collaborator_e2e()
    print("\n=== TODOS OS TESTES DE fonte_medicao PASSARAM ===")
