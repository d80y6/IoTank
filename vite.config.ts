import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import compression from 'vite-plugin-compression';
import path from 'path';

// PWA options reused in plugin list
const pwaOptions = {
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.js',
  registerType: 'autoUpdate',
  includeAssets: ['favicon.ico', 'robots.txt', 'sitemap.xml', 'assets/**/*'],
  manifest: {
    name: 'IoTank Fuel Intelligence Hub',
    short_name: 'IoTank',
    description: 'Cloud-native Industrial IoT fuel tank monitoring and analytics',
    theme_color: '#00D4FF',
    background_color: '#FFFFFF',
    display: 'standalone',
    icons: [
      { src: 'icons/icon-192x192.webp', sizes: '192x192', type: 'image/webp' },
      { src: 'icons/icon-512x512.webp', sizes: '512x512', type: 'image/webp' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp}'],
    navigationPreload: true,
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-cache',
          expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'gstatic-fonts-cache',
          expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'static-images-cache', expiration: { maxEntries: 50 } },
      },
    ],
  },
  injectManifest: {
    injectionPoint: undefined
  }
};

// Build plugin list and avoid enabling the compression plugin on Windows
const plugins: any[] = [react(), VitePWA(pwaOptions)];

if (process.platform !== 'win32') {
  plugins.push(
    compression({ algorithm: 'brotliCompress', ext: '.br', threshold: 1024, deleteOriginFile: false })
  );
} else {
  // Skip brotli on Windows local builds to avoid absolute-path artifacts
  // CI (Linux) will still run compression.
  // eslint-disable-next-line no-console
  console.warn('[vite] Skipping Brotli compression on Windows to avoid path issues');
}

export default defineConfig({
  cacheDir: 'node_modules/.vite_clean',
  plugins,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@contexts': path.resolve(__dirname, './src/contexts'),
      '@config': path.resolve(__dirname, './src/config'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    terserOptions: { compress: { drop_console: true, drop_debugger: true } },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router-dom') || id.includes('react')) return 'vendor-core';
            if (id.includes('firebase')) return 'vendor-firebase';
            if (id.includes('supabase')) return 'vendor-supabase';
            if (id.includes('recharts') || id.includes('chart.js')) return 'vendor-charts';
            if (id.includes('three') || id.includes('@react-three')) return 'vendor-three';
            if (id.includes('jspdf') || id.includes('xlsx')) return 'vendor-docs';
            if (id.includes('lodash')) return 'vendor-lodash';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: { port: 3001, open: true },
});
