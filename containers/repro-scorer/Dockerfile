FROM --platform=linux/amd64 python:3.11.9-slim

LABEL org.opencontainers.image.source="https://github.com/andymolecule/Agora" \
      org.opencontainers.image.url="https://github.com/andymolecule/Agora/tree/main/containers/repro-scorer" \
      org.opencontainers.image.title="Agora Repro Scorer" \
      org.opencontainers.image.description="Deterministic CSV comparison scorer for Agora reproducibility presets."

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY score.py /app/score.py
CMD ["python", "/app/score.py"]
