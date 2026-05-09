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

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

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

  await new Promise((resolve) => {
    server.listen(portArg ?? 0, resolve);
  });

  return { server, wss, port: server.address().port };
}

// CLI entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = Number(process.env.PORT) || 3000;
  createApp({ port }).then(() => {
    console.log(`> ready on http://localhost:${port}`);
  });
}
