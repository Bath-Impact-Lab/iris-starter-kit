import { describe, expect, it, vi } from 'vitest';

import { createProcessManagerRigCalibrationRuntime } from './rigCalibrationRuntime.js';
import type { ProcessManager } from './processManager.js';

function fakeProcessManager() {
  return {
    openPreviewMonitor: vi.fn(async () => ({ videoStreams: [{ cameraId: 0, url: 'ws://x' }] })),
    closePreviewMonitor: vi.fn(async () => undefined),
  } as unknown as ProcessManager;
}

describe('createProcessManagerRigCalibrationRuntime', () => {
  it('forwards targetFps to openPreviewMonitor instead of letting it default silently', async () => {
    const processManager = fakeProcessManager();
    const runtime = createProcessManagerRigCalibrationRuntime(processManager);

    await runtime.startRecording('C:\\capture', 2, 60);

    expect(processManager.openPreviewMonitor).toHaveBeenCalledWith({
      outputDirectory: 'C:\\capture',
      cameraCount: 2,
      targetFps: 60,
    });
  });

  it('passes targetFps through as undefined when the caller does not specify one', async () => {
    const processManager = fakeProcessManager();
    const runtime = createProcessManagerRigCalibrationRuntime(processManager);

    await runtime.startRecording('C:\\capture', 2);

    expect(processManager.openPreviewMonitor).toHaveBeenCalledWith({
      outputDirectory: 'C:\\capture',
      cameraCount: 2,
      targetFps: undefined,
    });
  });

  it('stopRecording delegates to closePreviewMonitor', async () => {
    const processManager = fakeProcessManager();
    const runtime = createProcessManagerRigCalibrationRuntime(processManager);

    await runtime.stopRecording();

    expect(processManager.closePreviewMonitor).toHaveBeenCalledTimes(1);
  });
});
