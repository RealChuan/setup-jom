/**
 * Platform aware helpers used to install JOM.
 *
 * Everything in this module is pure: it never touches the file system or the
 * network, which keeps the version and path handling easy to unit test.
 */
import * as path from 'node:path'

/** Directory the official JOM archives are published in. */
export const BASE_URL = 'https://download.qt.io/official_releases/jom'

/** Version alias that resolves to the newest stable release. */
export const LATEST = 'latest'

/** Name of the unversioned archive that always points at the newest release. */
export const LATEST_ARCHIVE = 'jom.zip'

/** Name of the file that holds the checksums of every published archive. */
export const CHECKSUM_FILE = 'md5sums.txt'

/** Directory JOM is installed into when the `install-dir` input is empty. */
export const DEFAULT_INSTALL_DIR = 'C:\\jom'

/** Name of the JOM executable inside the installation directory. */
export const EXECUTABLE_NAME = 'jom.exe'

/** A version with all three components, for example `1.1.7`. */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/u

/** A command and its arguments, ready to be handed to `@actions/exec`. */
export interface CommandSpec {
  command: string
  args: string[]
}

/** A resolved JOM release: the version, the archive name and its URL. */
export interface JomRelease {
  /** Normalised version, either `latest` or `major.minor.patch`. */
  version: string
  /** File name of the archive inside {@link BASE_URL}. */
  archive: string
  /** Full download URL of the archive. */
  url: string
}

/** Returns true when the given platform is a Windows platform. */
export function isWindows(platform: string = process.platform): boolean {
  return platform === 'win32'
}

/**
 * Normalises the `jom-version` input.
 *
 * Accepts `latest`, an empty string, `1.1.7` and the `1_1_7` spelling used by
 * the official archive names. Partial versions such as `1.1` are rejected:
 * guessing the patch level would silently install the wrong release.
 */
export function normalizeVersion(input: string = ''): string {
  const raw = input.trim()
  if (raw === '' || raw.toLowerCase() === LATEST) return LATEST

  const normalized = raw.replace(/^v/iu, '').replace(/_/gu, '.')
  if (!VERSION_PATTERN.test(normalized)) {
    throw new Error(
      `Invalid JOM version "${input}". Use "latest" or a full version such as "1.1.7".`
    )
  }

  return normalized
}

/**
 * Resolves a version input to the archive that has to be downloaded.
 *
 * `latest` uses the stable `jom.zip` alias, every other version uses the
 * `jom_<major>_<minor>_<patch>.zip` naming of the official release folder.
 */
export function resolveRelease(input: string = ''): JomRelease {
  const version = normalizeVersion(input)
  const archive =
    version === LATEST
      ? LATEST_ARCHIVE
      : `jom_${version.replace(/\./gu, '_')}.zip`

  return { version, archive, url: `${BASE_URL}/${archive}` }
}

/** URL of the checksum file for every published archive. */
export function checksumUrl(): string {
  return `${BASE_URL}/${CHECKSUM_FILE}`
}

/**
 * Parses the `md5sums.txt` file into a map of file name to MD5 hash.
 *
 * Lines that do not follow the `<md5> <file>` format are ignored, which keeps
 * the parser forgiving about the number of separating spaces and about the
 * `*` binary mode marker used by some `md5sum` implementations.
 */
export function parseChecksums(text: string): Map<string, string> {
  const checksums = new Map<string, string>()

  for (const line of text.split(/\r?\n/u)) {
    const match = line.trim().match(/^([0-9a-f]{32})\s+\*?(.+)$/iu)
    if (!match) continue

    checksums.set(match[2].trim(), match[1].toLowerCase())
  }

  return checksums
}

/**
 * Returns the highest JOM version listed in the parsed `md5sums.txt`.
 *
 * `latest` is resolved from the checksum file instead of the `jom.zip` alias:
 * the alias is not always kept in sync on the official mirrors, while the
 * versioned archives and their checksums are published together.
 */
export function newestVersion(
  checksums: Map<string, string>
): string | undefined {
  let newest: string[] | undefined

  for (const fileName of checksums.keys()) {
    const match = fileName.match(/^jom_(\d+)_(\d+)_(\d+)\.zip$/iu)
    if (!match) continue

    const candidate = [match[1], match[2], match[3]]
    if (!newest || compareVersions(candidate, newest) > 0) newest = candidate
  }

  return newest?.join('.')
}

/** Compares two three part versions numerically. */
function compareVersions(left: string[], right: string[]): number {
  for (let index = 0; index < 3; index++) {
    const difference = Number(left[index]) - Number(right[index])
    if (difference !== 0) return difference
  }

  return 0
}

/**
 * Resolves the `install-dir` input to an absolute path.
 *
 * An empty input selects {@link DEFAULT_INSTALL_DIR}; relative paths are
 * resolved against the workspace so `install-dir: jom` ends up inside the
 * checked out repository instead of somewhere in the runner profile.
 *
 * The path style follows `platform` rather than the host: `path.win32` treats
 * `/tmp/jom` as rooted (it would turn it into `\tmp\jom`), so a POSIX path can
 * only be handled with the POSIX flavour of the helpers.
 */
export function resolveInstallDir(
  input: string = '',
  workspace: string = process.env.GITHUB_WORKSPACE ?? process.cwd(),
  platform: string = process.platform
): string {
  const directory = input.trim() || DEFAULT_INSTALL_DIR

  if (isWindows(platform)) {
    return path.win32.isAbsolute(directory)
      ? path.win32.normalize(directory)
      : path.win32.resolve(workspace, directory)
  }

  return path.posix.isAbsolute(directory)
    ? path.posix.normalize(directory)
    : path.posix.resolve(workspace, directory)
}

/** Absolute path of the `jom.exe` inside the installation directory. */
export function jomExecutable(installDir: string): string {
  return path.join(installDir, EXECUTABLE_NAME)
}

/** Command that prints the version of the installed JOM. */
export function versionCommand(executable: string): CommandSpec {
  return { command: executable, args: ['/version'] }
}

/**
 * Quotes a command so that `@actions/exec` does not split it on whitespace.
 *
 * `exec()` tokenizes its first argument, so a path such as
 * `C:\Program Files\jom\jom.exe` would otherwise be cut in half.
 */
export function quoteCommand(command: string): string {
  return /\s/u.test(command) ? `"${command}"` : command
}

/**
 * Extracts the version from `jom /version` output.
 *
 * The first line looks like `jom 1.1.7 - empower your cores`; anything else
 * falls back to the first line of the output.
 */
export function parseVersion(output: string): string {
  const match = output.match(/jom(?:\s+version)?\s+v?(\d+\.\d+\.\d+)/iu)
  if (match) return match[1]

  const fallback = output.match(/v?(\d+\.\d+\.\d+)/u)
  if (fallback) return fallback[1]

  return output.trim().split(/\r?\n/u)[0] ?? ''
}
