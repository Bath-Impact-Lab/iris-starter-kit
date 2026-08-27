import net from 'node:net';

export interface PipeServerOptions {
  pipeName: string;
  onFrame: (frame: unknown) => void;
  createServer?: typeof net.createServer;
}

export interface ParsedPipeData {
  frames: unknown[];
  remainder: string;
}

export function parsePipeData(buffer: string): ParsedPipeData {
  const frames: unknown[] = [];
  let remainder = buffer;
  let boundary = remainder.indexOf('\n');

  while (boundary !== -1) {
    const line = remainder.slice(0, boundary).trim();
    remainder = remainder.slice(boundary + 1);

    if (line) {
      try {
        frames.push(JSON.parse(line));
      } catch {
        // Ignore malformed frames and continue reading the pipe.
      }
    }

    boundary = remainder.indexOf('\n');
  }

  return { frames, remainder };
}

export function createPipeServer({ pipeName, onFrame, createServer = net.createServer }: PipeServerOptions): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const streams = new Set<net.Socket>();
    const server = createServer((stream) => {
      streams.add(stream);
      let buffer = '';

      stream.on('data', (chunk) => {
        const parsed = parsePipeData(buffer + chunk.toString('utf8'));
        buffer = parsed.remainder;
        parsed.frames.forEach(onFrame);
      });

      stream.on('close', () => {
        streams.delete(stream);
      });

      stream.on('error', (error) => {
        console.error('[pipe] stream error:', error);
      });
    });

    server.on('error', (error) => {
      console.error('[pipe] server error:', error);
      reject(error);
    });

    server.listen(pipeName, () => {
      console.log(`[pipe] Server listening on ${pipeName}`);
      resolve(server);
    });
  });
}
