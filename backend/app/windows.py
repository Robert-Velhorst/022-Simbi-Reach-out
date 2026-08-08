from __future__ import annotations

import os
import threading
import urllib.request
import webbrowser


def _configure() -> tuple[str, int]:
    host = "127.0.0.1"
    port = int(os.getenv("SIMBI_WINDOWS_PORT", "8765"))
    if not 1024 <= port <= 65535:
        raise RuntimeError("SIMBI_WINDOWS_PORT must be between 1024 and 65535")
    origin = f"http://{host}:{port}"
    os.environ.setdefault("SIMBI_ENV", "local")
    os.environ.setdefault("SIMBI_FRONTEND_ORIGIN", origin)
    os.environ.setdefault("SIMBI_ALLOWED_HOSTS", f"{host},localhost")
    os.environ.setdefault("SIMBI_COOKIE_SECURE", "false")
    os.environ.setdefault("SIMBI_AUTO_BACKUP", "true")
    return host, port


def _maintenance(stop: threading.Event) -> None:
    from .worker import run_once

    while not stop.is_set():
        try:
            run_once()
        except Exception as exc:  # pragma: no cover - surfaced in packaged runtime
            print(f"Maintenance warning: {exc}", flush=True)
        stop.wait(300)


def _open_when_ready(url: str, stop: threading.Event) -> None:
    for _ in range(100):
        if stop.wait(0.1):
            return
        try:
            with urllib.request.urlopen(  # noqa: S310 - URL is fixed to loopback above
                f"{url}/api/health/ready", timeout=1
            ) as response:
                if response.status == 200:
                    webbrowser.open(url)
                    return
        except OSError:
            continue
    print(f"Simbi is running at {url}; open that address in your browser.", flush=True)


def main() -> None:
    host, port = _configure()
    import uvicorn

    from .db import migrate
    from .main import app

    migrate()
    stop = threading.Event()
    maintenance = threading.Thread(target=_maintenance, args=(stop,), daemon=True)
    opener = threading.Thread(
        target=_open_when_ready, args=(f"http://{host}:{port}", stop), daemon=True
    )
    maintenance.start()
    opener.start()
    print(f"Simbi Reach-Out is starting at http://{host}:{port}")
    print("Keep this window open. Press Ctrl+C here to stop the app safely.")
    try:
        uvicorn.run(app, host=host, port=port, server_header=False, access_log=False)
    finally:
        stop.set()
        maintenance.join(timeout=2)


if __name__ == "__main__":
    main()
