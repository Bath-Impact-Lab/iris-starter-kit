import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';

const DROP_BACKPRESSURE_BYTES = 96 * 1024;
const TERMINATE_BACKPRESSURE_BYTES = 384 * 1024;
const EARLY_BUFFER_BYTES = 256 * 1024;

export interface VideoStreamDescriptor {
  cameraId: number;
  url: string;
}

// Relays raw H.264 Annex-B chunks to per-camera WebSocket clients in the
// renderer.
export class VideoRelayServer {
  private server: WebSocketServer | null = null;
  private readonly clients = new Map<number, Set<WebSocket>>();
  private readonly earlyChunks = new Map<number, Buffer[]>();
  private readonly earlyBytes = new Map<number, number>();

  async start(cameraIds: number[]): Promise<VideoStreamDescriptor[]> {
    await this.stop();

    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: false });
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    this.server = server;

    server.on('connection', (client, request) => {
      client.binaryType = 'nodebuffer';
      const match = new URL(request.url ?? '/', 'ws://127.0.0.1').pathname.match(/^\/camera\/(\d+)$/);
      const cameraId = match ? Number(match[1]) : null;
      if (cameraId === null) {
        client.close(1008, 'Invalid camera route');
        return;
      }

      const clients = this.clients.get(cameraId) ?? new Set<WebSocket>();
      clients.add(client);
      this.clients.set(cameraId, clients);

      for (const chunk of this.earlyChunks.get(cameraId) ?? []) {
        if (client.readyState === WebSocket.OPEN) client.send(chunk, { binary: true });
      }
      this.earlyChunks.delete(cameraId);
      this.earlyBytes.delete(cameraId);

      client.once('close', () => clients.delete(client));
    });

    const port = (server.address() as AddressInfo).port;
    return cameraIds.map((cameraId) => ({
      cameraId,
      url: `ws://127.0.0.1:${port}/camera/${cameraId}`,
    }));
  }

  push(cameraId: number, chunk: Buffer): void {
    const clients = this.clients.get(cameraId);

    if (!clients || clients.size === 0) {
      const buffered = this.earlyChunks.get(cameraId) ?? [];
      buffered.push(chunk);
      let bytes = (this.earlyBytes.get(cameraId) ?? 0) + chunk.length;
      while (buffered.length > 1 && bytes > EARLY_BUFFER_BYTES) {
        bytes -= buffered.shift()!.length;
      }
      this.earlyChunks.set(cameraId, buffered);
      this.earlyBytes.set(cameraId, bytes);
      return;
    }

    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > TERMINATE_BACKPRESSURE_BYTES) {
        client.terminate();
        continue;
      }
      if (client.bufferedAmount > DROP_BACKPRESSURE_BYTES) continue;
      client.send(chunk, { binary: true });
    }
  }

  async stop(): Promise<void> {
    for (const clients of this.clients.values()) {
      for (const client of clients) client.terminate();
    }
    this.clients.clear();
    this.earlyChunks.clear();
    this.earlyBytes.clear();

    const server = this.server;
    this.server = null;
    if (!server) return;

    await new Promise<void>((resolve) => {
      try {
        server.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}
