FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server.js startup.js engine.cjs bootstrap-owner.js import-indicators.js ./
COPY schema.sql indicator-seed.json ./

COPY public ./public

RUN mkdir -p /app/storage \
    && test -f /app/public/index.html \
    && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm","start"]
