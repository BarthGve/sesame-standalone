FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js cote.js ./
USER node
EXPOSE 8082
CMD ["node","server.js"]
