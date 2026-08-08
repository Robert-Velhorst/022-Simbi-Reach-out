FROM node:24-alpine AS frontend
WORKDIR /build/frontend
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SIMBI_ENV=production \
    SIMBI_DATABASE_PATH=/app/data/simbi.db \
    SIMBI_FRONTEND_ORIGIN=https://localhost \
    SIMBI_COOKIE_SECURE=true
WORKDIR /app
RUN addgroup --system simbi && adduser --system --ingroup simbi simbi
COPY pyproject.toml ./
COPY backend ./backend
COPY --from=frontend /build/frontend/dist ./frontend/dist
RUN pip install --no-cache-dir .
RUN mkdir -p /app/data && chown -R simbi:simbi /app
USER simbi
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health/ready', timeout=3)"
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1"]
