import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter({
        pages: 'build',
        assets: 'build',
        strict: true
      })
    }),
    svelteTesting({ autoCleanup: false })
  ],
  optimizeDeps: {
    exclude: ['@jsquash/avif', '@jsquash/jpeg', '@jsquash/png', '@jsquash/resize', '@jsquash/webp']
  },
  worker: {
    format: 'es'
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    environment: 'node'
  }
});
