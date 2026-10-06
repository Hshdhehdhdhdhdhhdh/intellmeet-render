#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install Node.js 22+ and pnpm, then run this script again."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the bundled local MySQL setup."
  echo "Install Docker Desktop, then run: pnpm setup"
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

pnpm install

echo "Starting local MySQL..."
docker compose up -d mysql

echo "Waiting for MySQL to become ready..."
for _ in {1..30}; do
  if docker compose exec -T mysql mysqladmin ping -h localhost -u intellmeet -pintellmeet >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! docker compose exec -T mysql mysqladmin ping -h localhost -u intellmeet -pintellmeet >/dev/null 2>&1; then
  echo "MySQL did not become ready in time. Run 'docker compose logs mysql' for details."
  exit 1
fi

pnpm db:push

echo
echo "Setup complete. Start IntellMeet with: pnpm dev"
echo "Then open: http://localhost:3000/register"
