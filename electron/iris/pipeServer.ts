import net from 'node:net';

export interface PipeServerOptions {
  pipeName: string;
  onFrame: (frame: unknown) => void;
}

export function createPipeServer({ pipeName, onFrame }: PipeServerOptions): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const streams = new Set<net.Socket>();
    const server = net.createServer((stream) => {
      streams.add(stream);
      let buffer = '';

      stream.on('data', (chunk) => {
        buffer += chunk.toString('utf8');

        let boundary = buffer.indexOf('\n');
        while (boundary !== -1) {
          const line = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 1);

          if (line) {
            try {
              onFrame(JSON.parse(line));
            } catch (error) {
              console.error('[pipe] JSON parse error on stream line:', error);
            }
          }

          boundary = buffer.indexOf('\n');
        }
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
