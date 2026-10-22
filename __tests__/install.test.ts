/**
 * Unit tests for the installation flow in src/install.ts
 *
 * The file system is real (a temporary directory is used) while
 * `@actions/core`, `@actions/exec` and `@actions/tool-cache` are mocked, so
 * nothing is downloaded and no command is executed.
 */
import { jest } from '@jest/globals'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as core from '../__fixtures__/core.js'
import * as exec from '../__fixtures__/exec.js'
import * as tc from '../__fixtures__/tool-cache.js'
import { BASE_URL } from '../src/jom.js'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/exec', () => exec)
jest.unstable_mockModule('@actions/tool-cache', () => tc)

const { install } = await import('../src/install.js')

const ARCHIVE_CONTENT = 'jom archive'
const OLD_CHECKSUM = 'd1dffac4e4771c91207821d2426ba5aa'

describe('install.ts', () => {
  let workspace: string
  let installDir: string
  let archivePath: string
  let checksumsPath: string
  let archiveMd5: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-jom-'))
    installDir = path.join(workspace, 'jom')
    archivePath = path.join(workspace, 'jom.zip')
    checksumsPath = path.join(workspace, 'md5sums.txt')

    fs.writeFileSync(archivePath, ARCHIVE_CONTENT)
    archiveMd5 = crypto.createHash('md5').update(ARCHIVE_CONTENT).digest('hex')

    tc.downloadTool.mockImplementation(async (url, destination) => {
      const source = url.endsWith('md5sums.txt') ? checksumsPath : archivePath
      if (destination) fs.copyFileSync(source, destination)
      return destination ?? source
    })
    tc.extractZip.mockImplementation(async (_file, dest) => {
      fs.mkdirSync(dest, { recursive: true })
      fs.writeFileSync(path.join(dest, 'jom.exe'), '')
      return dest
    })
    exec.getExecOutput.mockResolvedValue({
      exitCode: 0,
      stdout: 'jom version 1.1.7\n',
      stderr: ''
    })

    writeChecksums({
      'jom_1_1_6.zip': OLD_CHECKSUM,
      'jom_1_1_7.zip': archiveMd5
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  /** Writes a `md5sums.txt` with the given entries. */
  function writeChecksums(entries: Record<string, string>): void {
    fs.writeFileSync(
      checksumsPath,
      Object.entries(entries)
        .map(([name, hash]) => `${hash}  ${name}`)
        .join('\n')
    )
  }

  it('installs the newest version for "latest"', async () => {
    const result = await install({ installDir, platform: 'win32' })

    expect(result).toEqual({
      installDir,
      executable: path.join(installDir, 'jom.exe'),
      version: '1.1.7'
    })
    expect(tc.downloadTool).toHaveBeenNthCalledWith(
      1,
      `${BASE_URL}/md5sums.txt`,
      expect.stringMatching(/md5sums\.txt$/u)
    )
    expect(tc.downloadTool).toHaveBeenNthCalledWith(
      2,
      `${BASE_URL}/jom_1_1_7.zip`,
      expect.stringMatching(/jom_1_1_7\.zip$/u)
    )
    expect(tc.extractZip).toHaveBeenCalledWith(
      expect.stringMatching(/jom_1_1_7\.zip$/u),
      installDir
    )
    expect(exec.getExecOutput).toHaveBeenCalledWith(
      path.join(installDir, 'jom.exe'),
      ['/version'],
      expect.anything()
    )
    expect(core.info).toHaveBeenCalledWith(
      expect.stringMatching(/Resolved "latest" to JOM 1\.1\.7/u)
    )
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('cleans up the temporary downloads', async () => {
    await install({ installDir, platform: 'win32' })

    const destinations = tc.downloadTool.mock.calls.map(
      ([, destination]) => destination as string
    )

    expect(destinations).toHaveLength(2)
    for (const destination of destinations) {
      expect(fs.existsSync(destination)).toBe(false)
    }
  })

  it('installs a pinned version', async () => {
    writeChecksums({ 'jom_1_1_5.zip': archiveMd5 })

    await install({ version: '1_1_5', installDir, platform: 'win32' })

    expect(tc.downloadTool).toHaveBeenNthCalledWith(
      1,
      `${BASE_URL}/md5sums.txt`,
      expect.any(String)
    )
    expect(tc.downloadTool).toHaveBeenNthCalledWith(
      2,
      `${BASE_URL}/jom_1_1_5.zip`,
      expect.any(String)
    )
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('fails when the checksum does not match', async () => {
    writeChecksums({ 'jom_1_1_7.zip': OLD_CHECKSUM })

    await expect(install({ installDir, platform: 'win32' })).rejects.toThrow(
      /Checksum mismatch/u
    )
    expect(tc.extractZip).not.toHaveBeenCalled()
  })

  it('continues when the checksum file has no entry for the archive', async () => {
    writeChecksums({ 'jom_1_1_7.zip': archiveMd5 })

    const result = await install({
      version: '1.1.5',
      installDir,
      platform: 'win32'
    })

    expect(result.version).toBe('1.1.7')
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringMatching(/no entry for jom_1_1_5\.zip/u)
    )
  })

  it('falls back to the stable alias when the checksum file is unavailable', async () => {
    tc.downloadTool.mockImplementation(async (url) => {
      if (url.endsWith('md5sums.txt')) throw new Error('404')
      return archivePath
    })

    const result = await install({ installDir, platform: 'win32' })

    expect(result.version).toBe('1.1.7')
    expect(tc.downloadTool).toHaveBeenCalledWith(
      `${BASE_URL}/jom.zip`,
      expect.any(String)
    )
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringMatching(/Unable to download md5sums\.txt/u)
    )
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringMatching(/falling back to jom\.zip/u)
    )
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringMatching(/Skipping checksum verification/u)
    )
  })

  it('skips the checksum download when verification is disabled', async () => {
    await install({
      version: '1.1.7',
      installDir,
      platform: 'win32',
      verifyChecksum: false
    })

    expect(tc.downloadTool).toHaveBeenCalledTimes(1)
    expect(tc.downloadTool).toHaveBeenCalledWith(
      `${BASE_URL}/jom_1_1_7.zip`,
      expect.any(String)
    )
  })

  it('removes an existing installation when clean is true', async () => {
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'stale.txt'), 'stale')

    await install({ installDir, platform: 'win32', clean: true })

    expect(fs.existsSync(path.join(installDir, 'stale.txt'))).toBe(false)
  })

  it('reuses an existing directory when clean is false', async () => {
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'keep.txt'), 'keep')

    await install({ installDir, platform: 'win32', clean: false })

    expect(fs.existsSync(path.join(installDir, 'keep.txt'))).toBe(true)
    expect(core.info).toHaveBeenCalledWith(
      expect.stringMatching(/Reusing the existing directory/u)
    )
  })

  it('explains when the installation directory cannot be created', async () => {
    fs.writeFileSync(installDir, 'not a directory')

    await expect(
      install({ installDir, platform: 'win32', clean: false })
    ).rejects.toThrow(/Unable to create/u)
  })

  it('fails when jom.exe is missing after extracting', async () => {
    tc.extractZip.mockResolvedValue(installDir)

    await expect(install({ installDir, platform: 'win32' })).rejects.toThrow(
      /was not found after extracting/u
    )
  })

  it('fails when the version cannot be read', async () => {
    exec.getExecOutput.mockRejectedValue(new Error('exit code 1'))

    await expect(install({ installDir, platform: 'win32' })).rejects.toThrow(
      /Failed to run/u
    )
  })

  it('reports the download URL when the download fails', async () => {
    tc.downloadTool.mockRejectedValue(new Error('404'))

    await expect(install({ installDir, platform: 'win32' })).rejects.toThrow(
      /Failed to download JOM latest from https:\/\/download\.qt\.io/u
    )
  })

  it('rejects unsupported platforms', async () => {
    await expect(install({ installDir, platform: 'linux' })).rejects.toThrow(
      /only be installed on Windows/u
    )
  })
})
