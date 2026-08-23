import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Builds straight into the published site directory. emptyOutDir MUST stay
// false: dist/honeypot also holds data/, data/db/ and data/samples/, which the
// honeypot box syncs in every 30 minutes. Wiping it on build would delete the
// dataset the page reads.
export default defineConfig({
  plugins: [react()],
  base: './',
  css: { transformer: 'lightningcss' },
  build: {
    outDir: '../dist/honeypot',
    emptyOutDir: false,
    cssMinify: 'lightningcss',
  },
})
