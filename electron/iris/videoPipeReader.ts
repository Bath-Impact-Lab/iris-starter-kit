import net from 'node:net';

// Mirrors `iris::core::IpcFrameHeader`: a packed 40-byte, little-endian
// header before every payload chunk on a `--video-pipe` named pipe. See
// dont commit/IRIS-INTEGRATION-NOTES.md for field layout and the payload
// format (raw H.264 Annex-B, not MPEG-TS despite the CLI help text).
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

export interface VideoPipeReaderOptions {
  pipeName: string;
  onChunk: (chunk: VideoFrameChunk) => void;
  createServer?: typeof net.createServer;
}

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

export function createVideoPipeReader({ pipeName, onChunk, createServer = net.createServer }: VideoPipeReaderOptions): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((stream) => {
      const push = createVideoFrameParser(onChunk);

      stream.on('data', (chunk) => push(chunk));
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
