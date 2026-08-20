import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface IrisExecutableLocation {
  appPath: string
  resourcesPath: string
  isPackaged: boolean
  override?: string
  platform?: NodeJS.Platform
  irisHome?: string
  pathExists?: (path: string) => boolean
}

export interface IrisExecutableResolution {
  executablePath: string
  discovered: boolean
}

export function resolveIrisExecutable(location: IrisExecutableLocation): string {
  return resolveIrisExecutableResolution(location).executablePath
}

export function resolveIrisExecutableResolution(
  location: IrisExecutableLocation,
): IrisExecutableResolution {
  const pathExists = location.pathExists ?? existsSync
  if (location.override?.trim()) {
    const executablePath = path.resolve(location.override.trim())
    return { executablePath, discovered: pathExists(executablePath) }
  }

  const platform = location.platform ?? process.platform
  const executableName = platform === 'win32'
    ? 'iris_cli.exe'
    : 'iris_cli'
  const executableFromHome = (home: string) => path.join(home, 'bin', executableName)

  // IRIS is installed separately from Recapture. Its installer records the
  // installation root in IRIS_HOME, so prefer that manifest location over the
  // (normally absent) legacy bundled-resource path.
  const irisHome = location.irisHome?.trim()
    || process.env.IRIS_HOME?.trim()
    || getIrisHomeFromRegistry(platform)
  
  console.log('IRIS_HOME:', irisHome, process.env.IRIS_HOME, getIrisHomeFromRegistry(platform))
  if (irisHome) {
    const executable = executableFromHome(irisHome)
    if (pathExists(executable)) return { executablePath: executable, discovered: true }
  }

  const resourcesRoot = location.isPackaged
    ? location.resourcesPath
    : path.join(location.appPath, 'resources')

  const executablePath = path.join(resourcesRoot, 'iris', 'bin', executableName)
  return { executablePath, discovered: pathExists(executablePath) }
}

function getIrisHomeFromRegistry(platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return undefined

  for (const hive of [
    'HKCU\\Environment',
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  ]) {
    try {
      const output = execFileSync('reg', ['query', hive, '/v', 'IRIS_HOME'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const match = output.match(/IRIS_HOME\s+\w+\s+(.+)/)
      if (match?.[1]?.trim()) return match[1].trim()
    } catch {
      // The value is optional; continue with the remaining lookup locations.
    }
  }

  return undefined
}
