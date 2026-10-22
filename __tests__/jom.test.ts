/**
 * Unit tests for the pure helpers in src/jom.ts
 *
 * These functions never touch the file system or the network, so the tests
 * only describe how inputs are normalised and how URLs are built.
 */
import * as path from 'node:path'
import {
  BASE_URL,
  DEFAULT_INSTALL_DIR,
  checksumUrl,
  isWindows,
  jomExecutable,
  newestVersion,
  normalizeVersion,
  parseChecksums,
  parseVersion,
  quoteCommand,
  resolveInstallDir,
  resolveRelease,
  versionCommand
} from '../src/jom.js'

describe('jom.ts', () => {
  describe('normalizeVersion', () => {
    it('defaults to latest', () => {
      expect(normalizeVersion('')).toBe('latest')
      expect(normalizeVersion('  ')).toBe('latest')
      expect(normalizeVersion('latest')).toBe('latest')
      expect(normalizeVersion('LATEST')).toBe('latest')
    })

    it('accepts dotted, underscored and v-prefixed versions', () => {
      expect(normalizeVersion('1.1.7')).toBe('1.1.7')
      expect(normalizeVersion('1_1_7')).toBe('1.1.7')
      expect(normalizeVersion('v1.1.7')).toBe('1.1.7')
      expect(normalizeVersion(' 1.1.7 ')).toBe('1.1.7')
    })

    it('rejects partial and malformed versions', () => {
      expect(() => normalizeVersion('1.1')).toThrow(/Invalid JOM version/u)
      expect(() => normalizeVersion('1')).toThrow(/Invalid JOM version/u)
      expect(() => normalizeVersion('nightly')).toThrow(/Invalid JOM version/u)
      expect(() => normalizeVersion('1.1.7.1')).toThrow(/Invalid JOM version/u)
    })
  })

  describe('resolveRelease', () => {
    it('uses the stable alias for latest', () => {
      expect(resolveRelease('')).toEqual({
        version: 'latest',
        archive: 'jom.zip',
        url: `${BASE_URL}/jom.zip`
      })
    })

    it('uses the versioned archive for a pinned version', () => {
      expect(resolveRelease('1.1.7')).toEqual({
        version: '1.1.7',
        archive: 'jom_1_1_7.zip',
        url: `${BASE_URL}/jom_1_1_7.zip`
      })
    })

    it('normalises the underscore spelling', () => {
      expect(resolveRelease('1_1_5').url).toBe(`${BASE_URL}/jom_1_1_5.zip`)
    })

    it('points the checksum file at the same directory', () => {
      expect(checksumUrl()).toBe(`${BASE_URL}/md5sums.txt`)
    })
  })

  describe('parseChecksums', () => {
    it('parses single and double space separated lines', () => {
      const checksums = parseChecksums(
        [
          'd3271c103e3ee9f67c3adced18db2e68  jom_1_1_7.zip',
          '4cd0e6fb721e063b24232bc9ecb6d130 jom.zip',
          ''
        ].join('\r\n')
      )

      expect(checksums.get('jom_1_1_7.zip')).toBe(
        'd3271c103e3ee9f67c3adced18db2e68'
      )
      expect(checksums.get('jom.zip')).toBe('4cd0e6fb721e063b24232bc9ecb6d130')
      expect(checksums.size).toBe(2)
    })

    it('handles the binary mode marker and upper case hashes', () => {
      const checksums = parseChecksums(
        'ABC123abc123abc123abc123abc12345 *jom.zip'
      )

      expect(checksums.get('jom.zip')).toBe('abc123abc123abc123abc123abc12345')
    })

    it('ignores lines that are not checksums', () => {
      const checksums = parseChecksums('not a checksum\n# comment\n')

      expect(checksums.size).toBe(0)
    })
  })

  describe('newestVersion', () => {
    it('picks the highest versioned archive', () => {
      const checksums = parseChecksums(
        [
          'd3271c103e3ee9f67c3adced18db2e68  jom_1_1_7.zip',
          'd1dffac4e4771c91207821d2426ba5aa  jom_1_1_6.zip',
          'f960efa8dc1e99df088d32bc1bc2157c  jom_1_1_3.zip',
          'b1c805be396035c03e2a94d78f3ef7af  jom_0_6_08.zip'
        ].join('\n')
      )

      expect(newestVersion(checksums)).toBe('1.1.7')
    })

    it('compares version parts numerically', () => {
      const checksums = parseChecksums(
        [
          'aa'.repeat(16) + '  jom_1_9_0.zip',
          'bb'.repeat(16) + '  jom_1_10_0.zip'
        ].join('\n')
      )

      expect(newestVersion(checksums)).toBe('1.10.0')
    })

    it('ignores the unversioned aliases', () => {
      const checksums = parseChecksums(
        'd3271c103e3ee9f67c3adced18db2e68  jom.zip'
      )

      expect(newestVersion(checksums)).toBeUndefined()
    })
  })

  describe('resolveInstallDir', () => {
    it('defaults to C:\\jom on Windows', () => {
      expect(DEFAULT_INSTALL_DIR).toBe('C:\\jom')
      expect(resolveInstallDir('', 'D:\\a\\repo\\repo', 'win32')).toBe(
        'C:\\jom'
      )
    })

    it('keeps absolute Windows paths and normalises separators', () => {
      expect(resolveInstallDir('C:/tools/jom', '', 'win32')).toBe(
        'C:\\tools\\jom'
      )
      expect(resolveInstallDir(' D:\\Qt\\jom ', '', 'win32')).toBe(
        'D:\\Qt\\jom'
      )
      expect(resolveInstallDir('\\\\server\\share\\jom', '', 'win32')).toBe(
        '\\\\server\\share\\jom'
      )
    })

    it('resolves relative paths against the workspace on Windows', () => {
      expect(resolveInstallDir('jom', 'D:\\a\\repo\\repo', 'win32')).toBe(
        'D:\\a\\repo\\repo\\jom'
      )
    })

    it('keeps POSIX paths intact on other hosts', () => {
      expect(resolveInstallDir('/opt/jom', '/workspace', 'linux')).toBe(
        '/opt/jom'
      )
      expect(resolveInstallDir('jom', '/workspace', 'linux')).toBe(
        '/workspace/jom'
      )
    })
  })

  describe('path and command helpers', () => {
    it('builds the jom.exe path', () => {
      expect(path.basename(jomExecutable('C:\\jom'))).toBe('jom.exe')
      expect(jomExecutable(process.cwd())).toBe(
        path.join(process.cwd(), 'jom.exe')
      )
    })

    it('asks jom for its version', () => {
      expect(versionCommand('C:\\jom\\jom.exe')).toEqual({
        command: 'C:\\jom\\jom.exe',
        args: ['/version']
      })
    })

    it('quotes commands that contain whitespace', () => {
      expect(quoteCommand('C:\\jom\\jom.exe')).toBe('C:\\jom\\jom.exe')
      expect(quoteCommand('C:\\Program Files\\jom\\jom.exe')).toBe(
        '"C:\\Program Files\\jom\\jom.exe"'
      )
    })

    it('knows which platforms are Windows', () => {
      expect(isWindows('win32')).toBe(true)
      expect(isWindows('linux')).toBe(false)
      expect(isWindows('darwin')).toBe(false)
    })
  })

  describe('parseVersion', () => {
    it('reads the version banner', () => {
      expect(parseVersion('jom version 1.1.7\n')).toBe('1.1.7')
      expect(parseVersion('jom 1.1.7 - empower your cores\n')).toBe('1.1.7')
    })

    it('is case insensitive and tolerates a v prefix', () => {
      expect(parseVersion('JOM v1.1.3 - empower your cores')).toBe('1.1.3')
    })

    it('falls back to the first version that appears', () => {
      expect(parseVersion('JOM, The Sequential Make replacement (1.1.5)')).toBe(
        '1.1.5'
      )
    })

    it('falls back to the first line when no version is found', () => {
      expect(parseVersion('unknown output\nsecond line')).toBe('unknown output')
    })
  })
})
