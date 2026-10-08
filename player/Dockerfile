FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev --ignore-scripts --offline
COPY server.mjs index.html app.js styles.css ./
ENV PORT=5180
EXPOSE 5180
CMD ["npm", "start"]
