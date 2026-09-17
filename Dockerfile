FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    procps \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY shared/ ../shared/

ENV PORT=4000
EXPOSE 4000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-4000}"]
