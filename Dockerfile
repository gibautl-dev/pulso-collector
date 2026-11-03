FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PGOPTIONS="-c statement_timeout=30000 -c lock_timeout=5000"
WORKDIR /app
COPY requirements-render.txt ./
RUN python -m pip install --no-cache-dir --require-hashes -r requirements-render.txt
COPY pulso ./pulso
USER 65534:65534
CMD ["python", "-m", "pulso.deploy_run", "--days", "7"]
