"""Valida duas correções estruturais que substituem exceções hardcoded por nome (Cristiano
Jeferson/Mauricio Spindola) por dado cadastral real em CadastroFornecedor:

1. "Valor fixo mensal/contratual" é resolvido por `resolve_condicao_fixa`, que lê SOMENTE
   tipo_condicao_fixa/valor_condicao_fixa/valor_condicao_fixa_com_producao/valor_condicao_fixa_sem_producao
   — nunca uma tabela hardcoded por nome.
2. "Qual aba da planilha é produção deste fornecedor" é resolvido por `uses_documentos_auxiliares`/
   `bm_aux_people`, que leem SOMENTE `fonte_medicao` — nunca a antiga whitelist hardcoded
   BM_AUX_ALLOWED_COLLABORATORS.

Teste puro, sem banco."""
from decimal import Decimal

from ingest_medicoes import (
    bm_aux_people,
    normalize_fonte_medicao,
    normalize_tipo_condicao_fixa,
    resolve_condicao_fixa,
    uses_documentos_auxiliares,
)


def main():
    # FIXA (padrão, inclusive quando tipo_condicao_fixa é None) — mesmo comportamento de sempre
    # para Mauricio Spindola (8640) e Ronald Rafael Silva Leal (21300), nenhuma tabela por nome.
    fixa = {"tipo_condicao_fixa": None, "valor_condicao_fixa": Decimal("8640"), "valor_condicao_fixa_com_producao": None, "valor_condicao_fixa_sem_producao": None}
    assert resolve_condicao_fixa(fixa, has_production=True) == Decimal("8640")
    assert resolve_condicao_fixa(fixa, has_production=False) == Decimal("8640")

    fixa_explicito = {**fixa, "tipo_condicao_fixa": "FIXA", "valor_condicao_fixa": Decimal("21300")}
    assert resolve_condicao_fixa(fixa_explicito, has_production=False) == Decimal("21300")

    # Sem condição fixa (NULL) — nunca vira zero nem herda outro valor.
    sem_condicao = {"tipo_condicao_fixa": None, "valor_condicao_fixa": None, "valor_condicao_fixa_com_producao": None, "valor_condicao_fixa_sem_producao": None}
    assert resolve_condicao_fixa(sem_condicao, has_production=True) is None
    assert resolve_condicao_fixa(None, has_production=True) is None

    # CONDICIONAL_PRODUCAO — qualquer fornecedor, dado cadastral real (ex.: config de dev do
    # Cristiano Jeferson: com_producao=8640, sem_producao=12000 — mas a função não sabe nem precisa
    # saber que é ele; é só mais um CadastroFornecedor).
    condicional = {
        "tipo_condicao_fixa": "CONDICIONAL_PRODUCAO",
        "valor_condicao_fixa": None,
        "valor_condicao_fixa_com_producao": Decimal("8640"),
        "valor_condicao_fixa_sem_producao": Decimal("12000"),
    }
    assert resolve_condicao_fixa(condicional, has_production=True) == Decimal("8640")
    assert resolve_condicao_fixa(condicional, has_production=False) == Decimal("12000")

    # CONDICIONAL_PRODUCAO configurado pela metade (falta um dos dois valores) — inválido, nunca
    # inventa um valor.
    incompleto = {"tipo_condicao_fixa": "CONDICIONAL_PRODUCAO", "valor_condicao_fixa": None, "valor_condicao_fixa_com_producao": Decimal("8640"), "valor_condicao_fixa_sem_producao": None}
    assert resolve_condicao_fixa(incompleto, has_production=True) is None
    assert resolve_condicao_fixa(incompleto, has_production=False) is None

    assert normalize_tipo_condicao_fixa(None) == "FIXA"
    assert normalize_tipo_condicao_fixa("") == "FIXA"
    assert normalize_tipo_condicao_fixa("fixa") == "FIXA"
    assert normalize_tipo_condicao_fixa("condicional_producao") == "CONDICIONAL_PRODUCAO"

    import ingest_medicoes
    assert not hasattr(ingest_medicoes, "FIXED_CONDITION_REFERENCE"), "tabela hardcoded por nome não pode mais existir"
    assert not hasattr(ingest_medicoes, "fixed_condition_reference_for"), "lookup genérico por nome não pode mais existir"
    assert not hasattr(ingest_medicoes, "is_cristiano_jeferson"), "exceção hardcoded do Cristiano não pode mais existir"
    assert not hasattr(ingest_medicoes, "CRISTIANO_FIXED_WITH_DOCUMENTS"), "constante hardcoded não pode mais existir"
    assert not hasattr(ingest_medicoes, "CRISTIANO_FIXED_WITHOUT_DOCUMENTS"), "constante hardcoded não pode mais existir"

    print("PASS: resolve_condicao_fixa — FIXA, CONDICIONAL_PRODUCAO, NULL e incompleto, nenhuma tabela/exceção hardcoded por nome.")

    # ─── Fonte da medição (substitui BM_AUX_ALLOWED_COLLABORATORS) ────────────────────────────────
    # A antiga whitelist hardcoded por nome ("mauricio spindola", "cristiano jeferson") virou dado
    # cadastral real (CadastroFornecedor.fonte_medicao). `uses_documentos_auxiliares`/`bm_aux_people`
    # nunca devem decidir por nome — só por `fonte_medicao_map`, resolvido a partir da identidade
    # canônica (colaborador_codigo).
    canonical_codes = {"mauricio spindola": "MAURICIO SPINDOLA", "cristiano jeferson": "CRISTIANO JEFERSON"}
    fonte_medicao_map = {"mauricio spindola": "DOCUMENTOS_AUXILIARES", "cristiano jeferson": "DOCUMENTOS_AUXILIARES"}

    assert uses_documentos_auxiliares("MAURICIO SPINDOLA", canonical_codes, fonte_medicao_map) is True
    assert uses_documentos_auxiliares("CRISTIANO JEFERSON", canonical_codes, fonte_medicao_map) is True
    assert uses_documentos_auxiliares("FORNECEDOR NORMAL", canonical_codes, fonte_medicao_map) is False
    # Default legado: sem cadastro/config nenhuma -> DOCUMENTOS (nunca BM AUX por acidente).
    assert uses_documentos_auxiliares("QUALQUER UM", {}, {}) is False

    assert normalize_fonte_medicao(None) == "DOCUMENTOS"
    assert normalize_fonte_medicao("") == "DOCUMENTOS"
    assert normalize_fonte_medicao("algo_invalido") == "DOCUMENTOS"
    assert normalize_fonte_medicao("documentos_auxiliares") == "DOCUMENTOS_AUXILIARES"

    # bm_aux_people: só fornecedores configurados para DOCUMENTOS_AUXILIARES entram, mesmo estando
    # ambos presentes na mesma linha da aba BM AUX (RESPONSAVEL/AUXILIAR).
    raw = {"responsavel": "MAURICIO SPINDOLA", "auxiliar": "FORNECEDOR NORMAL"}
    people = bm_aux_people(raw, canonical_codes, fonte_medicao_map)
    assert people == [("RESPONSAVEL", "MAURICIO SPINDOLA")], people

    assert not hasattr(ingest_medicoes, "BM_AUX_ALLOWED_COLLABORATORS"), "whitelist hardcoded por nome não pode mais existir"
    assert not hasattr(ingest_medicoes, "is_bm_aux_only_collaborator"), "checagem hardcoded por nome não pode mais existir"

    print("PASS: fonte_medicao — DOCUMENTOS_AUXILIARES/DOCUMENTOS via CadastroFornecedor, nenhuma whitelist hardcoded por nome.")


if __name__ == "__main__":
    main()
