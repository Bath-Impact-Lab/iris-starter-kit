// Minimal H.264 Annex-B inspection shared by the main-process video relay and
// the renderer decoder. Both handle exactly one access unit (frame) at a time.

const NAL_SLICE = 1;
const NAL_IDR_SLICE = 5;
const NAL_SPS = 7;

export interface AccessUnitInfo {
  /** Contains an IDR slice: decodable without earlier frames. */
  keyframe: boolean;
  /** Contains a coded picture, not just parameter sets or SEI. */
  hasPicture: boolean;
  /** The SPS NAL unit (header byte first), if present. */
  sps: Uint8Array | null;
}

// Parameter sets and SEI precede the first slice, so scanning stops there
// instead of walking the (large) slice data.
export function inspectAccessUnit(data: Uint8Array): AccessUnitInfo {
  let sps: Uint8Array | null = null;
  let start = findStartCode(data, 0);

  while (start) {
    const header = start.index + start.length;
    if (header >= data.length) break;

    const type = data[header]! & 0x1f;
    if (type === NAL_SLICE || type === NAL_IDR_SLICE) {
      return { keyframe: type === NAL_IDR_SLICE, hasPicture: true, sps };
    }

    const next = findStartCode(data, header + 1);
    if (type === NAL_SPS) sps = data.subarray(header, next ? next.index : data.length);
    start = next;
  }

  return { keyframe: false, hasPicture: false, sps };
}

function findStartCode(data: Uint8Array, offset: number): { index: number; length: number } | null {
  for (let index = offset; index < data.length - 2; index += 1) {
    if (data[index] !== 0 || data[index + 1] !== 0) continue;
    if (data[index + 2] === 1) return { index, length: 3 };
    if (data[index + 2] === 0 && data[index + 3] === 1) return { index, length: 4 };
  }
  return null;
}
