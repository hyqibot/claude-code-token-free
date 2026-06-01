import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function formatDeviceFingerprint(cpuMd5Hex: string): string {
  if (cpuMd5Hex.length < 16) return cpuMd5Hex.toUpperCase().slice(0, 12)
  return (
    cpuMd5Hex.slice(11, 14) +
    cpuMd5Hex.slice(7, 10) +
    cpuMd5Hex.slice(3, 6) +
    cpuMd5Hex.slice(cpuMd5Hex.length - 3)
  ).toUpperCase()
}

async function readWindowsProcessorId(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty ProcessorId)",
      ],
      { timeout: 15_000, windowsHide: true },
    )
    return stdout.trim()
  } catch {
    return ''
  }
}

async function readWindowsMachineGuid(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid",
      ],
      { timeout: 15_000, windowsHide: true },
    )
    return stdout.trim()
  } catch {
    return ''
  }
}

export async function getGatewayDeviceId(): Promise<string> {
  const override = process.env.CC_HAHA_DEVICE_ID?.trim()
  if (override) return override.toUpperCase()

  let cpuMd5 = ''
  if (process.platform === 'win32') {
    const processorId = await readWindowsProcessorId()
    if (processorId) {
      cpuMd5 = createHash('md5').update(processorId, 'utf8').digest('hex')
    }
    if (!cpuMd5) {
      const guid = await readWindowsMachineGuid()
      if (guid) cpuMd5 = createHash('md5').update(guid, 'utf8').digest('hex')
    }
  }

  if (!cpuMd5) {
    cpuMd5 = createHash('md5').update(`${process.platform}-${process.arch}`, 'utf8').digest('hex')
  }

  return formatDeviceFingerprint(cpuMd5)
}
