/**
 * StoryForge Phase Tests
 * 
 * Run all tests: npx vitest run
 * Run specific phase: npx vitest run src/tests/phases/phase1-jobQueue.test.js
 * Run with coverage: npx vitest run --coverage
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/tests/setup.js'],
        
        include: [
            'src/tests/**/*.test.{js,jsx,ts,tsx}',
        ],
        
        exclude: [
            'node_modules/**',
            'dist/**',
        ],
        
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: [
                'src/services/**',
                'src/stores/**',
                'src/pages/**/services/**',
            ],
            exclude: [
                '**/*.d.ts',
                '**/types/**',
                '**/node_modules/**',
            ],
        },
        
        // Test timeouts
        testTimeout: 10000,
        hookTimeout: 10000,
        
        // reporters
        reporters: ['verbose'],
        
        // Output file for CI
        outputFile: {
            json: './test-results/results.json',
        },
    },
    
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@services': path.resolve(__dirname, './src/services'),
            '@stores': path.resolve(__dirname, './src/stores'),
            '@components': path.resolve(__dirname, './src/components'),
            '@pages': path.resolve(__dirname, './src/pages'),
        },
    },
});
