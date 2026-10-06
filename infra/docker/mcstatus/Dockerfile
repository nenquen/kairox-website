FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -n 1 || npm install --omit=dev --no-audit --no-fund
COPY status.js ./
CMD ["node", "status.js"]
