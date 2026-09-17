import net from 'node:net';

// Packed 40-byte, little-endian header before every payload chunk on the
// video pipe. Payload is raw H.264 Annex-B, not MPEG-TS despite the CLI
// help text.
export const IPC_FRAME_HEADER_SIZE = 40;
export const IPC_FRAME_MAGIC = 0x49524953; // "IRIS"

export interface VideoFrameChunk {
  cameraId: number;
  frameIndex: bigint;
  timestampMs: bigint;
  width: number;
  height: number;
  payload: Buffer;
}

export interface VideoAccessUnit {
  cameraId: number;
  timestampMs: bigint;
  width: number;
  height: number;
  data: Buffer;
}

export interface VideoPipeReaderOptions {
  pipeName: string;
  onAccessUnit: (accessUnit: VideoAccessUnit) => void;
  createServer?: typeof net.createServer;
}

// Core's GpuVideoWriter (core/knect/gpu_writer.cpp) flushes after every
// encoded packet, but through a 32 KiB AVIO buffer: a larger packet (typically
// a keyframe) arrives as several full 32 KiB chunks, each with its own header,
// followed by a shorter tail. So a chunk shorter than the buffer ends a frame.
// A packet that is an exact multiple of 32 KiB has no tail; that full chunk is
// flushed once nothing follows it for IDLE_FLUSH_MS. Keep in sync with Core.
export const CORE_AVIO_CHUNK_BYTES = 32 * 1024;
const IDLE_FLUSH_MS = 5;

function findMagic(buffer: Buffer, from: number): number {
  for (let index = from; index <= buffer.length - 4; index += 1) {
    if (buffer.readUInt32LE(index) === IPC_FRAME_MAGIC) return index;
  }
  return -1;
}

export function createVideoFrameParser(onChunk: (chunk: VideoFrameChunk) => void) {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  return function push(chunk: Buffer): void {
    buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;

    for (;;) {
      if (buffer.length < IPC_FRAME_HEADER_SIZE) return;

      if (buffer.readUInt32LE(0) !== IPC_FRAME_MAGIC) {
        const resync = findMagic(buffer, 1);
        buffer = resync === -1 ? buffer.subarray(Math.max(0, buffer.length - 3)) : buffer.subarray(resync);
        if (buffer.length < IPC_FRAME_HEADER_SIZE) return;
      }

      const payloadSize = buffer.readUInt32LE(36);
      const totalSize = IPC_FRAME_HEADER_SIZE + payloadSize;
      if (buffer.length < totalSize) return;

      onChunk({
        cameraId: buffer.readUInt32LE(4),
        frameIndex: buffer.readBigUInt64LE(8),
        timestampMs: buffer.readBigUInt64LE(16),
        width: buffer.readUInt32LE(24),
        height: buffer.readUInt32LE(28),
        payload: buffer.subarray(IPC_FRAME_HEADER_SIZE, totalSize),
      });

      buffer = buffer.subarray(totalSize);
    }
  };
}

// Joins the chunks of one encoded packet back into a single access unit.
export function createAccessUnitAssembler(
  onAccessUnit: (accessUnit: VideoAccessUnit) => void,
  idleFlushMs = IDLE_FLUSH_MS,
) {
  let parts: VideoFrameChunk[] = [];
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const flush = () => {
    clearIdleTimer();
    const first = parts[0];
    if (!first) return;
    const data = parts.length === 1 ? first.payload : Buffer.concat(parts.map((part) => part.payload));
    parts = [];
    onAccessUnit({ cameraId: first.cameraId, timestampMs: first.timestampMs, width: first.width, height: first.height, data });
  };

  return {
    push(chunk: VideoFrameChunk): void {
      clearIdleTimer();
      parts.push(chunk);
      if (chunk.payload.length !== CORE_AVIO_CHUNK_BYTES) flush();
      else idleTimer = setTimeout(flush, idleFlushMs);
    },
    discard(): void {
      clearIdleTimer();
      parts = [];
    },
  };
}

export function createVideoPipeReader({ pipeName, onAccessUnit, createServer = net.createServer }: VideoPipeReaderOptions): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((stream) => {
      const assembler = createAccessUnitAssembler(onAccessUnit);
      const push = createVideoFrameParser(assembler.push);

      stream.on('data', (chunk) => push(chunk));
      stream.on('close', () => assembler.discard());
      stream.on('error', (error) => {
        console.error('[video-pipe] stream error:', error);
      });
    });

    server.on('error', (error) => {
      console.error('[video-pipe] server error:', error);
      reject(error);
    });

    server.listen(pipeName, () => {
      console.log(`[video-pipe] Server listening on ${pipeName}`);
      resolve(server);
    });
  });
}
