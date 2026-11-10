import { defineConfig } from 'vite';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [iwsdkDev(), viteStaticCopy({ targets: [{ src: 'src/assets/midi/*.mid', dest: 'assets/midi' }] })],
  base: './',
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: { target: 'esnext' },
  resolve: { dedupe: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide'] },
  optimizeDeps: { exclude: ['@babylonjs/havok'], esbuildOptions: { target: 'esnext' } },
});
