import { open } from 'node:fs/promises';
import path from 'node:path';
import type { Da3Scene, RoiState } from '../../shared/roi';

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_POINTS = 100000;

// DA3 writes a fixed binary XYZ/RGB layout. Reject other layouts rather than
// interpreting arbitrary PLY properties as positions or allocating unbounded buffers.
export function decodeDa3Ply(data: Buffer, limit = MAX_POINTS) {
  const headerEnd = data.indexOf('end_header\n');
  if (headerEnd < 0 || headerEnd > 4096) throw new Error('Invalid DA3 scene header');
  const header = data.subarray(0, headerEnd).toString('ascii');
  const match = /^ply\nformat binary_little_endian 1\.0\nelement vertex (\d+)\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n$/.exec(header);
  if (!match) throw new Error('Unsupported DA3 scene format');
  const count = Number(match[1]), offset = headerEnd + 11;
  if (!Number.isSafeInteger(count) || count < 1 || count * 15 !== data.length - offset || data.length > MAX_FILE_BYTES)
    throw new Error('Incomplete or oversized DA3 scene');
  const stride = Math.max(1, Math.ceil(count / Math.max(1, limit)));
  const positions: number[] = [], colors: number[] = [];
  for (let i = 0; i < count; i += stride) {
    const start = offset + i * 15;
    const point = [data.readFloatLE(start), data.readFloatLE(start + 4), data.readFloatLE(start + 8)];
    if (!point.every(v => Number.isFinite(v) && Math.abs(v) <= 10000)) continue;
    positions.push(...point); colors.push(data[start + 12], data[start + 13], data[start + 14]);
  }
  if (!positions.length) throw new Error('DA3 scene contains no usable points');
  return { positions: new Float32Array(positions), colors: new Uint8Array(colors), originalPointCount: count };
}

async function readBounded(file: string, max: number) {
  const handle = await open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > max) throw new Error('DA3 output exceeds the size limit');
    const data = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) throw new Error('DA3 output is still being written');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('DA3 output changed while loading');
    return data;
  } finally { await handle.close(); }
}

export function sceneMatchesCalibration(document: any, state: RoiState): boolean {
  const matches = (a: unknown, b: number[] | undefined, size: number) => Array.isArray(a) && a.length === size && b?.length === size && a.every((v, i) =>
    typeof v === 'number' && Number.isFinite(v) && Number.isFinite(b[i]) && Math.abs(v - b[i]) <= 1e-5 * Math.max(1, Math.abs(b[i])));
  return document?.success === true && Array.isArray(document.cameras) && state.cameras.length > 0 && document.cameras.length === state.cameras.length &&
    state.cameras.every(c => {
      const saved = document.cameras.filter((s: any) => s.cam_id === c.cameraId);
      return saved.length === 1 && matches(saved[0].extrinsics?.R, c.rotation, 9) && matches(saved[0].extrinsics?.t, c.position, 3);
    });
}

/** One instance per run, with a unique directory owned by the main process. */
export class Da3SceneSource {
  private calibrationVersion?: number;
  private cached?: Promise<Da3Scene>;
  constructor(readonly runId: string, private directory: string) {}
  observe(state: RoiState) {
    if (state.runId === this.runId && state.calibrationVersion > 0 && state.cameras.some(c => c.position)) {
      this.calibrationVersion ??= state.calibrationVersion;
      if (state.calibrationVersion !== this.calibrationVersion) this.cached = undefined;
    }
  }
  async load(state: RoiState): Promise<Da3Scene> {
    this.observe(state);
    if (state.runId !== this.runId || !this.calibrationVersion || state.calibrationVersion !== this.calibrationVersion)
      throw new Error('The DA3 scene is unavailable for this calibration. Start a new capture to reconstruct it.');
    if (!this.cached) {
      this.cached = this.read(state).catch(error => { this.cached = undefined; throw error; });
    }
    return this.cached;
  }
  private async read(state: RoiState): Promise<Da3Scene> {
    const file = path.join(this.directory, 'extrinsics.json');
    const before = await readBounded(file, 1024 * 1024);
    if (!sceneMatchesCalibration(JSON.parse(before.toString('utf8')), state))
      throw new Error('The reconstructed scene does not match the live camera calibration.');
    const data = await readBounded(path.join(this.directory, 'scene.ply'), MAX_FILE_BYTES);
    const after = await readBounded(file, 1024 * 1024);
    if (!before.equals(after)) throw new Error('Calibration changed while loading the DA3 scene');
    return { ...decodeDa3Ply(data), runId: this.runId, calibrationVersion: state.calibrationVersion };
  }
}
