import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { inspectAccessUnit } from '../../shared/h264';

const DROP_BACKPRESSURE_BYTES = 96 * 1024;
const TERMINATE_BACKPRESSURE_BYTES = 384 * 1024;
// Core forces a keyframe twice a second; this only bounds a stream that stops sending them.
const MAX_REPLAY_BYTES = 8 * 1024 * 1024;

export interface VideoStreamDescriptor {
  cameraId: number;
  url: string;
}

interface RelayClient {
  socket: WebSocket;
  // Set after a dropped frame: later delta frames reference it, so sending
  // them would smear the picture until the next keyframe.
  awaitingKeyframe: boolean;
}

// Everything a newly connected decoder needs to show a picture immediately:
// the latest SPS-carrying access unit and the frames since the last keyframe.
interface ReplayBuffer {
  parameterSets: Buffer | null;
  groupOfPictures: Buffer[];
  bytes: number;
}

// Relays H.264 access units (one per message) to per-camera WebSocket
// clients in the renderer. URLs carry a random token so other local processes
// and web pages can't subscribe to camera video.
export class VideoRelayServer {
  private server: WebSocketServer | null = null;
  private readonly clients = new Map<number, Set<RelayClient>>();
  private readonly replayBuffers = new Map<number, ReplayBuffer>();

  async start(cameraIds: number[]): Promise<VideoStreamDescriptor[]> {
    await this.stop();

    const token = randomBytes(24).toString('base64url');
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      perMessageDeflate: false,
      verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) =>
        new URL(req.url ?? '/', 'ws://127.0.0.1').searchParams.get('token') === token && isAllowedOrigin(origin),
    });
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    this.server = server;

    server.on('connection', (socket, request) => {
      socket.binaryType = 'nodebuffer';
      const match = new URL(request.url ?? '/', 'ws://127.0.0.1').pathname.match(/^\/camera\/(\d+)$/);
      const cameraId = match ? Number(match[1]) : null;
      if (cameraId === null) {
        socket.close(1008, 'Invalid camera route');
        return;
      }

      const replay = replayChunks(this.replayBuffers.get(cameraId));
      for (const chunk of replay) socket.send(chunk, { binary: true });
      const client: RelayClient = { socket, awaitingKeyframe: replay.length === 0 };

      const clients = this.clients.get(cameraId) ?? new Set<RelayClient>();
      clients.add(client);
      this.clients.set(cameraId, clients);
      socket.once('close', () => clients.delete(client));
    });

    const port = (server.address() as AddressInfo).port;
    return cameraIds.map((cameraId) => ({
      cameraId,
      url: `ws://127.0.0.1:${port}/camera/${cameraId}?token=${token}`,
    }));
  }

  push(cameraId: number, accessUnit: Buffer): void {
    const { keyframe, sps } = inspectAccessUnit(accessUnit);
    this.remember(cameraId, accessUnit, keyframe, sps !== null);

    for (const client of this.clients.get(cameraId) ?? []) {
      const { socket } = client;
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.bufferedAmount > TERMINATE_BACKPRESSURE_BYTES) {
        socket.terminate();
        continue;
      }
      if (client.awaitingKeyframe && !keyframe) continue;
      if (socket.bufferedAmount > DROP_BACKPRESSURE_BYTES) {
        client.awaitingKeyframe = true;
        continue;
      }
      client.awaitingKeyframe = false;
      socket.send(accessUnit, { binary: true });
    }
  }

  async stop(): Promise<void> {
    for (const clients of this.clients.values()) {
      for (const client of clients) client.socket.terminate();
    }
    this.clients.clear();
    this.replayBuffers.clear();

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

  private remember(cameraId: number, accessUnit: Buffer, keyframe: boolean, hasSps: boolean): void {
    const replay = this.replayBuffers.get(cameraId) ?? { parameterSets: null, groupOfPictures: [], bytes: 0 };
    this.replayBuffers.set(cameraId, replay);

    if (hasSps) replay.parameterSets = accessUnit;
    if (keyframe) {
      replay.groupOfPictures = [accessUnit];
      replay.bytes = accessUnit.length;
    } else if (replay.groupOfPictures.length > 0) {
      replay.groupOfPictures.push(accessUnit);
      replay.bytes += accessUnit.length;
    }

    // A replay without its keyframe can't start a decoder; wait for the next one.
    if (replay.bytes > MAX_REPLAY_BYTES) {
      replay.groupOfPictures = [];
      replay.bytes = 0;
    }
  }
}

function replayChunks(replay: ReplayBuffer | undefined): Buffer[] {
  if (!replay?.groupOfPictures.length) return [];
  const { parameterSets, groupOfPictures } = replay;
  return parameterSets && !groupOfPictures.includes(parameterSets) ? [parameterSets, ...groupOfPictures] : groupOfPictures;
}

// The renderer is loaded from the dev server (http://127.0.0.1 or localhost)
// or from file://, which Chromium reports as "null" or "file://". Other local
// processes send no Origin but still need the token.
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin || origin === 'null' || origin.startsWith('file://')) return true;
  try {
    const url = new URL(origin);
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}
