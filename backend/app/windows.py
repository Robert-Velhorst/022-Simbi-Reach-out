from __future__ import annotations

import os
import socket
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
    os.environ.setdefault("SIMBI_REQUIRE_MAINTENANCE", "true")
    return host, port


def _maintenance(stop: threading.Event, failed: threading.Event, server=None) -> None:
    from .worker import run_once

    while not stop.is_set():
        try:
            run_once()
        except Exception:
            print(
                "Maintenance failed; stopping the app. Run the local diagnostics before restarting.",
                flush=True,
            )
            failed.set()
            if server is not None:
                server.should_exit = True
            return
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
    # Detect a conflicting listener before migrating data or opening any browser.
    with socket.socket() as probe:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        probe.bind((host, port))
    import uvicorn

    from .db import migrate, runtime_guard
    from .main import app
    from .worker import _record_state, worker_lock

    stop = threading.Event()
    failed = threading.Event()
    server = uvicorn.Server(
        uvicorn.Config(app, host=host, port=port, server_header=False, access_log=False)
    )
    with runtime_guard(), worker_lock():
        migrate()
        _record_state("last_maintenance_interval", "300")
        maintenance = threading.Thread(
            target=_maintenance, args=(stop, failed, server), daemon=True
        )
        maintenance.start()
        if os.getenv("SIMBI_WINDOWS_NO_BROWSER", "false").lower() not in {"true", "1"}:
            threading.Thread(
                target=_open_when_ready, args=(f"http://{host}:{port}", stop), daemon=True
            ).start()
        print(f"Simbi Reach-Out is starting at http://{host}:{port}")
        print("Keep this window open. Press Ctrl+C here to stop the app safely.")
        try:
            server.run()
        finally:
            stop.set()
            maintenance.join(timeout=30)
        if failed.is_set() or maintenance.is_alive():
            raise RuntimeError("Maintenance failed or could not stop safely")


if __name__ == "__main__":
    main()
