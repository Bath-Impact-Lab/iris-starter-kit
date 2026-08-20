import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { PIPE_NAME, buildConfigFromOptions, getIrisCliMissingMessage, getIrisCliPath } from './config.js'
import { createPipeServer } from './pipeServer.js'
import { IrisRunStore } from './runStore.js'
import { writeTempConfigFile } from './utils.js'

// IRIS's `run` pipeline and `monitor` process are two independent CLI
// invocations, not a sequential start -> calibrate -> mocap chain. `run`
// stays alive as ONE continuous process: it opens cameras, warms up
// detection/pose/triangulation, runs DA3 startup calibration inline inside
// the triangulation stage, then keeps streaming live 3D poses for mocap --
// all in the same process, without restarting. `monitor` is a separate,
// short-lived process that attaches to that run's shared-memory output and
// relays frames to us over the named pipe; it can be started, stopped, and
// restarted (e.g. swapping the calibration-view monitor for the live-preview
// monitor) without touching the underlying `run` process at all.
//
// These strings are copied verbatim from the IRIS C++ source so the markers
// stay exact even if the surrounding log formatting changes:
//   run:     core/src/pipeline_runtime.cpp   ("Pipeline warmup complete")
//   run:     core/stages/triangulation/triangulation.cpp
//              ("Waiting for startup DA3 calibration batch",
//               "Initialized live calibration from DA3 batch")
//   monitor: core/knect/monitor.cpp          ("Successfully attached to Shared Memory")
const IRIS_MILESTONES: Array<{ marker: string; describe: (line: string) => string }> = [
  {
    marker: 'Pipeline warmup complete',
    describe: () => 'pipeline warmup complete -- cameras open, detection/pose/triangulation stages running',
  },
  {
    marker: 'Waiting for startup DA3 calibration batch',
    describe: () => 'DA3 startup calibration -- waiting on triangulation for enough frames to converge',
  },
  {
    marker: 'Initialized live calibration from DA3 batch',
    describe: (line) => `DA3 startup calibration converged -- ${line.trim()}`,
  },
  {
    marker: 'Successfully attached to Shared Memory',
    describe: () => 'monitor attached to shared memory -- pose frames now streaming over the named pipe',
  },
]

function logIrisMilestones(tag: string, chunkText: string): void {
  for (const line of chunkText.split(/\r?\n/)) {
    if (!line.trim()) continue
    for (const milestone of IRIS_MILESTONES) {
      if (line.includes(milestone.marker)) {
        console.log(`[iris:${tag}] ✓ ${milestone.describe(line)}`)
      }
    }
  }
}

export interface CliOutputPayload {
  channel: string
  line: string
}

export interface ProcessStartOptions {
  sessionId: string
  options: Record<string, any>
  onCliOutput?: (payload: CliOutputPayload) => void
  onFrame?: (frame: unknown) => void
}

export interface ProcessManagerDependencies {
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => ChildProcess
  pathExists?: (filePath: string) => boolean
  getExecutablePath?: () => string
  getMissingMessage?: () => string
  createPipeServer?: typeof createPipeServer
  writeTempConfigFile?: typeof writeTempConfigFile
  pipeName?: string
}

export interface ProcessManagerOptions {
  runStore?: IrisRunStore
  dependencies?: ProcessManagerDependencies
}

export interface ProcessState {
  child: ChildProcess
  stopPromise?: Promise<{ ok: boolean; sessionId: string }>
}

export type IrisDispatcherState = 'idle' | 'starting' | 'running' | 'previewing' | 'stopping' | 'failed'

export interface IrisDispatcherStatus {
  state: IrisDispatcherState
  runId: string | null
  runCount: number
  previewMonitorAttached: boolean
  recordingMonitorAttached: boolean
  previewOpen: boolean
  stopping: boolean
  failed: boolean
}

export interface StartIrisRunInput {
  specFile?: string
  verbose?: boolean
  profileFile?: string
  run_id?: string
  camera_width?: number
  camera_height?: number
  video_fps?: number
  cameras?: Array<{ id: string | number; label?: string; resolution?: string; fps?: number; rotation?: number }>
}

export interface OpenIrisMonitorInput {
  sharedMemoryName?: string
  outputDirectory?: string
  posePipePath?: string
  videoPipes?: Array<{ cameraIndex: number; pipePath: string }>
  targetFps?: number
  savePoses?: boolean
  drawBoundingBoxes?: boolean
  drawKeypoints?: boolean
  drawIds?: boolean
  drawCaptureVolume?: boolean
  verbose?: boolean
}

export interface IrisProcessResult {
  exitCode: number | null
  stopped: boolean
  stdout?: string
  stderr?: string
}

export interface IrisRun {
  ready: Promise<void>
  completion: Promise<IrisProcessResult>
  stop: () => Promise<void>
}

export type StatusListener = (status: IrisDispatcherStatus) => void

export class ProcessManager {
  private readonly workers = new Map<string, ProcessState>()
  private readonly listeners = new Set<StatusListener>()
  private readonly spawnProcess: NonNullable<ProcessManagerDependencies['spawnProcess']>
  private readonly pathExists: NonNullable<ProcessManagerDependencies['pathExists']>
  private readonly resolveExecutablePath: NonNullable<ProcessManagerDependencies['getExecutablePath']>
  private readonly resolveMissingMessage: NonNullable<ProcessManagerDependencies['getMissingMessage']>
  private readonly openPipeServer: NonNullable<ProcessManagerDependencies['createPipeServer']>
  private readonly createTempConfig: NonNullable<ProcessManagerDependencies['writeTempConfigFile']>
  private readonly pipeName: string
  private status: IrisDispatcherStatus = {
    state: 'idle',
    runId: null,
    runCount: 0,
    previewMonitorAttached: false,
    recordingMonitorAttached: false,
    previewOpen: false,
    stopping: false,
    failed: false,
  }

  private readonly runStore?: IrisRunStore
  private streamSessionId: string | null = null

  constructor(options: ProcessManagerOptions = {}) {
    const dependencies = options.dependencies ?? {}
    this.runStore = options.runStore
    this.spawnProcess = dependencies.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions))
    this.pathExists = dependencies.pathExists ?? existsSync
    this.resolveExecutablePath = dependencies.getExecutablePath ?? getIrisCliPath
    this.resolveMissingMessage = dependencies.getMissingMessage ?? getIrisCliMissingMessage
    this.openPipeServer = dependencies.createPipeServer ?? createPipeServer
    this.createTempConfig = dependencies.writeTempConfigFile ?? writeTempConfigFile
    this.pipeName = dependencies.pipeName ?? PIPE_NAME
  }

  private emitStatus(partial: Partial<IrisDispatcherStatus> = {}): void {
    this.status = { ...this.status, ...partial }
    for (const listener of [...this.listeners]) {
      listener(this.getStatus())
    }
  }

  getStatus(): IrisDispatcherStatus {
    return { ...this.status }
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.getStatus())
    return () => {
      this.listeners.delete(listener)
    }
  }

  hasExecutable(): boolean {
    const cliPath = this.resolveExecutablePath()
    return typeof cliPath === 'string' && !!cliPath && this.pathExists(cliPath)
  }

  getExecutablePath(): string {
    return this.resolveExecutablePath()
  }

  async startRun(input: StartIrisRunInput = {}): Promise<{ ok: boolean; runId: string | null; state: IrisDispatcherState; runCount: number; failed: boolean; error?: string }> {
    const runId = input.run_id ?? `run-${Date.now()}`
    await this.runStore?.create(runId, input.cameras?.length ?? 0)

    const cliPath = this.getExecutablePath()
    if (!this.pathExists(cliPath)) {
      const message = this.resolveMissingMessage()
      this.emitStatus({
        state: 'failed',
        runId: null,
        runCount: this.status.runCount,
        previewMonitorAttached: false,
        previewOpen: false,
        stopping: false,
        failed: true,
      })
      await this.runStore?.update(runId, { state: 'failed', error: message })

      return {
        ok: false,
        runId: null,
        state: 'failed',
        runCount: this.getStatus().runCount,
        failed: true,
        error: message,
      }
    }

    this.emitStatus({
      state: 'starting',
      runId,
      runCount: this.status.runCount + 1,
      previewMonitorAttached: false,
      previewOpen: false,
      stopping: false,
      failed: false,
    })

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
    })

    if (!runner.ok) {
      this.emitStatus({
        state: 'failed',
        failed: true,
        runId: null,
        previewMonitorAttached: false,
        previewOpen: false,
      })
      await this.runStore?.update(runId, { state: 'failed', error: typeof runner.error === 'string' ? runner.error : 'IRIS CLI could not be started' })

      return {
        ok: false,
        runId: null,
        state: 'failed',
        runCount: this.getStatus().runCount,
        failed: true,
        error: typeof runner.error === 'string' ? runner.error : 'IRIS CLI could not be started',
      }
    }

    this.emitStatus({ state: 'running', runId, previewOpen: false, previewMonitorAttached: false, failed: false })
    await this.runStore?.update(runId, { state: 'recording' })

    return {
      ok: true,
      runId,
      state: 'running',
      runCount: this.getStatus().runCount,
      failed: false,
    }
  }

  async openPreviewMonitor(input: OpenIrisMonitorInput = {}): Promise<void> {
    if (!this.hasExecutable()) {
      this.emitStatus({
        state: 'failed',
        failed: true,
        previewMonitorAttached: false,
        previewOpen: false,
      })
      return
    }

    const sessionId = `preview-${Date.now()}`
    const monitorOptions = {
      ...input,
      sharedMemoryName: input.sharedMemoryName ?? 'iris_shm_ipc',
      outputDirectory: input.outputDirectory ?? process.cwd(),
      posePipePath: input.posePipePath ?? this.pipeName,
      verbose: input.verbose ?? false,
    }

    await this.startStream({
      sessionId,
      options: monitorOptions,
      onCliOutput: (payload) => console.log(`[iris:${sessionId}] ${payload.channel}`, payload.line),
      onFrame: (frame) => console.log('[iris:preview-frame]', frame),
    })

    this.emitStatus({
      state: 'previewing',
      previewMonitorAttached: true,
      previewOpen: true,
      failed: false,
    })
  }

  async closePreviewMonitor(): Promise<void> {
    for (const [sessionId, entry] of this.workers.entries()) {
      if (sessionId.startsWith('preview-')) {
        try {
          await this.stop(sessionId)
        } catch {
          // ignore cleanup issues for preview monitor close
        }
      }
    }

    this.emitStatus({
      state: this.status.runId ? 'running' : 'idle',
      previewMonitorAttached: false,
      previewOpen: false,
    })
  }

  async stopAll(): Promise<void> {
    this.emitStatus({
      state: 'stopping',
      stopping: true,
      previewMonitorAttached: false,
      previewOpen: false,
      failed: false,
    })

    const sessions = [...this.workers.keys()]
    await Promise.all(sessions.map((sessionId) => this.stop(sessionId)))

    this.emitStatus({
      state: 'idle',
      runId: null,
      previewMonitorAttached: false,
      previewOpen: false,
      stopping: false,
      failed: false,
    })
  }

  async shutdown(): Promise<void> {
    await this.stopAll()
  }

  async startStandard({ sessionId, options, onCliOutput }: ProcessStartOptions) {
    console.log(`[iris:run:${sessionId}] step 1/3 -- resolving iris_cli.exe`)
    const cliPath = this.getExecutablePath()
    if (!this.hasExecutable()) {
      console.error(`[iris:run:${sessionId}] step 1/3 FAILED -- no executable at ${cliPath}`)
      return { ok: false, error: getIrisCliMissingMessage() }
    }
    console.log(`[iris:run:${sessionId}] step 1/3 done -- ${cliPath}`)

    console.log(`[iris:run:${sessionId}] step 2/3 -- writing pipeline spec (run_id, runtime, shared, pipeline incl. da3_startup_calibration)`)
    const { tmpDir, cfgPath } = this.createTempConfig(buildConfigFromOptions(options))
    console.log(`[iris:run:${sessionId}] step 2/3 done -- ${cfgPath}`)

    console.log(`[iris:run:${sessionId}] step 3/3 -- spawning "iris_cli run ${cfgPath}"`)
    const child = this.spawnProcess(cliPath, ['run', cfgPath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    console.log(`[iris:run:${sessionId}] step 3/3 done -- pid ${child.pid}; this process stays alive for capture, DA3 startup calibration, and live mocap -- watching stdout for milestones`)

    child.stdout!.on('data', (chunk) => {
      const text = chunk.toString()
      logIrisMilestones(`run:${sessionId}`, text)
      onCliOutput?.({ channel: 'run:stdout', line: text })
    })

    child.stderr!.on('data', (chunk) => {
      onCliOutput?.({ channel: 'run:stderr', line: chunk.toString() })
    })

    child.on('error', (error) => {
      console.error(`[iris:run:${sessionId}] start failed`, error)
    })

    child.on('exit', (code, signal) => {
      console.log(`[iris:run:${sessionId}] run process exited (code=${code}, signal=${signal})`)
    })

    this.workers.set(sessionId, { child })

    return {
      ok: true,
      sessionId,
      cfgPath,
      tmpDir,
      pid: child.pid,
    }
  }

  async startStream({ sessionId, options, onCliOutput, onFrame }: ProcessStartOptions) {
    console.log(`[iris:monitor:${sessionId}] Starting stream with options:`, options)
    console.log(`[iris:monitor:${sessionId}] step 1/4 -- resolving iris_cli.exe`)
    const cliPath = this.getExecutablePath()
    console.log(`[iris:monitor:${sessionId}] CLI path: ${cliPath}`)
    if (!this.hasExecutable()) {
      console.error(`[iris:monitor:${sessionId}] step 1/4 FAILED -- no executable at ${cliPath}`)
      return { ok: false, error: getIrisCliMissingMessage() }
    }
    console.log(`[iris:monitor:${sessionId}] step 1/4 done -- ${cliPath}`)

    // Only one process can hold the named pipe at a time; release it before
    // starting a new monitor/pose stream (e.g. calibration handing off to
    // the live preview monitor). This does NOT touch the underlying `run`
    // pipeline -- that keeps capturing/calibrating/tracking independently.
    if (this.streamSessionId && this.workers.has(this.streamSessionId)) {
      console.log(`[iris:monitor:${sessionId}] releasing previous monitor session "${this.streamSessionId}" (pipe is single-consumer)`)
      await this.stop(this.streamSessionId)
    }

    const { tmpDir, cfgPath } = this.createTempConfig(buildConfigFromOptions(options))

    let pipeServer: Awaited<ReturnType<typeof createPipeServer>> | null = null
    try {
      console.log(`[iris:monitor:${sessionId}] step 2/4 -- opening named pipe server at ${this.pipeName}`)
      pipeServer = await this.openPipeServer({
        pipeName: this.pipeName,
        onFrame: (frame) => onFrame?.(frame),
      })
      console.log(`[iris:monitor:${sessionId}] step 2/4 done -- named pipe listening`)

      const args = ['monitor', '--shm-name', 'iris_shm_ipc', '--pipe', PIPE_NAME]
      console.log(`[iris:monitor:${sessionId}] step 3/4 -- spawning "iris_cli ${args.join(' ')}"`)
      const child = this.spawnProcess(cliPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      console.log(`[iris:monitor:${sessionId}] step 3/4 done -- pid ${child.pid}; watching stdout for shared-memory attach`)
      console.log(`[iris:monitor:${sessionId}] step 4/4 -- waiting to attach to shared memory "iris_shm_ipc" (requires a "run" process already producing frames)`)

      child.stdout!.on('data', (chunk) => {
        const text = chunk.toString()
        logIrisMilestones(`monitor:${sessionId}`, text)
        onCliOutput?.({ channel: 'monitor:stdout', line: text })
      })

      child.stderr!.on('data', (chunk) => {
        onCliOutput?.({ channel: 'monitor:stderr', line: chunk.toString() })
      })

      this.workers.set(sessionId, { child })
      this.streamSessionId = sessionId

      child.on('exit', async (code, signal) => {
        console.log(`[iris:monitor:${sessionId}] monitor process exited (code=${code}, signal=${signal}); closing named pipe`)
        if (pipeServer) {
          pipeServer.close()
        }
        if (this.streamSessionId === sessionId) {
          this.streamSessionId = null
        }
      })

      return {
        ok: true,
        sessionId,
        cfgPath,
        tmpDir,
        pid: child.pid,
      }
    } catch (error) {
      console.error(`[iris:monitor:${sessionId}] step 2-3/4 FAILED`, error)
      if (pipeServer) {
        try {
          pipeServer.close()
        } catch {
          // ignore cleanup errors
        }
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Pipe or CLI failed to start',
      }
    }
  }

  async stop(sessionId: string) {
    const entry = this.workers.get(sessionId)
    if (!entry) {
      console.log(`[iris:${sessionId}] stop requested but no worker is running`)
      return { ok: false, error: 'not_found' }
    }

    if (entry.stopPromise) {
      return entry.stopPromise
    }

    console.log(`[iris:${sessionId}] stopping -- sending SIGTERM (pid ${entry.child.pid}), SIGKILL after 2500ms if still alive`)
    entry.stopPromise = new Promise((resolve) => {
      const child = entry.child

      child.once('exit', () => {
        console.log(`[iris:${sessionId}] stopped`)
        this.workers.delete(sessionId)
        if (!sessionId.startsWith('preview-')) {
          void this.runStore?.update(sessionId, { state: 'stopped' })
        }
        resolve({ ok: true, sessionId })
      })

      child.kill('SIGTERM')

      setTimeout(() => {
        if (!child.killed) {
          console.log(`[iris:${sessionId}] still alive after 2500ms -- sending SIGKILL`)
          child.kill('SIGKILL')
        }
      }, 2500)
    })

    return entry.stopPromise
  }
}
