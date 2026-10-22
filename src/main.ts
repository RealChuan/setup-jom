import * as core from '@actions/core'
import { install } from './install.js'
import { isWindows } from './jom.js'

/**
 * The main function for the action.
 *
 * @param platform Platform to install for. Defaults to `process.platform`, and
 * can be overridden by tests so the Windows and non Windows paths are covered
 * on every runner.
 * @returns Resolves when the action is complete.
 */
export async function run(platform: string = process.platform): Promise<void> {
  try {
    if (!isWindows(platform)) {
      core.warning(
        `JOM is only available on Windows, skipping the installation on "${platform}".`
      )
      core.setOutput('jom-path', '')
      core.setOutput('jom-executable', '')
      core.setOutput('jom-version', '')
      core.setOutput('jom-skipped', 'true')
      return
    }

    const result = await install({
      version: core.getInput('jom-version'),
      installDir: core.getInput('install-dir'),
      clean: core.getBooleanInput('clean'),
      verifyChecksum: core.getBooleanInput('verify-checksum'),
      platform
    })

    if (core.getBooleanInput('add-to-path')) {
      core.addPath(result.installDir)
      core.info(`Added ${result.installDir} to PATH`)
    }

    core.setOutput('jom-path', result.installDir)
    core.setOutput('jom-executable', result.executable)
    core.setOutput('jom-version', result.version)
    core.setOutput('jom-skipped', 'false')

    core.info(`JOM ${result.version} is ready at ${result.installDir}`)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
    else core.setFailed(String(error))
  }
}
