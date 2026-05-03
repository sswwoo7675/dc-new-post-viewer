FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY lib ./lib
COPY server.js ./server.js
COPY README.md ./README.md

RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "server.js"]
