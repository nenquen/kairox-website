FROM node:22-slim
RUN apt-get update -qq && apt-get install -y -qq tmux > /dev/null 2>&1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund 2>&1 | tail -n 1 || npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN ./node_modules/.bin/tsc
CMD ["node", "dist/bot.js"]
