# SignCraft — single image that builds the Next.js app and, on start, syncs the
# Prisma schema and seeds Mongo before running `next start`.
FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache openssl libc6-compat
WORKDIR /app

FROM base AS deps
# pnpm-workspace.yaml carries the `allowBuilds` gate so the Prisma/esbuild postinstalls run.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml next.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY lib ./lib
COPY docker/entrypoint.sh ./entrypoint.sh
# .gitattributes pins *.sh to LF; the sed is belt-and-braces for older checkouts.
RUN sed -i 's/\r$//' ./entrypoint.sh && chmod +x ./entrypoint.sh
EXPOSE 3000
CMD ["./entrypoint.sh"]
