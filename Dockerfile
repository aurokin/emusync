FROM oven/bun:1-alpine AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN bun install --frozen-lockfile

FROM oven/bun:1-alpine AS production-dependencies-env
COPY ./package.json bun.lock /app/
WORKDIR /app
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN bun run build

FROM oven/bun:1-alpine
COPY ./package.json bun.lock /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
WORKDIR /app

# Environment variables:
# - REDIS_URL: Redis connection URL (default: redis://localhost:6379)
# - DB_PATH: Path to db.json config file (default: ./db.json)
#
# Mount db.json at runtime:
# docker run -v /path/to/db.json:/app/db.json -e REDIS_URL=redis://host:6379 ...

CMD ["bun", "run", "start"]
