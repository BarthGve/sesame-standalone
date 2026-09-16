FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js fiches.js redaction.js referentiel.js openapi.json migrate.js start.js ./
# audit/ porte les routes de lecture (server.js require ./audit/rapport : sans lui le
# conteneur ne démarre pas) ET le job nocturne lancé par le cron. seed/ et migrations/
# sont aussi appliqués au boot (start.js, PGUSER_MIGRATE=sesame).
COPY audit ./audit
COPY seed ./seed
COPY migrations ./migrations
USER node
EXPOSE 8080
CMD ["node","start.js"]
