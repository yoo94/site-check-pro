import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node20',
    external: ['playwright'],
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    dts: false,
    sourcemap: true,
    target: 'node20',
    external: ['playwright'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
