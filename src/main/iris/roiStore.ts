import fs from 'node:fs';
import path from 'node:path';
import type { SavedRoi, RoiState } from '../../shared/roi';

export class RoiStore {
  constructor(private file: string) {}
  load(): SavedRoi | null {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (value.schemaVersion !== 1 || !['off', 'automatic', 'manual'].includes(value.mode)) return null;
      if (value.mode === 'manual' && (!Array.isArray(value.worldPolygon) ||
          value.worldPolygon.length < 3 || value.worldPolygon.length > 32 ||
          !value.worldPolygon.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000)))) return null;
      return value;
    } catch { return null; }
  }
  save(state: RoiState, captureRotation: number) {
    const value: SavedRoi = {
      schemaVersion: 1, mode: state.mode, source: state.source,
      deviceKey: state.cameras.find(c => c.cameraId === state.source?.cameraId)?.deviceKey,
      captureRotation, worldPolygon: state.worldPolygon, savedAt: new Date().toISOString(),
      calibrationVersion: state.calibrationVersion, runId: state.runId, floorHeight: state.floorHeight,
      rigDeviceKeys: state.cameras.map(c => c.deviceKey).filter((key): key is string => Boolean(key)),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, this.file);
  }
}
