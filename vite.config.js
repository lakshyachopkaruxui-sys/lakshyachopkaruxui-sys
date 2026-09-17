import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Default mode serves HTTPS on the LAN so a Quest on the same Wi-Fi can open
// https://<this-PC-IP>:5173 (WebXR needs a secure context off-localhost).
// `--mode http` serves plain HTTP for local desktop tools that reject
// self-signed certificates.
export default defineConfig(({ mode }) => {
  // The managed browser preview supplies this exact port/strictPort pair and
  // terminates at its own HTTP preview endpoint. Keep normal LAN/headset dev HTTPS.
  const portFlag = process.argv.indexOf('--port');
  const managedPreview = portFlag >= 0 && process.argv[portFlag + 1] === '4173' && process.argv.includes('--strictPort');
  const https = mode !== 'http' && !managedPreview;
  return {
    server: {
      host: '0.0.0.0',
      allowedHosts: ['terminal.local'],
      port: 5173,
      // Vite's watcher crashes (EBUSY) if it tries to watch asset files while
      // they are still being written, and nothing in these folders needs HMR.
      watch: { ignored: ['**/public/**', '**/_legacy/**', '**/dist/**'] }
    },
    plugins: https ? [basicSsl()] : [],
    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: { input: { main: 'index.html' } }
    }
  };
});
