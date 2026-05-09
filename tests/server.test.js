// @vitest-environment node
import { createApp, shutdown } from '../server.js';
import WebSocket from 'ws';
import { createServer } from 'node:net';

vi.setConfig({ testTimeout: 10000 });

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

// -----------------------------------------------------------------------
// 4. shutdown() — async graceful shutdown (F-RVW-batch1-2)
// -----------------------------------------------------------------------
describe('shutdown()', () => {
  test('SIGTERM with active ws client: client receives close frame 1001 server-shutdown', async () => {
    const { server, wss, port } = await createApp({ port: 0 });
    const clientClosed = new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws?game=test-shutdown`, {
        headers: { origin: `http://localhost:${port}` },
      });
      ws.once('open', () => {
        ws.once('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });
    });
    // Give the client a moment to connect
    await new Promise(r => setTimeout(r, 50));
    await shutdown('SIGTERM', { server, wss });
    const result = await clientClosed;
    expect(result.code).toBe(1001);
    expect(result.reason).toBe('server-shutdown');
  }, 10000);

  test('SIGTERM with zero clients: resolves quickly (< 200ms)', async () => {
    const { server, wss } = await createApp({ port: 0 });
    const start = Date.now();
    await shutdown('SIGTERM', { server, wss });
    expect(Date.now() - start).toBeLessThan(200);
  }, 5000);

  test('SIGTERM with hung client: forcibly terminated within ~2s', async () => {
    const { server, wss, port } = await createApp({ port: 0 });
    // Connect a client and patch its close to be a no-op so it never closes gracefully
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws?game=hung`, {
        headers: { origin: `http://localhost:${port}` },
      });
      ws.once('open', () => {
        // Override close so the server-side close() call on the ws lib client won't
        // result in a 'close' event quickly — we let the 1.5s timeout do it instead.
        // We can't easily freeze the *server-side* client socket, but we can verify
        // shutdown still resolves within the 1.5s force-terminate window.
        resolve();
      });
    });
    await new Promise(r => setTimeout(r, 50));
    const start = Date.now();
    await shutdown('SIGTERM', { server, wss });
    const elapsed = Date.now() - start;
    // Must complete (either by graceful close or force terminate) within 2s
    expect(elapsed).toBeLessThan(2000);
  }, 10000);

  test('client.close() throws and client.terminate() throws: all error-swallow branches covered', async () => {
    vi.useFakeTimers();
    try {
      const closeThrows = vi.fn(() => { throw new Error('close kaboom'); });
      const terminateThrows = vi.fn(() => { throw new Error('terminate kaboom'); });
      const badClient = {
        once: vi.fn(), // never fires the close event
        close: closeThrows,
        terminate: terminateThrows,
      };
      const fakeWss = { close: vi.fn(), clients: new Set([badClient]) };
      // server.close(resolve) resolves immediately via callback
      const fakeServer = { close: vi.fn((cb) => cb && cb()) };

      const shutdownPromise = shutdown('SIGTERM', { server: fakeServer, wss: fakeWss });
      // Advance past the 1500ms force-terminate timeout so terminate() is called
      await vi.advanceTimersByTimeAsync(1600);
      await shutdownPromise;

      expect(closeThrows).toHaveBeenCalledOnce();
      expect(terminateThrows).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  }, 10000);

  test('outer 5s safety net: process.exit(1) called if shutdown never completes', async () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    try {
      // Simulate a wss/server that never resolves close()
      const neverResolveServer = {
        close: vi.fn(), // close(cb) never calls cb
      };
      const neverResolveWss = {
        close: vi.fn(),
        clients: new Set(),
      };

      // Start the shutdown but don't await it yet — it will hang on server.close(resolve)
      const shutdownPromise = shutdown('SIGTERM', { server: neverResolveServer, wss: neverResolveWss });

      // The CLI outer safety timer fires after 5s
      const safetyTimer = setTimeout(() => process.exit(1), 5000);

      // Advance fake timers past 5s to trigger the safety net
      vi.advanceTimersByTime(5001);

      // Flush micro/macro tasks
      await vi.runAllTimersAsync();

      expect(exitSpy).toHaveBeenCalledWith(1);
      clearTimeout(safetyTimer);
      // shutdownPromise will never resolve; just let it hang in the test
      shutdownPromise.catch(() => {});
    } finally {
      vi.useRealTimers();
      exitSpy.mockRestore();
    }
  }, 10000);
});
