FROM rust:1.95-bookworm AS build
WORKDIR /app
# Check sqlx queries against .sqlx/ instead of a live database.
ENV SQLX_OFFLINE=true
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release --bin backend --bin admin --bin health \
    && mkdir /out \
    && cp target/release/backend target/release/admin target/release/health /out/

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 app \
    && mkdir -p /data/attachments \
    && chown -R app /data
COPY --from=build /out/ /usr/local/bin/
USER app
WORKDIR /app
ENV BIND_ADDR=0.0.0.0:8080 \
    STORAGE_DIR=/data/attachments \
    LOG_FORMAT=json
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
    CMD ["health", "--url", "http://127.0.0.1:8080"]
CMD ["backend"]
