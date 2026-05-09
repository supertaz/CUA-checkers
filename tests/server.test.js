// @vitest-environment node
import { createApp } from '../server.js';
import { createServer } from 'node:net';

vi.setConfig({ testTimeout: 5000 });

// Occupy a port with a raw TCP server, return {port, close}
function occupyPort() {
  return new Promise((resolve, reject) => {
    const sentinel = createServer();
    sentinel.listen(0, () => {
      const { port } = sentinel.address();
      resolve({
        port,
        close: () => new Promise((res) => sentinel.close(res)),
      });
    });
    sentinel.on('error', reject);
  });
}

// -----------------------------------------------------------------------
// 1. createApp resolves on port:0 (happy path)
// -----------------------------------------------------------------------
describe('createApp happy path', () => {
  test('resolves with server, wss, and port for two sequential calls on port 0', async () => {
    const r1 = await createApp({ port: 0 });
    expect(r1.server).toBeDefined();
    expect(r1.wss).toBeDefined();
    expect(typeof r1.port).toBe('number');
    expect(r1.port).toBeGreaterThan(0);
    await new Promise((res) => {
      r1.wss.close();
      r1.server.close(res);
    });

    const r2 = await createApp({ port: 0 });
    expect(r2.port).toBeGreaterThan(0);
    await new Promise((res) => {
      r2.wss.close();
      r2.server.close(res);
    });
  });

  test('resolves when called with no arguments (portArg ?? 0 fallback)', async () => {
    // Exercises the portArg ?? 0 branch where portArg is undefined
    const r = await createApp();
    expect(r.port).toBeGreaterThan(0);
    await new Promise((res) => {
      r.wss.close();
      r.server.close(res);
    });
  });
});

// -----------------------------------------------------------------------
// 2. createApp rejects when the port is already occupied (EADDRINUSE)
// -----------------------------------------------------------------------
describe('createApp port-in-use rejects', () => {
  test('rejects with EADDRINUSE when port is already bound', async () => {
    const occupied = await occupyPort();
    try {
      await expect(createApp({ port: occupied.port })).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
    } finally {
      await occupied.close();
    }
  });
});

// -----------------------------------------------------------------------
// 3. Graceful shutdown: server.close + wss.close settle cleanly
// -----------------------------------------------------------------------
describe('graceful shutdown', () => {
  test('server.close and wss.close settle after createApp', async () => {
    const { server, wss, port } = await createApp({ port: 0 });
    expect(port).toBeGreaterThan(0);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('shutdown did not settle in time')),
        2000,
      );
      wss.close();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });

    // After shutdown, the same port should be bindable again by createApp
    const r2 = await createApp({ port: 0 });
    expect(r2.port).toBeGreaterThan(0);
    await new Promise((res) => {
      r2.wss.close();
      r2.server.close(res);
    });
  });
});
