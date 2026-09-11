import type { Point2, RoiCamera } from '../../../shared/roi';
export function rotatePoint([x, y]: Point2, rotation: number): Point2 {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return [1 - y, x];
    case 180: return [1 - x, 1 - y];
    case 270: return [y, 1 - x];
    default: return [x, y];
  }
}
export function orientedSize(width: number, height: number, rotation: number): [number, number] {
  return Math.abs(rotation % 180) === 90 ? [height, width] : [width, height];
}

/** Unnormalised camera ray, transformed by row-major camera-to-world R. */
export function cameraRay(camera: RoiCamera, u: number, v: number): [number, number, number] | null {
  const k = camera.intrinsics, r = camera.rotation;
  if (!k || !r || k.length !== 9 || r.length !== 9 || ![...k, ...r].every(Number.isFinite) || Math.abs(k[0]) < 1e-6 || Math.abs(k[4]) < 1e-6) return null;
  const y = (v - k[5]) / k[4], x = (u - k[2] - k[1] * y) / k[0];
  return [r[0] * x + r[1] * y + r[2], r[3] * x + r[4] * y + r[5], r[6] * x + r[7] * y + r[8]];
}

export function suggestedRectangle(cameras: RoiCamera[], floor: number): Point2[] {
  const points: Point2[] = [];
  for (const c of cameras) {
    const ray = cameraRay(c, c.width / 2, c.height * .75), p = c.position;
    if (!ray || !p || !p.every(Number.isFinite) || Math.abs(ray[1]) < 1e-5) continue;
    const t = (floor - p[1]) / ray[1];
    if (t > 0 && t < 20) points.push([p[0] + t * ray[0], p[2] + t * ray[2]]);
  }
  const x = points.length ? points.reduce((sum, p) => sum + p[0], 0) / points.length : 0;
  const z = points.length ? points.reduce((sum, p) => sum + p[1], 0) / points.length : 0;
  return [[x - 1, z - 1], [x + 1, z - 1], [x + 1, z + 1], [x - 1, z + 1]];
}
export function segmentPath(segments: [number, number, number, number][]): string {
  return segments.map(s => `M${s[0]},${s[1]}L${s[2]},${s[3]}`).join(' ');
}
