import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [],
  // Production builds use a slimmer Phaser without physics, tilemaps and sound (see src/vendor/phaser-lite.js).
  resolve: command === 'build'
    ? { alias: [{ find: /^phaser$/, replacement: fileURLToPath(new URL('./src/vendor/phaser-lite.js', import.meta.url)) }] }
    : {},
  // Phaser's source tests its build flags as `if (typeof FLAG)`; its own builds replace those tests the same way.
  define: command === 'build'
    ? {
      'typeof WEBGL_RENDERER': 'true',
      'typeof CANVAS_RENDERER': 'true',
      'typeof WEBGL_DEBUG': 'false',
      'typeof FEATURE_SOUND': 'false',
      'typeof EXPERIMENTAL': 'false',
      'typeof PLUGIN_CAMERA3D': 'false',
      'typeof PLUGIN_FBINSTANT': 'false',
    }
    : {},
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/phaser') || id.includes('src/vendor/phaser-lite') ? 'phaser' : undefined),
      },
    },
  },
  server: { port: 5173 },
}));
