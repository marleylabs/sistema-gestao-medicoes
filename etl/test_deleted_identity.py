"""Valida o guard ETL contra o Postgres E2E real; todas as fixtures sofrem rollback."""
import json
import os
import uuid
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from ingest_medicoes import assert_import_identities_active, deleted_identity_hash


def main():
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
            uid = str(uuid.uuid4())
            code = f"TESTE-ETL-{uid}"
            name = f"Nome Histórico ETL {uid}"
            conn.execute(text("insert into profissionais (id,nome,codigo,deleted_at,status_colaborador) values (:id,:nome,:codigo,now(),'ATO')"), {"id": uid, "nome": f"EXCLUIDO-{uid}", "codigo": code})
            conn.execute(text("insert into admin_audit_logs (action,admin_id,admin_usuario,admin_nome,target_type,target_id,target_codigo,metadata) values ('FORNECEDOR_EXCLUSAO_DEFINITIVA',:id,'TESTE-ETL','Teste','Profissional',:id,:codigo,cast(:metadata as jsonb))"), {"id": uid, "codigo": code, "metadata": json.dumps({"identityNameHashes": [deleted_identity_hash(name)]})})
            assert_import_identities_active(conn, {f"ATIVO-{uid}"})
            for identity in (code, name, name.lower()):
                try:
                    assert_import_identities_active(conn, {identity})
                except ValueError as error:
                    assert "IMPORTACAO_BLOQUEADA" in str(error)
                else:
                    raise AssertionError("ETL aceitou identidade excluída")
            # Constraint REAL: EXCLUIDO continua proibido em status_colaborador.
            nested = conn.begin_nested()
            try:
                conn.execute(text("update profissionais set status_colaborador='EXCLUIDO' where id=:id"), {"id": uid})
            except IntegrityError:
                nested.rollback()
            else:
                nested.rollback()
                raise AssertionError("CHECK de status_colaborador ausente")
            print("PASS: ETL bloqueia código/alias excluído e respeita CHECK real; fixtures revertidas.")
        finally:
            transaction.rollback()
    engine.dispose()


if __name__ == "__main__":
    main()
