FROM oven/bun:1.4 AS base
WORKDIR /app

COPY apps/api/package.json apps/api/bun.lock* ./
RUN bun install --production

COPY apps/api/ ./

ENV PORT=3000
EXPOSE 3000 9001

CMD ["bun", "src/index.ts"]
