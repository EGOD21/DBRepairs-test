FROM node:22-alpine
# pg_dump/pg_restore must not be older than the PostgreSQL 17 server.
RUN apk add --no-cache postgresql17-client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY migrations ./migrations
COPY src ./src
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
