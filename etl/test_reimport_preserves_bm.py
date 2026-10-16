"""Reimportação de ciclo preserva BMs aprovados pelo fornecedor ou pagos (decisão 010).

Carga real no Postgres E2E (fixture sintética, sem nenhum nome/documento real):
- BM em AGUARDANDO_NF/APROVADO/PAGO: status, NF, comprovante, trilha (sgc_logs), medições, mapa
  (inclusive REV) e BM AUX ficam intactos; a diferença da planilha vira divergência no resultado;
- BM PENDENTE/REVISAO_SOLICITADA: segue o comportamento anterior (BM removido, valores novos);
- fornecedor PAGO ausente da planilha, com nome "parecido" com um presente, não é removido;
- planilha igual ao BM aprovado (mesmo em outra ordem de linhas) não gera divergência;
- falha no meio da reimportação não deixa nada pela metade (uma transação)."""
from __future__ import annotations

import os
import tempfile
import uuid
from pathlib import Path

from openpyxl import Workbook

import ingest_medicoes as im
from test_identity_extraction import HEADERS, row_values

CICLO = "2906"
STATUS_POR_PAPEL = {
    "PENDENTE": "PENDENTE",
    "REVISAO": "REVISAO_SOLICITADA",
    "AGUARDANDO": "AGUARDANDO_NF",
    "APROVADO": "APROVADO",
    "PAGO": "PAGO",
    "REVISAO FILIAL": "PAGO",  # ausente na reimportação; casa por nome com "REVISAO"
}
BLOQUEADOS = {"AGUARDANDO", "APROVADO", "PAGO", "REVISAO FILIAL"}


def _sufixo() -> str:
    return "".join("ABCDEFGHIJ"[int(c, 16) % 10] for c in uuid.uuid4().hex[:6])


def _workbook(path: Path, linhas: list[tuple[str, str, int]]) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Documentos"
    ws.append(HEADERS)
    for projetista, documento, valor in linhas:
        ws.append(row_values(PROJETISTA=projetista, **{"Número do Documento": documento, "VALOR DE MEDIÇÃO": valor}))
    wb.create_sheet("Documentos Auxiliares").append(["Responsavel", "Auxiliar", "Ciclo"])
    wb.save(path)


def test_reimport_preserves_approved_bms() -> None:
    url_text = os.environ.get("ETL_DATABASE_URL") or os.environ.get("DATABASE_URL_TEST")
    if not url_text:
        print("SKIP: sem ETL_DATABASE_URL/DATABASE_URL_TEST")
        return
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    url = make_url(url_text).difference_update_query(["schema"])
    assert url.host in ("localhost", "127.0.0.1") and "e2e" in (url.database or "")
    db = url.render_as_string(hide_password=False)
    engine = create_engine(db)
    s = _sufixo()
    nome = {papel: f"FORNECEDOR {s} {papel}" for papel in STATUS_POR_PAPEL}
    ids: dict[str, str] = {}
    nf = {papel: f"%PDF-NF-{papel}".encode() for papel in STATUS_POR_PAPEL}
    comprovante = {papel: f"COMPROVANTE-{papel}".encode() for papel in STATUS_POR_PAPEL}

    def run(path: Path) -> dict:
        return im.ingest(path, "Documentos", "Base", "MAPA PAGTO", "Documentos Auxiliares", db, False, True, CICLO)

    def estado(conn) -> dict[str, dict]:
        out = {}
        for papel, codigo in nome.items():
            sgc = conn.execute(text(
                "select id, status, nf_arquivo, comprovante_arquivo, aprovado_at, pago_at from sgc_aprovacoes_medicao "
                "where ciclo = :c and colaborador_codigo = :k"), {"c": CICLO, "k": codigo}).mappings().one_or_none()
            out[papel] = {
                "sgc": dict(sgc) if sgc else None,
                "logs": conn.execute(text("select count(*) from sgc_logs where ciclo = :c and colaborador_codigo = :k"),
                                     {"c": CICLO, "k": codigo}).scalar(),
                "medido": conn.execute(text("select coalesce(sum(valor_medicao), 0) from medicoes where ciclo = :c and id_profissional = :p"),
                                       {"c": CICLO, "p": ids[papel]}).scalar(),
                "mapa": conn.execute(text("select valor, rev from mapa_pagamento_itens where ciclo = :c and projetista_codigo = :k"),
                                     {"c": CICLO, "k": codigo}).one_or_none(),
            }
        return out

    with engine.begin() as conn:
        for papel, codigo in nome.items():
            ids[papel] = str(conn.execute(text("insert into profissionais (nome, codigo) values (:c, :c) returning id"), {"c": codigo}).scalar())
            conn.execute(text("insert into cadastros_fornecedores (cnpj_normalizado, colaborador_codigo, responsavel, razao_social, raw_payload) "
                              "values ('11222333000181', :c, :c, :c, '{}')"), {"c": codigo})
    try:
        with tempfile.TemporaryDirectory() as d:
            # 1ª carga: todos com 100.
            primeira = Path(d) / "primeira.xlsx"
            _workbook(primeira, [(nome[p], f"DOC-{s}-{i}", 100) for i, p in enumerate(STATUS_POR_PAPEL)])
            run(primeira)

            # Fluxo andou: um BM por status (NF/comprovante onde o fluxo já chegou), trilha e REV manual.
            with engine.begin() as conn:
                for papel, status in STATUS_POR_PAPEL.items():
                    com_nf = status in ("APROVADO", "PAGO")
                    sgc_id = conn.execute(text(
                        "insert into sgc_aprovacoes_medicao (colaborador_codigo, ciclo, status, nf_arquivo, nf_arquivo_nome, "
                        "comprovante_arquivo, comprovante_arquivo_nome, aprovado_at, pago_at) values (:k, :c, :st, :nf, :nfn, :cp, :cpn, "
                        "case when :aprov then now() end, case when :pago then now() end) returning id"),
                        {"k": nome[papel], "c": CICLO, "st": status,
                         "nf": nf[papel] if com_nf else None, "nfn": "nf.pdf" if com_nf else None,
                         "cp": comprovante[papel] if status == "PAGO" else None, "cpn": "comp.pdf" if status == "PAGO" else None,
                         "aprov": status != "PENDENTE" and status != "REVISAO_SOLICITADA", "pago": status == "PAGO"}).scalar()
                    conn.execute(text("insert into sgc_logs (sgc_id, colaborador_codigo, ciclo, acao, status_novo) values (:i, :k, :c, 'ENVIAR', :st)"),
                                 {"i": sgc_id, "k": nome[papel], "c": CICLO, "st": status})
                conn.execute(text("update mapa_pagamento_itens set rev = 15 where ciclo = :c and projetista_codigo = :k"),
                             {"c": CICLO, "k": nome["PAGO"]})
            with engine.connect() as conn:
                antes = estado(conn)
            assert all(antes[p]["sgc"] for p in STATUS_POR_PAPEL) and float(antes["PAGO"]["mapa"].rev) == 15

            # Reimportação: valores mudam (200), exceto AGUARDANDO (igual, em outra posição); a FILIAL some.
            segunda = Path(d) / "segunda.xlsx"
            linhas = [(nome[p], f"DOC-{s}-{i}", 200) for i, p in enumerate(STATUS_POR_PAPEL) if p not in ("AGUARDANDO", "REVISAO FILIAL")]
            linhas.append((nome["AGUARDANDO"], f"DOC-{s}-{list(STATUS_POR_PAPEL).index('AGUARDANDO')}", 100))
            _workbook(segunda, linhas)

            # Falha no fim da carga: nada pode ter sido apagado ou gravado pela metade.
            original = im.generate_payment_map_from_measurements
            im.generate_payment_map_from_measurements = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("falha simulada"))
            try:
                run(segunda)
                raise AssertionError("a falha simulada deveria abortar a importação")
            except RuntimeError as error:
                assert "falha simulada" in str(error)
            finally:
                im.generate_payment_map_from_measurements = original
            with engine.connect() as conn:
                assert estado(conn) == antes, "falha no meio da reimportação não pode alterar nada (uma transação)"

            resultado = run(segunda)
            with engine.connect() as conn:
                depois = estado(conn)

            perdas = []
            for papel in sorted(BLOQUEADOS):
                a, b = antes[papel], depois[papel]
                sgc = b["sgc"] or {}
                if sgc.get("id") != a["sgc"]["id"] or sgc.get("status") != a["sgc"]["status"]:
                    perdas.append(f"{papel}: aprovação perdida ({a['sgc']['status']} -> {sgc.get('status')})")
                if sgc.get("nf_arquivo") != a["sgc"]["nf_arquivo"]:
                    perdas.append(f"{papel}: NF perdida")
                if sgc.get("comprovante_arquivo") != a["sgc"]["comprovante_arquivo"]:
                    perdas.append(f"{papel}: comprovante perdido")
                if (sgc.get("aprovado_at"), sgc.get("pago_at")) != (a["sgc"]["aprovado_at"], a["sgc"]["pago_at"]):
                    perdas.append(f"{papel}: datas de aprovação/pagamento perdidas")
                if b["logs"] != a["logs"]:
                    perdas.append(f"{papel}: trilha do BM perdida ({a['logs']} -> {b['logs']} logs)")
                if float(b["medido"]) != 100.0:
                    perdas.append(f"{papel}: valor medido sobrescrito (100 -> {b['medido']})")
                if b["mapa"] != a["mapa"]:
                    perdas.append(f"{papel}: mapa de pagamento sobrescrito ({a['mapa']} -> {b['mapa']})")
            assert not perdas, "Reimportação alterou BMs aprovados/pagos:\n  " + "\n  ".join(perdas)
            for papel in ("PENDENTE", "REVISAO"):
                assert depois[papel]["sgc"] is None, f"{papel}: BM não aprovado segue o comportamento anterior (removido)"
                assert float(depois[papel]["medido"]) == 200.0 and float(depois[papel]["mapa"].valor) == 200.0

            preservados = {b["colaborador_codigo"]: b["status"] for b in resultado["bms_preservados"]}
            assert preservados == {nome[p]: STATUS_POR_PAPEL[p] for p in BLOQUEADOS}, preservados
            divergentes = {d["colaborador_codigo"]: d for d in resultado["divergencias_bm_bloqueado"]}
            assert set(divergentes) == {nome["APROVADO"], nome["PAGO"]}, sorted(divergentes)  # AGUARDANDO igual; FILIAL ausente
            pago = divergentes[nome["PAGO"]]
            assert pago["status"] == "PAGO" and pago["total_banco"] == "100.0000" and pago["total_planilha"] == "200.0000"
            assert [x["valor_medicao"] for x in pago["somente_planilha"]] == ["200.0000"]
            assert [x["valor_medicao"] for x in pago["somente_banco"]] == ["100.0000"]
    finally:
        with engine.begin() as conn:
            for tabela in ("sgc_logs", "sgc_aprovacoes_medicao", "medicoes", "mapa_pagamento_itens", "mapa_pagamento_contexto",
                           "bm_aux_medicoes", "importacao_identidades"):
                conn.execute(text(f"delete from {tabela} where ciclo = :c"), {"c": CICLO})
            conn.execute(text("delete from cadastros_fornecedores where colaborador_codigo in :c").bindparams(im.bindparam("c", expanding=True)),
                         {"c": list(nome.values())})
            if ids:
                conn.execute(text("delete from profissionais where id in :ids").bindparams(im.bindparam("ids", expanding=True)),
                             {"ids": list(ids.values())})


# ─── MAPA PAGTO explícito, Documentos Auxiliares e aprovação concorrente ─────────────────────
# Nomes sem token em comum (além do sufixo): uses_documentos_auxiliares também casa por nome parecido.
AUX_HEADERS = ["Projeto", "Num_Cliente", "Responsavel", "Auxiliar", "Formato", "Equivalente_Revisado", "Tipo_Doc", "Ciclo", "Valor De Medição"]


def _conectar():
    url_text = os.environ.get("ETL_DATABASE_URL") or os.environ.get("DATABASE_URL_TEST")
    if not url_text:
        print("SKIP: sem ETL_DATABASE_URL/DATABASE_URL_TEST")
        return None, None
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url

    url = make_url(url_text).difference_update_query(["schema"])
    assert url.host in ("localhost", "127.0.0.1") and "e2e" in (url.database or "")
    db = url.render_as_string(hide_password=False)
    return create_engine(db), db


def _semear(engine, codigos: list[str], fonte_aux: set[str] = frozenset()) -> dict[str, str]:
    from sqlalchemy import text

    ids = {}
    with engine.begin() as conn:
        for codigo in codigos:
            ids[codigo] = str(conn.execute(text("insert into profissionais (nome, codigo) values (:c, :c) returning id"), {"c": codigo}).scalar())
            conn.execute(text("insert into cadastros_fornecedores (cnpj_normalizado, colaborador_codigo, responsavel, razao_social, fonte_medicao, raw_payload) "
                              "values ('11222333000181', :c, :c, :c, :f, '{}')"),
                         {"c": codigo, "f": "DOCUMENTOS_AUXILIARES" if codigo in fonte_aux else "DOCUMENTOS"})
    return ids


def _criar_bm(engine, ciclo: str, codigo: str, status: str) -> str:
    from sqlalchemy import text

    with engine.begin() as conn:
        sgc_id = str(conn.execute(text(
            "insert into sgc_aprovacoes_medicao (colaborador_codigo, ciclo, status, nf_arquivo, comprovante_arquivo) "
            "values (:k, :c, :st, :nf, :cp) returning id"),
            {"k": codigo, "c": ciclo, "st": status,
             "nf": b"%PDF-NF" if status in ("APROVADO", "PAGO") else None, "cp": b"COMP" if status == "PAGO" else None}).scalar())
        conn.execute(text("insert into sgc_logs (sgc_id, colaborador_codigo, ciclo, acao) values (:i, :k, :c, 'ENVIAR')"),
                     {"i": sgc_id, "k": codigo, "c": ciclo})
    return sgc_id


def _limpar(engine, ciclo: str, ids: dict[str, str]) -> None:
    from sqlalchemy import text

    with engine.begin() as conn:
        for tabela in ("sgc_logs", "sgc_aprovacoes_medicao", "medicoes", "mapa_pagamento_itens", "mapa_pagamento_contexto",
                       "bm_aux_medicoes", "importacao_identidades"):
            conn.execute(text(f"delete from {tabela} where ciclo = :c"), {"c": ciclo})
        if ids:
            conn.execute(text("delete from cadastros_fornecedores where colaborador_codigo in :c").bindparams(im.bindparam("c", expanding=True)),
                         {"c": list(ids)})
            conn.execute(text("delete from profissionais where id in :ids").bindparams(im.bindparam("ids", expanding=True)),
                         {"ids": list(ids.values())})


def _planilha(path: Path, ciclo: str, documentos: list[tuple[str, str, int]], mapa: list[tuple[str, int, int]],
              aux: list[tuple[str, str, int]]) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Documentos"
    ws.append(HEADERS)
    for projetista, documento, valor in documentos:
        ws.append(row_values(PROJETISTA=projetista, **{"Número do Documento": documento, "VALOR DE MEDIÇÃO": valor}))
    if mapa:
        ws_mapa = wb.create_sheet("MAPA PAGTO")
        ws_mapa.append(["ATO", "PROJETISTA", "VALOR", "REV"])
        for projetista, valor, rev in mapa:
            ws_mapa.append(["PRODUÇÃO", projetista, valor, rev])
    ws_aux = wb.create_sheet("Documentos Auxiliares")
    ws_aux.append(AUX_HEADERS)
    for responsavel, documento, valor in aux:
        ws_aux.append(["PROJ-AUX-TESTE", documento, responsavel, None, "A1", 1, "DOC", ciclo, valor])
    wb.save(path)


def _ingest(path: Path, db: str, ciclo: str) -> dict:
    return im.ingest(path, "Documentos", "Base", "MAPA PAGTO", "Documentos Auxiliares", db, False, True, ciclo)


def test_reimport_preserves_payment_map_sheet_and_bm_aux() -> None:
    engine, db = _conectar()
    if not engine:
        return
    from sqlalchemy import text

    ciclo, s = "2907", _sufixo()
    docs, aux, livre = f"ALFAMA {s} BRUNO", f"CORVO {s} DIAS", f"ESTEVO {s} FARIAS"
    ids: dict[str, str] = {}

    def estado(conn, codigo: str) -> dict:
        return {
            "sgc": conn.execute(text("select id, status, nf_arquivo, comprovante_arquivo from sgc_aprovacoes_medicao where ciclo = :c and colaborador_codigo = :k"),
                                {"c": ciclo, "k": codigo}).one_or_none(),
            "logs": conn.execute(text("select count(*) from sgc_logs where ciclo = :c and colaborador_codigo = :k"), {"c": ciclo, "k": codigo}).scalar(),
            "medido": float(conn.execute(text("select coalesce(sum(valor_medicao), 0) from medicoes where ciclo = :c and id_profissional = :p"),
                                         {"c": ciclo, "p": ids[codigo]}).scalar()),
            "mapa": conn.execute(text("select valor, rev from mapa_pagamento_itens where ciclo = :c and projetista_codigo = :k"),
                                 {"c": ciclo, "k": codigo}).all(),
            "bm_aux": conn.execute(text("select id, updated_at from bm_aux_medicoes where ciclo = :c and responsavel_codigo = :k order by id"),
                                   {"c": ciclo, "k": codigo}).all(),
        }

    try:
        ids = _semear(engine, [docs, aux, livre], fonte_aux={aux})
        with tempfile.TemporaryDirectory() as d:
            primeira, segunda = Path(d) / "primeira.xlsx", Path(d) / "segunda.xlsx"
            _planilha(primeira, ciclo, [(docs, f"DOC-{s}-1", 100), (livre, f"DOC-{s}-3", 100)],
                      [(docs, 100, 0), (aux, 100, 0), (livre, 100, 0)], [(aux, f"AUX-{s}-2", 100)])
            _ingest(primeira, db, ciclo)
            _criar_bm(engine, ciclo, docs, "APROVADO")
            _criar_bm(engine, ciclo, aux, "PAGO")
            _criar_bm(engine, ciclo, livre, "PENDENTE")
            with engine.begin() as conn:
                conn.execute(text("update mapa_pagamento_itens set rev = 15 where ciclo = :c and projetista_codigo = :k"), {"c": ciclo, "k": aux})
                antes = {codigo: estado(conn, codigo) for codigo in (docs, aux)}
            assert antes[aux]["bm_aux"] and antes[aux]["medido"] == 100.0, "fixture: BM AUX precisa ter carregado"

            _planilha(segunda, ciclo, [(docs, f"DOC-{s}-1", 200), (livre, f"DOC-{s}-3", 200)],
                      [(docs, 200, 5), (aux, 200, 5), (livre, 200, 5)], [(aux, f"AUX-{s}-2", 200)])
            resultado = _ingest(segunda, db, ciclo)
            with engine.connect() as conn:
                for codigo in (docs, aux):
                    assert estado(conn, codigo) == antes[codigo], f"{codigo}: BM bloqueado alterado pela aba MAPA PAGTO/Documentos Auxiliares"
                depois_livre = estado(conn, livre)
            assert depois_livre["sgc"] is None and depois_livre["medido"] == 200.0
            assert [(float(v), float(r)) for v, r in depois_livre["mapa"]] == [(200.0, 5.0)]

            divergentes = {d["colaborador_codigo"]: d for d in resultado["divergencias_bm_bloqueado"]}
            assert set(divergentes) == {docs, aux}, sorted(divergentes)
            assert divergentes[docs]["mapa"] == {"banco": {"valor": "100.0000", "rev": "0.0000"}, "planilha": {"valor": "200.0000", "rev": "5.0000"}}
            assert divergentes[aux]["mapa"] == {"banco": {"valor": "100.0000", "rev": "15.0000"}, "planilha": {"valor": "200.0000", "rev": "5.0000"}}
            assert [x["valor_medicao"] for x in divergentes[aux]["somente_planilha"]] == ["200.0000"]
            assert [x["valor_medicao"] for x in divergentes[aux]["somente_banco"]] == ["100.0000"]
    finally:
        _limpar(engine, ciclo, ids)


def test_bm_approved_during_import_aborts_instead_of_deleting() -> None:
    engine, db = _conectar()
    if not engine:
        return
    from sqlalchemy import text

    ciclo, s = "2909", _sufixo()
    codigo = f"GUSTAVO {s} HELENA"
    ids: dict[str, str] = {}
    original = im.assert_import_identities_active
    try:
        ids = _semear(engine, [codigo])
        with tempfile.TemporaryDirectory() as d:
            primeira, segunda = Path(d) / "primeira.xlsx", Path(d) / "segunda.xlsx"
            _planilha(primeira, ciclo, [(codigo, f"DOC-{s}-1", 100)], [], [])
            _ingest(primeira, db, ciclo)
            sgc_id = _criar_bm(engine, ciclo, codigo, "PENDENTE")

            # O fornecedor aprova (outra conexão, commit) depois da trava inicial e antes da limpeza.
            def aprova_no_meio(conn, identities):
                with engine.begin() as outra:
                    outra.execute(text("update sgc_aprovacoes_medicao set status = 'AGUARDANDO_NF', aprovado_at = now() where id = :i"), {"i": sgc_id})
                return original(conn, identities)

            im.assert_import_identities_active = aprova_no_meio
            _planilha(segunda, ciclo, [(codigo, f"DOC-{s}-1", 200)], [], [])
            try:
                _ingest(segunda, db, ciclo)
                raise AssertionError("BM aprovado durante a importação deveria abortar a carga")
            except ValueError as error:
                assert "BM aprovado durante a importação" in str(error), error
            finally:
                im.assert_import_identities_active = original

            with engine.connect() as conn:
                status = conn.execute(text("select status from sgc_aprovacoes_medicao where id = :i"), {"i": sgc_id}).scalar()
                logs = conn.execute(text("select count(*) from sgc_logs where sgc_id = :i"), {"i": sgc_id}).scalar()
                medido = conn.execute(text("select coalesce(sum(valor_medicao), 0) from medicoes where ciclo = :c and id_profissional = :p"),
                                      {"c": ciclo, "p": ids[codigo]}).scalar()
            assert status == "AGUARDANDO_NF", f"BM aprovado no meio da importação foi apagado/alterado: {status}"
            assert logs == 1 and float(medido) == 100.0, (logs, medido)
    finally:
        im.assert_import_identities_active = original
        _limpar(engine, ciclo, ids)


if __name__ == "__main__":
    test_reimport_preserves_approved_bms()
    test_reimport_preserves_payment_map_sheet_and_bm_aux()
    test_bm_approved_during_import_aborts_instead_of_deleting()
    print("OK: reimportação preserva BMs aprovados/pagos (Documentos, MAPA PAGTO, Documentos Auxiliares), "
          "reporta divergência, é atômica e não apaga BM aprovado durante a carga.")
