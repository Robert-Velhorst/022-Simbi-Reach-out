FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS frontend
WORKDIR /build/frontend
RUN npm install --global npm@12.2.1 pnpm@12.15.0
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.15.1-alpine3.24@sha256:54448f67d7c31c39e5cdd3ea2d6382395ce142806c284425f8e897d78a0465b3 AS sqlite-builder
WORKDIR /app
RUN apk upgrade --no-cache && apk add --no-cache build-base ca-certificates openssl
COPY sqlite-runtime.json ./
COPY scripts/setup_sqlite_runtime.py scripts/build_sqlite_apk.py ./scripts/
COPY backend/app/__init__.py backend/app/sqlite_runtime.py ./backend/app/
RUN python -I scripts/setup_sqlite_runtime.py
RUN python -I scripts/build_sqlite_apk.py

FROM sqlite-builder AS backend-qualification
COPY . .
COPY --from=frontend /build/frontend/dist ./frontend/dist
RUN python -m pip install --no-cache-dir uv==0.13.5 \
    && uv sync --frozen --extra dev --python /usr/local/bin/python
RUN --network=none PYTHONPATH=/app/runtime_bootstrap:/app/backend \
    .venv/bin/python -m pytest --junitxml=/app/musl-backend-tests.xml

FROM python:3.15.1-alpine3.24@sha256:54448f67d7c31c39e5cdd3ea2d6382395ce142806c284425f8e897d78a0465b3 AS runtime
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
RUN apk upgrade --no-cache \
    && addgroup -S -g 10001 simbi && adduser -S -u 10001 -G simbi simbi
COPY pyproject.toml requirements-runtime.lock sqlite-runtime.json ./
COPY --from=sqlite-builder /app/.simbi-runtime ./.simbi-runtime
COPY --from=sqlite-builder /tmp/simbi-sqlite.apk /tmp/simbi-sqlite.apk
COPY --from=sqlite-builder /tmp/simbi-package-keys /tmp/simbi-package-keys
COPY runtime_bootstrap ./runtime_bootstrap
COPY backend/app ./backend/app
COPY backend/migrations ./backend/migrations
COPY --from=frontend /build/frontend/dist ./frontend/dist
RUN python -m pip install --no-cache-dir --require-hashes -r requirements-runtime.lock
RUN python -m pip uninstall -y pip \
    && apk --keys-dir /tmp/simbi-package-keys --no-network add /tmp/simbi-sqlite.apk \
    && rm -f /tmp/simbi-sqlite.apk \
    && rm -rf /tmp/simbi-package-keys /root/.cache/pip
RUN mkdir -p /app/data /app/backups /app/hai && chown -R simbi:simbi /app/data /app/backups /app/hai
USER simbi
RUN --mount=type=bind,source=scripts/probe_image_runtime.py,target=/qualification.py,readonly \
    python /qualification.py
EXPOSE 8000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.parse,urllib.request; host=urllib.parse.urlparse(os.environ['SIMBI_FRONTEND_ORIGIN']).hostname; request=urllib.request.Request('http://127.0.0.1:8000/api/health/ready', headers={'Host': host}); urllib.request.urlopen(request, timeout=3)"
CMD ["python", "-m", "app.server"]
