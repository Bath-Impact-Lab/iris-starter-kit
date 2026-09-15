import { describe, expect, it, vi } from 'vitest';

import { calibrateWithFallback } from './arucoCalibration.js';

function fakeExecFile(handler: (cliPath: string, args: string[]) => { stdout: string } | never) {
  return vi.fn(async (cliPath: string, args: string[]) => handler(cliPath, args));
}

describe('calibrateWithFallback', () => {
  const videos = [
    { cameraId: 0, path: 'C:\\calib\\cam0.mp4' },
    { cameraId: 1, path: 'C:\\calib\\cam1.mp4' },
  ];

  it('rejects fewer than two videos before touching the CLI', async () => {
    const execFile = fakeExecFile(() => ({ stdout: '{}' }));
    const result = await calibrateWithFallback(
      { videos: [videos[0]!], outputDir: 'C:\\out' },
      { execFile: execFile as any, getCliPath: () => 'iris_cli.exe' },
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/at least two/);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('runs da3-aruco with the marker args and returns its result on success', async () => {
    const execFile = fakeExecFile((cliPath, args) => {
      expect(cliPath).toBe('iris_cli.exe');
      expect(args).toEqual([
        'calibrate-extrinsics',
        '--mode',
        'da3-aruco',
        '--out',
        'C:\\out',
        '--json',
        '--video',
        '0:C:\\calib\\cam0.mp4',
        '--video',
        '1:C:\\calib\\cam1.mp4',
        '--engine',
        'C:/models/da3_base.trt',
        '--marker-size',
        '270',
        '--marker-id',
        '42',
        '--sample-fps',
        '15',
      ]);
      return {
        stdout: JSON.stringify({
          success: true,
          extrinsics_path: 'C:\\out\\extrinsics.json',
          report_path: 'C:\\out\\report.json',
          mean_reprojection_error_px: 1.2,
          metric_scale: 1.0,
          marker_observations: 240,
        }),
      };
    });

    const result = await calibrateWithFallback(
      { videos, outputDir: 'C:\\out', da3EnginePath: 'C:/models/da3_base.trt' },
      { execFile: execFile as any, getCliPath: () => 'iris_cli.exe' },
    );

    expect(result).toMatchObject({
      success: true,
      mode: 'da3-aruco',
      extrinsicsPath: 'C:\\out\\extrinsics.json',
      meanReprojectionErrorPx: 1.2,
      markerObservations: 240,
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it('falls back to plain da3 on the same videos when da3-aruco fails', async () => {
    let call = 0;
    const execFile = vi.fn(async (_cliPath: string, args: string[]) => {
      call += 1;
      if (call === 1) {
        expect(args).toContain('da3-aruco');
        const error: any = new Error('Command failed');
        error.stdout = JSON.stringify({
          success: false,
          error_message: 'Insufficient marker observations',
        });
        throw error;
      }
      expect(args).toContain('da3');
      expect(args).not.toContain('--marker-size');
      return {
        stdout: JSON.stringify({
          success: true,
          extrinsics_path: 'C:\\out\\extrinsics.json',
          mean_reprojection_error_px: 3.4,
        }),
      };
    });

    const result = await calibrateWithFallback(
      { videos, outputDir: 'C:\\out' },
      { execFile: execFile as any, getCliPath: () => 'iris_cli.exe' },
    );

    expect(result).toMatchObject({ success: true, mode: 'da3' });
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('reports failure when both da3-aruco and the da3 fallback fail', async () => {
    const execFile = fakeExecFile(() => {
      const error: any = new Error('Command failed');
      error.stdout = JSON.stringify({ success: false, error_message: 'No marker detected in any frame' });
      throw error;
    });

    const result = await calibrateWithFallback(
      { videos, outputDir: 'C:\\out' },
      { execFile: execFile as any, getCliPath: () => 'iris_cli.exe' },
    );

    expect(result).toMatchObject({ success: false, mode: 'da3' });
    expect(execFile).toHaveBeenCalledTimes(2);
  });
});
