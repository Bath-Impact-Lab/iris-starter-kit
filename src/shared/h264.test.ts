import { describe, expect, it } from 'vitest';
import { inspectAccessUnit } from './h264';

const START = [0, 0, 0, 1];
const nal = (type: number, ...body: number[]) => [...START, type, ...body];

describe('inspectAccessUnit', () => {
  it('recognises a keyframe and returns its SPS', () => {
    const unit = new Uint8Array([...nal(0x67, 0x64, 0x00, 0x1f), ...nal(0x68, 0xee), ...nal(0x65, 0x88, 0x84)]);

    const info = inspectAccessUnit(unit);

    expect(info.keyframe).toBe(true);
    expect(info.hasPicture).toBe(true);
    expect(Array.from(info.sps ?? [])).toEqual([0x67, 0x64, 0x00, 0x1f]);
  });

  it('recognises a delta frame with a 3-byte start code', () => {
    const info = inspectAccessUnit(new Uint8Array([0, 0, 1, 0x41, 0x9a]));

    expect(info).toEqual({ keyframe: false, hasPicture: true, sps: null });
  });

  it('reports parameter sets without a picture', () => {
    const info = inspectAccessUnit(new Uint8Array([...nal(0x67, 0x42, 0x00, 0x1e), ...nal(0x68, 0xce)]));

    expect(info.hasPicture).toBe(false);
    expect(info.sps).not.toBeNull();
  });
});
