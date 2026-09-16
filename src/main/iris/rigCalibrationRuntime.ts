import type { ProcessManager } from './processManager.js';
import type { RigCalibrationRuntime } from './rigCalibrationCoordinator.js';

// Recording is just a preview monitor session given an output directory.
export function createProcessManagerRigCalibrationRuntime(processManager: ProcessManager): RigCalibrationRuntime {
  return {
    async startRecording(directory, cameraCount, targetFps) {
      const { videoStreams } = await processManager.openPreviewMonitor({ outputDirectory: directory, cameraCount, targetFps });
      return videoStreams;
    },
    async stopRecording(): Promise<void> {
      await processManager.closePreviewMonitor();
    },
  };
}
