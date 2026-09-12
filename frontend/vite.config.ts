import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const frontendDirectory = fileURLToPath(new URL('.', import.meta.url));

function liveBackendTarget(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      'Live preview requires ZAROORI_API_TARGET in frontend/.env.live.local or the process environment. Use the running Zaroori Baat backend URL.',
    );
  }

  let target: URL;
  try {
    target = new URL(value.trim());
  } catch {
    throw new Error('ZAROORI_API_TARGET must be a valid HTTP or HTTPS backend URL.');
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('ZAROORI_API_TARGET must use HTTP or HTTPS.');
  }
  if (target.username || target.password || target.search || target.hash) {
    throw new Error(
      'ZAROORI_API_TARGET must not contain credentials, a query string, or a fragment.',
    );
  }
  const hostname = target.hostname.toLowerCase().replace(/\.$/, '');
  if (
    ['slack.com', 'slack-gov.com'].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    )
  ) {
    throw new Error(
      'ZAROORI_API_TARGET must point to the running Zaroori Baat backend, not a Slack workspace or channel.',
    );
  }
  return target.href.replace(/\/$/, '');
}

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, frontendDirectory, 'ZAROORI_');
  const target =
    mode === 'live'
      ? liveBackendTarget(process.env.ZAROORI_API_TARGET ?? environment.ZAROORI_API_TARGET)
      : 'http://127.0.0.1:8001';
  const proxy = { target, changeOrigin: true, secure: true };

  return {
    plugins: [react()],
    define: { __LIVE_PREVIEW__: JSON.stringify(command === 'serve' && mode === 'live') },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/api': { ...proxy }, '/health': { ...proxy } },
    },
  };
});
