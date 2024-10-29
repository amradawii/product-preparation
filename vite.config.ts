import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit(), svelteTesting({ autoCleanup: false })],
  optimizeDeps: {
    exclude: ['@jsquash/avif', '@jsquash/jpeg', '@jsquash/png', '@jsquash/resize', '@jsquash/webp']
  },
  worker: {
    format: 'es'
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
});
