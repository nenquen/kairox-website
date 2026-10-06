FROM node:22-slim
RUN apt-get update -qq && apt-get install -y -qq tmux > /dev/null 2>&1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY app.js ./
COPY public ./public
CMD ["node", "app.js"]
