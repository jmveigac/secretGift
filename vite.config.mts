import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: 'frontend',
    plugins: [react()],
    build: { outDir: '../build/public', emptyOutDir: true, sourcemap: false },
    test: {
        environment: 'jsdom',
        include: ['src/**/*.test.tsx'],
        setupFiles: ['./test-setup.ts'],
    },
});
