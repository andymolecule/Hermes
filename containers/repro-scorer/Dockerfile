FROM --platform=linux/amd64 python:3.11.9-slim

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY score.py /app/score.py
CMD ["python", "/app/score.py"]
