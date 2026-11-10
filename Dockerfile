FROM node:24.11.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV CLOUDFLARE_CF_FETCH_ENABLED=false \
    WRANGLER_SEND_METRICS=false \
    WRANGLER_LOG_PATH=/app/.wrangler/logs/wrangler.log \
    XDG_CONFIG_HOME=/app/.wrangler/config
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && mkdir -p node_modules/.mf && chown node:node /app node_modules/.mf
COPY --chown=node:node wrangler.toml ./
COPY --chown=node:node src/web ./src/web
USER node
EXPOSE 8787
CMD ["./node_modules/.bin/wrangler", "dev", "--local", "--ip", "0.0.0.0", "--port", "8787", "--inspector-port", "0"]
