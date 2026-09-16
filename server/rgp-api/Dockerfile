FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js perquisition.js photo.js migrate.js start.js openapi.json ./
COPY migrations/ ./migrations/
COPY seed/ ./seed/
USER node
EXPOSE 8080
CMD ["node","start.js"]
