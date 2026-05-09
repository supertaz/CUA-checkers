import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { handleSocket } from './src/lib/wsHandler.js';

const dev = process.env.NODE_ENV !== 'production';

export async function createApp({ port: portArg } = {}) {
  const app = next({ dev });
  await app.prepare();
  const handle = app.getRequestHandler();

  /* v8 ignore next 4 */
  // HTTP request handler — exercised by the live server in ws.test.js (Phase 6); not
  // reachable from createApp unit tests which make no HTTP requests.
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  const wss = new WebSocketServer({ noServer: true });

  /* v8 ignore next 12 */
  // Upgrade handler — exercised by ws.test.js live WS connections (Phase 6);
  // not reachable from bootstrap unit tests which do not open WebSocket connections.
  server.on('upgrade', (req, socket, head) => {
    const { pathname, query } = parse(req.url, true);
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
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

/* v8 ignore start */
// CLI entry point — only runs when server.js is executed directly (node server.js),
// not when imported by tests. Subprocess bootstrap is not exercised by the test suite.
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = Number(process.env.PORT) || 3000;
  createApp({ port })
    .then(({ server, wss }) => {
      console.log(`> ready on http://localhost:${port}`);

      function shutdown() {
        wss.close();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
      }

      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
/* v8 ignore stop */
