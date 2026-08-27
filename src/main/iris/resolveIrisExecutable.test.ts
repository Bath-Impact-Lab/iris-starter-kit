import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveIrisExecutable, resolveIrisExecutableResolution } from './resolveIrisExecutable.js'

describe('resolveIrisExecutable', () => {
  const location = {
    appPath: 'C:\\Recapture',
    resourcesPath: 'C:\\Recapture\\resources',
    isPackaged: true,
    platform: 'win32' as const,
  }

  it('uses the IRIS installation manifest location when it contains the CLI', () => {
    expect(resolveIrisExecutable({
      ...location,
      irisHome: 'C:\\Program Files\\Bath Impact Lab\\IRIS',
      pathExists: (candidate: string) => candidate.includes('IRIS') && candidate.endsWith('iris_cli.exe'),
    })).toBe(path.join('C:\\Program Files\\Bath Impact Lab\\IRIS', 'bin', 'iris_cli.exe'))
  })

  it('keeps the explicit executable override as the highest-priority setting', () => {
    expect(resolveIrisExecutable({
      ...location,
      irisHome: 'C:\\Program Files\\Bath Impact Lab\\IRIS',
      override: 'D:\\tools\\iris_cli.exe',
    })).toBe(path.resolve('D:\\tools\\iris_cli.exe'))
  })

  it('falls back to the bundled resource path when no installed CLI is available', () => {
    expect(resolveIrisExecutable({
      ...location,
      irisHome: 'C:\\Program Files\\Bath Impact Lab\\IRIS',
      pathExists: () => false,
    })).toBe(path.join('C:\\Recapture\\resources', 'iris', 'bin', 'iris_cli.exe'))
  })

  it('reports when the fallback executable has not been discovered', () => {
    expect(resolveIrisExecutableResolution({
      ...location,
      pathExists: () => false,
    })).toEqual({
      executablePath: path.join('C:\\Recapture\\resources', 'iris', 'bin', 'iris_cli.exe'),
      discovered: false,
    })
  })
})
