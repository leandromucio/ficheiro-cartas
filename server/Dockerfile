FROM node:22-alpine
WORKDIR /app
COPY server.mjs update-catalog.mjs ./
COPY public ./public
ENV NODE_ENV=production PORT=3077 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3077
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3077/healthz || exit 1
CMD ["node", "server.mjs"]
