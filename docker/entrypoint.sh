#!/bin/sh
set -e
# Call the binaries directly rather than via `pnpm <script>`: pnpm 11 runs a
# verify-deps-before-run check that spawns an implicit `pnpm install`, which
# fails inside the image (no lockfile-consistent workspace state at runtime).
echo "Syncing schema..." && ./node_modules/.bin/prisma db push --skip-generate --accept-data-loss
echo "Seeding..." && ./node_modules/.bin/tsx prisma/seed.ts
exec ./node_modules/.bin/next start
