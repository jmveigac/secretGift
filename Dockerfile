FROM node:26.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.web.json vite.config.mts ./
COPY frontend ./frontend
COPY src/web ./src/web
COPY src/domain ./src/domain
COPY src/models/participants.ts ./src/models/participants.ts
RUN npm run build:web

FROM node:26.13.0-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /app/build ./build
RUN mkdir /app/data && chown node:node /app/data && chmod 700 /app/data
ENV DATA_FILE=/app/data/state.json
ENV WEB_HOST=0.0.0.0
USER node
EXPOSE 8787
CMD ["node", "build/web/server.js"]
