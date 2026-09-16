# SignCraft — single image that builds the Next.js app and, on start, syncs the
# Prisma schema and seeds Mongo before running `next start`.
FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache openssl libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
# pnpm 11 ignores the legacy `onlyBuiltDependencies` list and wants an `allowBuilds`
# map; without it a fresh install skips the Prisma/esbuild postinstalls (no query
# engine) and exits with ERR_PNPM_IGNORED_BUILDS. Appended here so the checked-in
# pnpm-workspace.yaml stays as-is.
RUN printf '\nallowBuilds:\n  "@prisma/client": true\n  "@prisma/engines": true\n  esbuild: true\n  prisma: true\n  unrs-resolver: true\n' >> pnpm-workspace.yaml \
 && pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `COPY . .` restored the pristine pnpm-workspace.yaml, so re-apply allowBuilds:
# pnpm verifies deps before running a script and would otherwise re-install.
RUN printf '\nallowBuilds:\n  "@prisma/client": true\n  "@prisma/engines": true\n  esbuild: true\n  prisma: true\n  unrs-resolver: true\n' >> pnpm-workspace.yaml \
 && pnpm build

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml next.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY lib ./lib
COPY docker/entrypoint.sh ./entrypoint.sh
# Strip CRs: a Windows checkout (core.autocrlf=true) would otherwise give the
# script a `#!/bin/sh\r` shebang and the container would fail to start.
RUN sed -i 's/\r$//' ./entrypoint.sh && chmod +x ./entrypoint.sh
EXPOSE 3000
CMD ["./entrypoint.sh"]
