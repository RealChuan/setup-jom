import { jest } from '@jest/globals'
import type { InstallOptions, InstallResult } from '../src/install.js'

export const install =
  jest.fn<(options: InstallOptions) => Promise<InstallResult>>()
