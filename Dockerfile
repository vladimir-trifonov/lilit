FROM node:22-alpine

WORKDIR /app

# node-pty needs build tools for native bindings
RUN apk add --no-cache python3 make g++ bash

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install deps first (layer cache)
COPY package.json package-lock.json ./
RUN npm install

# Copy source
COPY . .

# Generate Prisma client
RUN npx prisma generate

EXPOSE 51000

CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run dev"]
