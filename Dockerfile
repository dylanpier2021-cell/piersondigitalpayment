# Transfado — production image. Serves the UI + API from one Node process.
FROM node:20-alpine

WORKDIR /app

# Install only runtime dependencies (jsdom etc. are dev-only).
COPY package*.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

# The server reads PORT from the environment (hosts set this); default 4242.
ENV NODE_ENV=production
ENV PORT=4242
EXPOSE 4242

# Optional: persist the JSON database to a mounted volume.
#   docker run -v transfado-data:/data -e TF_DATA_DIR=/data ...
# Without a volume the DB is ephemeral and re-seeds on each boot (login still works).

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD wget -qO- http://localhost:${PORT}/api/health || exit 1

CMD ["node", "server/index.js"]
