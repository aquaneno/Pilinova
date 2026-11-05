FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE_PATH=/app/data/pilinova.sqlite3 \
    PORT=8080
WORKDIR /app
RUN groupadd --gid 10001 pilinova && useradd --uid 10001 --gid pilinova --no-create-home pilinova \
    && mkdir /app/data && chown pilinova:pilinova /app/data
COPY --chown=pilinova:pilinova server.py ./
COPY --chown=pilinova:pilinova public ./public
USER pilinova
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3)"
CMD ["python", "server.py"]
