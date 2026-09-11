import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { RoiClient } from './roiClient';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
async function server(handler: (req: any, socket: net.Socket) => void) {
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\iris_roi_test_${randomUUID()}` : `/tmp/iris-roi-${randomUUID()}.sock`;
  const host = net.createServer(socket => {
    cleanup.push(() => socket.destroy());
    let input = '';
    socket.on('data', chunk => {
      input += chunk.toString();
      let end: number;
      while ((end = input.indexOf('\n')) >= 0) { const req = JSON.parse(input.slice(0, end)); input = input.slice(end + 1); handler(req, socket); }
    });
  });
  await new Promise<void>(resolve => host.listen(endpoint, resolve));
  const client = new RoiClient(endpoint, 'test');
  cleanup.push(() => { client.close(); host.close(); });
  return client;
}
describe('ROI control', () => {
  it('reassembles fragmented responses and serializes concurrent requests', async () => {
    const operations: string[] = [];
    const client = await server((req, socket) => {
      operations.push(req.operation);
      const reply = JSON.stringify({ ...req, ok: true, state: { cameras: [] } }) + '\n';
      socket.write(reply.slice(0, 12)); setTimeout(() => socket.write(reply.slice(12)), 5);
    });
    const results = await Promise.all([client.request('roi.get'), client.request('capabilities')]);
    expect(results.every(r => r.ok)).toBe(true);
    expect(operations).toEqual(['roi.get', 'capabilities']);
  });
  it('rejects responses from a different run', async () => {
    const client = await server((req, socket) => socket.write(JSON.stringify({ ...req, runId: 'old', ok: true, state: { cameras: [] } }) + '\n'));
    await expect(client.request('roi.get')).rejects.toThrow('Unexpected');
  });
  it('cancels outstanding and queued commands on stop', async () => {
    const client = await server(() => client.close());
    const results = await Promise.allSettled([client.request('roi.get'), client.request('roi.get')]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected']);
  });
  it('never retries Apply after the peer disconnects', async () => {
    let calls = 0;
    const client = await server((_req, socket) => { calls++; socket.destroy(); });
    await expect(client.request('roi.apply', { mode: 'off', calibrationVersion: 1, roiVersion: 1 })).rejects.toThrow('disconnected');
    expect(calls).toBe(1);
  });
});
