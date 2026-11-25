import { defineConfig } from 'vite';

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: { entry: 'src/entry.tsx', name: 'ProjectStudioRecorder', formats: ['iife'], fileName: () => 'recorder.js' },
    sourcemap: true,
  },
});
