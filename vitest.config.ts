import { defineConfig } from 'vitest/config';
import path from 'node:path';

const alias = { '@': path.resolve(__dirname, '.') };

export default defineConfig({
  test: {
    // vitest 3.2's ProjectConfig omits passWithNoTests/fileParallelism (root-only options,
    // see NonProjectOptions in vitest/dist/chunks/reporters.d.*.d.ts) so both are set at
    // root level here and apply to every project.
    passWithNoTests: true,
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
        // tsconfig.json keeps Next's `jsx: "preserve"`, so esbuild needs to be
        // told how to compile the .tsx component tests.
        esbuild: { jsx: 'automatic' },
        resolve: { alias },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/helpers/env.ts'],
          testTimeout: 30_000,
        },
        resolve: { alias },
      },
    ],
  },
});
