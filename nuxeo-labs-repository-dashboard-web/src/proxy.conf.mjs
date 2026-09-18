/*
 * Dev-server proxy: forwards every /nuxeo/** call from http://localhost:4200 to a local
 * Nuxeo server on http://localhost:8080.
 *
 * Copy .env.example to .env and fill it in, so that `ng serve` never hits the login page.
 * The .env file is gitignored: never commit real credentials.
 */
import { readFileSync } from 'node:fs';

/** Minimal .env reader: avoids pulling a dependency just for the dev server. */
function readDotEnv() {
  try {
    return Object.fromEntries(
      readFileSync(new URL('../.env', import.meta.url), 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        })
    );
  } catch {
    return {};
  }
}

const env = { ...readDotEnv(), ...process.env };
const target = env['NUXEO_URL'] || 'http://localhost:8080';

const headers = {
  // Makes Nuxeo rewrite the URLs it returns so they point back at the dev server.
  'nuxeo-virtual-host': 'http://localhost:4200/',
};

if (env['NUXEO_AUTHORIZATION']) {
  headers['authorization'] = env['NUXEO_AUTHORIZATION'];
} else {
  console.warn(
    '[proxy] NUXEO_AUTHORIZATION is not set. Requests will be anonymous and Nuxeo will redirect to the login page.'
  );
}

export default {
  '/nuxeo': {
    target,
    secure: false,
    changeOrigin: true,
    headers,
  },
};
