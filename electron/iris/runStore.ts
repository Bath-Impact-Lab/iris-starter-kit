import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type IrisRunState = 'preparing' | 'recording' | 'processing' | 'complete' | 'failed' | 'stopped'

export interface IrisRunRecord {
  schemaVersion: 1
  runId: string
  state: IrisRunState
  createdAt: string
  updatedAt: string
  cameraCount: number
  assets: string[]
  error?: string
}

export class IrisRunStore {
  private readonly directory: string

  constructor(userDataDirectory: string) {
    this.directory = path.join(userDataDirectory, 'iris-runs')
  }

  async create(runId: string, cameraCount: number): Promise<IrisRunRecord> {
    const now = new Date().toISOString()
    const record: IrisRunRecord = {
      schemaVersion: 1,
      runId,
      state: 'preparing',
      createdAt: now,
      updatedAt: now,
      cameraCount,
      assets: [],
    }
    await this.save(record)
    return record
  }

  async update(runId: string, patch: Partial<Pick<IrisRunRecord, 'state' | 'assets' | 'error'>>): Promise<void> {
    const filePath = this.filePath(runId)
    const current = await this.read(filePath)
    await this.save({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    })
  }

  private async save(record: IrisRunRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const filePath = this.filePath(record.runId)
    const temporaryPath = `${filePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, JSON.stringify(record, null, 2), 'utf8')
    await rename(temporaryPath, filePath)
  }

  private async read(filePath: string): Promise<IrisRunRecord> {
    const { readFile } = await import('node:fs/promises')
    const value: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    if (!isIrisRunRecord(value)) {
      throw new Error('Stored Iris run metadata is invalid')
    }
    return value
  }

  private filePath(runId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
      throw new Error('Iris run ID is invalid')
    }
    return path.join(this.directory, `${runId}.json`)
  }
}

function isIrisRunRecord(value: unknown): value is IrisRunRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1
    && typeof record.runId === 'string'
    && typeof record.state === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string'
    && typeof record.cameraCount === 'number'
    && Array.isArray(record.assets)
}
