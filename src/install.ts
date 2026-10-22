/**
 * Installs JOM on the current runner.
 *
 * The archive is downloaded from the official Qt mirror, verified against the
 * published MD5 sums and extracted into the requested directory. Nothing else
 * is installed and no machine wide configuration is changed.
 */
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import * as tc from '@actions/tool-cache'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  CHECKSUM_FILE,
  LATEST,
  LATEST_ARCHIVE,
  checksumUrl,
  isWindows,
  jomExecutable,
  newestVersion,
  parseChecksums,
  parseVersion,
  quoteCommand,
  resolveInstallDir,
  resolveRelease,
  versionCommand
} from './jom.js'
import type { JomRelease } from './jom.js'

/** Options accepted by {@link install}. */
export interface InstallOptions {
  /** Version to install, either `latest` or `major.minor.patch`. */
  version?: string
  /** Target directory. Defaults to `C:\jom`. */
  installDir?: string
  /** Remove an existing installation before extracting. Defaults to `true`. */
  clean?: boolean
  /** Verify the downloaded archive against `md5sums.txt`. Defaults to `true`. */
  verifyChecksum?: boolean
  /** Directory relative install paths are resolved against. */
  workspace?: string
  /** Platform to install for. Defaults to `process.platform`. */
  platform?: string
}

/** Result of a successful installation. */
export interface InstallResult {
  /** Directory JOM was installed into. */
  installDir: string
  /** Absolute path of `jom.exe`. */
  executable: string
  /** Version reported by `jom /version`. */
  version: string
}

/**
 * Installs JOM and returns where it lives and which version was installed.
 */
export async function install(
  options: InstallOptions = {}
): Promise<InstallResult> {
  const platform = options.platform ?? process.platform
  if (!isWindows(platform)) {
    throw new Error(
      `JOM can only be installed on Windows, but the runner platform is "${platform}".`
    )
  }

  const verify = options.verifyChecksum ?? true
  // `install-dir` points at the host file system, so it is resolved with the
  // host's path rules. `platform` only decides whether JOM can be installed.
  const installDir = resolveInstallDir(
    options.installDir ?? '',
    options.workspace
  )

  let release = resolveRelease(options.version ?? '')

  // Downloads go into a directory owned by this step. The archive keeps its
  // real name, because `Expand-Archive` refuses to unpack a file without the
  // `.zip` extension on runners that only ship Windows PowerShell.
  const downloadDir = await fs.promises.mkdtemp(
    path.join(tempDirectory(), 'setup-jom-')
  )

  try {
    const checksums =
      verify || release.version === LATEST
        ? await fetchChecksums(downloadDir)
        : undefined

    if (release.version === LATEST) {
      const newest = checksums ? newestVersion(checksums) : undefined
      if (newest) {
        release = resolveRelease(newest)
        core.info(`Resolved "latest" to JOM ${newest}`)
      } else {
        core.warning(
          `Unable to determine the newest JOM version from ${CHECKSUM_FILE}, falling back to ${LATEST_ARCHIVE}`
        )
      }
    }

    core.info(`Installing JOM ${release.version} from ${release.url}`)

    const archivePath = await download(release, downloadDir)

    if (verify) {
      if (checksums) {
        await verifyChecksum(archivePath, release.archive, checksums)
      } else {
        core.warning(
          `Skipping checksum verification, ${CHECKSUM_FILE} is unavailable`
        )
      }
    } else {
      core.info('Skipping checksum verification')
    }

    await prepareInstallDir(installDir, options.clean ?? true)

    core.info(`Extracting ${release.archive} to ${installDir}`)
    await tc.extractZip(archivePath, installDir)
  } finally {
    await io.rmRF(downloadDir)
  }

  const executable = jomExecutable(installDir)
  if (!fs.existsSync(executable)) {
    throw new Error(
      `"${executable}" was not found after extracting ${release.archive}. The archive layout may have changed.`
    )
  }

  const version = await readVersion(executable)

  return { installDir, executable, version }
}

/** Downloads the release archive, turning failures into a helpful error. */
async function download(
  release: JomRelease,
  directory: string
): Promise<string> {
  try {
    return await tc.downloadTool(
      release.url,
      path.join(directory, release.archive)
    )
  } catch (error) {
    throw new Error(
      `Failed to download JOM ${release.version} from ${release.url}: ${messageOf(error)}. ` +
        'See https://download.qt.io/official_releases/jom/ for the published versions.',
      { cause: error }
    )
  }
}

/**
 * Downloads and parses the official `md5sums.txt`.
 *
 * The file is best effort: a mirror hiccup should not block the installation,
 * so a failure only produces a warning and returns `undefined`.
 */
async function fetchChecksums(
  directory: string
): Promise<Map<string, string> | undefined> {
  try {
    const checksumsPath = await tc.downloadTool(
      checksumUrl(),
      path.join(directory, CHECKSUM_FILE)
    )
    return parseChecksums(await fs.promises.readFile(checksumsPath, 'utf8'))
  } catch (error) {
    core.warning(`Unable to download ${CHECKSUM_FILE}: ${messageOf(error)}`)
    return undefined
  }
}

/** Base directory the temporary download directory is created in. */
function tempDirectory(): string {
  const runnerTemp = process.env.RUNNER_TEMP?.trim()
  return runnerTemp || os.tmpdir()
}

/**
 * Checks the archive against the official `md5sums.txt`.
 *
 * A missing entry only produces a warning, because older releases may not be
 * listed. A hash mismatch is treated as corruption and fails the step.
 */
async function verifyChecksum(
  archivePath: string,
  archive: string,
  checksums: Map<string, string>
): Promise<void> {
  const expected = checksums.get(archive)
  if (!expected) {
    core.warning(
      `${CHECKSUM_FILE} has no entry for ${archive}, skipping checksum verification`
    )
    return
  }

  const actual = await md5File(archivePath)
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${archive}: expected ${expected}, got ${actual}. The download is corrupted or was tampered with.`
    )
  }

  core.info(`Checksum verified for ${archive}`)
}

/** Removes (or reuses) a previous installation and creates the directory. */
async function prepareInstallDir(
  installDir: string,
  clean: boolean
): Promise<void> {
  if (fs.existsSync(installDir)) {
    if (clean) {
      core.info(`Removing the existing installation at ${installDir}`)
      await io.rmRF(installDir)
    } else {
      core.info(`Reusing the existing directory ${installDir}`)
    }
  }

  try {
    await io.mkdirP(installDir)
  } catch (error) {
    throw new Error(
      `Unable to create "${installDir}": ${messageOf(error)}. Set "install-dir" to a writable directory or clean it up first.`,
      { cause: error }
    )
  }
}

/** Reads the version of the freshly installed JOM. */
async function readVersion(executable: string): Promise<string> {
  const spec = versionCommand(executable)

  let stdout: string
  try {
    const result = await exec.getExecOutput(
      quoteCommand(spec.command),
      spec.args,
      { silent: true }
    )
    stdout = result.stdout
  } catch (error) {
    throw new Error(
      `Failed to run "${executable} /version": ${messageOf(error)}`,
      { cause: error }
    )
  }

  const version = parseVersion(stdout)
  if (!version) {
    throw new Error(
      `Unable to determine the JOM version from the output of "${executable} /version"`
    )
  }

  return version
}

/** Returns the MD5 hash of a file. */
async function md5File(filePath: string): Promise<string> {
  const hash = crypto.createHash('md5')
  hash.update(await fs.promises.readFile(filePath))
  return hash.digest('hex')
}

/** Returns a readable message for an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
