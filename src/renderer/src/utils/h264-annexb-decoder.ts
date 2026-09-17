import { inspectAccessUnit } from '../../../shared/h264';

export type DecoderStatus = 'connecting' | 'streaming' | 'failed';

// Decodes IRIS's raw H.264 Annex-B video stream via WebCodecs, reading the
// codec profile/level from the stream's own SPS NAL rather than hardcoding it.
// The main-process relay sends exactly one access unit per WebSocket message
// (see videoPipeReader.ts), so each message is decoded as soon as it arrives
// instead of waiting for the next frame's start code.
export class H264AnnexBDecoder {
  private socket: WebSocket | null = null;
  private decoder: VideoDecoder | null = null;
  private pendingParameterSets: Uint8Array | null = null;
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
    this.pendingParameterSets = null;
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

  private push(accessUnit: Uint8Array): void {
    const { keyframe, hasPicture, sps } = inspectAccessUnit(accessUnit);
    if (sps) this.configureFromSps(sps);

    // Parameter sets sent on their own belong to the next picture.
    if (!hasPicture) {
      this.pendingParameterSets = accessUnit;
      return;
    }
    const data = this.pendingParameterSets ? concatenate(this.pendingParameterSets, accessUnit) : accessUnit;
    this.pendingParameterSets = null;

    const decoder = this.decoder;
    if (!decoder || decoder.state !== 'configured') return;

    if (keyframe) {
      this.receivedKeyframe = true;
    } else if (!this.receivedKeyframe) {
      return;
    } else if (decoder.decodeQueueSize > 2) {
      // Every later delta frame references this one, so decoding past a gap
      // smears until the next keyframe. Wait for it instead.
      this.receivedKeyframe = false;
      return;
    }

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
