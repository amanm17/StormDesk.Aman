import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps the build working at a domain root or a sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { three: ['three'], echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'] } } },
  },
});
