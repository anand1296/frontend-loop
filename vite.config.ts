import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { contentPlugin } from './build/vite-plugin-content.ts';

export default defineConfig({
  // Relative base so the same build works on Vercel, Netlify, GitHub Pages
  // sub-paths or any static host.
  base: './',
  plugins: [react(), contentPlugin()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
