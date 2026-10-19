FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DATA_DIR=/data

WORKDIR /app

RUN useradd --create-home --uid 1000 app && mkdir -p /data && chown app:app /data

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY --chown=app:app . .

USER app
EXPOSE 8000

# Migrations run on start: single-container personal app, SQLite on a volume.
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2 --threads 4 --access-logfile -"]
