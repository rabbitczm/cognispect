FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app:/app/tools \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/tmp/matplotlib \
    HELIX_DATA_DIR=/data \
    TEMP=/tmp \
    TMP=/tmp
WORKDIR /app

COPY requirements-research.txt requirements-web.txt ./
RUN pip install --no-cache-dir --only-binary=:all: -r requirements-web.txt \
    && groupadd --gid 10001 helix \
    && useradd --uid 10001 --gid 10001 --no-create-home helix
COPY app.template.html admin.html intro.html ATTRIBUTION.md ./
COPY _lib/ ./_lib/
COPY assets/ ./assets/
COPY data/ ./data/
COPY tools/ ./tools/
COPY _tools/build_release.py ./_tools/build_release.py
RUN python _tools/build_release.py \
    && mkdir -p /data /app/scratch \
    && chown helix:helix /data /app/scratch
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "tools.web_app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
