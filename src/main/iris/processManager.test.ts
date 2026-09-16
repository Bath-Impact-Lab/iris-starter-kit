import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { ProcessManager } from './processManager.js';
import type { IrisCameraDevice } from './config.js';

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 1234;
  child.stdin = { writable: true, write: vi.fn() };
  child.kill = vi.fn((signal: string) => {
    child.emit('exit', null, signal);
  });
  return child;
}

function makeManager(overrides: {
  listCameras?: (cliPath: string) => Promise<IrisCameraDevice[] | null>;
  spawnProcess?: (command: string, args: string[]) => any;
}) {
  const writeTempConfigFile = vi.fn((config: Record<string, any>) => ({
    tmpDir: 'C:\\fake\\tmp',
    cfgPath: 'C:\\fake\\tmp\\config.json',
  }));

  const manager = new ProcessManager({
    dependencies: {
      spawnProcess: overrides.spawnProcess ?? (() => fakeChild()),
      pathExists: () => true,
      getExecutablePath: () => 'C:\\fake\\iris_cli.exe',
      writeTempConfigFile,
      listCameras: overrides.listCameras ?? (async () => null),
      createPipeServer: async () => ({ close: () => {} }) as any,
      createVideoPipeReader: async () => ({ close: () => {} }) as any,
      videoRelayServer: { start: async () => [], stop: async () => {}, push: () => {} } as any,
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
  it.each([[120, 120], [60000 / 1001, 60], [30, 30]])('passes monitor rate %s to Core as %s', async (targetFps, expected) => {
    const spawnProcess = vi.fn(() => fakeChild());
    const manager = new ProcessManager({ dependencies: {
      spawnProcess,
      pathExists: () => true,
      getExecutablePath: () => 'C:\\fake\\iris_cli.exe',
      writeTempConfigFile: () => ({ tmpDir: 'C:\\fake\\tmp', cfgPath: 'C:\\fake\\tmp\\config.json' }),
      createPipeServer: vi.fn(async () => ({ close: vi.fn() })) as any,
    } });
    await manager.startStream({ sessionId: 'rate-test', options: { targetFps } });
    expect(spawnProcess.mock.calls[0]).toEqual(expect.arrayContaining([
      expect.arrayContaining(['--fps', String(expected)]),
    ]));
  });

  it('rechecks stable device paths and remaps reordered native indices at launch', async () => {
    const { manager, writeTempConfigFile } = makeManager({ listCameras: async () => [
      { index: 7, name: 'A', devicePath: 'path-a', modes: [{ width: 1280, height: 720, fpsNumerator: 60, fpsDenominator: 1, format: 'MJPEG' }] },
      { index: 3, name: 'B', devicePath: 'path-b', modes: [{ width: 1280, height: 720, fpsNumerator: 60, fpsDenominator: 1, format: 'MJPEG' }] },
    ] });
    expect((await manager.startRun({ cameras: [
      { id: 0, devicePath: 'path-a', resolution: '1280x720', fps: 60 },
      { id: 1, devicePath: 'path-b', resolution: '1280x720', fps: 60 },
    ] })).ok).toBe(true);
    expect(cameraIdsFromLastConfig(writeTempConfigFile)).toEqual([7, 3]);
    expect(writeTempConfigFile.mock.calls.at(-1)![0].shared.camera_groups.capture_rig.fps).toBe(60);
  });

  it('refuses missing selected devices and unsupported modes before spawning', async () => {
    const { manager, writeTempConfigFile } = makeManager({ listCameras: async () => [
      { index: 0, name: 'A', devicePath: 'path-a', modes: [{ width: 1280, height: 720, fpsNumerator: 30, fpsDenominator: 1, format: 'MJPEG' }] },
    ] });
    expect((await manager.startRun({ cameras: [{ id: 0, devicePath: 'missing' }] })).error).toContain('no longer available');
    expect((await manager.startRun({ cameras: [{ id: 0, devicePath: 'path-a', resolution: '1280x720', fps: 60 }] })).error).toContain('does not support');
    expect(writeTempConfigFile).not.toHaveBeenCalled();
  });

  it('retains cached capabilities while a running capture holds a device', async () => {
    let query = 0;
    const modes = [{ width: 1280, height: 720, fpsNumerator: 120, fpsDenominator: 1, format: 'MJPEG' }];
    const { manager } = makeManager({ listCameras: async () => [{ index: 0, name: 'A', devicePath: 'path-a', modes: query++ ? [] : modes }] });
    await manager.getCaptureCameras();
    expect((await manager.getCaptureCameras())![0].modes).toEqual(modes);
  });

  it('publishes fragmented capture descriptors and clears confirmation on unexpected exit', async () => {
    const child = fakeChild();
    const manager = new ProcessManager({ dependencies: {
      spawnProcess: () => child, pathExists: () => true, getExecutablePath: () => 'fake',
      listCameras: async () => null, writeTempConfigFile: () => ({ tmpDir: 'fake', cfgPath: 'fake.json' }),
    } });
    await manager.startRun({ run_id: 'capture', camera_width: 1280, camera_height: 720, video_fps: 60000 / 1001, cameras: [{ id: 7 }] });
    child.stdout.emit('data', 'noise\nIRIS_CAPTURE_SET');
    child.stdout.emit('data', 'TINGS {"cameraId":7,"width":1280,"height":720,"fpsNumerator":60000,"fpsDenominator":1001,"format":"MJPEG"}\n');
    expect(manager.getStatus().capture?.[0].fpsNumerator).toBe(60000);
    child.emit('exit', 1, null);
    expect(manager.getStatus()).toMatchObject({ failed: true, capture: [] });
  });
  it('isolates DA3 output directories even when a run ID is reused', async () => {
    const first = makeManager({}), second = makeManager({});
    await first.manager.startRun({ run_id: 'same', cameras: twoConfiguredCameras });
    await second.manager.startRun({ run_id: 'same', cameras: twoConfiguredCameras });
    const a = first.writeTempConfigFile.mock.calls.at(-1)![0].pipeline.triangulation.da3_startup_calibration;
    const b = second.writeTempConfigFile.mock.calls.at(-1)![0].pipeline.triangulation.da3_startup_calibration;
    expect(a.output_dir).not.toBe(b.output_dir);
    expect(a.save_ply).toBe('scene.ply');
  });
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

describe('ProcessManager monitor recording', () => {
  it('does not pass --output-dir to iris_cli monitor for an ordinary live preview', async () => {
    const spawnProcess = vi.fn((_command: string, _args: string[]) => fakeChild());
    const { manager } = makeManager({ spawnProcess });

    await manager.openPreviewMonitor({ cameraCount: 2 });

    const args = spawnProcess.mock.calls[0]?.[1] as string[];
    expect(args).not.toContain('--output-dir');
  });

  it('passes --output-dir to iris_cli monitor when explicitly recording for rig calibration', async () => {
    const spawnProcess = vi.fn((_command: string, _args: string[]) => fakeChild());
    const { manager } = makeManager({ spawnProcess });

    await manager.openPreviewMonitor({ cameraCount: 2, outputDirectory: 'C:\\calib\\capture-1' });

    const args = spawnProcess.mock.calls[0]?.[1] as string[];
    const flagIndex = args.indexOf('--output-dir');
    expect(flagIndex).toBeGreaterThan(-1);
    expect(args[flagIndex + 1]).toBe('C:\\calib\\capture-1');
  });
});

describe('ProcessManager graceful monitor shutdown', () => {
  // Killing the process outright (SIGTERM is a hard kill on Windows)
  // leaves recording_cam<N>.mp4 corrupt. This covers the graceful path.
  it('writes "stop\\n" to a monitor session\'s stdin instead of killing it outright', async () => {
    const child = fakeChild();
    const spawnProcess = vi.fn(() => child);
    const { manager } = makeManager({ spawnProcess });

    await manager.openPreviewMonitor({ cameraCount: 1, outputDirectory: 'C:\\calib\\capture-1' });
    const closePromise = manager.closePreviewMonitor();

    // stdin.write happens synchronously, before the await suspends.
    expect(child.stdin.write).toHaveBeenCalledWith('stop\n');
    expect(child.kill).not.toHaveBeenCalled();

    child.emit('exit', null, 'SIGTERM');
    await closePromise;
  });

  it('escalates to SIGTERM then SIGKILL if the monitor does not exit after "stop\\n"', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      // Simulate a monitor that ignores stop\n and never exits on its own.
      child.kill = vi.fn();
      const spawnProcess = vi.fn(() => child);
      const { manager } = makeManager({ spawnProcess });

      await manager.openPreviewMonitor({ cameraCount: 1, outputDirectory: 'C:\\calib\\capture-1' });
      const closePromise = manager.closePreviewMonitor();

      expect(child.stdin.write).toHaveBeenCalledWith('stop\n');
      expect(child.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(3000);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      await vi.advanceTimersByTimeAsync(2500);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      child.emit('exit', null, 'SIGKILL');
      await closePromise;
    } finally {
      vi.useRealTimers();
    }
  });
});
