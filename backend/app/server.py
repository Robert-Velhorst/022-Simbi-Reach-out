from __future__ import annotations

import uvicorn

from .config import settings


def main() -> None:
    uvicorn.run(
        "app.main:app",
        app_dir="backend",
        host="0.0.0.0",  # noqa: S104 - container ingress is constrained by Compose/Caddy
        port=8000,
        proxy_headers=True,
        forwarded_allow_ips=settings.forwarded_allow_ips,
        server_header=False,
    )


if __name__ == "__main__":
    main()
