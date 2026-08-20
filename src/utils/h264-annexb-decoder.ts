const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

export type DecoderStatus = 'connecting' | 'streaming' | 'failed';

// Decodes IRIS's raw H.264 Annex-B video-pipe stream via WebCodecs, reading
// the codec profile/level from the stream's own SPS NAL rather than
// hardcoding it. See dont commit/IRIS-INTEGRATION-NOTES.md.
export class H264AnnexBDecoder {
  private socket: WebSocket | null = null;
  private decoder: VideoDecoder | null = null;
  private buffer = new Uint8Array(0);
  private accessUnit: Uint8Array[] = [];
  private receivedKeyframe = false;
  private timestamp = 0;

  constructor(
    private readonly streamUrl: string,
    private readonly onFrame: (frame: VideoFrame) => void,
    private readonly onStatus: (status: DecoderStatus) => void,
  ) {}

  start(): void {
    if (typeof VideoDecoder === 'undefined') {
      this.onStatus('failed');
      return;
    }
    this.onStatus('connecting');

    const socket = new WebSocket(this.streamUrl);
    socket.binaryType = 'arraybuffer';
    socket.onmessage = ({ data }) => {
      if (data instanceof ArrayBuffer) this.push(new Uint8Array(data));
    };
    socket.onerror = () => this.onStatus('failed');
    this.socket = socket;
  }

  stop(): void {
    this.socket?.close();
    this.socket = null;
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
    this.buffer = new Uint8Array(0);
    this.accessUnit = [];
    this.receivedKeyframe = false;
  }

  private configureFromSps(sps: Uint8Array): void {
    if (this.decoder || sps.length < 4) return;

    // sps[0] is the NAL header byte; profile_idc, constraint flags, and
    // level_idc are the next three (ISO 14496-15 avcC / RFC 6381).
    const codec = `avc1.${Array.from(sps.subarray(1, 4))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;

    const decoder = new VideoDecoder({
      output: (frame) => {
        this.onStatus('streaming');
        this.onFrame(frame);
      },
      error: () => this.onStatus('failed'),
    });
    decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' });
    this.decoder = decoder;
  }

  private push(chunk: Uint8Array): void {
    const joined = concatenate(this.buffer, chunk);
    let current = findStartCode(joined, 0);

    while (current) {
      const next = findStartCode(joined, current.index + current.length);
      if (!next) break;

      const nalu = joined.slice(current.index, next.index);
      const type = joined[current.index + current.length]! & 0x1f;
      if (type === 7) this.configureFromSps(nalu.slice(current.length));

      this.accessUnit.push(nalu);
      if (type === 1 || type === 5) this.decodeAccessUnit(type === 5);
      current = next;
    }

    this.buffer = current
      ? joined.slice(current.index)
      : joined.length <= MAX_BUFFER_BYTES
        ? joined
        : new Uint8Array(0);
  }

  private decodeAccessUnit(keyframe: boolean): void {
    const decoder = this.decoder;
    if (!decoder || decoder.state !== 'configured') return;

    if (keyframe) this.receivedKeyframe = true;
    if (!this.receivedKeyframe || decoder.decodeQueueSize > 2) {
      this.accessUnit = [];
      return;
    }

    const size = this.accessUnit.reduce((total, nalu) => total + nalu.length, 0);
    const data = new Uint8Array(size);
    let offset = 0;
    for (const nalu of this.accessUnit) {
      data.set(nalu, offset);
      offset += nalu.length;
    }
    this.accessUnit = [];

    decoder.decode(
      new EncodedVideoChunk({
        type: keyframe ? 'key' : 'delta',
        timestamp: ++this.timestamp,
        data,
      }),
    );
  }
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
}

function findStartCode(buffer: Uint8Array, offset: number): { index: number; length: number } | null {
  for (let index = offset; index < buffer.length - 2; index += 1) {
    if (buffer[index] !== 0 || buffer[index + 1] !== 0) continue;
    if (buffer[index + 2] === 1) return { index, length: 3 };
    if (buffer[index + 2] === 0 && buffer[index + 3] === 1) return { index, length: 4 };
  }
  return null;
}
