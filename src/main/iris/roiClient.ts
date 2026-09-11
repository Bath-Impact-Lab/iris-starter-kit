import net, { type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { RoiEdit, RoiOperation, RoiReply } from '../../shared/roi';

// Serialise requests on one connection. Never retry mutations after an uncertain reply.
export class RoiClient {
  private socket: Socket | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private rejectPending: ((error: Error) => void) | null = null;
  constructor(readonly pipe: string, readonly runId: string) {}

  request(operation: RoiOperation, edit?: RoiEdit): Promise<RoiReply> {
    const task = this.queue.then(() => this.exchange(operation, edit));
    this.queue = task.catch(() => undefined);
    return task;
  }
  close() {
    this.closed = true;
    this.rejectPending?.(new Error('IRIS run stopped'));
    this.socket?.destroy();
    this.socket = null;
  }
  private async exchange(operation: RoiOperation, edit?: RoiEdit): Promise<RoiReply> {
    if (this.closed) throw new Error('IRIS run stopped');
    const requestId = randomUUID();
    const message = JSON.stringify({ ...edit, operation, protocolVersion: 1, requestId, runId: this.runId }) + '\n';
    if (Buffer.byteLength(message) > 65536) throw new Error('Capture area request is too large');
    return new Promise((resolve, reject) => {
      const previous = this.socket;
      const socket = previous ?? net.createConnection(this.pipe);
      socket.setEncoding('utf8');
      this.socket = socket;
      if (!previous) socket.once('close', () => { if (this.socket === socket) this.socket = null; });
      let buffer = '';
      let done = false;
      const finish = (error?: Error, reply?: RoiReply) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.rejectPending = null;
        socket.off('data', data);
        socket.off('error', failed);
        socket.off('close', disconnected);
        socket.off('connect', send);
        if (error) { socket.destroy(); this.socket = null; reject(error); }
        else resolve(reply!);
      };
      const timer = setTimeout(() => finish(new Error('Capture area control unavailable or timed out. Use an ROI-capable IRIS build; refresh to check whether changes applied.')), 5000);
      const failed = (_error: Error) => finish(new Error('Capture area controls are unavailable. Wait for IRIS startup, or use an updated IRIS build.'));
      const disconnected = () => finish(new Error('IRIS control disconnected; refresh applied state'));
      const data = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        if (buffer.length > 1024 * 1024) { finish(new Error('ROI response is too large')); return; }
        const boundary = buffer.indexOf('\n');
        if (boundary < 0) return;
        try {
          const response = JSON.parse(buffer.slice(0, boundary));
          if (response.protocolVersion !== 1 || response.runId !== this.runId || response.requestId !== requestId)
            throw new Error('Unexpected ROI protocol response');
          if (typeof response.ok !== 'boolean' || (response.ok && (!response.state || !Array.isArray(response.state.cameras))))
            throw new Error('Invalid ROI state');
          if (response.ok) response.state.runId = this.runId;
          finish(undefined, response);
        } catch (error) { finish(error as Error); }
      };
      const send = () => socket.write(message);
      this.rejectPending = (error) => finish(error);
      socket.on('data', data);
      socket.once('error', failed);
      socket.once('close', disconnected);
      // Retain an error handler between requests to avoid unhandled socket errors.
      if (socket.listenerCount('error') === 1) socket.on('error', () => { if (this.socket === socket) this.socket = null; });
      if (socket.connecting) socket.once('connect', send); else send();
    });
  }
}
