import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { ProcessManager } from './processManager.js';
import type { IrisCameraDevice } from './config.js';

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 1234;
  return child;
}

function makeManager(overrides: {
  listCameras?: (cliPath: string) => Promise<IrisCameraDevice[] | null>;
}) {
  const writeTempConfigFile = vi.fn((config: Record<string, any>) => ({
    tmpDir: 'C:\\fake\\tmp',
    cfgPath: 'C:\\fake\\tmp\\config.json',
  }));

  const manager = new ProcessManager({
    dependencies: {
      spawnProcess: () => fakeChild(),
      pathExists: () => true,
      getExecutablePath: () => 'C:\\fake\\iris_cli.exe',
      writeTempConfigFile,
      listCameras: overrides.listCameras ?? (async () => null),
    },
  });

  return { manager, writeTempConfigFile };
}

const twoConfiguredCameras = [
  { id: '0', label: 'Camera 1' },
  { id: '1', label: 'Camera 2' },
];

function cameraIdsFromLastConfig(writeTempConfigFile: ReturnType<typeof vi.fn>): number[] {
  const lastConfig = writeTempConfigFile.mock.calls.at(-1)?.[0];
  return lastConfig?.shared?.camera_groups?.capture_rig?.camera_ids ?? [];
}

describe('ProcessManager camera reconciliation', () => {
  it('rejects a capture area draft belonging to another run before contacting core', async () => {
    const { manager } = makeManager({});
    await manager.startRun({ run_id: 'current', cameras: twoConfiguredCameras });
    const reply = await manager.roiRequest('roi.apply', { runId: 'previous', mode: 'off', calibrationVersion: 1, roiVersion: 0 });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('run changed');
  });
  it('passes the configured cameras through unchanged when IRIS reports the same count', async () => {
    const { manager, writeTempConfigFile } = makeManager({
      listCameras: async () => [
        { index: 0, name: 'Cam A' },
        { index: 1, name: 'Cam B' },
      ],
    });

    const result = await manager.startRun({ cameras: twoConfiguredCameras });

    expect(result.ok).toBe(true);
    expect(cameraIdsFromLastConfig(writeTempConfigFile).length).toBe(2);
  });

  it('clamps to what IRIS itself found when the configured camera count is higher (e.g. a virtual camera the browser sees but IRIS does not)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, writeTempConfigFile } = makeManager({
      listCameras: async () => [{ index: 0, name: 'Cam A' }],
    });

    const result = await manager.startRun({ cameras: twoConfiguredCameras });

    expect(result.ok).toBe(true);
    expect(cameraIdsFromLastConfig(writeTempConfigFile).length).toBe(1);
    expect(warnSpy.mock.calls.some(([msg]) => String(msg).includes('IRIS itself found 1'))).toBe(true);
    warnSpy.mockRestore();
  });

  it("proceeds with the configured cameras unchanged when IRIS's own list cannot be determined", async () => {
    const { manager, writeTempConfigFile } = makeManager({
      listCameras: async () => null,
    });

    const result = await manager.startRun({ cameras: twoConfiguredCameras });

    expect(result.ok).toBe(true);
    expect(cameraIdsFromLastConfig(writeTempConfigFile).length).toBe(2);
  });

  it('does not query IRIS at all when no cameras were configured', async () => {
    const listCameras = vi.fn(async () => [{ index: 0, name: 'Cam A' }]);
    const { manager } = makeManager({ listCameras });

    await manager.startRun({ cameras: [] });

    expect(listCameras).not.toHaveBeenCalled();
  });
});
