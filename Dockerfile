# ---- build the React frontend ----
FROM node:20-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend runtime ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/backend
# better-sqlite3 ships prebuilt binaries for linux/x64 + node 20; build tools are a fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist
ENV PORT=3001 DATABASE_PATH=/data/docs.db
RUN mkdir -p /data
EXPOSE 3001
CMD ["node", "src/index.js"]
