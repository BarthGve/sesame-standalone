# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build-theme && npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production STATIC_DIR=/app/dist PROXY_PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8787
CMD ["node", "server/proxy.mjs"]
