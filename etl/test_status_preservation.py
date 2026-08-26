from __future__ import annotations

import os

from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, create_engine, select

from ingest_medicoes import upsert_payment_map_status


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
        Column("nome_completo", String),
        Column("status_colaborador", String),
        Column("updated_at", DateTime),
        prefixes=["TEMPORARY"],
    )
    with engine.begin() as conn:
        profissionais.create(conn)
        conn.execute(profissionais.insert(), [
            {"nome": "A", "codigo": "A", "status_colaborador": "ATO"},
            {"nome": "B", "codigo": "B", "status_colaborador": "PRODUÇÃO"},
            {"nome": "C", "codigo": "C", "status_colaborador": "PRODUÇÃO"},
        ])
        upsert_payment_map_status(conn, profissionais, {"nome": "A", "codigo": "A", "nome_completo": "A", "status_colaborador": "PRODUÇÃO"})
        upsert_payment_map_status(conn, profissionais, {"nome": "B", "codigo": "B", "nome_completo": "B", "status_colaborador": "ATO"})
        rows = dict(conn.execute(select(profissionais.c.nome, profissionais.c.status_colaborador)).all())
    assert rows == {"A": "PRODUÇÃO", "B": "ATO", "C": "PRODUÇÃO"}, rows
    print("OK: presentes recalculados; profissional ausente preservado.")


if __name__ == "__main__":
    main()
