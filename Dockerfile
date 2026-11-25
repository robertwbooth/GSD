# --- Build -------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
ARG GSD_VERSION=dev
ENV VITE_GSD_VERSION=$GSD_VERSION
RUN npm run build

# --- Runtime -----------------------------------------------------------------
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 GSD_DATA_DIR=/data GSD_WEB_DIR=/app/web
RUN echo '{"type":"module","private":true}' > package.json \
 && npm install --no-save --omit=dev fastify@5 @fastify/static@8 better-sqlite3@11 \
 && npm cache clean --force
COPY --from=build /app/apps/server/dist/server.js ./server.js
COPY --from=build /app/apps/web/dist ./web
ARG GSD_VERSION=dev
ENV GSD_VERSION=$GSD_VERSION
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "server.js"]
