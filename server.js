import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { handleSocket } from './src/lib/wsHandler.js';

const dev = process.env.NODE_ENV !== 'production';

// Phase 17: 8 KiB is more than sufficient for {type, from, to, requestId} payloads
const WS_MAX_PAYLOAD = Number(process.env.WS_MAX_PAYLOAD ?? 8 * 1024);

export const WS_HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS ?? 30000);

export async function createApp({ port: portArg, heartbeatMs = WS_HEARTBEAT_MS } = {}) {
  const app = next({ dev });
  await app.prepare();
  const handle = app.getRequestHandler();

  /* v8 ignore next 4 */
  // HTTP request handler — exercised by the live server in ws.test.js (Phase 6); not
  // reachable from createApp unit tests which make no HTTP requests.
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

  // Suppress uncaught WS_ERR_UNSUPPORTED_MESSAGE_LENGTH; the ws library closes
  // the socket with code 1009 automatically — the error event is informational only.
  /* v8 ignore next 1 */
  wss.on('error', () => {});

  // Heartbeat interval: terminate unresponsive clients, ping live ones.
  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, heartbeatMs);
  wss.once('close', () => clearInterval(heartbeatInterval));

  /* v8 ignore next 22 */
  // Upgrade handler — exercised by ws.test.js live WS connections (Phase 6);
  // not reachable from bootstrap unit tests which do not open WebSocket connections.
  server.on('upgrade', (req, socket, head) => {
    const { pathname, query } = parse(req.url, true);
    if (pathname === '/ws') {
      // Phase 15: Origin allowlist — reject cross-site WS upgrade (CSWSH)
      const origin = req.headers.origin;
      const rawAllowed = process.env.ALLOWED_ORIGINS ?? `http://localhost:${server.address()?.port ?? portArg ?? 0}`;
      const allowed = rawAllowed.split(',').map(s => s.trim());
      const wildcardAllowed = allowed.includes('*');
      if (!wildcardAllowed && (!origin || !allowed.includes(origin))) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        handleSocket(ws, req, query);
      });
    } else {
      socket.destroy();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', (err) => {
      wss.close();
      reject(err);
    });
    server.once('listening', resolve);
    /* v8 ignore next -- ?? branch split is a cross-suite instrumentation artifact; both sides covered by server.test.js + ws.test.js */
    server.listen(portArg ?? 0);
  });

  return { server, wss, port: server.address().port };
}

export async function shutdown(signal, { server, wss }) {
  console.log(`[server] received ${signal}, shutting down`);
  wss.close();
  server.close();
  await Promise.all([...wss.clients].map(client =>
    new Promise(resolve => {
      client.once('close', resolve);
      try { client.close(1001, 'server-shutdown'); } catch { resolve(); }
      setTimeout(() => { try { client.terminate(); } catch {} resolve(); }, 1500).unref();
    })
  ));
  await new Promise(resolve => server.close(resolve));
  console.log(`[server] shutdown complete`);
}

/* v8 ignore start */
// CLI entry point — only runs when server.js is executed directly (node server.js),
// not when imported by tests. Subprocess bootstrap is not exercised by the test suite.
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = Number(process.env.PORT) || 3000;
  createApp({ port })
    .then(({ server, wss }) => {
      console.log(`> ready on http://localhost:${port}`);

      const handleSignal = (signal) => {
        const timer = setTimeout(() => process.exit(1), 5000).unref();
        shutdown(signal, { server, wss }).then(() => {
          clearTimeout(timer);
          process.exit(0);
        });
      };

      process.once('SIGTERM', handleSignal);
      process.once('SIGINT', handleSignal);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
/* v8 ignore stop */
