import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/index.js';
import { Store } from '../../server/store.js';

const host = process.env.GREENREACH_E2E_HOST || '127.0.0.1';
const port = Number(process.env.GREENREACH_E2E_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('GREENREACH_E2E_PORT must be an available TCP port.');
}

const dataDirectory = mkdtempSync(join(tmpdir(), 'greenreach-e2e-'));
const store = new Store(join(dataDirectory, 'greenreach.sqlite'));
const { server } = createApp({
  store,
  demo: true,
  // Keep provider discovery, AI calls, auth, and scheduled sync disabled in browser tests.
  env: { APP_TOKEN: '', SYNC_INTERVAL_MINUTES: '0' },
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    store.close();
    rmSync(dataDirectory, { recursive: true, force: true });
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
server.once('error', error => {
  store.close();
  rmSync(dataDirectory, { recursive: true, force: true });
  throw error;
});
server.listen(port, host, () => console.log(`GreenReach E2E server ready at http://${host}:${port}`));
