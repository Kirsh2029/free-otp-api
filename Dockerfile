# Puppeteer Chrome for Testing requires the Linux x86_64 image selected here.
ARG NUMBER_API_PLATFORM=linux/amd64
FROM --platform=${NUMBER_API_PLATFORM} node:24.22.2-bookworm-slim@sha256:c0a93797ee78814ae6d32fcca2561fdbbe423149c3f5389aad32d86e9fd85bd4 AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM --platform=${NUMBER_API_PLATFORM} node:24.22.2-bookworm-slim@sha256:c0a93797ee78814ae6d32fcca2561fdbbe423149c3f5389aad32d86e9fd85bd4 AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3030 \
    PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
# Official Puppeteer installer selects the exact Chrome revision pinned by this package.
# Chrome for Testing is distributed for Linux x86_64; Compose selects linux/amd64.
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates unzip \
    && node node_modules/puppeteer/lib/puppeteer/node/cli.js browsers install chrome --install-deps \
    && chown -R node:node /home/node/.cache \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3030
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3030)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/app.js"]
