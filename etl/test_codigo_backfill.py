from __future__ import annotations

import os

from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, create_engine, select

from ingest_medicoes import backfill_professional_codigo


def main() -> None:
    database_url = os.environ.get("ETL_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("ETL_DATABASE_URL ou DATABASE_URL é obrigatório para o teste temporário.")
    engine = create_engine(database_url)
    metadata = MetaData()
    profissionais = Table(
        "profissionais",
        metadata,
        Column("id", Integer, primary_key=True, autoincrement=True),
        Column("nome", String, unique=True, nullable=False),
        Column("codigo", String),
        Column("status_colaborador", String),
        Column("updated_at", DateTime),
        prefixes=["TEMPORARY"],
    )
    with engine.begin() as conn:
        profissionais.create(conn)
        conn.execute(profissionais.insert(), [
            {"nome": "SEM CODIGO", "codigo": None, "status_colaborador": "PRODUÇÃO"},
            {"nome": "JA TEM CODIGO", "codigo": "CODIGO-ANTIGO", "status_colaborador": "ATO"},
        ])

        # Caso 1: profissional sem codigo -> deve ser preenchido, sem tocar status_colaborador.
        backfill_professional_codigo(conn, profissionais, "SEM CODIGO", "SEM CODIGO")

        # Caso 2: profissional com codigo já preenchido -> nunca deve ser sobrescrito.
        backfill_professional_codigo(conn, profissionais, "JA TEM CODIGO", "VALOR-NOVO-INDEVIDO")

        # Caso 3: profissional inexistente -> deve ser criado (mesmo comportamento dos outros upserts do ETL).
        backfill_professional_codigo(conn, profissionais, "NOVO PROFISSIONAL", "NOVO PROFISSIONAL")

        rows = {
            r.nome: (r.codigo, r.status_colaborador)
            for r in conn.execute(select(profissionais.c.nome, profissionais.c.codigo, profissionais.c.status_colaborador)).all()
        }

    assert rows["SEM CODIGO"] == ("SEM CODIGO", "PRODUÇÃO"), rows
    assert rows["JA TEM CODIGO"] == ("CODIGO-ANTIGO", "ATO"), rows
    assert rows["NOVO PROFISSIONAL"][0] == "NOVO PROFISSIONAL", rows
    print("OK: codigo vazio preenchido; codigo existente preservado; status_colaborador nunca tocado.")


if __name__ == "__main__":
    main()
