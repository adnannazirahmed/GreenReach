FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4310 \
    DATABASE_PATH=/app/data/greenreach.db

WORKDIR /app

COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node package.json ./package.json

RUN mkdir -p /app/data && chown node:node /app/data

COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

USER node
VOLUME ["/app/data"]
EXPOSE 4310

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4310/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
