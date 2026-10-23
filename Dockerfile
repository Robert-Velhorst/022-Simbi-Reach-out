FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS frontend
WORKDIR /build/frontend
RUN npm install --global npm@12.2.1 pnpm@12.15.0
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.15.1-slim-trixie@sha256:08275f764e022331c6d3e3ca55d8cce01fa4684b02111adf0445d71806fe7941 AS sqlite-builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY sqlite-runtime.json ./
COPY scripts/setup_sqlite_runtime.py ./scripts/setup_sqlite_runtime.py
COPY backend/app/__init__.py backend/app/sqlite_runtime.py ./backend/app/
RUN python -I scripts/setup_sqlite_runtime.py

FROM python:3.15.1-slim-trixie@sha256:08275f764e022331c6d3e3ca55d8cce01fa4684b02111adf0445d71806fe7941 AS runtime
LABEL org.opencontainers.image.title="Simbi Reach-Out" \
      org.opencontainers.image.description="Local-first, review-gated outreach operations" \
      org.opencontainers.image.source="https://github.com/Robert-Velhorst/022-Simbi-Reach-out"
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/runtime_bootstrap:/app/backend \
    SIMBI_ENV=production \
    SIMBI_DATABASE_PATH=/app/data/simbi.db \
    SIMBI_COOKIE_SECURE=true \
    SIMBI_BACKUP_PATH=/app/backups
WORKDIR /app
RUN addgroup --system --gid 10001 simbi && adduser --system --uid 10001 --ingroup simbi simbi
COPY pyproject.toml requirements-runtime.lock sqlite-runtime.json ./
COPY --from=sqlite-builder /app/.simbi-runtime ./.simbi-runtime
COPY runtime_bootstrap ./runtime_bootstrap
COPY backend ./backend
COPY --from=frontend /build/frontend/dist ./frontend/dist
RUN python -m pip install --no-cache-dir --require-hashes -r requirements-runtime.lock
RUN python -m pip uninstall -y pip \
    && if dpkg-query -W libsqlite3-0 >/dev/null 2>&1; then apt-get purge -y --no-auto-remove libsqlite3-0; fi \
    && rm -rf /var/lib/apt/lists/* /root/.cache/pip
RUN mkdir -p /app/data /app/backups /app/hai && chown -R simbi:simbi /app/data /app/backups /app/hai
USER simbi
RUN python -c "import os, sys, sqlite3; assert os.getuid() == 10001; assert sys.version_info[:3] == (3, 15, 1); assert sqlite3.sqlite_version == '3.54.1'"
EXPOSE 8000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.parse,urllib.request; host=urllib.parse.urlparse(os.environ['SIMBI_FRONTEND_ORIGIN']).hostname; request=urllib.request.Request('http://127.0.0.1:8000/api/health/ready', headers={'Host': host}); urllib.request.urlopen(request, timeout=3)"
CMD ["python", "-m", "app.server"]
