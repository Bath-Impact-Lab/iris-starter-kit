import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { PIPE_NAME, buildConfigFromOptions, getIrisCliMissingMessage, getIrisCliPath } from './config.js';
import { createPipeServer } from './pipeServer.js';
import { writeTempConfigFile } from './utils.js';

export interface CliOutputPayload {
  channel: string;
  line: string;
}

export interface ProcessStartOptions {
  sessionId: string;
  options: Record<string, any>;
  onCliOutput?: (payload: CliOutputPayload) => void;
  onFrame?: (frame: unknown) => void;
}

export interface ProcessState {
  child: ChildProcess;
  stopPromise?: Promise<{ ok: boolean; sessionId: string }>;
}

export type IrisDispatcherState = 'idle' | 'starting' | 'running' | 'previewing' | 'stopping' | 'failed';

export interface IrisDispatcherStatus {
  state: IrisDispatcherState;
  runId: string | null;
  runCount: number;
  previewMonitorAttached: boolean;
  recordingMonitorAttached: boolean;
  previewOpen: boolean;
  stopping: boolean;
  failed: boolean;
}

export interface StartIrisRunInput {
  specFile?: string;
  verbose?: boolean;
  profileFile?: string;
  run_id?: string;
  camera_width?: number;
  camera_height?: number;
  video_fps?: number;
  cameras?: Array<{ id: string | number; label?: string; resolution?: string; fps?: number; rotation?: number }>;
}

export interface OpenIrisMonitorInput {
  sharedMemoryName?: string;
  outputDirectory?: string;
  posePipePath?: string;
  videoPipes?: Array<{ cameraIndex: number; pipePath: string }>;
  targetFps?: number;
  savePoses?: boolean;
  drawBoundingBoxes?: boolean;
  drawKeypoints?: boolean;
  drawIds?: boolean;
  drawCaptureVolume?: boolean;
  verbose?: boolean;
}

export interface IrisProcessResult {
  exitCode: number | null;
  stopped: boolean;
  stdout?: string;
  stderr?: string;
}

export interface IrisRun {
  ready: Promise<void>;
  completion: Promise<IrisProcessResult>;
  stop: () => Promise<void>;
}

export type StatusListener = (status: IrisDispatcherStatus) => void;

export class ProcessManager {
  private readonly workers = new Map<string, ProcessState>();
  private readonly listeners = new Set<StatusListener>();
  private status: IrisDispatcherStatus = {
    state: 'idle',
    runId: null,
    runCount: 0,
    previewMonitorAttached: false,
    recordingMonitorAttached: false,
    previewOpen: false,
    stopping: false,
    failed: false,
  };

  private emitStatus(partial: Partial<IrisDispatcherStatus> = {}): void {
    this.status = { ...this.status, ...partial };
    for (const listener of [...this.listeners]) {
      listener(this.getStatus());
    }
  }

  getStatus(): IrisDispatcherStatus {
    return { ...this.status };
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  hasExecutable(): boolean {
    const cliPath = getIrisCliPath();
    return typeof cliPath === 'string' && !!cliPath && fs.existsSync(cliPath);
  }

  getExecutablePath(): string {
    return getIrisCliPath();
  }

  async startRun(input: StartIrisRunInput = {}): Promise<{ ok: boolean; runId: string | null; state: IrisDispatcherState; runCount: number; failed: boolean; error?: string }> {
    const runId = input.run_id ?? `run-${Date.now()}`;

    const cliPath = this.getExecutablePath();
    if (!fs.existsSync(cliPath)) {
      const message = getIrisCliMissingMessage();
      this.emitStatus({
        state: 'failed',
        runId: null,
        runCount: this.status.runCount,
        previewMonitorAttached: false,
        previewOpen: false,
        stopping: false,
        failed: true,
      });

      return {
        ok: false,
        runId: null,
        state: 'failed',
        runCount: this.getStatus().runCount,
        failed: true,
        error: message,
      };
    }

    this.emitStatus({
      state: 'starting',
      runId,
      runCount: this.status.runCount + 1,
      previewMonitorAttached: false,
      previewOpen: false,
      stopping: false,
      failed: false,
    });

    const runner = await this.startStandard({
      sessionId: runId,
      options: {
        run_id: runId,
        camera_width: input.camera_width ?? 1920,
        camera_height: input.camera_height ?? 1080,
        video_fps: input.video_fps ?? 30,
        cameras: input.cameras ?? [],
        verbose: input.verbose ?? false,
        profileFile: input.profileFile,
      },
      onCliOutput: (payload) => console.log(`[iris:${runId}] ${payload.channel}`, payload.line),
    });

    if (!runner.ok) {
      this.emitStatus({
        state: 'failed',
        failed: true,
        runId: null,
        previewMonitorAttached: false,
        previewOpen: false,
      });

      return {
        ok: false,
        runId: null,
        state: 'failed',
        runCount: this.getStatus().runCount,
        failed: true,
        error: typeof runner.error === 'string' ? runner.error : 'IRIS CLI could not be started',
      };
    }

    this.emitStatus({ state: 'running', runId, previewOpen: false, previewMonitorAttached: false, failed: false });

    return {
      ok: true,
      runId,
      state: 'running',
      runCount: this.getStatus().runCount,
      failed: false,
    };
  }

  async openPreviewMonitor(input: OpenIrisMonitorInput = {}): Promise<void> {
    if (!this.hasExecutable()) {
      this.emitStatus({
        state: 'failed',
        failed: true,
        previewMonitorAttached: false,
        previewOpen: false,
      });
      return;
    }

    const sessionId = `preview-${Date.now()}`;
    const monitorOptions = {
      ...input,
      sharedMemoryName: input.sharedMemoryName ?? 'iris_shm_ipc',
      outputDirectory: input.outputDirectory ?? process.cwd(),
      posePipePath: input.posePipePath ?? PIPE_NAME,
      verbose: input.verbose ?? false,
    };

    await this.startStream({
      sessionId,
      options: monitorOptions,
      onCliOutput: (payload) => console.log(`[iris:${sessionId}] ${payload.channel}`, payload.line),
      onFrame: (frame) => console.log('[iris:preview-frame]', frame),
    });

    this.emitStatus({
      state: 'previewing',
      previewMonitorAttached: true,
      previewOpen: true,
      failed: false,
    });
  }

  async closePreviewMonitor(): Promise<void> {
    for (const [sessionId, entry] of this.workers.entries()) {
      if (sessionId.startsWith('preview-')) {
        try {
          await this.stop(sessionId);
        } catch {
          // ignore cleanup issues for preview monitor close
        }
      }
    }

    this.emitStatus({
      state: this.status.runId ? 'running' : 'idle',
      previewMonitorAttached: false,
      previewOpen: false,
    });
  }

  async stopAll(): Promise<void> {
    this.emitStatus({
      state: 'stopping',
      stopping: true,
      previewMonitorAttached: false,
      previewOpen: false,
      failed: false,
    });

    const sessions = [...this.workers.keys()];
    await Promise.all(sessions.map((sessionId) => this.stop(sessionId)));

    this.emitStatus({
      state: 'idle',
      runId: null,
      previewMonitorAttached: false,
      previewOpen: false,
      stopping: false,
      failed: false,
    });
  }

  async shutdown(): Promise<void> {
    await this.stopAll();
  }

  async startStandard({ sessionId, options, onCliOutput }: ProcessStartOptions) {
    const cliPath = this.getExecutablePath();
    if (!this.hasExecutable()) {
      return { ok: false, error: getIrisCliMissingMessage() };
    }

    const { tmpDir, cfgPath } = writeTempConfigFile(buildConfigFromOptions(options));
    const child = spawn(cliPath, ['run', cfgPath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      onCliOutput?.({ channel: 'run:stdout', line: chunk.toString() });
    });

    child.stderr.on('data', (chunk) => {
      onCliOutput?.({ channel: 'run:stderr', line: chunk.toString() });
    });

    child.on('error', (error) => {
      console.error(`[iris:${sessionId}] start failed`, error);
    });

    this.workers.set(sessionId, { child });

    return {
      ok: true,
      sessionId,
      cfgPath,
      tmpDir,
      pid: child.pid,
    };
  }

  async startStream({ sessionId, options, onCliOutput, onFrame }: ProcessStartOptions) {
    const cliPath = this.getExecutablePath();
    if (!this.hasExecutable()) {
      return { ok: false, error: getIrisCliMissingMessage() };
    }

    const { tmpDir, cfgPath } = writeTempConfigFile(buildConfigFromOptions(options));

    let pipeServer: Awaited<ReturnType<typeof createPipeServer>> | null = null;
    try {
      pipeServer = await createPipeServer({
        pipeName: PIPE_NAME,
        onFrame: (frame) => onFrame?.(frame),
      });

      const args = ['monitor', '--shm-name', 'iris_shm_ipc', '--pipe', PIPE_NAME];
      const child = spawn(cliPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk) => {
        onCliOutput?.({ channel: 'monitor:stdout', line: chunk.toString() });
      });

      child.stderr.on('data', (chunk) => {
        onCliOutput?.({ channel: 'monitor:stderr', line: chunk.toString() });
      });

      this.workers.set(sessionId, { child });

      child.on('exit', async () => {
        if (pipeServer) {
          pipeServer.close();
        }
      });

      return {
        ok: true,
        sessionId,
        cfgPath,
        tmpDir,
        pid: child.pid,
      };
    } catch (error) {
      if (pipeServer) {
        try {
          pipeServer.close();
        } catch {
          // ignore cleanup errors
        }
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Pipe or CLI failed to start',
      };
    }
  }

  async stop(sessionId: string) {
    const entry = this.workers.get(sessionId);
    if (!entry) {
      return { ok: false, error: 'not_found' };
    }

    if (entry.stopPromise) {
      return entry.stopPromise;
    }

    entry.stopPromise = new Promise((resolve) => {
      const child = entry.child;

      child.once('exit', () => {
        this.workers.delete(sessionId);
        resolve({ ok: true, sessionId });
      });

      child.kill('SIGTERM');

      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 2500);
    });

    return entry.stopPromise;
  }
}
