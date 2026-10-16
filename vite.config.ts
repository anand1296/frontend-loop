import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { contentPlugin } from './build/vite-plugin-content.ts';

// `npm run dev` proxies /api to the Go server (`go run ./cmd/server`), so the
// browser sees one origin and the session cookie works exactly as in production.
const apiTarget = process.env.API_PROXY ?? 'http://localhost:8080';

export default defineConfig({
  // Relative base so the same build works on Vercel, Netlify, GitHub Pages
  // sub-paths or any static host.
  base: './',
  plugins: [react(), contentPlugin()],
  define: {
    // The web build may run next to the Go API; it probes /api/bootstrap once.
    __BACKEND__: 'true',
  },
  server: {
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  // `vite preview` proxies only when asked (API_PROXY=…), so plain previews stay static.
  preview: process.env.API_PROXY ? { proxy: { '/api': { target: apiTarget, changeOrigin: false } } } : {},
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
