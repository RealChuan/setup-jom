/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * The `@actions/core` module and the install module are replaced with mocks so
 * that the tests only verify how inputs are turned into outputs and how errors
 * are reported.
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import { install } from '../__fixtures__/install.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/install.js', () => ({ install }))

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js')

describe('main.ts', () => {
  const inputs: Record<string, string> = {}

  beforeEach(() => {
    inputs['jom-version'] = ''
    inputs['install-dir'] = ''

    core.getInput.mockImplementation((name) => inputs[name] ?? '')
    core.getBooleanInput.mockImplementation((name) => inputs[name] !== 'false')
    install.mockResolvedValue({
      installDir: 'C:\\jom',
      executable: 'C:\\jom\\jom.exe',
      version: '1.1.7'
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('installs JOM with the default inputs', async () => {
    await run('win32')

    expect(install).toHaveBeenCalledWith({
      version: '',
      installDir: '',
      clean: true,
      verifyChecksum: true,
      platform: 'win32'
    })
  })

  it('passes the configured inputs through', async () => {
    inputs['jom-version'] = '1.1.5'
    inputs['install-dir'] = 'D:\\tools\\jom'
    inputs.clean = 'false'
    inputs['verify-checksum'] = 'false'

    await run('win32')

    expect(install).toHaveBeenCalledWith({
      version: '1.1.5',
      installDir: 'D:\\tools\\jom',
      clean: false,
      verifyChecksum: false,
      platform: 'win32'
    })
  })

  it('exposes the installation for the following steps', async () => {
    await run('win32')

    expect(core.addPath).toHaveBeenCalledWith('C:\\jom')
    expect(core.setOutput).toHaveBeenCalledWith('jom-path', 'C:\\jom')
    expect(core.setOutput).toHaveBeenCalledWith(
      'jom-executable',
      'C:\\jom\\jom.exe'
    )
    expect(core.setOutput).toHaveBeenCalledWith('jom-version', '1.1.7')
    expect(core.setOutput).toHaveBeenCalledWith('jom-skipped', 'false')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('does not touch PATH when add-to-path is false', async () => {
    inputs['add-to-path'] = 'false'

    await run('win32')

    expect(core.addPath).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith('jom-path', 'C:\\jom')
  })

  it('skips the installation on non Windows runners', async () => {
    await run('linux')

    expect(install).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringMatching(/only available on Windows/u)
    )
    expect(core.setOutput).toHaveBeenCalledWith('jom-path', '')
    expect(core.setOutput).toHaveBeenCalledWith('jom-executable', '')
    expect(core.setOutput).toHaveBeenCalledWith('jom-version', '')
    expect(core.setOutput).toHaveBeenCalledWith('jom-skipped', 'true')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('sets a failed status when the installation fails', async () => {
    install.mockRejectedValue(new Error('Failed to download JOM latest'))

    await run('win32')

    expect(core.setFailed).toHaveBeenCalledWith('Failed to download JOM latest')
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it('sets a failed status for non error rejections', async () => {
    install.mockRejectedValue('boom')

    await run('win32')

    expect(core.setFailed).toHaveBeenCalledWith('boom')
  })
})
