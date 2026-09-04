FROM node:24-alpine AS frontend
WORKDIR /build/frontend
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.13-slim AS runtime
LABEL org.opencontainers.image.title="Simbi Reach-Out" \
      org.opencontainers.image.description="Local-first, review-gated outreach operations" \
      org.opencontainers.image.source="https://github.com/Robert-Velhorst/022-Simbi-Reach-out"
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SIMBI_ENV=production \
    SIMBI_DATABASE_PATH=/app/data/simbi.db \
    SIMBI_COOKIE_SECURE=true \
    SIMBI_BACKUP_PATH=/app/backups
WORKDIR /app
RUN addgroup --system simbi && adduser --system --ingroup simbi simbi
COPY pyproject.toml ./
COPY backend ./backend
COPY --from=frontend /build/frontend/dist ./frontend/dist
RUN pip install --no-cache-dir .
RUN mkdir -p /app/data /app/backups && chown -R simbi:simbi /app
USER simbi
EXPOSE 8000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.parse,urllib.request; host=urllib.parse.urlparse(os.environ['SIMBI_FRONTEND_ORIGIN']).hostname; request=urllib.request.Request('http://127.0.0.1:8000/api/health/ready', headers={'Host': host}); urllib.request.urlopen(request, timeout=3)"
CMD ["python", "-m", "app.server"]
