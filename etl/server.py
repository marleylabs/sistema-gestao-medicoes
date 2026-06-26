from __future__ import annotations

import json
import os
import tempfile
import threading
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from ingest_medicoes import ingest

DATABASE_URL = os.environ.get("ETL_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
PORT = int(os.environ.get("ETL_SERVER_PORT", "4000"))
ETL_TIMEOUT_SECONDS = int(os.environ.get("ETL_TIMEOUT_SECONDS", "1800"))  # 30 min padrão

_lock = threading.Lock()
_running = False
_started_at: datetime | None = None
_last_result: dict | None = None
_last_error: str | None = None
_watchdog_timer: threading.Timer | None = None


def _reset_running() -> None:
    """Chamado pelo watchdog se ETL ultrapassar o timeout."""
    global _running, _last_error, _watchdog_timer
    with _lock:
        if _running:
            _running = False
            _last_error = f"ETL cancelado automaticamente após {ETL_TIMEOUT_SECONDS}s sem resposta."
            _watchdog_timer = None


def run_etl(file_bytes: bytes, ciclo: str | None) -> None:
    global _running, _last_result, _last_error, _watchdog_timer
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".xlsm", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)
        result = ingest(
            excel_path=tmp_path,
            sheet_name="Geral",
            base_sheet_name="BASE",
            payment_map_sheet_name="MAPA PAGTO",
            bm_aux_sheet_name="BM AUX",
            database_url=DATABASE_URL,
            create_schema=False,
            full_refresh=True,
            ciclo=ciclo or None,
        )
        _last_result = result
        _last_error = None
    except Exception:
        _last_error = traceback.format_exc()
        _last_result = None
    finally:
        if tmp_path:
            tmp_path.unlink(missing_ok=True)
        # Cancela watchdog e libera lock
        with _lock:
            if _watchdog_timer:
                _watchdog_timer.cancel()
                _watchdog_timer = None
            _running = False


def parse_multipart(content_type: str, body: bytes) -> tuple[bytes | None, str | None]:
    """Parse multipart/form-data — extrai campo 'file' e campo 'ciclo'."""
    boundary_str = ""
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary_str = part[len("boundary="):].strip('"')
            break
    if not boundary_str:
        return None, None

    boundary = b"--" + boundary_str.encode()
    file_bytes: bytes | None = None
    ciclo: str | None = None

    parts = body.split(boundary)
    for part in parts[1:]:
        if part in (b"--\r\n", b"--"):
            break
        if b"\r\n\r\n" not in part:
            continue
        header_block, _, content = part.partition(b"\r\n\r\n")
        # strip trailing \r\n
        content = content.rstrip(b"\r\n")
        headers = header_block.decode(errors="replace")

        if 'name="file"' in headers:
            file_bytes = content
        elif 'name="ciclo"' in headers:
            ciclo = content.decode(errors="replace").strip() or None

    return file_bytes, ciclo


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # silence default access log
        pass

    def send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True, "running": _running})
        elif self.path == "/status":
            elapsed = None
            if _running and _started_at:
                elapsed = int((datetime.now(timezone.utc) - _started_at).total_seconds())
            self.send_json(200, {
                "running": _running,
                "elapsedSeconds": elapsed,
                "lastResult": _last_result,
                "lastError": _last_error,
            })
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        global _running, _started_at, _watchdog_timer
        if self.path != "/run":
            self.send_json(404, {"error": "not found"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        content_type = self.headers.get("Content-Type", "")

        file_bytes, ciclo = parse_multipart(content_type, body)
        if not file_bytes:
            self.send_json(400, {"error": "Campo 'file' não encontrado no upload."})
            return

        with _lock:
            if _running:
                self.send_json(409, {"error": "ETL já em execução. Aguarde."})
                return
            _running = True
            _started_at = datetime.now(timezone.utc)
            # Watchdog: reseta _running se ETL travar além do timeout
            _watchdog_timer = threading.Timer(ETL_TIMEOUT_SECONDS, _reset_running)
            _watchdog_timer.daemon = True
            _watchdog_timer.start()

        thread = threading.Thread(target=run_etl, args=(file_bytes, ciclo), daemon=True)
        thread.start()
        self.send_json(202, {"ok": True, "message": "ETL iniciado.", "ciclo": ciclo})


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"ETL server listening on port {PORT}", flush=True)
    server.serve_forever()
