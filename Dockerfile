FROM node:22-bookworm-slim

WORKDIR /app

RUN npm install --global pnpm@10.15.1 --force

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
# Install ALL dependencies (vite, esbuild and drizzle-kit are needed to build and migrate)
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "pnpm exec drizzle-kit migrate && pnpm start"]
