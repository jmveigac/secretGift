FROM node:26.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.web.json ./
COPY src/web ./src/web
RUN npm run build:web

FROM node:26.13.0-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /app/build/web ./build/web
ENV WEB_HOST=0.0.0.0
USER node
EXPOSE 8787
CMD ["node", "build/web/server.js"]
