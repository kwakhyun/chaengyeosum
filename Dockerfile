FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server

ENV NODE_ENV=production
ENV PORT=8787
ENV CHAENGYEOSUM_DB_PATH=/data/chaengyeosum.sqlite

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "server/index.mjs"]

